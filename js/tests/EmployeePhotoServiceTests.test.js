import { EmployeePhotoService } from '../modules/services/EmployeePhotoService.js';

function processedPhoto(version = 7) {
    return {
        thumbnailBlob: new Blob(['thumb'], { type: 'image/webp' }),
        optimizedBlob: new Blob(['original'], { type: 'image/webp' }),
        width: 800,
        height: 800,
        version,
        updatedAt: 100
    };
}

describe('EmployeePhotoService', () => {
    test('publishes a durable ready signal only after both remote variants succeed', async () => {
        const events = [];
        let cached = null;
        const localStore = {
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = { employeeId: 'emp-1', ...value })),
            getEmployeePhoto: jest.fn(async () => cached),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(async coords => {
                events.push(`upload:${coords.variant}`);
                return { asset: { updatedAt: coords.variant === 'original' ? '2026-08-22T12:00:00.000Z' : '2026-08-22T12:00:01.000Z' } };
            }),
            lookupAndDownload: jest.fn(),
            delete: jest.fn()
        };
        const publishSignal = jest.fn(async (_id, signal) => events.push(`signal:${signal.state}`));
        const service = new EmployeePhotoService({ localStore, imageClient, publishSignal, now: () => 500 });

        await service.replaceEmployeePhoto('emp-1', processedPhoto());
        await service.waitForPendingSync('emp-1');

        expect(events).toEqual(['upload:original', 'upload:thumbnail', 'signal:ready']);
        expect(publishSignal.mock.calls[0][1]).toEqual({
            state: 'ready',
            revision: 'original:2026-08-22T12:00:00.000Z|thumbnail:2026-08-22T12:00:01.000Z',
            updatedAt: 500
        });
        expect(cached.remoteRevision).toBe(publishSignal.mock.calls[0][1].revision);
    });

    test('never publishes ready when either remote variant fails', async () => {
        let cached = null;
        const localStore = {
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = { employeeId: 'emp-1', ...value })),
            getEmployeePhoto: jest.fn(async () => cached),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn()
                .mockResolvedValueOnce({ asset: { updatedAt: '2026-08-22T12:00:00.000Z' } })
                .mockRejectedValueOnce(new Error('thumbnail offline')),
            lookupAndDownload: jest.fn(),
            delete: jest.fn()
        };
        const publishSignal = jest.fn();
        const service = new EmployeePhotoService({ localStore, imageClient, publishSignal });

        await service.replaceEmployeePhoto('emp-1', processedPhoto());
        await expect(service.waitForPendingSync('emp-1')).resolves.toBe(false);

        expect(publishSignal).not.toHaveBeenCalled();
        expect(cached.remoteSyncedVersion).not.toBe(cached.version);
    });

    test('commits local replacement before uploading original and thumbnail', async () => {
        const events = [];
        let cached = null;
        const localStore = {
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                events.push('local');
                cached = { employeeId: 'emp-1', ...value };
                return cached;
            }),
            getEmployeePhoto: jest.fn(async () => cached),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(async coords => { events.push(`remote:${coords.variant}`); return { asset: {} }; }),
            lookupAndDownload: jest.fn(),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        await service.replaceEmployeePhoto('emp-1', processedPhoto());
        expect(events[0]).toBe('local');
        await service.waitForPendingSync('emp-1');
        expect(events).toEqual(['local', 'remote:original', 'remote:thumbnail', 'local']);
    });

    test('downloads only the thumbnail on cache miss and original only when requested', async () => {
        let cached = null;
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                cached = { employeeId: 'emp-1', ...value };
                return cached;
            }),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(async coords => ({
                asset: { uploadedAt: '2026-08-22T12:00:00Z' },
                blob: new Blob([coords.variant], { type: 'image/webp' })
            })),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        const thumbnailRecord = await service.getEmployeePhoto('emp-1');
        expect(thumbnailRecord.thumbnailBlob).toBeInstanceOf(Blob);
        expect(thumbnailRecord.optimizedBlob).toBeNull();
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
        expect(imageClient.lookupAndDownload.mock.calls[0][0].variant).toBe('thumbnail');

        const fullRecord = await service.getEmployeeOriginal('emp-1');
        expect(fullRecord.optimizedBlob).toBeInstanceOf(Blob);
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
        expect(imageClient.lookupAndDownload.mock.calls[1][0].variant).toBe('original');
        expect(JSON.stringify(fullRecord)).not.toContain('signed');
    });

    test('uploads the newest local replacement after an older sync is already running', async () => {
        let cached = null;
        let releaseFirst;
        const firstUpload = new Promise(resolve => { releaseFirst = resolve; });
        const localStore = {
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                cached = { employeeId: 'emp-1', ...value };
                return cached;
            }),
            getEmployeePhoto: jest.fn(async () => cached),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn()
                .mockImplementationOnce(() => firstUpload)
                .mockResolvedValue({ asset: {} }),
            lookupAndDownload: jest.fn(),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        await service.replaceEmployeePhoto('emp-1', processedPhoto(1));
        await service.replaceEmployeePhoto('emp-1', processedPhoto(2));
        releaseFirst({ asset: {} });
        await service.waitForPendingSync('emp-1');

        expect(imageClient.upload).toHaveBeenCalledTimes(4);
        expect(imageClient.upload.mock.calls[2][1]).toBe(cached.optimizedBlob);
        expect(imageClient.upload.mock.calls[3][1]).toBe(cached.thumbnailBlob);
        expect(cached.remoteSyncedVersion).toBe(2);
    });

    test('deduplicates concurrent thumbnail recovery across shared avatar surfaces', async () => {
        let releaseLookup;
        const remote = new Promise(resolve => { releaseLookup = resolve; });
        const localStore = {
            getEmployeePhoto: jest.fn().mockResolvedValue(null),
            replaceEmployeePhoto: jest.fn(async (_id, value) => value),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(() => remote),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        const first = service.getEmployeePhoto('emp-1');
        const second = service.getEmployeePhoto('emp-1');
        releaseLookup({
            asset: { uploadedAt: '2026-08-22T12:00:00Z' },
            blob: new Blob(['thumb'], { type: 'image/webp' })
        });

        await expect(first).resolves.toBeTruthy();
        await expect(second).resolves.toBeTruthy();
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
    });

    test('keeps cached fallback on remote failure and deletes remote variants before local cache', async () => {
        const cached = processedPhoto();
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(),
            deleteEmployeePhoto: jest.fn(async () => true)
        };
        const events = [];
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn().mockRejectedValue(new Error('offline')),
            delete: jest.fn(async coords => { events.push(coords.variant); })
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        expect(await service.getEmployeePhoto('emp-1')).toBe(cached);
        await service.deleteEmployeePhoto('emp-1');
        expect(events).toEqual(['thumbnail', 'original']);
        expect(localStore.deleteEmployeePhoto).toHaveBeenCalledWith('emp-1');
    });

    test('persists a hidden tombstone after partial remote deletion and safely retries only pending variants', async () => {
        let cached = { employeeId: 'emp-1', ...processedPhoto() };
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                cached = { employeeId: 'emp-1', ...value };
                return cached;
            }),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; return true; })
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(),
            delete: jest.fn()
                .mockResolvedValueOnce({ ok: true })
                .mockRejectedValueOnce(new Error('original delete offline'))
                .mockResolvedValueOnce({ ok: true })
        };
        const service = new EmployeePhotoService({ localStore, imageClient, now: () => 500 });

        await expect(service.deleteEmployeePhoto('emp-1')).resolves.toEqual({
            complete: false,
            pendingVariants: ['original']
        });
        expect(cached.pendingDelete).toBe(true);
        expect(cached.pendingDeleteVariants).toEqual(['original']);
        expect(cached.thumbnailBlob).toBeNull();
        expect(cached.optimizedBlob).toBeNull();
        expect(imageClient.lookupAndDownload).not.toHaveBeenCalled();

        await expect(service.getEmployeePhoto('emp-1')).resolves.toBeNull();
        await service.waitForPendingSync('emp-1');
        expect(localStore.deleteEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(cached).toBeNull();
        expect(imageClient.delete.mock.calls.map(([coords]) => coords.variant))
            .toEqual(['thumbnail', 'original', 'original']);
    });

    test('publishes deleted only after both variants are removed and keeps the tombstone if signaling fails', async () => {
        let cached = { employeeId: 'emp-1', ...processedPhoto() };
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = { employeeId: 'emp-1', ...value })),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; return true; })
        };
        const events = [];
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(),
            delete: jest.fn(async coords => events.push(`delete:${coords.variant}`))
        };
        const publishSignal = jest.fn()
            .mockImplementationOnce(async (_id, signal) => {
                events.push(`signal:${signal.state}:failed`);
                throw new Error('firebase offline');
            })
            .mockImplementationOnce(async (_id, signal) => events.push(`signal:${signal.state}:ok`));
        const service = new EmployeePhotoService({ localStore, imageClient, publishSignal, now: () => 700 });

        await expect(service.deleteEmployeePhoto('emp-1')).resolves.toEqual({
            complete: false,
            pendingVariants: []
        });
        expect(events).toEqual(['delete:thumbnail', 'delete:original', 'signal:deleted:failed']);
        expect(cached.pendingDelete).toBe(true);
        expect(cached.pendingDeleteVariants).toEqual([]);
        expect(cached.pendingDeleteSignal).toBe(true);
        expect(localStore.deleteEmployeePhoto).not.toHaveBeenCalled();

        await expect(service.getEmployeePhoto('emp-1')).resolves.toBeNull();
        await service.waitForPendingSync('emp-1');
        expect(events).toEqual([
            'delete:thumbnail',
            'delete:original',
            'signal:deleted:failed',
            'signal:deleted:ok'
        ]);
        expect(cached).toBeNull();
    });

    test('reconciles a differing ready signal, keeps matching cache-first, and evicts only confirmed deleted', async () => {
        let cached = {
            employeeId: 'emp-1',
            ...processedPhoto(4),
            remoteSyncedVersion: 4,
            remoteRevision: 'old-revision'
        };
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = { employeeId: 'emp-1', ...value })),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; return true; })
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(async coords => ({
                asset: { updatedAt: '2026-08-22T13:00:00.000Z' },
                blob: new Blob([coords.variant], { type: 'image/webp' })
            })),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient });
        const ready = { state: 'ready', revision: 'new-revision', updatedAt: 900 };

        await expect(service.reconcileEmployeePhotoSignal('emp-1', ready)).resolves.toMatchObject({
            status: 'updated'
        });
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
        expect(imageClient.lookupAndDownload.mock.calls[0][0].variant).toBe('thumbnail');
        expect(cached.remoteRevision).toBe('new-revision');
        expect(cached.optimizedBlob).toBeNull();

        await expect(service.reconcileEmployeePhotoSignal('emp-1', ready)).resolves.toMatchObject({
            status: 'current'
        });
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);

        await expect(service.reconcileEmployeePhotoSignal('emp-1', {
            state: 'deleted', revision: 'deleted:1000', updatedAt: 1000
        })).resolves.toMatchObject({ status: 'deleted' });
        expect(cached).toBeNull();
    });

    test('does not let an older ready signal resurrect or replace a local deletion tombstone', async () => {
        const cached = {
            employeeId: 'emp-1',
            thumbnailBlob: null,
            optimizedBlob: null,
            version: 5,
            pendingDelete: true,
            pendingDeleteVariants: ['original'],
            deleteIntentAt: 800,
            deleteRevision: 'deleted:800'
        };
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(),
            delete: jest.fn(() => new Promise(() => {}))
        };
        const service = new EmployeePhotoService({ localStore, imageClient });

        await expect(service.reconcileEmployeePhotoSignal('emp-1', {
            state: 'ready', revision: 'older-ready', updatedAt: 700
        })).resolves.toMatchObject({ status: 'pending', record: cached });

        expect(imageClient.lookupAndDownload).not.toHaveBeenCalled();
        expect(localStore.replaceEmployeePhoto).not.toHaveBeenCalled();
    });

    test('manual refresh bypasses stale cache, replaces both variants when newer, and preserves pending local data on failure', async () => {
        let cached = {
            employeeId: 'emp-1',
            ...processedPhoto(5),
            remoteSyncedVersion: 5,
            remoteRevision: 'old-revision'
        };
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => (cached = { employeeId: 'emp-1', ...value })),
            deleteEmployeePhoto: jest.fn()
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(async coords => ({
                asset: { updatedAt: coords.variant === 'original' ? '2026-08-22T14:00:00.000Z' : '2026-08-22T14:00:01.000Z' },
                blob: new Blob([`new-${coords.variant}`], { type: 'image/webp' })
            })),
            delete: jest.fn()
        };
        const service = new EmployeePhotoService({ localStore, imageClient, now: () => 1200 });

        await expect(service.refreshEmployeePhoto('emp-1')).resolves.toMatchObject({ status: 'updated' });
        expect(imageClient.lookupAndDownload.mock.calls.map(([coords]) => coords.variant))
            .toEqual(['original', 'thumbnail']);
        expect(cached.optimizedBlob).toBeInstanceOf(Blob);
        expect(cached.thumbnailBlob).toBeInstanceOf(Blob);

        imageClient.lookupAndDownload.mockClear();
        await expect(service.refreshEmployeePhoto('emp-1')).resolves.toMatchObject({ status: 'current' });

        imageClient.lookupAndDownload.mockRejectedValueOnce(new Error('offline'));
        const syncedBeforeFailure = cached;
        const failed = await service.refreshEmployeePhoto('emp-1');
        expect(failed.status).toBe('error');
        expect(failed.record).toBe(syncedBeforeFailure);
        expect(cached).toBe(syncedBeforeFailure);

        cached = { employeeId: 'emp-1', ...processedPhoto(6), remoteSyncedVersion: 5, remoteRevision: 'server-old' };
        const before = cached;
        const readsBeforePending = imageClient.lookupAndDownload.mock.calls.length;
        const result = await service.refreshEmployeePhoto('emp-1');
        expect(result.status).toBe('error');
        expect(result.record).toBe(before);
        expect(cached).toBe(before);
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(readsBeforePending);
    });

    test('serializes delete then replace so the newest replacement intent wins deterministically', async () => {
        let cached = { employeeId: 'emp-1', ...processedPhoto(1) };
        let releaseOriginalDelete;
        const originalDelete = new Promise(resolve => { releaseOriginalDelete = resolve; });
        const events = [];
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                cached = { employeeId: 'emp-1', ...value };
                events.push(value.pendingDelete ? 'local:tombstone' : `local:photo:${value.version}`);
                return cached;
            }),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; events.push('local:deleted'); return true; })
        };
        const imageClient = {
            upload: jest.fn(async coords => { events.push(`upload:${coords.variant}`); return { ok: true }; }),
            lookupAndDownload: jest.fn(),
            delete: jest.fn(async coords => {
                events.push(`delete:${coords.variant}`);
                if (coords.variant === 'original') await originalDelete;
                return { ok: true };
            })
        };
        const service = new EmployeePhotoService({ localStore, imageClient, now: () => 700 });

        const deletion = service.deleteEmployeePhoto('emp-1');
        const replacement = service.replaceEmployeePhoto('emp-1', processedPhoto(9));
        await Promise.resolve();
        releaseOriginalDelete({ ok: true });

        await deletion;
        await replacement;
        await service.waitForPendingSync('emp-1');
        expect(cached.pendingDelete).not.toBe(true);
        expect(cached.version).toBe(9);
        expect(events).toEqual([
            'local:tombstone',
            'delete:thumbnail',
            'delete:original',
            'local:deleted',
            'local:photo:9',
            'upload:original',
            'upload:thumbnail',
            'local:photo:9'
        ]);
    });

    test('does not let an in-flight remote recovery resurrect a completed deletion', async () => {
        let cached = null;
        let resolveLookup;
        const lookup = new Promise(resolve => { resolveLookup = resolve; });
        const localStore = {
            getEmployeePhoto: jest.fn(async () => cached),
            replaceEmployeePhoto: jest.fn(async (_id, value) => {
                cached = { employeeId: 'emp-1', ...value };
                return cached;
            }),
            deleteEmployeePhoto: jest.fn(async () => { cached = null; return true; })
        };
        const imageClient = {
            upload: jest.fn(),
            lookupAndDownload: jest.fn(() => lookup),
            delete: jest.fn().mockResolvedValue({ ok: true })
        };
        const service = new EmployeePhotoService({ localStore, imageClient, now: () => 900 });

        const recovery = service.getEmployeePhoto('emp-1');
        await Promise.resolve();
        await service.deleteEmployeePhoto('emp-1');
        resolveLookup({
            asset: { uploadedAt: '2026-08-22T12:00:00Z' },
            blob: new Blob(['late-thumbnail'], { type: 'image/webp' })
        });

        await expect(recovery).resolves.toBeNull();
        expect(cached).toBeNull();
        expect(localStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
        expect(localStore.replaceEmployeePhoto.mock.calls[0][1].pendingDelete).toBe(true);
    });
});
