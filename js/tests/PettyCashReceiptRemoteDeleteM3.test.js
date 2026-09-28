/**
 * M3 — borrado remoto de comprobantes: lógico, versionado, reversible,
 * idempotente y con cola de reintento.
 *
 * - Cola real sobre IndexedDB (IndexedDBService real + fake-indexeddb).
 * - Cliente real (PettyCashReceiptBackup + PettyCashReceiptRemoteDelete).
 * - Backend en memoria que ejecuta la MISMA lógica que la Edge Function
 *   (supabase/functions/petty-cash-receipt/receipt-actions.js) y un Storage
 *   que registra objetos por ruta. No hay Deno, Postgres ni Supabase real: el
 *   SQL y el adaptador de index.ts no se ejecutan aquí.
 */
import 'fake-indexeddb/auto';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import {
    uploadReceiptBackup,
    lookupReceiptBackup,
    receiptUploadToken
} from '../modules/features/pettycash/PettyCashReceiptBackup.js';
import {
    RECEIPT_DELETE_STORE,
    cancelReceiptRemoteDelete,
    drainReceiptRemoteDeletes,
    enqueueReceiptRemoteDelete,
    listReceiptRemoteDeletes,
    receiptDeleteTransport
} from '../modules/features/pettycash/PettyCashReceiptRemoteDelete.js';
import {
    buildUploadRow,
    deleteReceiptLogically,
    isReceiptDeleted,
    receiptStoragePath,
    restoreReceipt,
    supersededVersion
} from '../../supabase/functions/petty-cash-receipt/receipt-actions.js';

const URL = 'https://n8n.example.test/webhook/caja-chica-subir';
const UID = 'firebase-uid-1';
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]).toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

// Backend con el contrato de la función (vía n8n). `mode` simula despliegues:
// 'current' (esta versión), 'legacy' (sin delete) o 'proxy-404' (flujo n8n inactivo).
function createBackend() {
    const rows = new Map();
    const objects = new Map();
    const versions = [];
    const backend = { rows, objects, versions, mode: 'current', offline: false, calls: [], clock: 1_000_000 };
    const tick = () => new Date(backend.clock += 1000);
    const store = {
        async getReceipt(uid, txId) { return rows.get(`${uid}/${txId}`) || null; },
        async markDeleted(uid, txId, version, deletedAt) {
            const row = rows.get(`${uid}/${txId}`);
            if (!row || row.uploaded_at !== version || row.deleted_at) return null;
            Object.assign(row, { status: 'deleted', deleted_at: deletedAt });
            return row;
        },
        async markRestored(uid, txId, version) {
            const row = rows.get(`${uid}/${txId}`);
            if (!row || row.uploaded_at !== version || !row.deleted_at) return null;
            Object.assign(row, { status: 'confirmed', deleted_at: null });
            return row;
        }
    };
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    backend.fetch = async (url, init) => {
        if (backend.offline) throw new TypeError('Failed to fetch');
        const body = JSON.parse(init.body);
        backend.calls.push(body.action);
        if (backend.mode === 'proxy-404') return reply(404, { code: 404, message: 'The requested webhook "POST caja-chica-subir" is not registered.' });
        if (body.idToken !== 'token') return reply(401, { ok: false, error: 'INVALID_FIREBASE_TOKEN' });
        const key = `${UID}/${body.txId}`;
        if (body.action === 'lookup') {
            const row = rows.get(key);
            if (!row) return reply(404, { ok: false, error: 'RECEIPT_NOT_FOUND' });
            if (isReceiptDeleted(row)) return reply(404, { ok: false, error: 'RECEIPT_DELETED' });
            return reply(200, { ok: true, receipt: { ...row }, signedUrl: `signed://${row.storage_path}` });
        }
        if (body.action === 'delete' || body.action === 'restore') {
            if (backend.mode === 'legacy') return reply(400, { ok: false, error: 'INVALID_ACTION' });
            const run = body.action === 'delete' ? deleteReceiptLogically : restoreReceipt;
            const result = await run({ store, uid: UID, txId: body.txId, ifUploadedAt: body.ifUploadedAt, now: tick() });
            return reply(result.status, result.body);
        }
        // upload
        const legacyServer = backend.mode === 'legacy';
        const storagePath = receiptStoragePath(UID, body.txId, legacyServer ? null : body.uploadToken);
        const previous = rows.get(key) || null;
        objects.set(storagePath, body.fileBase64);   // upsert del objeto de esa ruta
        const now = tick();
        const archived = supersededVersion(previous, storagePath, now);
        if (archived && !versions.some(v => v.storage_path === archived.storage_path)) versions.push(archived);
        const row = buildUploadRow({
            uid: UID, txId: body.txId, bucket: 'petty-cash-receipts', storagePath,
            file: { mimeType: body.mimeType, byteLength: 5 }, body, uploadToken: legacyServer ? null : body.uploadToken, now
        });
        rows.set(key, row);
        return reply(200, { ok: true, path: `petty-cash-receipts/${storagePath}`, receipt: { ...row } });
    };
    return backend;
}

