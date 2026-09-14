import fs from 'fs';
import path from 'path';
import {
  PRESENCE_PING_TYPE,
  PRESENCE_PONG_TYPE,
  HEARTBEAT_INTERVAL_MS,
  ONLINE_TTL_MS,
  PROBE_TIMEOUT_MS,
  RECONNECT_BACKOFF_STEPS,
  validatePresencePing,
  validatePresencePong,
  sortPeersByPresenceAndActivity,
  P2PPresenceManager,
  getP2PPresenceManager,
  resetP2PPresenceManagerForTesting
} from '../modules/features/p2p/P2PPresenceManager.js';
import { refreshSaP2PHeaderIndicator } from '../modules/features/p2p/P2PRosterUI.js';

const ROOT = path.resolve(process.cwd());
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('F3.4 P2P Presence v1 — Wire Protocol & Frame Validation', () => {
  test('validates exact presence-ping/v1 schema and rejects extra or missing keys', () => {
    const valid = { type: PRESENCE_PING_TYPE, probeId: 'probe-abc-123', sentAt: 1700000000000 };
    expect(validatePresencePing(valid)).toEqual(valid);

    // Missing key
    expect(() => validatePresencePing({ type: PRESENCE_PING_TYPE, sentAt: 1700000000000 })).toThrow(/inválido/);
    expect(() => validatePresencePing({ type: PRESENCE_PING_TYPE, probeId: 'p1' })).toThrow(/inválido/);

    // Extra key (must reject unknown fields)
    expect(() => validatePresencePing({ ...valid, extra: 'forbidden' })).toThrow(/inválido/);

    // Wrong type
    expect(() => validatePresencePing({ ...valid, type: 'presence-ping/v2' })).toThrow(/esperado/);
    expect(() => validatePresencePing({ ...valid, type: 'ping' })).toThrow(/esperado/);
  });

  test('validates bounded probeId and safe integer sentAt in presence-ping', () => {
    const base = { type: PRESENCE_PING_TYPE, probeId: 'p1', sentAt: 1700000000000 };

    // Invalid probeId: empty or whitespace
    expect(() => validatePresencePing({ ...base, probeId: '' })).toThrow(/probeId/);
    expect(() => validatePresencePing({ ...base, probeId: '   ' })).toThrow(/probeId/);
    expect(() => validatePresencePing({ ...base, probeId: 12345 })).toThrow(/probeId/);

    // ProbeId > 128 bytes
    expect(() => validatePresencePing({ ...base, probeId: 'a'.repeat(129) })).toThrow(/probeId/);
    // ProbeId with control characters
    expect(() => validatePresencePing({ ...base, probeId: 'bad\x00probe' })).toThrow(/probeId/);
    expect(() => validatePresencePing({ ...base, probeId: 'bad\nprobe' })).toThrow(/probeId/);

    // Invalid sentAt: not safe integer or <= 0
    expect(() => validatePresencePing({ ...base, sentAt: '1700000000000' })).toThrow(/sentAt/);
    expect(() => validatePresencePing({ ...base, sentAt: -100 })).toThrow(/sentAt/);
    expect(() => validatePresencePing({ ...base, sentAt: 0 })).toThrow(/sentAt/);
    expect(() => validatePresencePing({ ...base, sentAt: 1700000000.5 })).toThrow(/sentAt/);
    expect(() => validatePresencePing({ ...base, sentAt: Infinity })).toThrow(/sentAt/);
    expect(() => validatePresencePing({ ...base, sentAt: NaN })).toThrow(/sentAt/);
  });

  test('validates exact presence-pong/v1 schema, echoed probeId, and echoed sentAt', () => {
    const valid = { type: PRESENCE_PONG_TYPE, probeId: 'probe-xyz', sentAt: 1700000000000 };
    expect(validatePresencePong(valid)).toEqual(valid);
    expect(validatePresencePong(valid, 'probe-xyz', 1700000000000)).toEqual(valid);

    // Mismatched probeId
    expect(() => validatePresencePong(valid, 'other-probe', 1700000000000)).toThrow(/no coincide con probe/);

    // Mismatched sentAt
    expect(() => validatePresencePong(valid, 'probe-xyz', 1700000000001)).toThrow(/no coincide con sentAt/);

    // Extra or missing keys
    expect(() => validatePresencePong({ ...valid, extra: 'forbidden' })).toThrow(/inválido/);
    expect(() => validatePresencePong({ type: PRESENCE_PONG_TYPE, probeId: 'probe-xyz' })).toThrow(/inválido/);
  });

  test('pong tardío de probe anterior no valida frente a activeProbe posterior o desfasado', () => {
    const oldPong = { type: PRESENCE_PONG_TYPE, probeId: 'probe-old-1', sentAt: 1700000000000 };
    const activeProbe = { probeId: 'probe-new-2', sentAt: 1700000025000 };

    // Valida frente a su propia sonda
    expect(validatePresencePong(oldPong, 'probe-old-1', 1700000000000)).toEqual(oldPong);

    // Falla al validar contra activeProbe de una sonda posterior (probeId distinto)
    expect(() => validatePresencePong(oldPong, activeProbe.probeId, activeProbe.sentAt)).toThrow(/no coincide con probe/);
    expect(() => validatePresencePong(oldPong, activeProbe)).toThrow(/no coincide con probe/);

    // Falla al validar si sentAt no coincide exactamente
    const mixedPong = { type: PRESENCE_PONG_TYPE, probeId: 'probe-new-2', sentAt: 1700000000000 };
    expect(() => validatePresencePong(mixedPong, activeProbe)).toThrow(/no coincide con sentAt/);
  });
});

