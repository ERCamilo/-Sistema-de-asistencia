import {
    ATTENDANCE_REQUEST_SCHEMA,
    ATTENDANCE_RESPONSE_SCHEMA,
    MAX_REQUEST_RANGE_DAYS,
    buildAttendanceRequest,
    validateAttendanceRequest,
    validateAttendanceResponse,
    validateCalendarDate,
    rangeDays,
    listLinkedMiniPeers,
    requestAttendanceFromPeer,
    requestMiniAttendance
} from '../modules/features/p2p/P2PAttendanceBridge.js';
import {
    AttendanceSubmissionInboxStore,
    AttendanceSubmissionReplayConflictError
} from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { consolidateAttendanceSubmissions } from '../modules/features/attendance/AttendanceConsolidation.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
    }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) {
        return this.store(name).get(key) || null;
    }
    async getAll(name) {
        return [...this.store(name).values()];
    }
    async update(name, value) {
        this.updates.push(name);
        const key = value.key ?? value.submissionId ?? value.eventId;
        this.store(name).set(key, JSON.parse(JSON.stringify(value)));
    }
    async delete(name, key) {
        this.store(name).delete(key);
    }
}

class FakeDataChannel {
    constructor() {
        this.readyState = 'open';
        this.listeners = new Set();
        this.sent = [];
    }
    addEventListener(type, fn) {
        if (type === 'message') this.listeners.add(fn);
    }
    removeEventListener(type, fn) {
        if (type === 'message') this.listeners.delete(fn);
    }
    send(data) {
        this.sent.push(data);
    }
    receiveMessage(data) {
        const event = { data: typeof data === 'string' ? data : JSON.stringify(data) };
        for (const fn of this.listeners) {
            fn(event);
        }
    }
    close() {
        this.readyState = 'closed';
    }
}

const SA_PROJECT = 'PRJ-OBRA-1';
const SUB_UUID_1 = '123e4567-e89b-42d3-a456-426614174001';
const SUB_UUID_2 = '123e4567-e89b-42d3-a456-426614174002';
const SUB_UUID_3 = '123e4567-e89b-42d3-a456-426614174003';
const SUB_UUID_9 = '123e4567-e89b-42d3-a456-426614174009';

function sampleSubmission({
    submissionId = SUB_UUID_1,
    saProjectId = SA_PROJECT,
    workDate = '2026-09-06',
    deviceId = 'mini-device'
} = {}) {
    return {
        schema: 'attendance-submission/v1',
        submissionId,
        saProjectId,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-1' },
        deviceId,
        rosterVersion: 'roster-1',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate,
        rows: [
            {
                miniLocalId: 'm1',
                number: '001',
                name: 'Ana Pérez',
                normalHours: 8,
                overtimeHours: 0,
                status: 'present',
                saEmployeeId: 'EMP-001'
            }
        ]
    };
}

