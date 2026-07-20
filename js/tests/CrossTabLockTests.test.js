import { createCrossTabLock } from '../modules/services/CrossTabLock.js';

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

function mockLeaseStore(acquireLease = jest.fn().mockResolvedValue(true)) {
    return {
        acquireLease,
        renewLease: jest.fn().mockResolvedValue(true),
        releaseLease: jest.fn().mockResolvedValue(true)
    };
}

describe('CrossTabLock', () => {
    test('serializes callers through the browser Web Locks API', async () => {
        let tail = Promise.resolve();
        const lockManager = {
            request: jest.fn((_name, _options, callback) => {
                const run = tail.then(() => callback({ name: 'main-sync-outbox' }));
                tail = run.catch(() => undefined);
                return run;
            })
        };
        const lock = createCrossTabLock({ lockManager, leaseStore: null });
        const firstMayFinish = deferred();
        const events = [];
        const first = lock.run('main-sync-outbox', async () => {
            events.push('first:start');
            await firstMayFinish.promise;
            events.push('first:end');
        });
        const second = lock.run('main-sync-outbox', async () => {
            events.push('second:start');
            events.push('second:end');
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(events).toEqual(['first:start']);
        firstMayFinish.resolve();
        await Promise.all([first, second]);
        expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
        expect(lockManager.request).toHaveBeenCalledWith(
            'main-sync-outbox',
            { mode: 'exclusive' },
            expect.any(Function)
        );
    });

    test('uses an IndexedDB lease when Web Locks is unavailable and releases it', async () => {
        const leaseStore = mockLeaseStore();
        const lock = createCrossTabLock({
            lockManager: null,
            leaseStore,
            ownerId: 'tab-a',
            leaseMs: 120_000,
            renewEveryMs: 30_000
        });
        const task = jest.fn().mockResolvedValue('done');
        await expect(lock.run('main-sync-outbox', task)).resolves.toBe('done');
        expect(leaseStore.acquireLease).toHaveBeenCalledWith('main-sync-outbox', 'tab-a', 120_000);
        expect(leaseStore.releaseLease).toHaveBeenCalledWith('main-sync-outbox', 'tab-a');
        expect(task).toHaveBeenCalledTimes(1);
    });

    test('waits for an occupied fallback lease and takes over after it becomes available', async () => {
        const leaseStore = mockLeaseStore(jest.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true));
        const wait = jest.fn().mockResolvedValue(undefined);
        const lock = createCrossTabLock({
            lockManager: null,
            leaseStore,
            ownerId: 'tab-b',
            wait
        });
        const task = jest.fn().mockResolvedValue('taken-over');
        await expect(lock.run('main-sync-outbox', task)).resolves.toBe('taken-over');
        expect(leaseStore.acquireLease).toHaveBeenCalledTimes(3);
        expect(wait).toHaveBeenCalledTimes(2);
        expect(task).toHaveBeenCalledTimes(1);
    });

    test('releases the fallback lease even when the protected task fails', async () => {
        const leaseStore = mockLeaseStore();
        const lock = createCrossTabLock({ lockManager: null, leaseStore, ownerId: 'tab-c' });

        await expect(lock.run('main-sync-outbox', async () => {
            throw new Error('cloud failed');
        })).rejects.toThrow('cloud failed');

        expect(leaseStore.releaseLease).toHaveBeenCalledWith('main-sync-outbox', 'tab-c');
    });
});

describe('MainSyncStore multi-tab wiring', () => {
    afterEach(() => {
        jest.resetModules();
        delete navigator.locks;
    });

    test('drains the outbox inside the shared browser lock', async () => {
        const request = jest.fn((_name, _options, callback) => callback({ name: 'lock' }));
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { request }
        });
        jest.resetModules();
        const indexedDBService = require('../modules/services/IndexedDBService.js').default;
        indexedDBService.getAll.mockResolvedValue([]);
        const { MainSyncStore } = require('../modules/services/MainSyncStore.js');
        const guards = {
            hasSession: () => true,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            onCloudResult: jest.fn()
        };

        await MainSyncStore.flush(guards);

        expect(request).toHaveBeenCalledWith(
            'attendance-app-main-sync-outbox',
            { mode: 'exclusive' },
            expect.any(Function)
        );
        expect(indexedDBService.getAll).toHaveBeenCalledWith('mainSyncOutbox');
    });

    test('revalidates the session after waiting for another tab', async () => {
        const mayAcquire = deferred();
        const request = jest.fn(async (_name, _options, callback) => {
            await mayAcquire.promise;
            return callback({ name: 'lock' });
        });
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { request }
        });
        jest.resetModules();
        const indexedDBService = require('../modules/services/IndexedDBService.js').default;
        indexedDBService.getAll.mockResolvedValue([]);
        const { MainSyncStore } = require('../modules/services/MainSyncStore.js');
        let hasSession = true;
        const guards = {
            hasSession: () => hasSession,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            onCloudResult: jest.fn()
        };

        const flush = MainSyncStore.flush(guards);
        hasSession = false;
        mayAcquire.resolve();
        await flush;

        expect(indexedDBService.getAll).not.toHaveBeenCalled();
    });
});
