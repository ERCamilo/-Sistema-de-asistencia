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
        const reason = result?.error || `HTTP ${response.status || 0}`;
        throw new Error(`No se pudo ${action === 'lookup' ? 'recuperar' : 'respaldar'} el comprobante (${reason}).`);
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

export async function uploadReceiptBackup({
    url,
    idToken,
    txId,
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
            ocr,
            movement
        }
    });
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