function makeMockP2PEnvironment({
    peerId = 'peer-mini-1',
    peerName = 'Mini Obra 1',
    authSucceeds = true,
    autoRespond = true,
    responsePayload = null
} = {}) {
    const channel = new FakeDataChannel();
    let sessionClosed = false;
    let sessionCloseReason = null;

    const identityStore = {
        getSelf: jest.fn(async () => ({
            key: 'self',
            deviceId: 'sa-oficina-1',
            appType: 'sa',
            displayName: 'SA - Oficina'
        })),
        getPeer: jest.fn(async (id) => {
            if (id === peerId) {
                return {
                    peerId,
                    peerApp: 'mini',
                    displayName: peerName,
                    linkToken: 'token-abc-12345678901234567890123456789012'
                };
            }
            if (id === 'peer-mini-2') {
                return {
                    peerId: 'peer-mini-2',
                    peerApp: 'mini',
                    displayName: 'Mini Taller 2',
                    linkToken: 'token-def-12345678901234567890123456789012'
                };
            }
            return null;
        }),
        listPeers: jest.fn(async () => [
            {
                peerId,
                peerApp: 'mini',
                displayName: peerName,
                linkToken: 'token-abc-12345678901234567890123456789012'
            },
            {
                peerId: 'peer-mini-2',
                peerApp: 'mini',
                displayName: 'Mini Taller 2',
                linkToken: 'token-def-12345678901234567890123456789012'
            }
        ])
    };

    const p2pCore = {
        makeIdentityStore: jest.fn(() => identityStore),
        deriveTrustedRoute: jest.fn(async () => ({
            room: 'route-room-1',
            proof: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        })),
        SignalingClient: jest.fn().mockImplementation(() => ({
            connect: jest.fn(async () => {}),
            close: jest.fn()
        })),
        createRtcSession: jest.fn().mockImplementation(async ({ onChannel }) => {
            setTimeout(() => {
                onChannel?.(channel);
            }, 0);
            return {
                channel,
                close: jest.fn((reason) => {
                    sessionClosed = true;
                    sessionCloseReason = reason;
                    channel.close();
                })
            };
        })
    };

    const p2pPairing = {
        attachTrusted: jest.fn().mockImplementation((ch, { onAuthenticated, onError }) => {
            setTimeout(() => {
                if (authSucceeds) {
                    onAuthenticated?.();
                    if (autoRespond) {
                        setTimeout(() => {
                            if (ch.sent.length > 0) {
                                const req = JSON.parse(ch.sent[ch.sent.length - 1]);
                                const resp = responsePayload || {
                                    schema: ATTENDANCE_RESPONSE_SCHEMA,
                                    requestId: req.requestId,
                                    saProjectId: req.saProjectId,
                                    ok: true,
                                    fromDate: req.fromDate,
                                    toDate: req.toDate,
                                    submissions: [
                                        sampleSubmission({
                                            submissionId: SUB_UUID_1,
                                            saProjectId: req.saProjectId,
                                            workDate: req.fromDate,
                                            deviceId: 'mini-device'
                                        })
                                    ]
                                };
                                ch.receiveMessage(resp);
                            }
                        }, 5);
                    }
                } else {
                    onError?.(new Error('Autenticación P2P rechazada.'));
                }
            }, 0);
            return {
                detach: jest.fn()
            };
        })
    };

    return {
        channel,
        identityStore,
        p2pCore,
        p2pPairing,
        isSessionClosed: () => sessionClosed,
        getSessionCloseReason: () => sessionCloseReason
    };
}

