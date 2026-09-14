/**
 * P2PPresenceManager — Bounded presence coordinator for SA (F3.4 P2P Presence v1).
 *
 * Contract: /home/ubuntu/agent-bridge/context/contracts/F3.4_P2P_PRESENCE_V1.md
 *
 * Guarantees:
 * - navigator.onLine === false is the first gate: do not probe peers while offline.
 * - Authenticated channel only: untrusted/pre-auth frames never mark a peer online.
 * - Exact presence frames:
 *     Ping: { type: 'presence-ping/v1', probeId: <string>, sentAt: <unix ms> }
 *     Pong: { type: 'presence-pong/v1', probeId: <string>, sentAt: <unix ms> }
 * - ~25s nominal heartbeat interval.
 * - 60s online TTL after last authenticated pong.
 * - Reconnect backoff: 5s -> 15s -> 30s -> 60s max; reset after authenticated pong.
 * - Deduped per-peer timers and listeners.
 * - Honest stale expiry after browser suspension.
 * - Green means authenticated recent pong, never mere network availability.
 * - Transport metadata only: never writes attendance or roster repositories.
 */

export const PRESENCE_PING_TYPE = 'presence-ping/v1';
export const PRESENCE_PONG_TYPE = 'presence-pong/v1';
export const HEARTBEAT_INTERVAL_MS = 25000;
export const ONLINE_TTL_MS = 60000;
export const RECONNECT_BACKOFF_STEPS = Object.freeze([5000, 15000, 30000, 60000]);
export const PROBE_TIMEOUT_MS = 10000;
export const MAX_PROBE_ID_BYTES = 128;

function exactKeys(obj, expected) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj).sort();
    const exp = [...expected].sort();
    if (keys.length !== exp.length) return false;
    return keys.every((k, i) => k === exp[i]);
}

function isValidProbeId(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > MAX_PROBE_ID_BYTES) return false;
    if (/[\u0000-\u001f\u007f]/.test(id)) return false;
    return true;
}

function isValidSentAt(ts) {
    return Number.isSafeInteger(ts) && ts > 0;
}

export function validatePresencePing(data) {
    if (!exactKeys(data, ['probeId', 'sentAt', 'type'])) {
        throw new Error('Frame presence-ping inválido: estructura o claves no coinciden.');
    }
    if (data.type !== PRESENCE_PING_TYPE) {
        throw new Error(`Tipo de frame inválido: esperado ${PRESENCE_PING_TYPE}`);
    }
    if (!isValidProbeId(data.probeId)) {
        throw new Error('probeId inválido en presence-ping.');
    }
    if (!isValidSentAt(data.sentAt)) {
        throw new Error('sentAt inválido en presence-ping.');
    }
    return { type: PRESENCE_PING_TYPE, probeId: data.probeId, sentAt: data.sentAt };
}

export function validatePresencePong(data, expectedProbeId = null, expectedSentAt = null) {
    if (!exactKeys(data, ['probeId', 'sentAt', 'type'])) {
        throw new Error('Frame presence-pong inválido: estructura o claves no coinciden.');
    }
    if (data.type !== PRESENCE_PONG_TYPE) {
        throw new Error(`Tipo de frame inválido: esperado ${PRESENCE_PONG_TYPE}`);
    }
    if (!isValidProbeId(data.probeId)) {
        throw new Error('probeId inválido en presence-pong.');
    }
    if (!isValidSentAt(data.sentAt)) {
        throw new Error('sentAt inválido en presence-pong.');
    }

    let targetProbeId = expectedProbeId;
    let targetSentAt = expectedSentAt;
    if (expectedProbeId && typeof expectedProbeId === 'object') {
        targetProbeId = expectedProbeId.probeId ?? null;
        targetSentAt = expectedProbeId.sentAt ?? null;
    }

    if (targetProbeId !== null && targetProbeId !== undefined && data.probeId !== targetProbeId) {
        throw new Error(`probeId en presence-pong (${data.probeId}) no coincide con probe enviado (${targetProbeId}).`);
    }
    if (targetSentAt !== null && targetSentAt !== undefined && data.sentAt !== targetSentAt) {
        throw new Error(`sentAt en presence-pong (${data.sentAt}) no coincide con sentAt enviado (${targetSentAt}).`);
    }
    return { type: PRESENCE_PONG_TYPE, probeId: data.probeId, sentAt: data.sentAt };
}