describe('F3.4 P2P Presence v1 — Network Gate (navigator.onLine)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('navigator.onLine === false gates probes, connections, and reports peer as offline', async () => {
    const mockPeer = { peerId: 'mini-peer-1', peerApp: 'mini', linkToken: 'token1' };
    const mockStore = {
      listPeers: jest.fn().mockResolvedValue([mockPeer]),
      getPeer: jest.fn().mockResolvedValue(mockPeer),
      getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-device', displayName: 'SA' })
    };

    let onlineStatus = false;
    const manager = new P2PPresenceManager({
      store: () => mockStore,
      isOnlineFn: () => onlineStatus
    });

    // When network is offline:
    expect(manager.isNetworkOnline()).toBe(false);

    // ensureConnected does not proceed
    await manager.ensureConnected('mini-peer-1');
    const entry = manager.getPeerEntry('mini-peer-1');
    expect(entry.isConnecting).toBe(false);
    expect(entry.channel).toBeNull();
    expect(manager.getPeerState('mini-peer-1')).toBe('linked-offline');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);

    // Even if lastPongAt was recently set, network offline forces false
    entry.lastPongAt = Date.now();
    entry.state = 'online';
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    expect(manager.getPeerState('mini-peer-1')).toBe('linked-offline');
  });

  test('offline event immediately stops retries, tears down channels, and marks peers offline', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');
    entry.state = 'online';
    entry.lastPongAt = Date.now();

    const mockSession = { close: jest.fn() };
    entry.session = mockSession;

    const mockChannel = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    manager.registerChannel('mini-peer-1', mockChannel, mockSession);

    // Trigger network offline
    manager.handleNetworkOffline();

    expect(entry.state).toBe('linked-offline');
    expect(entry.channel).toBeNull();
    expect(entry.session).toBeNull();
    expect(mockSession.close).toHaveBeenCalledWith('network-offline');
  });

  test('online event triggers bounded check and resets backoff', async () => {
    const mockPeer = { peerId: 'mini-peer-1', peerApp: 'mini', linkToken: 'token1' };
    const mockStore = {
      listPeers: jest.fn().mockResolvedValue([mockPeer]),
      getPeer: jest.fn().mockResolvedValue(mockPeer),
      getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-device', displayName: 'SA' })
    };

    let onlineStatus = true;
    const manager = new P2PPresenceManager({
      store: () => mockStore,
      isOnlineFn: () => onlineStatus
    });

    const entry = manager.getPeerEntry('mini-peer-1');
    entry.backoffIndex = 3;

    manager.handleNetworkOnline();

    expect(entry.backoffIndex).toBe(0);
  });

  test('navigator.onLine === true is NOT proof of peer availability', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');

    // Network is online, but peer has not completed handshake / pong
    expect(manager.isNetworkOnline()).toBe(true);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    expect(manager.getPeerState('mini-peer-1')).toBe('linked-offline');
  });
});

