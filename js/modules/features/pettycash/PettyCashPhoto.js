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

export default { receiptStoragePath, compressImage };
