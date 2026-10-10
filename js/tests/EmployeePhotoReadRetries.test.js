import { EmployeePhotoService } from '../modules/services/EmployeePhotoService.js';
import { AppImageClient } from '../modules/services/AppImageClient.js';

function setup() {
    const records = new Map();
    const clock = { now: 1000 };
    const localStore = {
        getEmployeePhoto: jest.fn(async id => records.get(id) || null),
        replaceEmployeePhoto: jest.fn(async (id, value) => {
            records.set(id, { employeeId: id, ...value });
            return records.get(id);
        }),
        deleteEmployeePhoto: jest.fn(async id => records.delete(id))
    };
    const imageClient = {
        lookupAndDownload: jest.fn().mockRejectedValue(Object.assign(new Error('missing'), {
            status: 404, code: 'IMAGE_NOT_FOUND'
        }))
    };
    return {
        clock, records, imageClient,
        service: new EmployeePhotoService({ localStore, imageClient, now: () => clock.now })
    };
}

const remotePhoto = () => ({
    asset: { updatedAt: '2026-08-22T12:00:00Z' },
    blob: new Blob(['photo'], { type: 'image/webp' })
});

describe('remote photo reads after a failure', () => {
    test.each(['INVALID_FIREBASE_TOKEN', 'MISSING_ID_TOKEN'])('a backend 401 %s recovers immediately with a valid session', async code => {
        const { service } = setup();
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ ok: false, error: code }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, signedUrl: 'https://images.invalid/photo', asset: remotePhoto().asset }) })
            .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => remotePhoto().blob });
        service.imageClient = new AppImageClient({
            endpoint: 'https://images.invalid/webhook/app-images',
            getIdToken: async () => 'renewed-session-token', fetchImpl
        });
        expect(await service.getEmployeePhoto('emp-1')).toBeNull();
        expect((await service.getEmployeePhoto('emp-1'))?.thumbnailBlob).toBeInstanceOf(Blob);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    test.each(['AUTH_REQUIRED', 'AUTH_CHANGED'])('a %s error does not delay photo recovery after login', async code => {
        const { service, imageClient } = setup();
        imageClient.lookupAndDownload.mockRejectedValueOnce(Object.assign(new Error('no session'), { code }))
            .mockResolvedValue(remotePhoto());
        await service.getEmployeePhoto('emp-1');
        expect((await service.getEmployeePhoto('emp-1'))?.thumbnailBlob).toBeInstanceOf(Blob);
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
    });

    test('a proxy 404 is not reposted on every render, and cached photos still display', async () => {
        const { service, records } = setup();
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: false, status: 404,
            json: async () => ({ message: 'The requested webhook is not registered.' })
        });
        service.imageClient = new AppImageClient({
            endpoint: 'https://images.invalid/webhook/app-images',
            getIdToken: async () => 'test-token', fetchImpl
        });
        const cached = { thumbnailBlob: remotePhoto().blob, version: 10 };
        records.set('emp-cached', cached);
        for (let render = 0; render < 5; render++) {
            expect(await service.getEmployeePhoto('emp-missing')).toBeNull();
            expect(await service.getEmployeePhoto('emp-cached')).toBe(cached);
        }
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('repeated avatar renders wait progressively, then recover and use the local cache', async () => {
        const { service, imageClient, clock } = setup();
        await service.getEmployeePhoto('emp-1');
        for (let i = 0; i < 5; i++) await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
        clock.now += 15_000;
        await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
        clock.now += 15_000;
        await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
        clock.now += 15_000;
        imageClient.lookupAndDownload.mockResolvedValue(remotePhoto());
        expect((await service.getEmployeePhoto('emp-1')).thumbnailBlob).toBeInstanceOf(Blob);
        await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(3);
    });

    test('a failed thumbnail does not suppress other employees or original downloads', async () => {
        const { service, imageClient } = setup();
        await service.getEmployeePhoto('emp-1');
        await service.getEmployeePhoto('emp-2');
        await service.getEmployeeOriginal('emp-1');
        expect(imageClient.lookupAndDownload.mock.calls.map(([c]) => [c.ownerId, c.variant])).toEqual([
            ['emp-1', 'thumbnail'], ['emp-2', 'thumbnail'], ['emp-1', 'original']
        ]);
    });

    test('opening an original again retries immediately after connectivity recovers', async () => {
        const { service, records, imageClient } = setup();
        const cached = { thumbnailBlob: remotePhoto().blob, version: 10 };
        records.set('emp-1', cached);
        expect(await service.getEmployeeOriginal('emp-1')).toBe(cached);
        imageClient.lookupAndDownload.mockResolvedValue(remotePhoto());
        const recovered = await service.getEmployeeOriginal('emp-1');
        expect(recovered.optimizedBlob).toBeInstanceOf(Blob);
        expect(recovered.thumbnailBlob).toBe(cached.thumbnailBlob);
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
    });

    test('explicit refresh bypasses the wait and retrieves both variants', async () => {
        const { service, imageClient } = setup();
        await service.getEmployeePhoto('emp-1');
        imageClient.lookupAndDownload.mockResolvedValue(remotePhoto());
        const result = await service.refreshEmployeePhoto('emp-1');
        expect(result.status).toBe('updated');
        expect(result.record.optimizedBlob).toBeInstanceOf(Blob);
        expect(result.record.thumbnailBlob).toBeInstanceOf(Blob);
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(3);
    });

    test('repeated cloud signals wait, while a new revision retries immediately', async () => {
        const { service, imageClient } = setup();
        const signal = { state: 'ready', revision: 'photo-v1', updatedAt: 2000 };
        await service.reconcileEmployeePhotoSignal('emp-1', signal);
        await service.reconcileEmployeePhotoSignal('emp-1', signal);
        await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
        imageClient.lookupAndDownload.mockResolvedValue(remotePhoto());
        expect(await service.reconcileEmployeePhotoSignal('emp-1', {
            ...signal, revision: 'photo-v2', updatedAt: 3000
        })).toMatchObject({ status: 'updated', record: { remoteRevision: 'photo-v2' } });
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
    });

    test('concurrent failed requests are shared and subsequent renders do not refetch', async () => {
        const { service, imageClient } = setup();
        await Promise.all([service.getEmployeePhoto('emp-1'), service.getEmployeePhoto('emp-1')]);
        await service.getEmployeePhoto('emp-1');
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(1);
    });

    test('an obsolete failure does not delay the next local intent', async () => {
        const { service, imageClient } = setup();
        let reject;
        imageClient.lookupAndDownload.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        const pending = service.readRemoteVariant('emp-1', 'thumbnail');
        service.nextIntent('emp-1');
        reject(new Error('old failure'));
        await expect(pending).rejects.toThrow('old failure');
        imageClient.lookupAndDownload.mockResolvedValue(remotePhoto());
        await expect(service.getEmployeePhoto('emp-1')).resolves.toBeTruthy();
        expect(imageClient.lookupAndDownload).toHaveBeenCalledTimes(2);
    });
});