describe('P2PAttendanceBridge — Request & Response Validation', () => {
    test('buildAttendanceRequest constructs exact canonical envelope', () => {
        const req = buildAttendanceRequest({
            saProjectId: 'PRJ-OBRA-1',
            fromDate: '2026-09-01',
            toDate: '2026-09-07',
            requestId: 'req-123'
        });

        expect(req).toEqual({
            schema: ATTENDANCE_REQUEST_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            fromDate: '2026-09-01',
            toDate: '2026-09-07'
        });
        expect(Object.isFrozen(req)).toBe(true);
    });

    test('buildAttendanceRequest generates valid requestId when omitted', () => {
        const req = buildAttendanceRequest({
            saProjectId: 'PRJ-OBRA-1',
            fromDate: '2026-09-01',
            toDate: '2026-09-01'
        });

        expect(req.requestId).toBeTruthy();
        expect(typeof req.requestId).toBe('string');
        expect(req.requestId.length).toBeLessThanOrEqual(128);
    });

    test('validates date range: rejects inverted dates and range > 31 days', () => {
        // Inverted dates
        expect(() => {
            buildAttendanceRequest({
                saProjectId: 'PRJ-OBRA-1',
                fromDate: '2026-09-07',
                toDate: '2026-09-01'
            });
        }).toThrow(/fromDate must be less than or equal to toDate/);

        // Exceeding 31 days (32 days: 2026-08-01 to 2026-09-01 = 32 days)
        expect(() => {
            buildAttendanceRequest({
                saProjectId: 'PRJ-OBRA-1',
                fromDate: '2026-08-01',
                toDate: '2026-09-01'
            });
        }).toThrow(/exceeds maximum allowed range of 31 days/);

        // Exactly 31 days succeeds (2026-08-01 to 2026-08-31 = 31 days)
        expect(() => {
            buildAttendanceRequest({
                saProjectId: 'PRJ-OBRA-1',
                fromDate: '2026-08-01',
                toDate: '2026-08-31'
            });
        }).not.toThrow();
    });

    test('validates canonical saProjectId and rejects invalid or whitespace IDs', () => {
        expect(() => {
            buildAttendanceRequest({
                saProjectId: '   ',
                fromDate: '2026-09-01',
                toDate: '2026-09-01'
            });
        }).toThrow(/canonical ID/);

        expect(() => {
            buildAttendanceRequest({
                saProjectId: 'PRJ WITH SPACES',
                fromDate: '2026-09-01',
                toDate: '2026-09-01'
            });
        }).toThrow(/canonical ID/);
    });

    test('validateAttendanceRequest rejects unexpected envelope keys', () => {
        expect(() => {
            validateAttendanceRequest({
                schema: ATTENDANCE_REQUEST_SCHEMA,
                requestId: 'req-1',
                saProjectId: 'PRJ-1',
                fromDate: '2026-09-01',
                toDate: '2026-09-01',
                unsupportedExtra: 'hack'
            });
        }).toThrow(/contains unsupported field "unsupportedExtra"/);
    });

    test('validateAttendanceResponse strictly correlates requestId and saProjectId', () => {
        const validResp = {
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: true,
            fromDate: '2026-09-01',
            toDate: '2026-09-07',
            submissions: []
        };

        expect(() => {
            validateAttendanceResponse(validResp, {
                expectedRequestId: 'req-123',
                expectedSaProjectId: 'PRJ-OBRA-1',
                expectedFromDate: '2026-09-01',
                expectedToDate: '2026-09-07'
            });
        }).not.toThrow();

        // Mismatched requestId
        expect(() => {
            validateAttendanceResponse(validResp, {
                expectedRequestId: 'req-OTHER',
                expectedSaProjectId: 'PRJ-OBRA-1'
            });
        }).toThrow(/requestId mismatch/);

        // Mismatched saProjectId
        expect(() => {
            validateAttendanceResponse(validResp, {
                expectedRequestId: 'req-123',
                expectedSaProjectId: 'PRJ-OTHER'
            });
        }).toThrow(/saProjectId mismatch/);
    });

    test('validateAttendanceResponse rejects unknown fields and malformed canonical identities', () => {
        const base = {
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: true,
            fromDate: '2026-09-01',
            toDate: '2026-09-01',
            submissions: []
        };
        expect(() => validateAttendanceResponse({ ...base, debug: true }))
            .toThrow(/unsupported field "debug"/);
        expect(() => validateAttendanceResponse({ ...base, requestId: 'req with spaces' }))
            .toThrow(/requestId must not contain whitespace/);
        expect(() => validateAttendanceResponse({ ...base, saProjectId: 'PRJ WITH SPACES' }))
            .toThrow(/canonical ID/);
    });

    test('validateAttendanceResponse validates returned range and correlates it to the request', () => {
        const base = {
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: true,
            fromDate: '2026-09-01',
            toDate: '2026-09-07',
            submissions: []
        };
        expect(() => validateAttendanceResponse(base, {
            expectedRequestId: 'req-123',
            expectedSaProjectId: 'PRJ-OBRA-1',
            expectedFromDate: '2026-09-02',
            expectedToDate: '2026-09-07'
        })).toThrow(/fromDate mismatch/);
        expect(() => validateAttendanceResponse({ ...base, toDate: '2026-09-31' }))
            .toThrow(/toDate must be YYYY-MM-DD/);
    });

    test('validateAttendanceResponse validates every submission and rejects rows outside the response range', () => {
        const outside = sampleSubmission({
            submissionId: SUB_UUID_2,
            saProjectId: 'PRJ-OBRA-1',
            workDate: '2026-09-08'
        });
        expect(() => validateAttendanceResponse({
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: true,
            fromDate: '2026-09-01',
            toDate: '2026-09-07',
            submissions: [outside]
        })).toThrow(/outside requested range/);
    });

    test('validateAttendanceResponse rejects duplicated submission identities and mixed success/error shape', () => {
        const sub = sampleSubmission({ workDate: '2026-09-01' });
        const base = {
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: true,
            fromDate: '2026-09-01',
            toDate: '2026-09-01'
        };
        expect(() => validateAttendanceResponse({ ...base, submissions: [sub, sub] }))
            .toThrow(/submissionId is duplicated/);
        expect(() => validateAttendanceResponse({ ...base, submissions: [], error: 'should not coexist' }))
            .toThrow(/must not contain error/);
    });

    test('validateAttendanceResponse throws error message when ok is false', () => {
        const errorResp = {
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: 'req-123',
            saProjectId: 'PRJ-OBRA-1',
            ok: false,
            error: 'Mini no tiene permisos para este proyecto'
        };

        expect(() => {
            validateAttendanceResponse(errorResp, {
                expectedRequestId: 'req-123',
                expectedSaProjectId: 'PRJ-OBRA-1'
            });
        }).toThrow('Mini no tiene permisos para este proyecto');
    });
});