describe('F3.4 P2P Presence v1 — Authentication Requirement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('untrusted or pre-auth frames never establish online state and do not respond to ping', () => {
    let isAuthenticated = false;
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => isAuthenticated)
    };

    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });

    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    // Pre-auth incoming ping: must NOT reply with pong
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PING_TYPE,
        probeId: 'probe-1',
        sentAt: Date.now()
      })
    });
    expect(mockChannel.send).not.toHaveBeenCalled();

    // Pre-auth incoming pong: must NOT mark peer online
    entry.activeProbe = { probeId: 'probe-1', sentAt: 12345 };
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-1',
        sentAt: 12345
      })
    });
    expect(entry.state).not.toBe('online');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
  });

  test('authenticated ping receives pong, and authenticated pong establishes online state', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };

    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });

    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    // Authenticated ping
    const sentTs = Date.now();
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PING_TYPE,
        probeId: 'probe-client-99',
        sentAt: sentTs
      })
    });

    expect(mockChannel.send).toHaveBeenCalledWith(JSON.stringify({
      type: PRESENCE_PONG_TYPE,
      probeId: 'probe-client-99',
      sentAt: sentTs
    }));

    // Authenticated pong matching active probe
    entry.activeProbe = { probeId: 'probe-client-99', sentAt: sentTs };
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-client-99',
        sentAt: sentTs
      })
    });

    expect(entry.state).toBe('online');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);
    expect(manager.getPeerState('mini-peer-1')).toBe('online');
    expect(entry.backoffIndex).toBe(0);
    expect(entry.heartbeatTimer).not.toBeNull();
  });

  test('pong sin activeProbe no marca online', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');
    entry.activeProbe = null; // Ensure no probe is active
    expect(entry.activeProbe).toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');

    // Pong autenticado recibido sin sonda activa correlacionable (unsolicited)
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-unsolicited-99',
        sentAt: Date.now()
      })
    });

    // Debe ignorarse completamente: no marca online, no renueva lastPongAt ni altera estado
    expect(entry.activeProbe).toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
  });

  test('pong duplicado tras aceptar uno no extiende TTL', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 1000000;
    jest.setSystemTime(t0);

    // Sonda activa emitida
    entry.activeProbe = { probeId: 'probe-dup-test', sentAt: t0 };
    const pongFrame = {
      type: PRESENCE_PONG_TYPE,
      probeId: 'probe-dup-test',
      sentAt: t0
    };

    // Primer pong: aceptado y correlacionado con la sonda activa
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(pongFrame)
    });

    expect(entry.state).toBe('online');
    expect(entry.lastPongAt).toBe(t0);
    expect(entry.activeProbe).toBeNull();
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);

    // Avanzamos 45 segundos (dentro de la ventana TTL nominal de 60s)
    const tDup = t0 + 45000;
    jest.setSystemTime(tDup);

    // Llega pong duplicado (mismo payload, pero activeProbe ya no existe)
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(pongFrame)
    });

    // lastPongAt NO se renueva; sigue anclado en t0
    expect(entry.lastPongAt).toBe(t0);

    // Al llegar a t0 + 60001 (expiración del primer pong), pasa a offline
    // demostrando que el duplicado en tDup no extendió el TTL
    jest.setSystemTime(t0 + 60001);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
  });

  test('pong tardío de probe anterior no valida', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 1000000;
    jest.setSystemTime(t0);

    // Sonda anterior (Probe A)
    const probeA = { probeId: 'probe-A', sentAt: t0 };
    entry.activeProbe = probeA;

    // Se emite una nueva sonda (Probe B) desfasando la anterior
    const t1 = t0 + 5000;
    jest.setSystemTime(t1);
    const probeB = { probeId: 'probe-B', sentAt: t1 };
    entry.activeProbe = probeB;

    // Llega pong tardío de Probe A
    const latePongA = {
      type: PRESENCE_PONG_TYPE,
      probeId: 'probe-A',
      sentAt: t0
    };

    // 1) validatePresencePong lanza error frente a la sonda activa Probe B
    expect(() => validatePresencePong(latePongA, probeB.probeId, probeB.sentAt)).toThrow(/no coincide con probe enviado/);
    expect(() => validatePresencePong(latePongA, probeB)).toThrow(/no coincide con probe enviado/);

    // 2) handleIncomingMessage descarta el pong tardío sin validar ni alterar presencia
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(latePongA)
    });

    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    // La sonda activa Probe B sigue intacta y esperando su pong
    expect(entry.activeProbe).toEqual(probeB);

    // 3) Llega el pong legítimo de Probe B y se acepta
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-B',
        sentAt: t1
      })
    });

    expect(entry.lastPongAt).toBe(t1);
    expect(entry.state).toBe('online');
    expect(entry.activeProbe).toBeNull();
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);

    // 4) Si vuelve a llegar el pong tardío de Probe A, se ignora y no renueva lastPongAt
    const t2 = t1 + 10000;
    jest.setSystemTime(t2);
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(latePongA)
    });
    expect(entry.lastPongAt).toBe(t1);

    // 5) Caso sonda expirada por timeout (activeProbe es null tras timeout)
    const entry2 = manager.getPeerEntry('mini-peer-2');
    entry2.activeProbe = null;
    manager.handleIncomingMessage('mini-peer-2', mockChannel, {
      data: JSON.stringify(latePongA)
    });
    expect(entry2.lastPongAt).toBeNull();
    expect(entry2.state).toBe('linked-offline');
  });
});