async function upload(backend, txId, { fileDataUrl = JPEG, confirmedAt = 111, size = 5 } = {}) {
    const local = { txId, userConfirmedAt: confirmedAt, originalSize: size };
    const data = await uploadReceiptBackup({
        url: URL, idToken: 'token', txId, uploadToken: receiptUploadToken(local),
        fileDataUrl, mimeType: fileDataUrl.slice(5, fileDataUrl.indexOf(';')), userConfirmedAt: confirmedAt,
        fetchImpl: backend.fetch
    });
    // Mismo patrón que uploadPendingReceipts: lo que guarda el registro local.
    return { txId, uploadStatus: 'uploaded', remotePath: data.path, remoteVersion: data.receipt.uploaded_at };
}

function drain(db, backend, { now = () => backend.clock } = {}) {
    return drainReceiptRemoteDeletes({
        db, uid: UID, now,
        ...receiptDeleteTransport({ url: URL, idToken: 'token', fetchImpl: backend.fetch, lookupReceipt: lookupReceiptBackup })
    });
}

const lookup = (backend, txId) => lookupReceiptBackup({ url: URL, idToken: 'token', txId, fetchImpl: backend.fetch })
    .then(result => ({ ok: true, result }), error => ({ ok: false, code: error.code }));

describe('M3: borrado remoto de comprobantes', () => {
    let db;
    let backend;

    beforeEach(async () => {
        db = new IndexedDBService('m3-receipts-' + Math.random());
        await db.init();
        backend = createBackend();
    });

    test('borrar el movimiento: borrado lógico, objeto conservado, reversible e idempotente', async () => {
        const receipt = await upload(backend, 'mov-a');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-a', receipt, ownerUid: UID });
        const summary = await drain(db, backend);

        expect(summary).toMatchObject({ done: 1, retry: 0, dead: 0 });
        expect(summary.outcomes).toEqual([['mov-a', 'deleted']]);
        expect(await lookup(backend, 'mov-a')).toEqual({ ok: false, code: 'RECEIPT_DELETED' });
        expect(backend.objects.has(`${UID}/mov-a/v111-5`)).toBe(true);      // nunca se purga
        expect(await listReceiptRemoteDeletes(db)).toEqual([]);

        // Reintento (otra pestaña o petición repetida): idempotente.
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-a', receipt, ownerUid: UID });
        expect((await drain(db, backend)).outcomes).toEqual([['mov-a', 'already-deleted']]);

        // Reversible con la misma versión.
        const restored = await backend.fetch(URL, { body: JSON.stringify({ action: 'restore', idToken: 'token', txId: 'mov-a', ifUploadedAt: receipt.remoteVersion }) });
        expect(await restored.json()).toEqual({ ok: true, restored: true });
        expect((await lookup(backend, 'mov-a')).ok).toBe(true);
    });

    test('sin conexión: la petición queda en la cola con espera y se completa al volver', async () => {
        const receipt = await upload(backend, 'mov-b');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-b', receipt, ownerUid: UID });
        backend.offline = true;
        expect(await drain(db, backend)).toMatchObject({ done: 0, retry: 1 });
        const [waiting] = await listReceiptRemoteDeletes(db);
        expect(waiting).toMatchObject({ status: 'pending', attempts: 1 });
        expect(waiting.nextRetryAt).toBeGreaterThan(backend.clock);

        backend.offline = false;
        expect(await drain(db, backend)).toMatchObject({ done: 0, waiting: 1 });   // respeta la espera
        expect(await drain(db, backend, { now: () => waiting.nextRetryAt })).toMatchObject({ done: 1 });
        expect(await lookup(backend, 'mov-b')).toEqual({ ok: false, code: 'RECEIPT_DELETED' });
    });

    test('movimiento recreado con otra foto antes del drenado: no se borra la versión nueva y la anterior queda archivada', async () => {
        const first = await upload(backend, 'mov-c', { confirmedAt: 111 });
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-c', receipt: first, ownerUid: UID });
        const second = await upload(backend, 'mov-c', { fileDataUrl: PNG, confirmedAt: 222, size: 8 });
        expect(second.remoteVersion).not.toBe(first.remoteVersion);

        expect((await drain(db, backend)).outcomes).toEqual([['mov-c', 'newer-version']]);
        const current = await lookup(backend, 'mov-c');
        expect(current.ok).toBe(true);
        expect(current.result.receipt.storage_path).toBe(`${UID}/mov-c/v222-8`);
        // La foto anterior no se sobrescribió: sigue en Storage y en el archivo de versiones.
        expect(backend.objects.get(`${UID}/mov-c/v111-5`)).toBeTruthy();
        expect(backend.versions.map(v => v.storage_path)).toEqual([`${UID}/mov-c/v111-5`]);
    });

    test('un comprobante nuevo para el mismo txId cancela el borrado pendiente', async () => {
        const receipt = await upload(backend, 'mov-d');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-d', receipt, ownerUid: UID });
        expect(await cancelReceiptRemoteDelete({ db, txId: 'mov-d' })).toBe(true);
        expect(await drain(db, backend)).toMatchObject({ done: 0 });
        expect(backend.calls.filter(action => action === 'delete')).toEqual([]);
        expect((await lookup(backend, 'mov-d')).ok).toBe(true);
    });

    test('reintentar la subida de la misma versión es idempotente (misma ruta, sin versiones extra)', async () => {
        await upload(backend, 'mov-e', { confirmedAt: 333 });
        await upload(backend, 'mov-e', { confirmedAt: 333 });
        expect([...backend.objects.keys()].filter(key => key.includes('mov-e'))).toEqual([`${UID}/mov-e/v333-5`]);
        expect(backend.versions).toEqual([]);
    });

    test('subida en curso al borrar (versión desconocida): se consulta la versión y se borra esa', async () => {
        await upload(backend, 'mov-f');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-f', receipt: { uploadStatus: 'uploading' }, ownerUid: UID });
        expect((await drain(db, backend)).outcomes).toEqual([['mov-f', 'deleted']]);
        // Nunca subido: no hay nada remoto y no se encola.
        expect(await enqueueReceiptRemoteDelete({ db, txId: 'mov-g', receipt: { uploadStatus: 'deferred' } })).toBeNull();
        // Encolado pero la subida nunca llegó: se cierra como ausente.
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-h', receipt: { uploadStatus: 'retry-wait' }, ownerUid: UID });
        expect((await drain(db, backend)).outcomes).toEqual([['mov-h', 'absent']]);
    });

    test('función sin desplegar (INVALID_ACTION) o flujo n8n inactivo (404 del proxy): espera sin perder la petición', async () => {
        const receipt = await upload(backend, 'mov-i');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-i', receipt, ownerUid: UID });

        backend.mode = 'legacy';
        expect(await drain(db, backend)).toMatchObject({ waiting: 1, dead: 0 });
        let [entry] = await listReceiptRemoteDeletes(db);
        expect(entry).toMatchObject({ status: 'pending', attempts: 0 });
        expect(entry.lastError).toMatch(/pendiente de despliegue/);

        backend.mode = 'proxy-404';
        expect(await drain(db, backend, { now: () => entry.nextRetryAt })).toMatchObject({ retry: 1 });
        [entry] = await listReceiptRemoteDeletes(db);
        expect(entry).toMatchObject({ status: 'pending', attempts: 1 });

        backend.mode = 'current';
        expect(await drain(db, backend, { now: () => entry.nextRetryAt })).toMatchObject({ done: 1 });
        expect(await lookup(backend, 'mov-i')).toEqual({ ok: false, code: 'RECEIPT_DELETED' });
    });

    test('movimiento que vuelve a existir (respaldo o recreación): nunca se borra su comprobante', async () => {
        const receipt = await upload(backend, 'mov-l');
        const entry = await enqueueReceiptRemoteDelete({ db, txId: 'mov-l', receipt, ownerUid: UID, now: 5000 });
        // Aún no se retiró del almacén local: se espera, sin gastar intentos.
        await db.update('pettyCashMovements', { id: 'mov-l', periodId: 'per', updatedAt: 4000 });
        expect(await drain(db, backend)).toMatchObject({ done: 0, waiting: 1 });
        expect((await listReceiptRemoteDeletes(db))[0]).toMatchObject({ attempts: 0, ts: entry.ts });
        // Restaurado/recreado después de la petición: la petición caduca.
        await db.update('pettyCashMovements', { id: 'mov-l', periodId: 'per', updatedAt: 6000 });
        expect((await drain(db, backend)).outcomes).toEqual([['mov-l', 'movement-restored']]);
        expect(await listReceiptRemoteDeletes(db)).toEqual([]);
        expect(backend.calls.filter(action => action === 'delete')).toEqual([]);
        expect((await lookup(backend, 'mov-l')).ok).toBe(true);
    });

    test('otra cuenta o dueño desconocido: la petición no se envía con esta sesión', async () => {
        const receipt = await upload(backend, 'mov-j');
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-j', receipt, ownerUid: 'otra-cuenta' });
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-j2', receipt, ownerUid: null });
        expect(await drain(db, backend)).toMatchObject({ done: 0, retry: 0 });
        expect(backend.calls.filter(action => action === 'delete')).toEqual([]);
    });

    test('las entradas de borrado comparten el store del espejo sin mezclarse con sus movimientos', async () => {
        const receipt = await upload(backend, 'mov-k');
        await db.update(RECEIPT_DELETE_STORE, { id: 'mov-k', op: 'delete', data: { id: 'mov-k' }, status: 'pending', ts: 1 });
        await enqueueReceiptRemoteDelete({ db, txId: 'mov-k', receipt, ownerUid: UID });
        const all = await db.getAll(RECEIPT_DELETE_STORE);
        expect(all.map(entry => entry.id).sort()).toEqual(['mov-k', 'receipt-delete:mov-k']);
        await drain(db, backend);
        expect((await db.getAll(RECEIPT_DELETE_STORE)).map(entry => entry.id)).toEqual(['mov-k']);
    });
});
