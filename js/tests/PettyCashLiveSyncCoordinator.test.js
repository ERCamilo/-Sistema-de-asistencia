import { createPettyCashLiveSyncCoordinator } from '../modules/services/PettyCashLiveSyncCoordinator.js';

function createChannel() {
    return {
        onmessage: null,
        postMessage: jest.fn(),
        close: jest.fn()
    };
}

function createConfig() {
    return {
        projects: { subscribe: jest.fn(), onApply: jest.fn() },
        periods: { subscribe: jest.fn(), onApply: jest.fn() },
        movements: { subscribe: jest.fn(), onApply: jest.fn() }
    };
}

describe('PettyCashLiveSyncCoordinator', () => {
    test('solo el dueño del lease abre los tres listeners', async () => {
        const liveSync = { start: jest.fn(() => true), stop: jest.fn() };
        const leaseStore = {
            acquireLease: jest.fn().mockResolvedValue(true),
            renewLease: jest.fn().mockResolvedValue(true),
            releaseLease: jest.fn().mockResolvedValue(true)
        };
        const channel = createChannel();
        const coordinator = createPettyCashLiveSyncCoordinator({
            liveSync,
            leaseStore,
            channelFactory: () => channel,
            ownerId: 'tab-a',
            setIntervalFn: jest.fn(() => 1),
            clearIntervalFn: jest.fn()
        });

        const role = await coordinator.start({ uid: 'user-1', config: createConfig() });

        expect(role).toBe('leader');
        expect(liveSync.start).toHaveBeenCalledTimes(1);
        expect(coordinator.isLeader()).toBe(true);
        await coordinator.stop();
        expect(leaseStore.releaseLease).toHaveBeenCalled();
    });

    test('una pestaña seguidora no abre listeners y aplica snapshots difundidos', async () => {
        const liveSync = { start: jest.fn(() => true), stop: jest.fn() };
        const leaseStore = {
            acquireLease: jest.fn().mockResolvedValue(false),
            renewLease: jest.fn(),
            releaseLease: jest.fn()
        };
        const channel = createChannel();
        const config = createConfig();
        const coordinator = createPettyCashLiveSyncCoordinator({
            liveSync,
            leaseStore,
            channelFactory: () => channel,
            ownerId: 'tab-b',
            setIntervalFn: jest.fn(() => 1),
            clearIntervalFn: jest.fn()
        });
        await coordinator.start({ uid: 'user-1', config });

        await channel.onmessage({
            data: { type: 'snapshot', collection: 'movements', items: [{ id: 'm1' }] }
        });

        expect(liveSync.start).not.toHaveBeenCalled();
        expect(config.movements.onApply).toHaveBeenCalledWith([{ id: 'm1' }]);
        await coordinator.stop();
    });

    test('el líder difunde cada snapshot después de aplicarlo localmente', async () => {
        const liveSync = {
            start: jest.fn((config) => {
                config.projects.onApply([{ id: 'p1' }]);
                return true;
            }),
            stop: jest.fn()
        };
        const leaseStore = {
            acquireLease: jest.fn().mockResolvedValue(true),
            renewLease: jest.fn().mockResolvedValue(true),
            releaseLease: jest.fn().mockResolvedValue(true)
        };
        const channel = createChannel();
        const config = createConfig();
        const coordinator = createPettyCashLiveSyncCoordinator({
            liveSync,
            leaseStore,
            channelFactory: () => channel,
            ownerId: 'tab-a',
            setIntervalFn: jest.fn(() => 1),
            clearIntervalFn: jest.fn()
        });

        await coordinator.start({ uid: 'user-1', config });
        await Promise.resolve();

        expect(config.projects.onApply).toHaveBeenCalledWith([{ id: 'p1' }]);
        expect(channel.postMessage).toHaveBeenCalledWith({
            type: 'snapshot',
            collection: 'projects',
            items: [{ id: 'p1' }]
        });
        await coordinator.stop();
    });

    test('una seguidora toma el liderazgo cuando el lease queda libre', async () => {
        let heartbeat;
        const liveSync = { start: jest.fn(() => true), stop: jest.fn() };
        const leaseStore = {
            acquireLease: jest.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true),
            renewLease: jest.fn().mockResolvedValue(true),
            releaseLease: jest.fn().mockResolvedValue(true)
        };
        const coordinator = createPettyCashLiveSyncCoordinator({
            liveSync,
            leaseStore,
            channelFactory: () => createChannel(),
            ownerId: 'tab-b',
            setIntervalFn: jest.fn((callback) => {
                heartbeat = callback;
                return 1;
            }),
            clearIntervalFn: jest.fn()
        });
        await coordinator.start({ uid: 'user-1', config: createConfig() });

        await heartbeat();

        expect(coordinator.isLeader()).toBe(true);
        expect(liveSync.start).toHaveBeenCalledTimes(1);
        await coordinator.stop();
    });

    test('sin BroadcastChannel conserva el comportamiento compatible', async () => {
        const liveSync = { start: jest.fn(() => true), stop: jest.fn() };
        const coordinator = createPettyCashLiveSyncCoordinator({
            liveSync,
            leaseStore: { acquireLease: jest.fn().mockResolvedValue(false) },
            channelFactory: () => null,
            ownerId: 'legacy-tab',
            setIntervalFn: jest.fn(() => 1),
            clearIntervalFn: jest.fn()
        });

        const role = await coordinator.start({ uid: 'user-1', config: createConfig() });

        expect(role).toBe('legacy');
        expect(liveSync.start).toHaveBeenCalledTimes(1);
        await coordinator.stop();
    });
});
