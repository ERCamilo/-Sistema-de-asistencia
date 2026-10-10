import { EmployeePhotoService } from '../modules/services/EmployeePhotoService.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

const signal = (revision, updatedAt, state = 'ready') => ({ revision, updatedAt, state });
const remote = marker => ({
    asset: { updatedAt: `2026-10-10T12:00:0${marker}.000Z` },
    blob: new Blob([String(marker)], { type: 'image/webp' })
});

function setup(initial = null) {
    let record = initial;
    const downloads = [];
    const localStore = {
        getEmployeePhoto: jest.fn(async () => record),
        replaceEmployeePhoto: jest.fn(async (_id, value) => (record = { employeeId: 'emp-1', ...value })),
        deleteEmployeePhoto: jest.fn(async () => { record = null; })
    };
    const imageClient = {
        lookupAndDownload: jest.fn(() => {
            const download = deferred();
            downloads.push(download);
            return download.promise;
        })
    };
    return {
        service: new EmployeePhotoService({ localStore, imageClient, now: () => 5000 }),
        localStore, imageClient, downloads, current: () => record
    };
}

// Wait for an observable event, without depending on wall-clock timing.
async function waitFor(predicate) {
    for (let i = 0; i < 30; i++) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('Expected asynchronous operation did not start');
}

describe('employee photo downloads across revisions', () => {
    test('a new revision downloads independently and an older completion cannot overwrite it', async () => {
        const env = setup();
        const first = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000));
        await waitFor(() => env.downloads.length === 1);
        const second = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 2);
        const newest = remote(2);
        env.downloads[1].resolve(newest);
        expect((await second).status).toBe('updated');
        env.downloads[0].resolve(remote(1));
        expect((await first).status).toBe('current');
        expect(env.current().remoteRevision).toBe('photo-v2');
        expect(env.current().thumbnailBlob).toBe(newest.blob);
        expect(env.localStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
    });

    test('duplicate signals share one write and report a visual update only once', async () => {
        const env = setup();
        const pending = [
            env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000)),
            env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000))
        ];
        await waitFor(() => env.downloads.length === 1);
        env.downloads[0].resolve(remote(1));
        const results = await Promise.all(pending);
        expect(results.filter(result => result.status === 'updated')).toHaveLength(1);
        expect(env.localStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
        expect(env.imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
    });

    test('deleting an uncached photo invalidates a pending ready download and stale later signals', async () => {
        const env = setup();
        const pending = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000));
        await waitFor(() => env.downloads.length === 1);
        await env.service.reconcileEmployeePhotoSignal('emp-1', signal('deleted:v2', 2000, 'deleted'));
        env.downloads[0].resolve(remote(1));
        await pending;
        await env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000));
        expect(env.current()).toBeNull();
        expect(env.localStore.replaceEmployeePhoto).not.toHaveBeenCalled();
        expect(env.imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
    });

    test('an older signal cannot take over while a newer revision is still downloading', async () => {
        const env = setup();
        const latest = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 1);
        expect((await env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000))).status)
            .toBe('current');
        expect(env.imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
        env.downloads[0].resolve(remote(2));
        expect((await latest).status).toBe('updated');
        expect(env.current().remoteRevision).toBe('photo-v2');
    });

    test('an original recovery from an older revision cannot contaminate the new thumbnail', async () => {
        const env = setup({
            thumbnailBlob: remote(0).blob, version: 500, remoteSyncedVersion: 500,
            remoteRevision: 'photo-v0', remoteSignalUpdatedAt: 500
        });
        const original = env.service.getEmployeeOriginal('emp-1');
        await waitFor(() => env.downloads.length === 1);
        const latest = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 2);
        env.downloads[1].resolve(remote(2));
        await latest;
        env.downloads[0].resolve(remote(0));
        await original;
        expect(env.current().remoteRevision).toBe('photo-v2');
        expect(env.current().optimizedBlob).toBeNull();
        expect(env.localStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
    });

    test('manual refresh cannot overwrite a photo changed by live synchronization during its downloads', async () => {
        const env = setup();
        const refresh = env.service.refreshEmployeePhoto('emp-1');
        await waitFor(() => env.downloads.length === 2);
        const latest = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 3);
        env.downloads[2].resolve(remote(2));
        await latest;
        env.downloads[0].resolve(remote(1));
        env.downloads[1].resolve(remote(1));
        expect((await refresh).status).toBe('superseded');
        expect(env.current().remoteRevision).toBe('photo-v2');
        expect(env.localStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
    });

    test('a locally saved photo awaiting upload reports pending rather than a failed replacement', async () => {
        const pendingPhoto = { version: 1000, optimizedBlob: remote(1).blob, remoteSyncedVersion: null };
        const env = setup(pendingPhoto);
        expect((await env.service.refreshEmployeePhoto('emp-1')).status).toBe('pending');
        expect(env.imageClient.lookupAndDownload).not.toHaveBeenCalled();
        expect(env.current().version).toBe(1000);
    });

    test('avatar reads and the cloud echo do not enqueue a second upload of the photo already being sent', async () => {
        const env = setup();
        env.imageClient.upload = jest.fn(async () => ({ asset: remote(1).asset }));
        env.service.publishSignal = jest.fn(async (id, value) => {
            await env.service.reconcileEmployeePhotoSignal(id, value);
            for (let i = 0; i < 3; i++) await env.service.getEmployeePhoto(id);
        });
        await env.service.replaceEmployeePhoto('emp-1', {
            thumbnailBlob: remote(1).blob, optimizedBlob: remote(1).blob, version: 1000
        });
        expect(await env.service.waitForPendingSync('emp-1')).toBe(true);
        expect(env.imageClient.upload).toHaveBeenCalledTimes(2);
        expect(env.service.publishSignal).toHaveBeenCalledTimes(1);
        expect(env.current().remoteSyncedVersion).toBe(1000);
    });

    test('original bytes are not attached to an older thumbnail while the announced replacement is downloading', async () => {
        const env = setup({
            thumbnailBlob: remote(0).blob, version: 500, remoteSyncedVersion: 500,
            remoteRevision: 'photo-v0', remoteSignalUpdatedAt: 500
        });
        const latest = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 1);
        const original = env.service.getEmployeeOriginal('emp-1');
        await waitFor(() => env.downloads.length === 2);
        env.downloads[1].resolve(remote(2));
        await original;
        expect(env.current().optimizedBlob ?? null).toBeNull();
        env.downloads[0].resolve(remote(2));
        await latest;
        expect(env.current().remoteRevision).toBe('photo-v2');
    });

    test('an obsolete successful download cannot clear the cooldown of the failed newer revision', async () => {
        const env = setup();
        const first = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v1', 1000));
        await waitFor(() => env.downloads.length === 1);
        const latest = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        await waitFor(() => env.downloads.length === 2);
        env.downloads[1].reject(new Error('new version offline'));
        expect((await latest).status).toBe('error');
        env.downloads[0].resolve(remote(1));
        await first;
        const retry = env.service.reconcileEmployeePhotoSignal('emp-1', signal('photo-v2', 2000));
        for (let i = 0; i < 20; i++) await Promise.resolve();
        env.downloads.at(-1).resolve(remote(2));
        await retry;
        expect(env.imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
        expect(env.current()).toBeNull();
    });
});
