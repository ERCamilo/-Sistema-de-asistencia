/**
 * Foto de perfil: cliente web real (AppImageClient) → proxy n8n → app-images.
 *
 * El proxy y la función se simulan con el contrato documentado en
 * supabase/functions/app-images/README.md. Con el flujo n8n inactivo, n8n responde
 * 404 «webhook not registered» sin el campo `error` del backend: la app debe
 * conservar la foto local, no publicar la señal en Firestore, no repetir el POST en
 * cada render y subirla cuando el servicio vuelva. Nada de esto toca red real.
 */
import { AppImageClient } from '../modules/services/AppImageClient.js';
import { EmployeePhotoService } from '../modules/services/EmployeePhotoService.js';

// jsdom no implementa Blob.text().
const blobText = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
});

const N8N_NOT_REGISTERED = { code: 404, message: 'The requested webhook "POST app-images" is not registered.' };

function fakeImageBackend() {
    const assets = new Map();
    const state = { proxyActive: true, posts: [] };
    let version = 0;
    const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    const fetchImpl = async (url, init = {}) => {
        if (url.startsWith('https://signed.invalid/')) {
            const asset = assets.get(decodeURIComponent(url.slice('https://signed.invalid/'.length)));
            return asset ? { ok: true, status: 200, blob: async () => asset.blob } : { ok: false, status: 400 };
        }
        const body = JSON.parse(init.body);
        state.posts.push(body);
        if (!state.proxyActive) return reply(N8N_NOT_REGISTERED, 404);
        const key = [body.category, body.ownerType, body.ownerId, body.assetId, body.variant].join('/');
        if (body.action === 'upload') {
            version++;
            const updatedAt = new Date(Date.UTC(2026, 8, 27, 12, 0, version)).toISOString();
            const binary = Uint8Array.from(atob(body.fileBase64), char => char.charCodeAt(0));
            assets.set(key, { blob: new Blob([binary], { type: body.mimeType }), updatedAt });
            return reply({ ok: true, upserted: true, asset: { ownerId: body.ownerId, variant: body.variant, updatedAt }, cleanupPending: false });
        }
        if (body.action === 'lookup') {
            const asset = assets.get(key);
            if (!asset) return reply({ ok: false, error: 'IMAGE_NOT_FOUND' }, 404);
            return reply({ ok: true, asset: { updatedAt: asset.updatedAt }, signedUrl: `https://signed.invalid/${encodeURIComponent(key)}`, expiresIn: 600 });
        }
        const existed = assets.delete(key);
        return reply({ ok: true, deleted: existed, asset: null, cleanupPending: false });
    };
    return { assets, state, fetchImpl };
}

function memoryPhotoStore() {
    const records = new Map();
    return {
        records,
        getEmployeePhoto: async id => records.get(id) || null,
        replaceEmployeePhoto: async (id, value) => { records.set(id, value); return value; },
        deleteEmployeePhoto: async id => records.delete(id),
        listEmployeePhotos: async () => [...records.values()]
    };
}

function device(backend, employeeDocs, clock) {
    const localStore = memoryPhotoStore();
    const imageClient = new AppImageClient({
        endpoint: 'https://n8n.invalid/webhook/app-images',
        getIdToken: async () => 'firebase-id-token',
        fetchImpl: backend.fetchImpl
    });
    const service = new EmployeePhotoService({
        localStore,
        imageClient,
        now: () => clock.now,
        publishSignal: async (employeeId, signal) => {
            employeeDocs.set(employeeId, { ...(employeeDocs.get(employeeId) || { id: employeeId }), photo: signal });
            return true;
        }
    });
    return { localStore, service };
}

const photo = (marker, version) => ({
    employeeId: 'emp-7',
    thumbnailBlob: new Blob([`thumb-${marker}`], { type: 'image/webp' }),
    optimizedBlob: new Blob([`orig-${marker}`], { type: 'image/webp' }),
    width: 256, height: 256, version, updatedAt: version,
    remoteSyncedVersion: null, remoteRevision: null, remoteSignalUpdatedAt: null, pendingDelete: false
});

