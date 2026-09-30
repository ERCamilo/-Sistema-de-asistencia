/**
 * Pedir asistencia a un Mini en verde: SA ya tiene una conexión de presencia
 * autenticada con él, y el servidor de señalización rechaza una segunda
 * conexión del mismo SA a esa sala. El pedido va por la conexión de presencia
 * si el Mini anunció que responde asistencia; si no, la presencia se suelta
 * mientras dura la conexión nueva y se retoma al terminar.
 */
import { P2PPresenceManager } from '../modules/features/p2p/P2PPresenceManager.js';
import {
    ATTENDANCE_READY_SCHEMA,
    ATTENDANCE_RESPONSE_SCHEMA,
    requestAttendanceFromPeer
} from '../modules/features/p2p/P2PAttendanceBridge.js';

const PEER = 'peer-mini-1';
const SA_PROJECT = 'PRJ-OBRA-1';

class FakeChannel {
    constructor() { this.readyState = 'open'; this.listeners = { message: new Set(), close: new Set() }; this.sent = []; }
    addEventListener(type, fn) { this.listeners[type]?.add(fn); }
    removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
    send(data) { this.sent.push(data); }
    receive(data) { for (const fn of [...this.listeners.message]) fn({ data: JSON.stringify(data) }); }
    close() { this.readyState = 'closed'; for (const fn of [...this.listeners.close]) fn(); }
}

