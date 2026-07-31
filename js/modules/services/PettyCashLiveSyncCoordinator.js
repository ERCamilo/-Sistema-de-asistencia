/**
 * Coordinates Petty Cash listeners across tabs.
 *
 * One tab owns an IndexedDB lease and opens Firestore listeners. Followers
 * receive the same snapshots through BroadcastChannel, avoiding one billed
 * listener set per open tab. If the leader disappears, the lease expires and
 * a follower takes over on the next heartbeat.
 */

import { indexedDBService } from './IndexedDBService.js';
import { PettyCashLiveSync } from './PettyCashLiveSync.js';

const COLLECTIONS = ['projects', 'periods', 'movements'];
const LEASE_MS = 15_000;
const HEARTBEAT_MS = 5_000;

function createOwnerId() {
    try {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch { /* fallback below */ }
    return `pc-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultChannelFactory(name) {
    try {
        return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
    } catch {
        return null;
    }
}

export function createPettyCashLiveSyncCoordinator({
    liveSync = PettyCashLiveSync,
    leaseStore = indexedDBService,
    channelFactory = defaultChannelFactory,
    ownerId = createOwnerId(),
    leaseMs = LEASE_MS,
    heartbeatMs = HEARTBEAT_MS,
    setIntervalFn = (callback, delay) => setInterval(callback, delay),
    clearIntervalFn = (timer) => clearInterval(timer)
} = {}) {
    let activeUid = null;
    let activeConfig = null;
    let channel = null;
    let timer = null;
    let leader = false;
    let legacy = false;
    const pendingSnapshots = new Map();

    const leaseName = () => `attendance-app-petty-cash-listeners:${activeUid}`;
    const channelName = () => `attendance-app-petty-cash:${activeUid}`;

    function validConfig(config) {
        return COLLECTIONS.some((collectionName) =>
            typeof config?.[collectionName]?.subscribe === 'function' &&
            typeof config?.[collectionName]?.onApply === 'function'
        );
    }

    function leaderConfig() {
        return Object.fromEntries(COLLECTIONS.map(
            (collectionName) => [collectionName, wrappedCollection(collectionName)]
        ));
    }

    function wrappedCollection(collectionName) {
        const item = activeConfig?.[collectionName];
        if (!item) return item;
        return {
            subscribe: item.subscribe,
            onApply: async (items) => {
                await item.onApply(items);
                if (leader) {
                        channel?.postMessage({
                            type: 'snapshot',
                            collection: collectionName,
                            scopeKey: item.scopeKey,
                            items
                        });
                }
            }
        };
    }

    async function becomeLeader() {
        if (leader || legacy || !activeConfig) return;
        leader = true;
        liveSync.start(leaderConfig());
    }

    async function relinquishLeadership() {
        if (!leader) return;
        leader = false;
        liveSync.stop();
    }

    async function tryAcquireLeadership() {
        if (!activeUid || legacy) return false;
        let acquired = false;
        try {
            acquired = await leaseStore.acquireLease(leaseName(), ownerId, leaseMs);
        } catch {
            acquired = false;
        }
        if (acquired) await becomeLeader();
        return acquired;
    }

    async function heartbeat() {
        if (!activeUid || legacy) return;
        if (!leader) {
            await tryAcquireLeadership();
            return;
        }
        let renewed = false;
        try {
            renewed = await leaseStore.renewLease(leaseName(), ownerId, leaseMs);
        } catch {
            renewed = false;
        }
        if (!renewed) {
            await relinquishLeadership();
            await tryAcquireLeadership();
        }
    }

    return {
        async start({ uid, config } = {}) {
            const cleanUid = String(uid || '').trim();
            if (!cleanUid || !validConfig(config)) return 'inactive';
            if (activeUid === cleanUid && activeConfig) {
                return legacy ? 'legacy' : (leader ? 'leader' : 'follower');
            }
            if (activeUid) await this.stop();

            activeUid = cleanUid;
            activeConfig = config;
            channel = channelFactory(channelName());
            if (!channel) {
                legacy = true;
                liveSync.start(activeConfig);
                return 'legacy';
            }

            channel.onmessage = async (event) => {
                const message = event?.data;
                if (leader || message?.type !== 'snapshot') return;
                const item = activeConfig?.[message.collection];
                if (!item || typeof item.onApply !== 'function' || !Array.isArray(message.items)) return;
                if ((item.scopeKey || '') !== (message.scopeKey || '')) {
                    pendingSnapshots.set(message.collection, message);
                    return;
                }
                await item.onApply(message.items);
            };

            await tryAcquireLeadership();
            timer = setIntervalFn(() => heartbeat().catch(() => undefined), heartbeatMs);
            return leader ? 'leader' : 'follower';
        },

        async stop() {
            if (timer !== null) clearIntervalFn(timer);
            timer = null;
            if (leader || legacy) liveSync.stop();
            if (leader && activeUid) {
                try { await leaseStore.releaseLease(leaseName(), ownerId); } catch { /* expires */ }
            }
            try { channel?.close(); } catch { /* noop */ }
            channel = null;
            leader = false;
            legacy = false;
            activeConfig = null;
            activeUid = null;
            pendingSnapshots.clear();
        },

        replaceCollection(collectionName, item) {
            if (!activeConfig || !COLLECTIONS.includes(collectionName)) return false;
            if (typeof item?.subscribe !== 'function' || typeof item?.onApply !== 'function') {
                return false;
            }
            activeConfig[collectionName] = item;
            if (!leader && !legacy) {
                const pending = pendingSnapshots.get(collectionName);
                if (pending && (pending.scopeKey || '') === (item.scopeKey || '')) {
                    pendingSnapshots.delete(collectionName);
                    Promise.resolve(item.onApply(pending.items)).catch(() => undefined);
                }
                return true;
            }
            if (typeof liveSync.replace === 'function') {
                return liveSync.replace(collectionName, wrappedCollection(collectionName));
            }
            liveSync.stop();
            return liveSync.start(legacy ? activeConfig : leaderConfig());
        },

        isLeader() {
            return leader;
        },

        role() {
            if (!activeUid) return 'inactive';
            if (legacy) return 'legacy';
            return leader ? 'leader' : 'follower';
        }
    };
}

export const PettyCashLiveSyncCoordinator = createPettyCashLiveSyncCoordinator();

export default PettyCashLiveSyncCoordinator;