describe('P2PAttendanceBridge — Trusted Connection, Timeout & Session Cleanup', () => {
    test('sends attendance request only after channel authentication', async () => {
        const env = makeMockP2PEnvironment();
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const result = await requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        expect(result.peerId).toBe('peer-mini-1');
        expect(result.submissions.length).toBe(1);
        expect(env.channel.sent.length).toBe(1);

        const sentRequest = JSON.parse(env.channel.sent[0]);
        expect(sentRequest.schema).toBe(ATTENDANCE_REQUEST_SCHEMA);
        expect(sentRequest.saProjectId).toBe(SA_PROJECT);

        // Session must be closed at the end
        expect(env.isSessionClosed()).toBe(true);
    });

    test('closes the RTC session even when response settles before createRtcSession promise resolves', async () => {
        const env = makeMockP2PEnvironment({ autoRespond: false });
        let closed = false;
        env.p2pCore.createRtcSession = jest.fn().mockImplementation(({ onChannel }) => {
            onChannel(env.channel);
            return new Promise(resolve => {
                setTimeout(() => resolve({
                    close: jest.fn(() => {
                        closed = true;
                        env.channel.close();
                    })
                }), 30);
            });
        });
        env.p2pPairing.attachTrusted = jest.fn().mockImplementation((channel, { onAuthenticated }) => {
            onAuthenticated();
            const req = JSON.parse(channel.sent[channel.sent.length - 1]);
            channel.receiveMessage({
                schema: ATTENDANCE_RESPONSE_SCHEMA,
                requestId: req.requestId,
                saProjectId: req.saProjectId,
                ok: true,
                fromDate: req.fromDate,
                toDate: req.toDate,
                submissions: []
            });
            return { detach: jest.fn() };
        });

        const result = await requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            timeoutMs: 1000,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        });

        expect(result.submissions).toEqual([]);
        expect(closed).toBe(true);
    });

    test('times out and fails closed if peer does not respond in time', async () => {
        const env = makeMockP2PEnvironment({ autoRespond: false });

        await expect(requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            timeoutMs: 50,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        })).rejects.toThrow(/timeout/);

        // Ensure session closed fail-closed
        expect(env.isSessionClosed()).toBe(true);
    });

    test('ignores unrelated control / roster traffic frames and resolves only on attendance-response/v1', async () => {
        const env = makeMockP2PEnvironment({ autoRespond: false });
        const promise = requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            timeoutMs: 1000,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        });

        // Wait for channel to be ready and send request
        await new Promise(r => setTimeout(r, 10));
        expect(env.channel.sent.length).toBe(1);
        const req = JSON.parse(env.channel.sent[0]);

        // Inject unrelated control frame
        env.channel.receiveMessage({
            protocol: 'sa-mini-p2p-control/v1',
            type: 'trusted-ok',
            data: { deviceId: 'peer-mini-1' }
        });

        // Inject unrelated roster frame
        env.channel.receiveMessage({
            protocol: 'sa-mini-p2p-transfer/v1',
            type: 'chunk'
        });

        // Now inject valid attendance response
        env.channel.receiveMessage({
            schema: ATTENDANCE_RESPONSE_SCHEMA,
            requestId: req.requestId,
            saProjectId: req.saProjectId,
            ok: true,
            fromDate: req.fromDate,
            toDate: req.toDate,
            submissions: []
        });

        const result = await promise;
        expect(result.submissions).toEqual([]);
        expect(env.isSessionClosed()).toBe(true);
    });

    test('fails closed when authentication fails', async () => {
        const env = makeMockP2PEnvironment({ authSucceeds: false });

        await expect(requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        })).rejects.toThrow(/Autenticación P2P rechazada/);

        expect(env.isSessionClosed()).toBe(true);
    });
});