describe('F3.4 P2P Presence v1 — Timing, TTL & Backoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('nominal constants match contract: 25s heartbeat, 60s TTL, [5s, 15s, 30s, 60s] backoff', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(25000);
    expect(ONLINE_TTL_MS).toBe(60000);
    expect(PROBE_TIMEOUT_MS).toBe(10000);
    expect(RECONNECT_BACKOFF_STEPS).toEqual([5000, 15000, 30000, 60000]);
  });

  test('online state expires honestly when 60s TTL is exceeded without pong', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');
    const now = 1000000;
    jest.setSystemTime(now);

    entry.state = 'online';
    entry.lastPongAt = now;
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);

    // Advance 59s: still online
    jest.setSystemTime(now + 59000);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);

    // Advance 61s: expired
    jest.setSystemTime(now + 61000);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    expect(manager.getPeerState('mini-peer-1')).toBe('linked-offline');
  });

  test('browser suspension sweep honestly marks stale peers offline upon resume', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');
    const now = 1000000;
    jest.setSystemTime(now);

    entry.state = 'online';
    entry.lastPongAt = now;

    // Simulate suspension: jump time by 90 seconds
    jest.setSystemTime(now + 90000);

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    manager.sweepStalePeers();

    expect(entry.state).toBe('linked-offline');
    expect(changeSpy).toHaveBeenCalled();
  });

  test('reconnect backoff escalates through steps and caps at 60s', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');

    expect(entry.backoffIndex).toBe(0);
    manager.scheduleRetry('mini-peer-1');
    expect(entry.backoffIndex).toBe(1);

    manager.scheduleRetry('mini-peer-1');
    expect(entry.backoffIndex).toBe(2);

    manager.scheduleRetry('mini-peer-1');
    expect(entry.backoffIndex).toBe(3);

    manager.scheduleRetry('mini-peer-1');
    expect(entry.backoffIndex).toBe(4); // capped at last step (60s)
  });

  test('timers and listeners are deduped per peer', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');

    manager.scheduleHeartbeat('mini-peer-1');
    const firstTimer = entry.heartbeatTimer;
    expect(firstTimer).not.toBeNull();

    // Second call replaces existing timer cleanly without leaking
    manager.scheduleHeartbeat('mini-peer-1');
    expect(entry.heartbeatTimer).not.toBeNull();

    manager.clearPeerTimers(entry);
    expect(entry.heartbeatTimer).toBeNull();
    expect(entry.retryTimer).toBeNull();
    expect(entry.probeTimeoutTimer).toBeNull();
  });
});

describe('F3.4 P2P Presence v1 — Transfer State Tracking', () => {
  test('setPeerTransferring updates state to transferring and pauses heartbeats', () => {
    const manager = new P2PPresenceManager({ isOnlineFn: () => true });
    const entry = manager.getPeerEntry('mini-peer-1');
    entry.state = 'online';
    entry.lastPongAt = Date.now();
    entry.heartbeatTimer = setTimeout(() => {}, 10000);

    manager.setPeerTransferring('mini-peer-1', true);
    expect(entry.isTransferring).toBe(true);
    expect(entry.state).toBe('transferring');
    expect(manager.getPeerState('mini-peer-1')).toBe('transferring');
    expect(manager.isAnyTransferring()).toBe(true);
    expect(entry.heartbeatTimer).toBeNull(); // paused during transfer

    manager.setPeerTransferring('mini-peer-1', false);
    expect(entry.isTransferring).toBe(false);
    expect(entry.state).toBe('online');
    expect(manager.isAnyTransferring()).toBe(false);
  });
});

