import { EmployeePhotoService } from '../modules/services/EmployeePhotoService.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

function cachedRemotePhoto(overrides = {}) {
    return {
        employeeId: 'emp-1',
        thumbnailBlob: new Blob(['thumbnail'], { type: 'image/webp' }),
        optimizedBlob: new Blob(['original'], { type: 'image/webp' }),
        width: 512,
        height: 512,
        version: 1000,
        updatedAt: 1000,
        remoteSyncedVersion: 1000,
        remoteRevision: 'original:new|thumbnail:new',
        remoteSignalUpdatedAt: 1000,
        pendingDelete: false,
        ...overrides
    };
}

function localStoreFor(initial) {
    let cached = initial;
    return {
        store: {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = value)),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; return true; })
        },
        current: () => cached
    };
}

describe('cross-device employee photo verification', () => {
    test('employee merge selects the newest photo signal independently in either direction', () => {
        const serverPhoto = { state: 'ready', revision: 'original:old|thumbnail:old', updatedAt: 50 };
        const localPhoto = { state: 'ready', revision: 'original:new|thumbnail:new', updatedAt: 300 };

        const merged = mergeEmployees(
            { id: 'emp-1', name: 'Server scalar', updatedAt: 500, photo: serverPhoto },
            { id: 'emp-1', name: 'Local scalar', updatedAt: 200, photo: localPhoto }
        );

        expect(merged.name).toBe('Server scalar');
        expect(merged.photo).toEqual(localPhoto);
    });

    test('a stale ready signal preserves a newer synchronized IndexedDB photo', async () => {
        const local = localStoreFor(cachedRemotePhoto());
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(async () => ({
                asset: { updatedAt: '2026-08-22T10:00:00.000Z' },
                blob: new Blob(['stale'], { type: 'image/webp' })
            })),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore: local.store, imageClient });

        await expect(service.reconcileEmployeePhotoSignal('emp-1', {
            state: 'ready',
            revision: 'original:old|thumbnail:old',
            updatedAt: 700
        })).resolves.toMatchObject({ status: 'current' });

        expect(imageClient.lookupAndDownload).not.toHaveBeenCalled();
        expect(local.store.replaceEmployeePhoto).not.toHaveBeenCalled();
        expect(local.current().remoteRevision).toBe('original:new|thumbnail:new');
    });

    test('a stale deleted signal preserves a newer synchronized IndexedDB photo', async () => {
        const local = localStoreFor(cachedRemotePhoto());
        const imageClient = { upload: jest.fn(), lookupAndDownload: jest.fn(), delete: jest.fn() };
        const service = new EmployeePhotoService({ localStore: local.store, imageClient });

        await expect(service.reconcileEmployeePhotoSignal('emp-1', {
            state: 'deleted',
            revision: 'deleted:700',
            updatedAt: 700
        })).resolves.toMatchObject({ status: 'current' });

        expect(local.store.deleteEmployeePhoto).not.toHaveBeenCalled();
        expect(local.current()).not.toBeNull();
    });

    test('a stale deleted signal cannot clear a newer pending deletion tombstone', async () => {
        const tombstone = cachedRemotePhoto({
            thumbnailBlob: null,
            optimizedBlob: null,
            updatedAt: 1000,
            pendingDelete: true,
            pendingDeleteVariants: ['original'],
            deleteIntentAt: 1000,
            deleteRevision: 'deleted:1000'
        });
        const local = localStoreFor(tombstone);
        const imageClient = { upload: jest.fn(), lookupAndDownload: jest.fn(), delete: jest.fn() };
        const service = new EmployeePhotoService({ localStore: local.store, imageClient });

        await expect(service.reconcileEmployeePhotoSignal('emp-1', {
            state: 'deleted',
            revision: 'deleted:700',
            updatedAt: 700
        })).resolves.toMatchObject({ status: 'pending', record: tombstone });

        expect(local.store.deleteEmployeePhoto).not.toHaveBeenCalled();
        expect(local.current()).toBe(tombstone);
    });

    test('cleanupPending keeps deletion tombstoned and prevents publishing deleted', async () => {
        const local = localStoreFor(cachedRemotePhoto());
        const publishSignal = jest.fn();
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(),
            delete: jest.fn(async () => ({ ok: true, deleted: true, cleanupPending: true }))
        };
        const service = new EmployeePhotoService({
            localStore: local.store,
            imageClient,
            publishSignal,
            now: () => 1200
        });

        await expect(service.deleteEmployeePhoto('emp-1')).resolves.toMatchObject({
            complete: false,
            pendingVariants: ['thumbnail', 'original']
        });

        expect(publishSignal).not.toHaveBeenCalled();
        expect(local.current()).toMatchObject({
            pendingDelete: true,
            pendingDeleteVariants: ['thumbnail', 'original']
        });
    });
});