function defaultGenerateProbeId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `probe-${crypto.randomUUID()}`;
        }
    } catch (_) {}
    return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sortPeersByPresenceAndActivity(peers = [], presenceMap = new Map(), pendingCounts = new Map()) {
    return [...peers].sort((a, b) => {
        const aPres = presenceMap.get(a.peerId);
        const bPres = presenceMap.get(b.peerId);
        const aOnline = aPres?.isOnline === true;
        const bOnline = bPres?.isOnline === true;
        const aPending = (pendingCounts.get(a.peerId) || 0) > 0;
        const bPending = (pendingCounts.get(b.peerId) || 0) > 0;

        // Rank 0: online + pending
        // Rank 1: online
        // Rank 2: offline
        const aRank = aOnline ? (aPending ? 0 : 1) : 2;
        const bRank = bOnline ? (bPending ? 0 : 1) : 2;

        if (aRank !== bRank) {
            return aRank - bRank;
        }

        const aTime = Date.parse(a?.lastSeenAt || a?.linkedAt || '') || 0;
        const bTime = Date.parse(b?.lastSeenAt || b?.linkedAt || '') || 0;
        if (aTime !== bTime) {
            return bTime - aTime;
        }

        return String(a.peerId || '').localeCompare(String(b.peerId || ''));
    });
}

export class P2PPresenceManager {
    constructor(options = {}) {
        this.storeProvider = options.store || (() => (typeof window !== 'undefined' && window.SaMiniP2P?.makeIdentityStore ? window.SaMiniP2P.makeIdentityStore('sa', 'SA - Oficina') : null));
        this.coreProvider = options.core || (() => (typeof window !== 'undefined' ? window.SaMiniP2P : null));
        this.pairingProvider = options.pairing || (() => (typeof window !== 'undefined' ? window.SaMiniP2PPairing : null));
        this.generateProbeId = options.generateProbeId || defaultGenerateProbeId;
        this.isOnlineFn = options.isOnlineFn || null;

        // Map of peerId -> PeerRecord
        this.peers = new Map();
        this.listeners = new Set();
        this.isStarted = false;

        // Bound event handlers for clean removal
        this._onOnline = this.handleNetworkOnline.bind(this);
        this._onOffline = this.handleNetworkOffline.bind(this);
        this._onVisibility = this.handleVisibilityChange.bind(this);
        this._onFocus = this.sweepStalePeers.bind(this);
    }

    getCore() {
        return typeof this.coreProvider === 'function' ? this.coreProvider() : this.coreProvider;
    }

    getPairing() {
        return typeof this.pairingProvider === 'function' ? this.pairingProvider() : this.pairingProvider;
    }

    getIdentityStore() {
        return typeof this.storeProvider === 'function' ? this.storeProvider() : this.storeProvider;
    }