describe('F3.4 P2P Presence v1 — Peer Sorting (sortPeersByPresenceAndActivity)', () => {
  test('sorts peers into canonical 4-tier hierarchy: online+pending, online, recent offline, older offline', () => {
    const p1 = { peerId: 'p1', displayName: 'Peer 1', lastSeenAt: '2026-09-10T10:00:00Z' }; // offline, older
    const p2 = { peerId: 'p2', displayName: 'Peer 2', lastSeenAt: '2026-09-14T10:00:00Z' }; // offline, recent
    const p3 = { peerId: 'p3', displayName: 'Peer 3', lastSeenAt: '2026-09-14T08:00:00Z' }; // online, no pending
    const p4 = { peerId: 'p4', displayName: 'Peer 4', lastSeenAt: '2026-09-12T08:00:00Z' }; // online, with pending

    const presenceMap = new Map([
      ['p1', { isOnline: false, state: 'linked-offline' }],
      ['p2', { isOnline: false, state: 'linked-offline' }],
      ['p3', { isOnline: true, state: 'online' }],
      ['p4', { isOnline: true, state: 'online' }]
    ]);

    const pendingCounts = new Map([
      ['p1', 0],
      ['p2', 0],
      ['p3', 0],
      ['p4', 3] // actionable pending reviews
    ]);

    const peers = [p1, p2, p3, p4];
    const sorted = sortPeersByPresenceAndActivity(peers, presenceMap, pendingCounts);

    expect(sorted.map(p => p.peerId)).toEqual(['p4', 'p3', 'p2', 'p1']);
  });
});

