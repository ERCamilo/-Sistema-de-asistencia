// Lógica de retención de comprobantes de Caja Chica, sin dependencias de Deno
// ni de Supabase para poder probarla con un adaptador en memoria.
//
// Retención: un comprobante es evidencia financiera y no hay decisión de
// purga. Por eso:
//   - borrar es LÓGICO (status 'deleted' + deleted_at), reversible con
//     'restore' y condicionado a la versión (uploaded_at) que el cliente vio;
//   - cada subida con uploadToken usa su propia ruta física, así reemplazar la
//     foto no sobrescribe la anterior (queda archivada en
//     petty_cash_receipt_versions);
//   - nunca se borra un objeto de Storage desde aquí.

export const RECEIPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export class ReceiptActionError extends Error {
    constructor(code, status) {
        super(code);
        this.code = code;
        this.status = status;
    }
}

// Sin uploadToken (clientes anteriores) se conserva la ruta estable uid/txId.
export function receiptStoragePath(uid, txId, uploadToken) {
    const token = uploadToken == null ? '' : String(uploadToken);
    if (!token) return `${uid}/${txId}`;
    if (!RECEIPT_TOKEN_PATTERN.test(token)) throw new ReceiptActionError('INVALID_UPLOAD_TOKEN', 400);
    return `${uid}/${txId}/${token}`;
}

export function isReceiptDeleted(row) {
    return !!(row && (row.deleted_at || row.status === 'deleted'));
}

function requireVersion(ifUploadedAt) {
    const version = ifUploadedAt == null ? '' : String(ifUploadedAt);
    if (!version) throw new ReceiptActionError('MISSING_RECEIPT_VERSION', 400);
    return version;
}

// Instantes iguales aunque PostgREST los serialice con otra precisión/zona.
export function sameReceiptVersion(left, right) {
    if (left == null || right == null) return false;
    const a = Date.parse(String(left));
    const b = Date.parse(String(right));
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right);
}

/**
 * store: { getReceipt(uid, txId), markDeleted(uid, txId, version, deletedAt),
 *          markRestored(uid, txId, version, restoredAt) }
 * markDeleted/markRestored son CAS: solo actualizan si uploaded_at coincide y
 * el estado es el esperado; devuelven la fila actualizada o null.
 */
export async function deleteReceiptLogically({ store, uid, txId, ifUploadedAt, now = new Date() }) {
    const version = requireVersion(ifUploadedAt);
    const current = await store.getReceipt(uid, txId);
    if (!current) return { status: 200, body: { ok: true, deleted: false, absent: true } };
    if (!sameReceiptVersion(current.uploaded_at, version)) {
        // Hay una versión más nueva (movimiento recreado o foto reemplazada):
        // no se toca.
        return { status: 409, body: { ok: false, error: 'RECEIPT_VERSION_MISMATCH', currentVersion: current.uploaded_at } };
    }
    if (isReceiptDeleted(current)) {
        return { status: 200, body: { ok: true, deleted: true, alreadyDeleted: true, deletedAt: current.deleted_at || null } };
    }
    const updated = await store.markDeleted(uid, txId, current.uploaded_at, now.toISOString());
    if (!updated) {
        // Cambió entre la lectura y el CAS: el cliente vuelve a intentarlo.
        return { status: 409, body: { ok: false, error: 'RECEIPT_VERSION_CONFLICT', retryable: true } };
    }
    return { status: 200, body: { ok: true, deleted: true, deletedAt: updated.deleted_at } };
}

export async function restoreReceipt({ store, uid, txId, ifUploadedAt, now = new Date() }) {
    const version = requireVersion(ifUploadedAt);
    const current = await store.getReceipt(uid, txId);
    if (!current) return { status: 404, body: { ok: false, error: 'RECEIPT_NOT_FOUND' } };
    if (!sameReceiptVersion(current.uploaded_at, version)) {
        return { status: 409, body: { ok: false, error: 'RECEIPT_VERSION_MISMATCH', currentVersion: current.uploaded_at } };
    }
    if (!isReceiptDeleted(current)) return { status: 200, body: { ok: true, restored: false, active: true } };
    const updated = await store.markRestored(uid, txId, current.uploaded_at, now.toISOString());
    if (!updated) return { status: 409, body: { ok: false, error: 'RECEIPT_VERSION_CONFLICT', retryable: true } };
    return { status: 200, body: { ok: true, restored: true } };
}

// Fila que escribe una subida. Una subida nueva siempre reactiva el
// comprobante (recrear el movimiento con el mismo txId lo "resucita").
export function buildUploadRow({ uid, txId, bucket, storagePath, file, body, uploadToken, now = new Date() }) {
    const confirmedMillis = Number(body.userConfirmedAt);
    const iso = now.toISOString();
    const pageCount = body.pageCount == null ? null : Number(body.pageCount);
    return {
        firebase_uid: uid,
        transaction_id: txId,
        project_id: body.projectId ? String(body.projectId) : null,
        period_id: body.periodId ? String(body.periodId) : null,
        storage_bucket: bucket,
        storage_path: storagePath,
        mime_type: file.mimeType,
        file_size_bytes: file.byteLength,
        page_count: pageCount,
        original_name: body.originalName ? String(body.originalName).slice(0, 255) : null,
        ocr_data: body.ocr && typeof body.ocr === 'object' && !Array.isArray(body.ocr) ? body.ocr : {},
        movement_data: body.movement && typeof body.movement === 'object' && !Array.isArray(body.movement) ? body.movement : {},
        status: 'confirmed',
        upload_token: uploadToken ? String(uploadToken) : null,
        deleted_at: null,
        confirmed_at: Number.isFinite(confirmedMillis) && confirmedMillis > 0 ? new Date(confirmedMillis).toISOString() : iso,
        uploaded_at: iso,
        updated_at: iso
    };
}

// Registro de la versión anterior cuando la nueva subida cambia de objeto.
export function supersededVersion(previous, nextStoragePath, now = new Date()) {
    if (!previous?.storage_path || previous.storage_path === nextStoragePath) return null;
    return {
        firebase_uid: previous.firebase_uid,
        transaction_id: previous.transaction_id,
        storage_bucket: previous.storage_bucket,
        storage_path: previous.storage_path,
        mime_type: previous.mime_type,
        file_size_bytes: previous.file_size_bytes,
        uploaded_at: previous.uploaded_at,
        deleted_at: previous.deleted_at || null,
        superseded_at: now.toISOString()
    };
}