const submission = req => ({
    schema: 'attendance-submission/v1',
    submissionId: '123e4567-e89b-42d3-a456-426614174001',
    saProjectId: req.saProjectId,
    scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-1' },
    deviceId: 'mini-device', rosterVersion: 'roster-1', capturedAt: '2026-09-07T12:00:00.000Z',
    workDate: req.fromDate,
    rows: [{ miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
});
const answer = (channel, extra = {}) => {
    const req = JSON.parse(channel.sent.at(-1));
    channel.receive({ schema: ATTENDANCE_RESPONSE_SCHEMA, requestId: req.requestId, saProjectId: req.saProjectId, ok: true, fromDate: req.fromDate, toDate: req.toDate, submissions: [submission(req)], ...extra });
};

function makeEnv() {
    const freshChannel = new FakeChannel();
    const identityStore = {
        getSelf: jest.fn(async () => ({ deviceId: 'sa-1', appType: 'sa' })),
        getPeer: jest.fn(async () => ({ peerId: PEER, peerApp: 'mini', displayName: 'Mini Obra', linkToken: 'token-abc-12345678901234567890123456789012' }))
    };
    const p2pCore = {
        makeIdentityStore: jest.fn(() => identityStore),
        deriveTrustedRoute: jest.fn(async () => ({ room: 'room-1', proof: 'p'.repeat(64) })),
        SignalingClient: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
        isChannelAuthenticated: jest.fn(() => true),
        createRtcSession: jest.fn().mockImplementation(async ({ onChannel }) => {
            setTimeout(() => onChannel(freshChannel), 0);
            return { close: jest.fn() };
        })
    };
    const p2pPairing = {
        attachTrusted: jest.fn().mockImplementation((ch, { onAuthenticated }) => {
            setTimeout(() => {
                onAuthenticated();
                ch.receive({ schema: ATTENDANCE_READY_SCHEMA });
                setTimeout(() => answer(ch), 5);
            }, 0);
            return { detach: jest.fn() };
        })
    };
    return { freshChannel, identityStore, p2pCore, p2pPairing };
}

describe('P2PPresenceManager — conexión reutilizable para asistencia', () => {
    const makeManager = () => new P2PPresenceManager({
        core: { isChannelAuthenticated: () => true },
        pairing: {},
        store: {},
        isOnlineFn: () => true
    });

    test('recuerda el aviso de asistencia solo en su propio canal', () => {
        const manager = makeManager();
        const channel = new FakeChannel();
        manager.registerChannel(PEER, channel);
        expect(manager.getAttendanceChannel(PEER)).toBeNull();
        channel.receive({ schema: ATTENDANCE_READY_SCHEMA });
        expect(manager.getAttendanceChannel(PEER)).toBe(channel);
        manager.registerChannel(PEER, new FakeChannel()); // canal nuevo: hay que volver a anunciar
        expect(manager.getAttendanceChannel(PEER)).toBeNull();
    });

    test('soltar un Mini cierra la presencia y no reconecta hasta retomarlo', async () => {
        const manager = makeManager();
        const session = { close: jest.fn() };
        manager.registerChannel(PEER, new FakeChannel(), session);
        const connect = jest.spyOn(manager, 'ensureConnected');
        expect(manager.releasePeer(PEER)).toBe(true);
        expect(session.close).toHaveBeenCalledWith('presence-released');
        manager.scheduleRetry(PEER);
        expect(manager.getPeerEntry(PEER).retryTimer).toBeNull();
        await manager.ensureConnected(PEER);
        manager.isStarted = true;
        connect.mockClear();
        manager.resumePeer(PEER);
        expect(connect).toHaveBeenCalledWith(PEER);
    });
});

describe('requestAttendanceFromPeer con presencia activa', () => {
    test('Mini en verde: pide por la conexión de presencia sin abrir otra', async () => {
        const env = makeEnv();
        const presenceChannel = new FakeChannel();
        const presence = {
            getAttendanceChannel: jest.fn(() => presenceChannel),
            setPeerTransferring: jest.fn(),
            releasePeer: jest.fn(),
            resumePeer: jest.fn()
        };
        const pending = requestAttendanceFromPeer({
            peerId: PEER, saProjectId: SA_PROJECT, fromDate: '2026-09-06', toDate: '2026-09-06',
            identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing, presence
        });
        await new Promise(r => setTimeout(r, 0));
        expect(presenceChannel.sent).toHaveLength(1);
        answer(presenceChannel);
        const result = await pending;
        expect(result.submissions).toHaveLength(1);
        expect(env.p2pCore.SignalingClient).not.toHaveBeenCalled();
        expect(presence.releasePeer).not.toHaveBeenCalled();
        expect(presence.setPeerTransferring.mock.calls).toEqual([[PEER, true], [PEER, false]]);
        expect(presenceChannel.readyState).toBe('open'); // la presencia sigue viva
    });

    test('si la conexión de presencia se cae, sigue con una conexión nueva', async () => {
        const env = makeEnv();
        const presenceChannel = new FakeChannel();
        const presence = {
            getAttendanceChannel: jest.fn(() => presenceChannel),
            setPeerTransferring: jest.fn(),
            releasePeer: jest.fn(() => false),
            resumePeer: jest.fn()
        };
        const pending = requestAttendanceFromPeer({
            peerId: PEER, saProjectId: SA_PROJECT, fromDate: '2026-09-06', toDate: '2026-09-06', timeoutMs: 2000,
            identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing, presence
        });
        await new Promise(r => setTimeout(r, 0));
        presenceChannel.close();
        const result = await pending;
        expect(result.submissions).toHaveLength(1);
        expect(presence.releasePeer).toHaveBeenCalledWith(PEER);
        expect(env.p2pCore.SignalingClient).toHaveBeenCalledTimes(1);
        expect(presence.resumePeer).toHaveBeenCalledWith(PEER);
    });

    test('sin aviso de asistencia: suelta la presencia, conecta y la retoma', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
        try {
            const env = makeEnv();
            const order = [];
            const presence = {
                getAttendanceChannel: jest.fn(() => null),
                releasePeer: jest.fn(() => { order.push('release'); return true; }),
                resumePeer: jest.fn(() => order.push('resume'))
            };
            env.p2pCore.SignalingClient.mockImplementation(() => { order.push('signaling'); return { close: jest.fn() }; });
            const pending = requestAttendanceFromPeer({
                peerId: PEER, saProjectId: SA_PROJECT, fromDate: '2026-09-06', toDate: '2026-09-06', timeoutMs: 5000,
                identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing, presence
            });
            await jest.advanceTimersByTimeAsync(2000);
            const result = await pending;
            expect(result.submissions).toHaveLength(1);
            expect(order).toEqual(['release', 'signaling', 'resume']);
        } finally {
            jest.useRealTimers();
        }
    });
});
