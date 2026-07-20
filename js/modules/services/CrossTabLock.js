/** Exclusive lock shared by every tab, with an IndexedDB lease fallback. */

const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_RENEW_EVERY_MS = 30_000;
const DEFAULT_RETRY_MS = 150;

function createOwnerId() {
    try {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    } catch (_) { /* fall through */ }
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const defaultWait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createCrossTabLock({
    lockManager = globalThis.navigator?.locks,
    leaseStore = null,
    ownerId = createOwnerId(),
    leaseMs = DEFAULT_LEASE_MS,
    renewEveryMs = DEFAULT_RENEW_EVERY_MS,
    retryMs = DEFAULT_RETRY_MS,
    wait = defaultWait
} = {}) {
    async function runWithLease(name, task) {
        if (!leaseStore || typeof leaseStore.acquireLease !== 'function') {
            return task();
        }

        try {
            while (!(await leaseStore.acquireLease(name, ownerId, leaseMs))) {
                await wait(retryMs);
            }
        } catch (_) {
            // A storage failure must not disable cloud synchronization. The
            // in-tab mutex in the caller still protects the legacy behavior.
            return task();
        }

        const renewTimer = typeof setInterval === 'function'
            ? setInterval(() => {
                leaseStore.renewLease?.(name, ownerId, leaseMs).catch(() => undefined);
            }, renewEveryMs)
            : null;

        try {
            return await task();
        } finally {
            if (renewTimer !== null) clearInterval(renewTimer);
            try { await leaseStore.releaseLease(name, ownerId); } catch (_) { /* expires naturally */ }
        }
    }

    return {
        run(name, task) {
            if (lockManager && typeof lockManager.request === 'function') {
                return lockManager.request(name, { mode: 'exclusive' }, () => task());
            }
            return runWithLease(name, task);
        }
    };
}

export default createCrossTabLock;
