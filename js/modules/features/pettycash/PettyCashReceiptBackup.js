const TX_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function requireCommon({ url, idToken, txId }) {
    if (!url) throw new Error('No hay una URL de respaldo configurada.');
    if (!idToken) throw new Error('No hay una sesión válida para respaldar el comprobante.');
    if (!TX_ID_PATTERN.test(String(txId || ''))) {
        throw new Error('El identificador del comprobante no es válido.');
    }
}

function fileBase64FromDataUrl(fileDataUrl) {
    const value = String(fileDataUrl || '');
    const separator = value.indexOf(',');
    return separator >= 0 ? value.slice(separator + 1) : value;
}

async function postReceiptAction({
    url,
    idToken,
    txId,
    action,
    body = {},
    fetchImpl = globalThis.fetch
}) {
    requireCommon({ url, idToken, txId });
    if (typeof fetchImpl !== 'function') throw new Error('La conexión no está disponible.');
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, idToken, txId, ...body })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
        const code = result?.error || `HTTP_${response.status || 0}`;
        const verb = action === 'lookup' ? 'recuperar' : action === 'delete' ? 'borrar' : 'respaldar';
        const error = new Error(`No se pudo ${verb} el comprobante (${code}).`);
        error.code = code;
        error.status = Number(response.status) || 0;
        throw error;
    }
    return result;
}

export function isReceiptReadyForBackup(receipt, now = Date.now()) {
    return !!(
        receipt?.originalBlob
        && Number(receipt?.userConfirmedAt) > 0
        && receipt?.uploadStatus !== 'uploaded'
        && (!Number(receipt?.nextUploadRetryAt) || Number(receipt.nextUploadRetryAt) <= now)
    );
}

// Versión local del comprobante: cambia cuando el usuario confirma otra foto.
// El servidor la usa como ruta física propia, así un reintento de la misma
// versión es idempotente y reemplazar la foto no sobrescribe la anterior.
export function receiptUploadToken(receipt) {
    const confirmedAt = Math.trunc(Number(receipt?.userConfirmedAt) || 0);
    const size = Math.trunc(Number(receipt?.originalSize || receipt?.originalBlob?.size) || 0);
    return confirmedAt > 0 ? `v${confirmedAt}-${size}` : null;
}

export async function uploadReceiptBackup({
    url,
    idToken,
    txId,
    uploadToken = null,
    fileDataUrl,
    imageDataUrl,
    mimeType = 'image/jpeg',
    originalName = null,
    pageCount = null,
    projectId = null,
    periodId = null,
    userConfirmedAt,
    ocr = {},
    movement = {},
    fetchImpl = globalThis.fetch
}) {
    const fileBase64 = fileBase64FromDataUrl(fileDataUrl || imageDataUrl);
    if (!fileBase64) throw new Error('El comprobante no contiene un archivo válido.');
    return postReceiptAction({
        url,
        idToken,
        txId,
        action: 'upload',
        fetchImpl,
        body: {
            fileBase64,
            imageBase64: String(mimeType).startsWith('image/') ? fileBase64 : undefined,
            mimeType,
            originalName,
            pageCount,
            projectId,
            periodId,
            userConfirmedAt,
            uploadToken: uploadToken || undefined,
            ocr,
            movement
        }
    });
}

/**
 * Borrado LÓGICO y condicionado a la versión que este dispositivo subió
 * (ifUploadedAt = receipt.uploaded_at devuelto por el servidor). Resultado:
 *   { done: true, outcome: 'deleted' | 'already-deleted' | 'absent' | 'newer-version' }
 * o lanza un error con `retryable` (red, proxy o función sin desplegar).
 */
export async function deleteReceiptBackup({
    url,
    idToken,
    txId,
    ifUploadedAt,
    fetchImpl = globalThis.fetch
}) {
    if (!ifUploadedAt) throw new Error('Falta la versión del comprobante a borrar.');
    try {
        const result = await postReceiptAction({
            url, idToken, txId, action: 'delete', fetchImpl, body: { ifUploadedAt }
        });
        if (result.absent) return { done: true, outcome: 'absent' };
        return { done: true, outcome: result.alreadyDeleted ? 'already-deleted' : 'deleted' };
    } catch (error) {
        // Otra versión más nueva ocupa el txId: se conserva, no hay nada que borrar.
        if (error.code === 'RECEIPT_VERSION_MISMATCH') return { done: true, outcome: 'newer-version' };
        // Sesión inválida o petición mal formada: no se arregla reintentando.
        error.retryable = !['INVALID_TRANSACTION_ID', 'MISSING_RECEIPT_VERSION', 'MISSING_ID_TOKEN'].includes(error.code);
        throw error;
    }
}

export async function lookupReceiptBackup({
    url,
    idToken,
    txId,
    fetchImpl = globalThis.fetch
}) {
    return postReceiptAction({
        url,
        idToken,
        txId,
        action: 'lookup',
        fetchImpl
    });
}

export function isReceiptBackupVerified(result, txId) {
    if (!result?.signedUrl) return false;
    const remoteTxId = result?.receipt?.transaction_id;
    return !remoteTxId || String(remoteTxId) === String(txId || '');
}