describe('P2PAttendanceBridge — All-vs-One Selection Seam', () => {
    test('listLinkedMiniPeers returns linked Mini devices with resolved names', async () => {
        const env = makeMockP2PEnvironment();
        const peers = await listLinkedMiniPeers({ identityStore: env.identityStore, p2pCore: env.p2pCore });

        expect(peers.length).toBe(2);
        expect(peers[0].peerId).toBe('peer-mini-1');
        expect(peers[0].name).toBe('Mini Obra 1');
        expect(peers[1].peerId).toBe('peer-mini-2');
        expect(peers[1].name).toBe('Mini Taller 2');
    });

    test('requestMiniAttendance queries only specified Mini when miniId is provided', async () => {
        const env = makeMockP2PEnvironment();
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const result = await requestMiniAttendance({
            miniId: 'peer-mini-1',
            date: '2026-09-06',
            groupingMode: 'day',
            saProjectId: SA_PROJECT,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        expect(result.targetsCount).toBe(1);
        expect(result.respondedCount).toBe(1);
        expect(result.results[0].peerId).toBe('peer-mini-1');
    });

    test('requestMiniAttendance queries all linked Minis when miniId is empty', async () => {
        const env = makeMockP2PEnvironment();
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const result = await requestMiniAttendance({
            miniId: '', // Empty means ALL linked Minis
            date: '2026-09-06',
            groupingMode: 'day',
            saProjectId: SA_PROJECT,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        expect(result.targetsCount).toBe(2);
        expect(result.respondedCount).toBe(2);
    });

    test('period mode uses rangeStart and rangeEnd', async () => {
        const env = makeMockP2PEnvironment();
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const result = await requestMiniAttendance({
            miniId: 'peer-mini-1',
            rangeStart: '2026-09-01',
            rangeEnd: '2026-09-07',
            groupingMode: 'period',
            saProjectId: SA_PROJECT,
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        expect(result.ok).toBe(true);
        const sent = JSON.parse(env.channel.sent[0]);
        expect(sent.fromDate).toBe('2026-09-01');
        expect(sent.toDate).toBe('2026-09-07');
    });

    test('requires active official project and valid date range', async () => {
        const env = makeMockP2PEnvironment();

        // Missing active project
        await expect(requestMiniAttendance({
            saProjectId: null,
            date: '2026-09-06',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        })).rejects.toThrow(/Se requiere un proyecto activo/);

        // Missing date
        await expect(requestMiniAttendance({
            saProjectId: SA_PROJECT,
            date: '',
            groupingMode: 'day',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing
        })).rejects.toThrow(/Se requiere una fecha o rango válido/);
    });
});

describe('P2PAttendanceBridge — Inbox Staging & Metadata Transport Provenance', () => {
    test('imports returned submissions into inboxStore with metadata transport provenance', async () => {
        const env = makeMockP2PEnvironment({ peerName: 'Mini Especial Norte' });
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const result = await requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        expect(result.importedRecords.length).toBe(1);
        expect(result.importedRecords[0].outcome).toBe('imported');

        // Check record stored in inbox
        const stored = await inboxStore.get(SA_PROJECT, SUB_UUID_1);
        expect(stored).not.toBeNull();
        expect(stored.status).toBe('pending');
        expect(stored.metadata).toEqual({
            sourcePeerId: 'peer-mini-1',
            sourcePeerName: 'Mini Especial Norte'
        });

        // Source body deviceId must NOT be rewritten or faked
        expect(stored.sourceSnapshot.deviceId).toBe('mini-device');
    });

    test('duplicate submissions are accepted cleanly without error', async () => {
        const env = makeMockP2PEnvironment();
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        // First import
        await requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        });

        // Second import with same submission (duplicate)
        const env2 = makeMockP2PEnvironment();
        const result2 = await requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            identityStore: env2.identityStore,
            p2pCore: env2.p2pCore,
            p2pPairing: env2.p2pPairing,
            inboxStore
        });

        expect(result2.importedRecords.length).toBe(1);
        expect(result2.importedRecords[0].outcome).toBe('duplicate');
    });

    test('replay-content conflict throws AttendanceSubmissionReplayConflictError and surfaces', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        // First import submission with 8 hours
        const subOriginal = sampleSubmission({
            submissionId: SUB_UUID_1,
            saProjectId: SA_PROJECT,
            workDate: '2026-09-06'
        });
        await inboxStore.importSubmission(subOriginal, { expectedSaProjectId: SA_PROJECT });

        // Peer responds with DIFFERENT content for the SAME submissionId
        const subConflicting = {
            ...subOriginal,
            rows: [
                {
                    miniLocalId: 'm1',
                    number: '001',
                    name: 'Ana Pérez',
                    normalHours: 4, // CHANGED hours!
                    overtimeHours: 2,
                    status: 'present',
                    saEmployeeId: 'EMP-001'
                }
            ]
        };

        const env = makeMockP2PEnvironment({
            responsePayload: {
                schema: ATTENDANCE_RESPONSE_SCHEMA,
                requestId: 'req-conflict',
                saProjectId: SA_PROJECT,
                ok: true,
                fromDate: '2026-09-06',
                toDate: '2026-09-06',
                submissions: [subConflicting]
            }
        });

        await expect(requestAttendanceFromPeer({
            peerId: 'peer-mini-1',
            saProjectId: SA_PROJECT,
            fromDate: '2026-09-06',
            toDate: '2026-09-06',
            requestId: 'req-conflict',
            identityStore: env.identityStore,
            p2pCore: env.p2pCore,
            p2pPairing: env.p2pPairing,
            inboxStore
        })).rejects.toThrow(AttendanceSubmissionReplayConflictError);
    });

    test('consolidation prefers inbox record metadata sourcePeerName for generic deviceId', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        // Staged inbox draft 1 from Mini 1
        const sub1 = sampleSubmission({
            submissionId: SUB_UUID_1,
            deviceId: 'mini-device' // generic
        });
        await inboxStore.importSubmission(sub1, {
            expectedSaProjectId: SA_PROJECT,
            metadata: { sourcePeerId: 'peer-1', sourcePeerName: 'Mini Juan' }
        });

        // Staged inbox draft 2 from Mini 2
        const sub2 = sampleSubmission({
            submissionId: SUB_UUID_2,
            deviceId: 'mini-device' // generic
        });
        await inboxStore.importSubmission(sub2, {
            expectedSaProjectId: SA_PROJECT,
            metadata: { sourcePeerId: 'peer-2', sourcePeerName: 'Mini Pedro' }
        });

        const drafts = await inboxStore.list({ saProjectId: SA_PROJECT });
        const consolidated = consolidateAttendanceSubmissions(drafts);

        expect(consolidated.devices).toContain('Mini Juan');
        expect(consolidated.devices).toContain('Mini Pedro');

        const item = consolidated.items[0];
        expect(item.sources.length).toBe(2);
        expect(item.sources[0].deviceId).toBe('Mini Juan');
        expect(item.sources[0].sourcePeerName).toBe('Mini Juan');
        expect(item.sources[1].deviceId).toBe('Mini Pedro');
        expect(item.sources[1].sourcePeerName).toBe('Mini Pedro');

        // Grouping identity strictly remains (saProjectId, saEmployeeId, workDate)
        expect(item.saProjectId).toBe(SA_PROJECT);
        expect(item.saEmployeeId).toBe('EMP-001');
        expect(item.workDate).toBe('2026-09-06');
    });
});

