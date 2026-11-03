/**
 * La foto original de una factura, para volver a leerla.
 *
 * Una vez verificado el respaldo en la nube, el teléfono borra el original y
 * conserva solo una miniatura (480 px, calidad 0.5) para la lista. Esa
 * miniatura sirve para mirar, nunca para leer: con ella el lector se equivoca
 * en montos y totales. Aquí se busca el original en este orden:
 *   1. el original guardado en el teléfono;
 *   2. una imagen completa de un registro antiguo (`dataUrl`);
 *   3. el respaldo en la nube (enlace firmado → descarga).
 * Si ninguno existe devuelve `{ ok: false, reason: 'no-original' }`; nunca la miniatura.
 *
 * Probado en js/tests/PettyCashReceiptSource.test.js.
 */

const dataUrlType = (dataUrl) => /^data:([^;,]+)[;,]/.exec(String(dataUrl || ''))?.[1] || null;

/**
 * @param {object} options
 * @param {string} options.txId
 * @param {(txId:string)=>Promise<object|null>} options.getReceipt  registro local del comprobante
 * @param {(txId:string)=>Promise<{signedUrl?:string, receipt?:{mime_type?:string}}>} [options.lookup]  respaldo en la nube
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ok:true, origin:'local'|'legacy'|'remote', type:string, name?:string|null, blob?:Blob, dataUrl?:string}|{ok:false, reason:'no-original'}>}
 */
export async function resolveReceiptOriginal({ txId, getReceipt, lookup = null, fetchImpl = globalThis.fetch } = {}) {
    let record = null;
    try { record = await Promise.resolve(getReceipt?.(txId)); } catch { record = null; }

    if (record?.originalBlob) {
        return {
            ok: true,
            origin: 'local',
            blob: record.originalBlob,
            type: record.originalType || record.originalBlob.type || 'image/jpeg',
            name: record.originalName || null
        };
    }
    // Registros antiguos guardaban la imagen completa, no solo la miniatura.
    if (record?.dataUrl) {
        return { ok: true, origin: 'legacy', dataUrl: record.dataUrl, type: dataUrlType(record.dataUrl) || 'image/jpeg', name: record.originalName || null };
    }

    if (typeof lookup === 'function' && typeof fetchImpl === 'function') {
        try {
            const remote = await lookup(txId);
            if (remote?.signedUrl) {
                const response = await fetchImpl(remote.signedUrl);
                if (response?.ok) {
                    const blob = await response.blob();
                    if (blob?.size > 0) {
                        return {
                            ok: true,
                            origin: 'remote',
                            blob,
                            type: blob.type || remote.receipt?.mime_type || 'image/jpeg',
                            name: record?.originalName || null
                        };
                    }
                }
            }
        } catch { /* sin red o sin respaldo: no hay original */ }
    }
    return { ok: false, reason: 'no-original' };
}