describe('F3.4 P2P Presence v1 — Header UX & Separate Badges', () => {
  let indicatorButton;

  beforeEach(() => {
    resetP2PPresenceManagerForTesting();
    document.body.innerHTML = `
      <button type="button" class="header-p2p-indicator" id="header-p2p-indicator" data-p2p-state="unlinked" aria-label="Mini">
        <span class="header-p2p-ring">
          <span class="header-p2p-online-badge" data-p2p-online-badge hidden></span>
          <img class="header-p2p-app-icon" src="assets/icons/mini-app-icon.svg" alt="" />
          <span class="header-p2p-notification-badge" data-p2p-header-badge hidden></span>
        </span>
      </button>
    `;
    indicatorButton = document.querySelector('.header-p2p-indicator');
  });

  afterEach(() => {
    resetP2PPresenceManagerForTesting();
    document.body.innerHTML = '';
  });

  test('green online badge appears ONLY when onlineCount > 1 and never merges with red badge', async () => {
    const greenBadge = indicatorButton.querySelector('[data-p2p-online-badge]');
    const redBadge = indicatorButton.querySelector('[data-p2p-header-badge]');

    // Mock peers and store
    const peer1 = { peerId: 'p1', peerApp: 'mini' };
    const peer2 = { peerId: 'p2', peerApp: 'mini' };
    window.SaMiniP2P = {
      makeIdentityStore: () => ({
        listPeers: jest.fn().mockResolvedValue([peer1, peer2]),
        getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-1' })
      }),
      isChannelAuthenticated: () => true
    };
    window.getSaP2PPendingReviewCount = jest.fn().mockResolvedValue(0);

    const presenceMgr = getP2PPresenceManager();
    // 0 online: green hidden, red hidden, state disconnected
    await refreshSaP2PHeaderIndicator();
    expect(indicatorButton.getAttribute('data-p2p-state')).toBe('disconnected');
    expect(greenBadge.hidden).toBe(true);
    expect(redBadge.hidden).toBe(true);

    // 1 online: green hidden (only green ring, no numeric count for 1), state connected
    presenceMgr.getPeerEntry('p1').lastPongAt = Date.now();
    presenceMgr.getPeerEntry('p1').state = 'online';
    await refreshSaP2PHeaderIndicator();
    expect(indicatorButton.getAttribute('data-p2p-state')).toBe('connected');
    expect(greenBadge.hidden).toBe(true);
    expect(redBadge.hidden).toBe(true);

    // 2 online: green badge visible with '2'
    presenceMgr.getPeerEntry('p2').lastPongAt = Date.now();
    presenceMgr.getPeerEntry('p2').state = 'online';
    await refreshSaP2PHeaderIndicator();
    expect(indicatorButton.getAttribute('data-p2p-state')).toBe('connected');
    expect(greenBadge.hidden).toBe(false);
    expect(greenBadge.textContent).toBe('2');
    expect(greenBadge.getAttribute('aria-label')).toBe('2 dispositivos conectados');
    expect(redBadge.hidden).toBe(true);

    // With actionable pending: red badge visible, green badge still shows online count (never combined)
    window.getSaP2PPendingReviewCount = jest.fn().mockResolvedValue(5);
    await refreshSaP2PHeaderIndicator();
    expect(greenBadge.hidden).toBe(false);
    expect(greenBadge.textContent).toBe('2');
    expect(redBadge.hidden).toBe(false);
    expect(redBadge.textContent).toBe('5');
    expect(redBadge.getAttribute('aria-label')).toBe('5 revisiones pendientes');
  });

  test('active transfer sets state to transferring with pulse and restrained motion support', async () => {
    const peer1 = { peerId: 'p1', peerApp: 'mini' };
    window.SaMiniP2P = {
      makeIdentityStore: () => ({
        listPeers: jest.fn().mockResolvedValue([peer1]),
        getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-1' })
      })
    };
    window.getSaP2PPendingReviewCount = jest.fn().mockResolvedValue(0);

    const presenceMgr = getP2PPresenceManager();
    presenceMgr.setPeerTransferring('p1', true);

    await refreshSaP2PHeaderIndicator();
    expect(indicatorButton.getAttribute('data-p2p-state')).toBe('transferring');
    expect(indicatorButton.getAttribute('aria-label')).toContain('transfiriendo');

    const css = read('css/header.css');
    expect(css).toContain('[data-p2p-state="transferring"]');
    expect(css).toContain('p2pHeaderTransferPulse');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('F3.4 P2P Presence v1 — UI Structure & Design Contract', () => {
  test('header.css defines .header-p2p-online-badge with solid semantic tokens', () => {
    const css = read('css/header.css');
    expect(css).toContain('.header-p2p-online-badge');
    expect(css).toContain('background: var(--good');
    expect(css).toContain('color: var(--on-good');
  });

  test('p2p-transfer.css defines compact peer card, dot, status tag, and pending badge', () => {
    const css = read('css/p2p-transfer.css');
    expect(css).toContain('.sa-p2p-peer-card');
    expect(css).toContain('.sa-p2p-peer-dot.is-online');
    expect(css).toContain('.sa-p2p-peer-type');
    expect(css).toContain('.sa-p2p-peer-status');
    expect(css).toContain('.sa-p2p-peer-pending-badge');
  });

  test('sw.js precaches P2PPresenceManager.js as part of the P2P shell closure', () => {
    const sw = read('sw.js');
    expect(sw).toContain('./js/modules/features/p2p/P2PPresenceManager.js');
  });

  test('design.md documents F3.4 presence rules and dual badges', () => {
    const design = read('design.md');
    expect(design).toContain('Presencia P2P v1 (F3.4)');
    expect(design).toContain('Compromiso de honestidad visual');
    expect(design).toContain('Compuerta de red');
    expect(design).toContain('Tramas de presencia autenticadas');
    expect(design).toContain('presence-ping/v1');
    expect(design).toContain('presence-pong/v1');
    expect(design).toContain('Aro de estado agregado');
    expect(design).toContain('onlineCount > 1');
  });

  test('P2PRosterUI renders compact peer card with human alias, type tag, state, pending badge, and row selection', async () => {
    const mockPeer = {
      peerId: 'peer-device-42',
      displayName: 'Mini Móvil Patio',
      peerApp: 'mini',
      linkedAt: '2026-09-14T08:00:00Z',
      lastSeenAt: '2026-09-14T08:30:00Z'
    };

    window.SaMiniP2P = {
      makeIdentityStore: () => ({
        listPeers: jest.fn().mockResolvedValue([mockPeer]),
        getPeer: jest.fn().mockResolvedValue(mockPeer),
        getSelf: jest.fn().mockResolvedValue({ deviceId: 'sa-self', displayName: 'SA - Central' })
      }),
      isChannelAuthenticated: () => true
    };
    window.getSaP2PActionablePendingReviewGroups = jest.fn().mockResolvedValue([
      { deviceId: 'peer-device-42', status: 'pending' }
    ]);

    const { openP2PRosterTransfer, closeP2PRosterTransfer } = await import('../modules/features/p2p/P2PRosterUI.js');

    await openP2PRosterTransfer();

    const shell = document.querySelector('.sa-p2p-shell');
    expect(shell).not.toBeNull();

    // Verify compact peer card
    const card = shell.querySelector('.sa-p2p-peer-card');
    expect(card).not.toBeNull();
    expect(card.getAttribute('data-peer-id')).toBe('peer-device-42');

    // Verify primary human alias
    const nameEl = card.querySelector('.sa-p2p-peer-name');
    expect(nameEl.textContent).toBe('Mini Móvil Patio');

    // Verify device type tag
    const typeEl = card.querySelector('.sa-p2p-peer-type');
    expect(typeEl.textContent).toBe('Mini');

    // Verify state badge
    const statusEl = card.querySelector('.sa-p2p-peer-status');
    expect(statusEl).not.toBeNull();

    // Verify actionable pending review badge
    const pendingEl = card.querySelector('.sa-p2p-peer-pending-badge');
    expect(pendingEl).not.toBeNull();
    expect(pendingEl.textContent).toBe('1 pendiente');

    // Verify row selection target
    const selectTarget = card.querySelector('[data-select-peer="peer-device-42"]');
    expect(selectTarget).not.toBeNull();

    closeP2PRosterTransfer();
    expect(document.querySelector('.sa-p2p-shell')).toBeNull();
  });
});

describe('F3.4 P2P Presence v1 — Protocol & Repository Safety', () => {
  test('P2PPresenceManager handles transport metadata only and never writes attendance or roster stores', () => {
    const mgrSource = read('js/modules/features/p2p/P2PPresenceManager.js');

    // Must NOT write to business repositories
    expect(mgrSource).not.toMatch(/AttendanceSubmissionInboxStore/);
    expect(mgrSource).not.toMatch(/saveEmployees|savePositions|saveAttendance/);
    expect(mgrSource).not.toMatch(/localStorage\.setItem\(['"]employees/);
    expect(mgrSource).not.toMatch(/Firebase/);

    // Wire protocol strictly uses ping/pong types
    expect(mgrSource).toContain("PRESENCE_PING_TYPE = 'presence-ping/v1'");
    expect(mgrSource).toContain("PRESENCE_PONG_TYPE = 'presence-pong/v1'");
  });
});

describe('F3.4 P2P Presence v1 — Cross-Review Regressions (Probe Correlation & TTL Refresh)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('unsolicited pong ignored: pong received when entry.activeProbe is null leaves state, timers, and backoff unchanged', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');
    entry.activeProbe = null;
    entry.state = 'linked-offline';
    entry.lastPongAt = null;
    entry.backoffIndex = 2;
    entry.retryTimer = setTimeout(() => {}, 5000);

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    // Unsolicited pong frame
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-unsolicited-123',
        sentAt: Date.now()
      })
    });

    // Ignored completely: no state, timer, or backoff changes
    expect(entry.activeProbe).toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    expect(entry.backoffIndex).toBe(2);
    expect(entry.retryTimer).not.toBeNull();
    expect(entry.heartbeatTimer).toBeNull();
    expect(changeSpy).not.toHaveBeenCalled();
  });

  test('duplicate pong ignored: duplicate pong received after active probe was cleared does not refresh or extend online TTL', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 1000000;
    jest.setSystemTime(t0);

    // Active probe emitted
    entry.activeProbe = { probeId: 'probe-dup-reg', sentAt: t0 };
    const pongFrame = {
      type: PRESENCE_PONG_TYPE,
      probeId: 'probe-dup-reg',
      sentAt: t0
    };

    // First pong: correlated and accepted
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(pongFrame)
    });

    expect(entry.state).toBe('online');
    expect(entry.lastPongAt).toBe(t0);
    expect(entry.activeProbe).toBeNull();
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);

    // Advance 45s into 60s TTL window
    const tDup = t0 + 45000;
    jest.setSystemTime(tDup);

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    // Duplicate pong arrives (identical payload, but activeProbe is null)
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(pongFrame)
    });

    // Must be ignored: lastPongAt remains t0, no change event emitted
    expect(entry.lastPongAt).toBe(t0);
    expect(entry.activeProbe).toBeNull();
    expect(changeSpy).not.toHaveBeenCalled();

    // At t0 + 60001 (original TTL expiry), peer expires offline proving duplicate didn't extend TTL
    jest.setSystemTime(t0 + 60001);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
  });

  test('stale/wrong pong ignored: mismatched probeId or sentAt does not refresh TTL and preserves active probe and timer', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 1000000;
    jest.setSystemTime(t0);

    const currentProbe = { probeId: 'probe-current-id', sentAt: t0 };
    entry.activeProbe = { ...currentProbe };
    entry.probeTimeoutTimer = setTimeout(() => {}, 10000);
    entry.state = 'linked-offline';
    entry.lastPongAt = null;
    entry.backoffIndex = 2;

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    // 1. Wrong probeId
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-wrong-id',
        sentAt: t0
      })
    });

    expect(entry.activeProbe).toEqual(currentProbe);
    expect(entry.probeTimeoutTimer).not.toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(entry.backoffIndex).toBe(2);
    expect(changeSpy).not.toHaveBeenCalled();

    // 2. Stale sentAt (probeId matches, but sentAt does not)
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-current-id',
        sentAt: t0 - 25000
      })
    });

    expect(entry.activeProbe).toEqual(currentProbe);
    expect(entry.probeTimeoutTimer).not.toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(entry.backoffIndex).toBe(2);
    expect(changeSpy).not.toHaveBeenCalled();

    // 3. Completely stale probe from earlier cycle
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-old-cycle',
        sentAt: t0 - 50000
      })
    });

    expect(entry.activeProbe).toEqual(currentProbe);
    expect(entry.probeTimeoutTimer).not.toBeNull();
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(changeSpy).not.toHaveBeenCalled();
  });

  test('exact correlated pong accepted: exactly matching probeId and sentAt on authenticated channel refreshes TTL and establishes online state', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 2000000;
    jest.setSystemTime(t0);

    entry.activeProbe = { probeId: 'probe-exact-reg', sentAt: t0 };
    entry.probeTimeoutTimer = setTimeout(() => {}, 10000);
    entry.backoffIndex = 3;
    entry.state = 'connecting';
    entry.lastPongAt = null;

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    // Exact correlated pong received
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PONG_TYPE,
        probeId: 'probe-exact-reg',
        sentAt: t0
      })
    });

    // Verification of exact acceptance
    expect(entry.activeProbe).toBeNull();
    expect(entry.probeTimeoutTimer).toBeNull();
    expect(entry.lastPongAt).toBe(t0);
    expect(entry.backoffIndex).toBe(0);
    expect(entry.state).toBe('online');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(true);
    expect(manager.getPeerState('mini-peer-1')).toBe('online');
    expect(entry.heartbeatTimer).not.toBeNull();
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });

  test('ping response not refreshing own TTL: authenticated presence-ping/v1 triggers pong response but never refreshes SA own online TTL or state', () => {
    const mockCore = {
      isChannelAuthenticated: jest.fn(() => true)
    };
    const manager = new P2PPresenceManager({
      core: () => mockCore,
      isOnlineFn: () => true
    });
    const mockChannel = {
      send: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    manager.registerChannel('mini-peer-1', mockChannel);
    const entry = manager.getPeerEntry('mini-peer-1');

    const t0 = 3000000;
    jest.setSystemTime(t0);

    entry.state = 'linked-offline';
    entry.lastPongAt = null;
    entry.backoffIndex = 2;
    entry.activeProbe = null;

    const changeSpy = jest.fn();
    manager.on('change', changeSpy);

    const incomingPing = {
      type: PRESENCE_PING_TYPE,
      probeId: 'probe-mini-initiator',
      sentAt: t0
    };

    mockChannel.send.mockClear();

    // Authenticated ping arrives from peer
    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify(incomingPing)
    });

    // SA correctly sent the pong reply with echoed probeId and sentAt
    expect(mockChannel.send).toHaveBeenCalledTimes(1);
    expect(mockChannel.send).toHaveBeenCalledWith(JSON.stringify({
      type: PRESENCE_PONG_TYPE,
      probeId: 'probe-mini-initiator',
      sentAt: t0
    }));

    // SA's own online TTL MUST NOT be refreshed:
    expect(entry.lastPongAt).toBeNull();
    expect(entry.state).toBe('linked-offline');
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
    expect(manager.getPeerState('mini-peer-1')).toBe('linked-offline');
    expect(entry.backoffIndex).toBe(2); // not reset by ping
    expect(entry.heartbeatTimer).toBeNull();
    expect(changeSpy).not.toHaveBeenCalled();

    // Secondary test: if SA had a previous lastPongAt, incoming ping does NOT renew it
    const tPreviousPong = 2950000;
    entry.lastPongAt = tPreviousPong;
    entry.state = 'online';

    const tLater = t0 + 20000;
    jest.setSystemTime(tLater);

    manager.handleIncomingMessage('mini-peer-1', mockChannel, {
      data: JSON.stringify({
        type: PRESENCE_PING_TYPE,
        probeId: 'probe-mini-second',
        sentAt: tLater
      })
    });

    // lastPongAt is still tPreviousPong, NOT renewed to tLater
    expect(entry.lastPongAt).toBe(tPreviousPong);

    // At tPreviousPong + 60001, peer expires to offline despite receiving pings in the interim
    jest.setSystemTime(tPreviousPong + 60001);
    expect(manager.isPeerOnline('mini-peer-1')).toBe(false);
  });
});