    isNetworkOnline() {
        if (typeof this.isOnlineFn === 'function') {
            return this.isOnlineFn() !== false;
        }
        if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
            return navigator.onLine !== false;
        }
        return true;
    }

    isChannelAuthenticated(channel) {
        try {
            const core = this.getCore();
            if (!core || !channel) return false;
            return core.isChannelAuthenticated(channel) === true;
        } catch (_) {
            return false;
        }
    }

    on(event, callback) {
        if (event === 'change' && typeof callback === 'function') {
            this.listeners.add(callback);
        }
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (event === 'change') {
            this.listeners.delete(callback);
        }
    }

    notifyChange() {
        for (const cb of this.listeners) {
            try { cb(); } catch (_) {}
        }
    }

    getPeerEntry(peerId) {
        if (!peerId) return null;
        let entry = this.peers.get(peerId);
        if (!entry) {
            entry = {
                peerId,
                state: 'linked-offline',
                lastPongAt: null,
                isTransferring: false,
                isConnecting: false,
                channel: null,
                session: null,
                channelMessageCleanup: null,
                backoffIndex: 0,
                retryTimer: null,
                heartbeatTimer: null,
                probeTimeoutTimer: null,
                activeProbe: null
            };
            this.peers.set(peerId, entry);
        }
        return entry;
    }

    async start() {
        if (this.isStarted) return;
        this.isStarted = true;

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this._onOnline);
            window.addEventListener('offline', this._onOffline);
            window.addEventListener('focus', this._onFocus);
            window.addEventListener('pageshow', this._onFocus);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this._onVisibility);
        }

        await this.refreshPeers();
    }

    stop() {
        if (!this.isStarted) return;
        this.isStarted = false;

        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this._onOnline);
            window.removeEventListener('offline', this._onOffline);
            window.removeEventListener('focus', this._onFocus);
            window.removeEventListener('pageshow', this._onFocus);
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibility);
        }

        for (const [peerId, entry] of this.peers.entries()) {
            this.clearPeerTimers(entry);
            this.detachChannel(entry);
            if (entry.session) {
                try { entry.session.close?.('presence-stop'); } catch (_) {}
                entry.session = null;
            }
        }
        this.peers.clear();
    }

    clearPeerTimers(entry) {
        if (entry.retryTimer) {
            clearTimeout(entry.retryTimer);
            entry.retryTimer = null;
        }
        if (entry.heartbeatTimer) {
            clearTimeout(entry.heartbeatTimer);
            entry.heartbeatTimer = null;
        }
        if (entry.probeTimeoutTimer) {
            clearTimeout(entry.probeTimeoutTimer);
            entry.probeTimeoutTimer = null;
        }
        entry.activeProbe = null;
    }

    detachChannel(entry) {
        if (typeof entry.channelMessageCleanup === 'function') {
            entry.channelMessageCleanup();
            entry.channelMessageCleanup = null;
        }
        entry.channel = null;
    }

    async refreshPeers() {
        let store;
        try {
            store = this.getIdentityStore();
            if (!store || typeof store.listPeers !== 'function') return;
        } catch (_) {
            return;
        }

        let linkedPeers = [];
        try {
            linkedPeers = (await store.listPeers()).filter(p => p?.peerApp === 'mini');
        } catch (_) {
            linkedPeers = [];
        }

        const currentIds = new Set(linkedPeers.map(p => p.peerId));

        // Clean up peers that were unlinked
        for (const [peerId, entry] of this.peers.entries()) {
            if (!currentIds.has(peerId)) {
                this.clearPeerTimers(entry);
                this.detachChannel(entry);
                if (entry.session) {
                    try { entry.session.close?.('peer-unlinked'); } catch (_) {}
                    entry.session = null;
                }
                this.peers.delete(peerId);
            }
        }

        // Initialize or update linked peers
        for (const peer of linkedPeers) {
            const entry = this.getPeerEntry(peer.peerId);
            if (this.isNetworkOnline() && !entry.channel && !entry.isConnecting && !entry.retryTimer) {
                this.ensureConnected(peer.peerId);
            }
        }

        this.notifyChange();
    }

    handleNetworkOffline() {
        for (const [peerId, entry] of this.peers.entries()) {
            this.clearPeerTimers(entry);
            this.detachChannel(entry);
            if (entry.session) {
                try { entry.session.close?.('network-offline'); } catch (_) {}
                entry.session = null;
            }
            entry.isConnecting = false;
            entry.state = 'linked-offline';
        }
        this.notifyChange();
    }

    handleNetworkOnline() {
        for (const [peerId, entry] of this.peers.entries()) {
            entry.backoffIndex = 0;
            this.clearPeerTimers(entry);
            this.ensureConnected(peerId);
        }
        this.notifyChange();
    }

    handleVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            this.sweepStalePeers();
        }
    }

    sweepStalePeers() {
        const now = Date.now();
        let changed = false;
        const isNet = this.isNetworkOnline();

        for (const [peerId, entry] of this.peers.entries()) {
            if (!isNet) {
                if (entry.state !== 'linked-offline') {
                    entry.state = 'linked-offline';
                    changed = true;
                }
                continue;
            }

            // Honest stale expiry after browser suspension
            if (entry.lastPongAt && (now - entry.lastPongAt > ONLINE_TTL_MS)) {
                if (entry.state === 'online') {
                    entry.state = 'linked-offline';
                    changed = true;
                }
            }
        }

        if (changed) {
            this.notifyChange();
        }

        if (isNet) {
            for (const [peerId, entry] of this.peers.entries()) {
                if (entry.channel && this.isChannelAuthenticated(entry.channel)) {
                    this.sendProbe(peerId);
                } else if (!entry.retryTimer && !entry.isConnecting) {
                    this.ensureConnected(peerId);
                }
            }
        }
    }

    async ensureConnected(peerId) {
        if (!this.isNetworkOnline()) return;
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;
        if (entry.isConnecting) return; // deduped connection attempt

        if (entry.channel && this.isChannelAuthenticated(entry.channel)) {
            this.sendProbe(peerId);
            return;
        }

        let peer = null;
        try {
            const store = this.getIdentityStore();
            peer = await store.getPeer(peerId);
        } catch (_) {}
        if (!peer || peer.peerApp !== 'mini') return;

        entry.isConnecting = true;
        entry.state = 'connecting';
        this.notifyChange();

        try {
            const core = this.getCore();
            const pairing = this.getPairing();
            const store = this.getIdentityStore();
            if (!core || !pairing || !store) {
                throw new Error('P2P runtime not available');
            }

            const self = await store.getSelf();
            const route = await core.deriveTrustedRoute(peer.linkToken);
            const signaling = new core.SignalingClient({
                room: route.room,
                peerId: self.deviceId,
                proof: route.proof
            });

            const session = await core.createRtcSession({
                signaling,
                initiator: true,
                onState: (status, error) => {
                    if (error) {
                        this.handleConnectionFailure(peerId, error);
                    }
                },
                onChannel: (channel) => {
                    this.registerChannel(peerId, channel, session, peer);
                }
            });
            entry.session = session;
        } catch (err) {
            this.handleConnectionFailure(peerId, err);
        }
    }

    registerChannel(peerId, channel, session = null, peer = null) {
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;

        this.detachChannel(entry);
        entry.channel = channel;
        if (session) entry.session = session;

        const messageHandler = (event) => {
            this.handleIncomingMessage(peerId, channel, event);
        };
        channel.addEventListener('message', messageHandler);

        const closeHandler = () => {
            if (entry.channel === channel) {
                this.detachChannel(entry);
                entry.isConnecting = false;
                entry.state = 'linked-offline';
                this.notifyChange();
                this.scheduleRetry(peerId);
            }
        };
        channel.addEventListener('close', closeHandler);

        entry.channelMessageCleanup = () => {
            channel.removeEventListener('message', messageHandler);
            channel.removeEventListener('close', closeHandler);
        };

        // If peer data provided, attach trusted pairing handshake
        if (peer) {
            const pairing = this.getPairing();
            const store = this.getIdentityStore();
            store.getSelf().then(self => {
                pairing.attachTrusted(channel, {
                    self,
                    peer,
                    store,
                    onAuthenticated: () => {
                        entry.isConnecting = false;
                        // Channel is now authenticated! Probe immediately.
                        this.sendProbe(peerId);
                    },
                    onError: (err) => {
                        this.handleConnectionFailure(peerId, err);
                    }
                });
            }).catch(err => {
                this.handleConnectionFailure(peerId, err);
            });
        } else {
            // Channel attached externally (e.g. from transfer modal). If already authenticated, probe now.
            if (this.isChannelAuthenticated(channel)) {
                entry.isConnecting = false;
                this.sendProbe(peerId);
            }
        }
    }

    handleConnectionFailure(peerId, error) {
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;
        entry.isConnecting = false;
        entry.state = 'linked-offline';
        this.detachChannel(entry);
        if (entry.session) {
            try { entry.session.close?.('presence-failure'); } catch (_) {}
            entry.session = null;
        }
        this.notifyChange();
        this.scheduleRetry(peerId);
    }

    handleIncomingMessage(peerId, channel, event) {
        if (typeof event?.data !== 'string') return;
        let parsed;
        try {
            parsed = JSON.parse(event.data);
        } catch (_) {
            return;
        }
        if (!parsed || typeof parsed !== 'object') return;

        // Filter out control and transfer protocols
        if (parsed.protocol === 'sa-mini-p2p-control/v1' || parsed.protocol === 'sa-mini-p2p-transfer/v1') {
            return;
        }

        // Handle presence-ping/v1
        if (parsed.type === PRESENCE_PING_TYPE) {
            // First gate: must be on authenticated channel!
            if (!this.isChannelAuthenticated(channel)) {
                return;
            }
            const entry = this.getPeerEntry(peerId);
            if (!entry) return;
            if (entry.channel && entry.channel !== channel) {
                return;
            }
            let ping;
            try {
                ping = validatePresencePing(parsed);
            } catch (_) {
                return;
            }
            try {
                const pong = {
                    type: PRESENCE_PONG_TYPE,
                    probeId: ping.probeId,
                    sentAt: ping.sentAt
                };
                channel.send(JSON.stringify(pong));
            } catch (_) {}
            return;
        }

        // Handle presence-pong/v1
        if (parsed.type === PRESENCE_PONG_TYPE) {
            // First gate: must be on authenticated channel!
            if (!this.isChannelAuthenticated(channel)) {
                return;
            }
            const entry = this.getPeerEntry(peerId);
            if (!entry) return;

            if (entry.channel && entry.channel !== channel) {
                return;
            }

            // Must have an existing active probe on the authenticated channel.
            // If no active probe exists, ignore the pong with no state/timer/backoff changes.
            // Duplicate/stale/wrong pongs must be ignored without altering state, timers, or backoff.
            if (!entry.activeProbe || !isValidProbeId(entry.activeProbe.probeId) || !isValidSentAt(entry.activeProbe.sentAt)) {
                return;
            }

            const expectedProbeId = entry.activeProbe.probeId;
            const expectedSentAt = entry.activeProbe.sentAt;

            // Both probeId and sentAt must exactly match the existing active probe
            if (parsed.probeId !== expectedProbeId || parsed.sentAt !== expectedSentAt) {
                return;
            }

            let pong;
            try {
                pong = validatePresencePong(parsed, expectedProbeId, expectedSentAt);
            } catch (_) {
                return;
            }

            // Pong successfully correlated and authenticated
            if (entry.probeTimeoutTimer) {
                clearTimeout(entry.probeTimeoutTimer);
                entry.probeTimeoutTimer = null;
            }
            entry.activeProbe = null;
            entry.lastPongAt = Date.now();
            entry.backoffIndex = 0; // reset retry backoff
            entry.state = entry.isTransferring ? 'transferring' : 'online';

            this.scheduleHeartbeat(peerId);
            this.notifyChange();
            return;
        }
    }

    sendProbe(peerId) {
        if (!this.isNetworkOnline()) return;
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;
        if (entry.isTransferring) return; // Do not send probe while transfer is ongoing

        if (!entry.channel || !this.isChannelAuthenticated(entry.channel)) {
            this.ensureConnected(peerId);
            return;
        }

        if (entry.probeTimeoutTimer) {
            clearTimeout(entry.probeTimeoutTimer);
            entry.probeTimeoutTimer = null;
        }

        const probeId = this.generateProbeId();
        const sentAt = Date.now();
        entry.activeProbe = { probeId, sentAt };

        entry.probeTimeoutTimer = setTimeout(() => {
            entry.probeTimeoutTimer = null;
            if (entry.activeProbe?.probeId === probeId) {
                entry.activeProbe = null;
                if (!entry.lastPongAt || Date.now() - entry.lastPongAt > ONLINE_TTL_MS) {
                    entry.state = 'linked-offline';
                    this.notifyChange();
                }
                this.scheduleRetry(peerId);
            }
        }, PROBE_TIMEOUT_MS);

        try {
            const ping = { type: PRESENCE_PING_TYPE, probeId, sentAt };
            entry.channel.send(JSON.stringify(ping));
        } catch (err) {
            if (entry.probeTimeoutTimer) {
                clearTimeout(entry.probeTimeoutTimer);
                entry.probeTimeoutTimer = null;
            }
            entry.activeProbe = null;
            this.scheduleRetry(peerId);
        }
    }

    scheduleHeartbeat(peerId) {
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;
        if (entry.heartbeatTimer) {
            clearTimeout(entry.heartbeatTimer);
            entry.heartbeatTimer = null;
        }
        if (!this.isNetworkOnline()) return;

        entry.heartbeatTimer = setTimeout(() => {
            entry.heartbeatTimer = null;
            if (this.isNetworkOnline() && !entry.isTransferring) {
                this.sendProbe(peerId);
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    scheduleRetry(peerId) {
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;
        if (entry.retryTimer) {
            clearTimeout(entry.retryTimer);
            entry.retryTimer = null;
        }
        if (!this.isNetworkOnline()) return;

        const delay = RECONNECT_BACKOFF_STEPS[Math.min(entry.backoffIndex, RECONNECT_BACKOFF_STEPS.length - 1)];
        entry.backoffIndex++;

        entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null;
            if (this.isNetworkOnline()) {
                this.ensureConnected(peerId);
            }
        }, delay);
    }

    setPeerTransferring(peerId, isTransferring) {
        const entry = this.getPeerEntry(peerId);
        if (!entry) return;

        entry.isTransferring = Boolean(isTransferring);
        if (entry.isTransferring) {
            entry.state = 'transferring';
            if (entry.heartbeatTimer) {
                clearTimeout(entry.heartbeatTimer);
                entry.heartbeatTimer = null;
            }
        } else {
            if (this.isPeerOnline(peerId)) {
                entry.state = 'online';
                this.scheduleHeartbeat(peerId);
            } else {
                entry.state = 'linked-offline';
                this.scheduleRetry(peerId);
            }
        }
        this.notifyChange();
    }

    isPeerOnline(peerId) {
        if (!this.isNetworkOnline()) return false;
        const entry = this.peers.get(peerId);
        if (!entry || !entry.lastPongAt) return false;
        const now = Date.now();
        if (now - entry.lastPongAt > ONLINE_TTL_MS) {
            return false;
        }
        return entry.state === 'online' || entry.state === 'transferring';
    }

    getPeerState(peerId) {
        if (!this.isNetworkOnline()) return 'linked-offline';
        const entry = this.peers.get(peerId);
        if (!entry) return 'unlinked';
        if (entry.isTransferring) return 'transferring';
        if (this.isPeerOnline(peerId)) return 'online';
        if (entry.isConnecting) return 'connecting';
        return 'linked-offline';
    }

    getOnlinePeers(peersList = []) {
        return peersList.filter(peer => this.isPeerOnline(peer.peerId));
    }

    getOnlinePeerCount(peersList = []) {
        if (Array.isArray(peersList) && peersList.length > 0) {
            return this.getOnlinePeers(peersList).length;
        }
        let count = 0;
        for (const [peerId] of this.peers.entries()) {
            if (this.isPeerOnline(peerId)) count++;
        }
        return count;
    }

    isAnyTransferring() {
        for (const [, entry] of this.peers.entries()) {
            if (entry.isTransferring) return true;
        }
        return false;
    }

    getAuthenticatedChannel(peerId) {
        const entry = this.peers.get(peerId);
        if (!entry || !entry.channel) return null;
        if (!this.isChannelAuthenticated(entry.channel)) return null;
        return entry.channel;
    }
}

// Global singleton instance for SA
let _saPresenceManagerInstance = null;

export function getP2PPresenceManager() {
    if (!_saPresenceManagerInstance) {
        _saPresenceManagerInstance = new P2PPresenceManager();
        if (typeof window !== 'undefined') {
            window.p2pPresenceManager = _saPresenceManagerInstance;
        }
    }
    return _saPresenceManagerInstance;
}

export function resetP2PPresenceManagerForTesting() {
    if (_saPresenceManagerInstance) {
        _saPresenceManagerInstance.stop();
        _saPresenceManagerInstance = null;
    }
    if (typeof window !== 'undefined') {
        delete window.p2pPresenceManager;
    }
}
