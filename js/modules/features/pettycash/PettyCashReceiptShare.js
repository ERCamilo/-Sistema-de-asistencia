/**
 * Descargar o compartir la foto de la factura que se está viendo.
 * Compartir con archivo solo existe donde el navegador lo permite (menú del
 * sistema: WhatsApp, correo, etc.); si no, se descarga y se avisa, sin fingir
 * que se envió. Probado en js/tests/PettyCashReceiptShare.test.js.
 */
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** factura-<NCF>.jpg; sin NCF, el número de registro o el id. */
export function receiptFileName(movement = {}, mime) {
    const ncf = String(movement.ncf || '').replace(/[^A-Za-z0-9]/g, '');
    const record = Number.isFinite(Number(movement.recordNumber)) && Number(movement.recordNumber) > 0
        ? String(Number(movement.recordNumber)).padStart(3, '0') : '';
    const tag = ncf || record || String(movement.id || '').replace(/[^A-Za-z0-9-]/g, '');
    return `factura${tag ? `-${tag}` : ''}.${EXTENSIONS[mime] || 'jpg'}`;
}

async function readBlob(url, fetchImpl) {
    const response = await fetchImpl(url);
    if (!response?.ok) throw new Error('No se pudo leer la foto.');
    return response.blob();
}

function saveBlob(blob, name, { doc, urlApi }) {
    const href = urlApi.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = href;
    link.download = name;
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    setTimeout(() => urlApi.revokeObjectURL(href), 1000);
}

const browser = () => ({
    doc: typeof document !== 'undefined' ? document : null,
    urlApi: typeof URL !== 'undefined' ? URL : null,
    fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : null
});

export async function downloadReceipt({ url, mime, name, doc, urlApi, fetchImpl } = {}) {
    const env = { ...browser(), ...(doc && { doc }), ...(urlApi && { urlApi }), ...(fetchImpl && { fetchImpl }) };
    try {
        const blob = await readBlob(url, env.fetchImpl);
        saveBlob(blob.type ? blob : new Blob([blob], { type: mime }), name, env);
        return { status: 'downloaded', name };
    } catch (error) {
        return { status: 'error', message: error?.message || 'No se pudo descargar la foto.' };
    }
}

export async function shareReceipt({ url, mime, name, nav = typeof navigator !== 'undefined' ? navigator : {}, doc, urlApi, fetchImpl, FileCtor = typeof File !== 'undefined' ? File : null } = {}) {
    const env = { ...browser(), ...(doc && { doc }), ...(urlApi && { urlApi }), ...(fetchImpl && { fetchImpl }) };
    try {
        const blob = await readBlob(url, env.fetchImpl);
        const type = blob.type || mime || 'image/jpeg';
        const file = FileCtor ? new FileCtor([blob], name, { type }) : null;
        if (file && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
            try {
                await nav.share({ files: [file], title: name });
                return { status: 'shared' };
            } catch (error) {
                if (error?.name === 'AbortError') return { status: 'cancelled' };
                throw error;
            }
        }
        saveBlob(blob.type ? blob : new Blob([blob], { type }), name, env);
        return { status: 'downloaded', name };
    } catch (error) {
        return { status: 'error', message: error?.message || 'No se pudo compartir la foto.' };
    }
}
