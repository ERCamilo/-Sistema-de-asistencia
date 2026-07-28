/**
 * PettyCashPhoto.js — compresión de comprobantes + ruta de Storage.
 *
 * Las fotos se guardan LOCALMENTE en IndexedDB (data URL) vía
 * IndexedDBService, en cola para subir a Supabase vía n8n más adelante.
 * Aquí solo vive la compresión (browser) y el helper puro de ruta (que se
 * usará cuando la subida a Supabase exista).
 */

/** Ruta destino en Supabase Storage (para la subida futura vía n8n). null si faltan args. */
export function receiptStoragePath(uid, txId) {
    if (!uid || !txId) return null;
    return `users/${uid}/receipts/${txId}.jpg`;
}

/**
 * Comprime un File de imagen a un data URL JPEG (~maxWidth px).
 * @returns {Promise<string>} data URL ('data:image/jpeg;base64,...')
 */
export async function compressImage(file, maxWidth = 1600, quality = 0.82) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();
    return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Conserva una copia binaria independiente del archivo elegido por el usuario.
 * `Blob.slice()` mantiene los bytes y el MIME type, pero evita depender de que
 * el objeto File original siga vivo después de cerrar el selector/cámara.
 */
export function cloneOriginalReceipt(file) {
    if (!file || typeof file.slice !== 'function' || !Number.isFinite(Number(file.size))) return null;
    return file.slice(0, file.size, file.type || 'application/octet-stream');
}

/** Convierte un Blob local a data URL únicamente cuando la UI/OCR lo necesita. */
export function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve(null);
    if (typeof FileReader === 'undefined') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer el comprobante local.'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Solicita almacenamiento persistente para reducir el riesgo de que el
 * navegador expulse comprobantes locales bajo presión de espacio. El usuario
 * todavía puede borrarlos manualmente desde los datos del sitio.
 */
export async function requestPersistentReceiptStorage() {
    try {
        const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
        if (!storage) return false;
        if (typeof storage.persisted === 'function' && await storage.persisted()) return true;
        return typeof storage.persist === 'function' ? !!(await storage.persist()) : false;
    } catch (_) {
        return false;
    }
}

/**
 * 🧮 Escala para una miniatura: el lado MAYOR no debe exceder maxDim.
 * Función pura (sin canvas) → testeable. Nunca agranda (escala ≤ 1) y tolera
 * dimensiones inválidas devolviendo 1.
 * @returns {number} factor de escala en (0, 1]
 */
export function receiptThumbnailScale(width, height, maxDim = 480) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const longest = Math.max(w, h);
    if (!longest || !isFinite(longest) || !maxDim) return 1;
    return Math.min(1, maxDim / longest);
}

/**
 * 🔻 Reduce un data URL a una MINIATURA JPEG (M4): tras subir el comprobante a
 * la nube, la copia local full-res es pura acumulación en IndexedDB. Guardamos
 * sólo una miniatura para que "Ver comprobante" siga funcionando sin gastar
 * cientos de KB por foto. Si algo falla (sin canvas, data URL inválido),
 * devuelve el original — mejor no podar que perder la única copia.
 * @returns {Promise<string>} data URL reducido (o el original ante fallo)
 */
export async function downscaleDataUrl(dataUrl, maxDim = 480, quality = 0.5) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
    try {
        if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = dataUrl;
        });
        const scale = receiptThumbnailScale(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
        if (scale >= 1) return dataUrl; // ya es pequeña: nada que ganar
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((img.naturalWidth || img.width) * scale);
        canvas.height = Math.round((img.naturalHeight || img.height) * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
    } catch (_) {
        return dataUrl;
    }
}

export default {
    receiptStoragePath,
    compressImage,
    cloneOriginalReceipt,
    blobToDataUrl,
    requestPersistentReceiptStorage,
    receiptThumbnailScale,
    downscaleDataUrl
};