describe('foto de empleado con el proxy de imágenes caído', () => {
    test('el 404 de n8n se distingue de «imagen no encontrada» del backend', async () => {
        const backend = fakeImageBackend();
        const client = new AppImageClient({ endpoint: 'https://n8n.invalid/webhook/app-images', getIdToken: async () => 't', fetchImpl: backend.fetchImpl });
        const coordinates = { category: 'employee-profile', ownerType: 'employee', ownerId: 'emp-7', assetId: 'profile', variant: 'thumbnail' };

        await expect(client.lookup(coordinates)).rejects.toMatchObject({ code: 'IMAGE_NOT_FOUND', status: 404, retryable: false });
        backend.state.proxyActive = false;
        await expect(client.lookup(coordinates)).rejects.toMatchObject({ code: 'IMAGE_ENDPOINT_NOT_FOUND', status: 404, retryable: true });
        const offline = new AppImageClient({ endpoint: 'https://n8n.invalid/x', getIdToken: async () => 't', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
        await expect(offline.lookup(coordinates)).rejects.toMatchObject({ code: 'IMAGE_SERVICE_UNREACHABLE', retryable: true });
        // El cliente nunca envía bucket ni ruta: solo coordenadas lógicas con el id del empleado.
        expect(Object.keys(backend.state.posts[0]).sort()).toEqual(['action', 'assetId', 'category', 'idToken', 'ownerId', 'ownerType', 'variant']);
    });

    test('creación con proxy caído → espera sin martillar → sube al volver → otro dispositivo la recibe → borrado', async () => {
        const backend = fakeImageBackend();
        const employeeDocs = new Map([['emp-7', { id: 'emp-7', name: 'Persona sintética' }]]);
        const clock = { now: 1_000_000 };
        const a = device(backend, employeeDocs, clock);
        const b = device(backend, employeeDocs, clock);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        backend.state.proxyActive = false;
        await a.service.replaceEmployeePhoto('emp-7', photo('v1', 1000));
        await a.service.waitForPendingSync('emp-7');
        expect(backend.assets.size).toBe(0);
        expect(employeeDocs.get('emp-7').photo).toBeUndefined();           // sin señal falsa en Firestore
        expect(a.service.getUploadRetryState('emp-7')).toMatchObject({ attempts: 1, code: 'IMAGE_ENDPOINT_NOT_FOUND' });
        expect((await a.localStore.getEmployeePhoto('emp-7')).thumbnailBlob).toBeInstanceOf(Blob);

        const postsAfterFailure = backend.state.posts.length;
        for (let i = 0; i < 5; i++) await a.service.getEmployeePhoto('emp-7');   // renders del avatar
        await a.service.waitForPendingSync('emp-7');
        expect(backend.state.posts.length).toBe(postsAfterFailure);

        backend.state.proxyActive = true;
        clock.now += 16_000;
        await a.service.getEmployeePhoto('emp-7');
        await a.service.waitForPendingSync('emp-7');
        expect([...backend.assets.keys()].sort()).toEqual([
            'employee-profile/employee/emp-7/profile/original',
            'employee-profile/employee/emp-7/profile/thumbnail'
        ]);
        expect(a.service.getUploadRetryState('emp-7')).toBeNull();
        const signal = employeeDocs.get('emp-7').photo;
        expect(signal).toMatchObject({ state: 'ready' });
        expect(employeeDocs.get('emp-7').name).toBe('Persona sintética');
        const synced = await a.localStore.getEmployeePhoto('emp-7');
        expect(synced.remoteSyncedVersion).toBe(synced.version);

        await expect(b.service.reconcileEmployeePhotoSignal('emp-7', signal)).resolves.toMatchObject({ status: 'updated' });
        expect(await blobText((await b.localStore.getEmployeePhoto('emp-7')).thumbnailBlob)).toBe('thumb-v1');

        await expect(a.service.deleteEmployeePhoto('emp-7')).resolves.toEqual({ complete: true, pendingVariants: [] });
        expect(backend.assets.size).toBe(0);
        await expect(b.service.reconcileEmployeePhotoSignal('emp-7', employeeDocs.get('emp-7').photo))
            .resolves.toMatchObject({ status: 'deleted' });
        expect(await b.localStore.getEmployeePhoto('emp-7')).toBeNull();
        warn.mockRestore();
    });

    test('un reemplazo explícito del usuario reintenta de inmediato aunque haya espera', async () => {
        const backend = fakeImageBackend();
        const clock = { now: 5_000 };
        const a = device(backend, new Map(), clock);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        backend.state.proxyActive = false;
        await a.service.replaceEmployeePhoto('emp-7', photo('v1', 1000));
        await a.service.waitForPendingSync('emp-7');
        backend.state.proxyActive = true;
        await a.service.replaceEmployeePhoto('emp-7', photo('v2', 2000));
        await a.service.waitForPendingSync('emp-7');
        expect(await blobText(backend.assets.get('employee-profile/employee/emp-7/profile/thumbnail').blob)).toBe('thumb-v2');
        warn.mockRestore();
    });
});

describe('indicador de subida pendiente y señal sin empleado en la nube', () => {
    test('la foto local sin subir se informa como pendiente hasta que la señal se publica', async () => {
        const backend = fakeImageBackend();
        const clock = { now: 2_000_000 };
        const employeeDocs = new Map();                      // el empleado aún no se subió
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const localStore = memoryPhotoStore();
        const imageClient = new AppImageClient({
            endpoint: 'https://n8n.invalid/webhook/app-images',
            getIdToken: async () => 'firebase-id-token',
            fetchImpl: backend.fetchImpl
        });
        const service = new EmployeePhotoService({
            localStore, imageClient, now: () => clock.now,
            // Contrato de EmployeeRepository.savePhotoSignal: sin documento no se crea nada.
            publishSignal: async (employeeId, signal) => {
                if (!employeeDocs.has(employeeId)) {
                    throw Object.assign(new Error('sin empleado'), { code: 'EMPLOYEE_PHOTO_SIGNAL_NO_EMPLOYEE', retryable: true });
                }
                employeeDocs.set(employeeId, { ...employeeDocs.get(employeeId), photo: signal });
                return { skipped: false };
            }
        });

        await expect(service.getPendingUploadStatus('emp-7')).resolves.toEqual({ pending: false });
        await service.replaceEmployeePhoto('emp-7', photo('v1', 1000));
        await service.waitForPendingSync('emp-7');
        expect(employeeDocs.has('emp-7')).toBe(false);       // no se fabricó un documento con solo `photo`
        await expect(service.getPendingUploadStatus('emp-7')).resolves.toMatchObject({
            pending: true, code: 'EMPLOYEE_PHOTO_SIGNAL_NO_EMPLOYEE'
        });

        employeeDocs.set('emp-7', { id: 'emp-7', name: 'Persona sintética' });
        clock.now += 16_000;
        await service.getEmployeePhoto('emp-7');
        await service.waitForPendingSync('emp-7');
        expect(employeeDocs.get('emp-7')).toMatchObject({ name: 'Persona sintética', photo: { state: 'ready' } });
        await expect(service.getPendingUploadStatus('emp-7')).resolves.toEqual({ pending: false });
        warn.mockRestore();
    });

    test('la hoja de foto muestra el aviso solo si hay subida pendiente', async () => {
        const { EmployeePhotoAcquisitionController, EmployeePhotoAcquisitionUI } =
            await import('../modules/ui/components/EmployeePhotoAcquisition.js');
        const statuses = { 'emp-1': { pending: true }, 'emp-2': { pending: false } };
        const controller = new EmployeePhotoAcquisitionController({
            photoStore: { getPendingUploadStatus: async id => statuses[id] }
        });
        for (const [id, expected] of [['emp-1', true], ['emp-2', false]]) {
            document.body.innerHTML = EmployeePhotoAcquisitionUI({ id, name: 'Persona' }, { avatarHtml: '<span></span>' });
            const sheet = document.querySelector('[data-employee-photo-sheet]');
            controller.handleAction('open', sheet.querySelector('[data-employee-photo-action="camera"]'));
            await expect(controller.showPendingUpload(sheet)).resolves.toBe(expected);
            const line = sheet.querySelector('[data-employee-photo-sync]');
            expect(line.hidden).toBe(!expected);
            expect(line.getAttribute('role')).toBe('status');
            expect(line.textContent).toMatch(/aún no se subió a la nube/);
        }
        document.body.innerHTML = '';
    });
});