describe('MiniAttendanceImportModal — Connected Mode Async Behavior', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('handleFetchConnected is async, prevents duplicate clicks, and refreshes drafts', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        let resolveRequest;
        const requestPromise = new Promise(resolve => {
            resolveRequest = resolve;
        });
        const onRequestSpy = jest.fn().mockReturnValue(requestPromise);

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            inboxStore,
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        expect(fetchBtn).not.toBeNull();

        // 1. Click button
        fetchBtn.click();

        // In-flight state: onRequestSubmissions called once
        expect(onRequestSpy).toHaveBeenCalledTimes(1);
        expect(modal.isFetchingConnected).toBe(true);
        expect(modal.transportStatusMessage).toContain('Solicitando');

        // 2. Click again while in-flight: must NOT trigger second request (duplicate click prevention)
        fetchBtn.click();
        expect(onRequestSpy).toHaveBeenCalledTimes(1);

        // Stage a new submission in inbox to verify refresh on completion
        await inboxStore.importSubmission(
            sampleSubmission({ submissionId: SUB_UUID_9 }),
            { expectedSaProjectId: SA_PROJECT }
        );

        // 3. Resolve transport
        resolveRequest({
            ok: true,
            importedCount: 1,
            duplicateCount: 0,
            message: '✓ Asistencia recibida (1 importados)'
        });
        await new Promise(resolve => setTimeout(resolve, 10));

        // After completion: success status, drafts refreshed, isFetching cleared
        expect(modal.isFetchingConnected).toBe(false);
        expect(modal.transportStatusMessage).toContain('Asistencia recibida');
        expect(modal.savedDrafts.length).toBe(1);
        expect(modal.savedDrafts[0].submissionId).toBe(SUB_UUID_9);
    });

    test('handleFetchConnected displays error message when transport fails', async () => {
        const onRequestSpy = jest.fn().mockRejectedValue(new Error('Conexión P2P rechazada por Mini'));

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        fetchBtn.click();

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(modal.isFetchingConnected).toBe(false);
        expect(modal.transportStatusMessage).toContain('Error: Conexión P2P rechazada por Mini');
    });
});
