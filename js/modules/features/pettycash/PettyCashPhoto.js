import { ensurePdfJsLoaded } from '../../utils/LazyPdfJS.js';

/**
 * PettyCashPhoto.js — compresión de comprobantes + ruta de Storage.
 *
 * Las fotos se guardan LOCALMENTE en IndexedDB (data URL) vía
 * IndexedDBService, en cola para subir a Supabase vía n8n más adelante.
 * Aquí solo vive la compresión (browser) y el helper puro de ruta (que se
 * usará cuando la subida a Supabase exista).
 */

export const RECEIPT_PDF_MIME_TYPE = 'application/pdf';
export const RECEIPT_MAX_PDF_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MAX_PDF_PAGES = 10;

export function receiptMimeType(file) {
    const declared = String(file?.type || '').trim().toLowerCase();
    if (declared) return declared;
    return /\.pdf$/i.test(String(file?.name || '')) ? RECEIPT_PDF_MIME_TYPE : '';
}

export function isPdfReceipt(file) {
    return receiptMimeType(file) === RECEIPT_PDF_MIME_TYPE;
}

export function validateReceiptFile(file) {
    if (!file || typeof file.slice !== 'function' || !Number.isFinite(Number(file.size))) {
        throw new Error('Selecciona una imagen o un PDF válido.');
    }
    const mimeType = receiptMimeType(file);
    if (!mimeType.startsWith('image/') && mimeType !== RECEIPT_PDF_MIME_TYPE) {
        throw new Error('Formato no compatible. Usa una imagen o un PDF.');
    }
    if (mimeType === RECEIPT_PDF_MIME_TYPE && Number(file.size) > RECEIPT_MAX_PDF_BYTES) {
        throw new Error('El PDF supera el límite de 10 MB.');
    }
    return { mimeType, kind: mimeType === RECEIPT_PDF_MIME_TYPE ? 'pdf' : 'image' };
}

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

function pdfFallbackThumbnail(fileName = 'Factura PDF') {
    const safeName = String(fileName || 'Factura PDF')
        .replace(/[<>&"']/g, '')
        .slice(0, 34);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
        <rect width="480" height="320" rx="24" fill="#0f172a"/>
        <rect x="124" y="36" width="232" height="248" rx="16" fill="#172033" stroke="#475569" stroke-width="3"/>
        <path d="M294 36v66h62" fill="#26364d" stroke="#64748b" stroke-width="3"/>
        <rect x="160" y="126" width="160" height="64" rx="12" fill="#dc2626"/>
        <text x="240" y="168" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="34" font-weight="700">PDF</text>
        <text x="240" y="230" text-anchor="middle" fill="#cbd5e1" font-family="Arial,sans-serif" font-size="17">${safeName}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function createPdfThumbnail(file, maxDim = 480) {
    let documentTask = null;
    let pdfDocument = null;
    try {
        const pdfjs = await ensurePdfJsLoaded();
        const bytes = new Uint8Array(await file.arrayBuffer());
        documentTask = pdfjs.getDocument({ data: bytes });
        pdfDocument = await documentTask.promise;
        const pageCount = Number(pdfDocument.numPages) || 0;
        if (!pageCount) throw new Error('El PDF no contiene páginas.');
        if (pageCount > RECEIPT_MAX_PDF_PAGES) {
            throw new Error(`El PDF supera el límite de ${RECEIPT_MAX_PDF_PAGES} páginas.`);
        }
        const page = await pdfDocument.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, maxDim / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: context, viewport }).promise;
        return {
            previewDataUrl: canvas.toDataURL('image/jpeg', 0.72),
            pageCount
        };
    } catch (error) {
        if (/supera el límite|no contiene páginas/i.test(String(error?.message || ''))) throw error;
        return {
            previewDataUrl: pdfFallbackThumbnail(file?.name),
            pageCount: null
        };
    } finally {
        try { await pdfDocument?.destroy?.(); } catch (_) { /* noop */ }
        try { documentTask?.destroy?.(); } catch (_) { /* noop */ }
    }
}

export async function prepareReceiptForOcr(file) {
    const { mimeType, kind } = validateReceiptFile(file);
    if (kind === 'pdf') {
        return {
            fileDataUrl: await blobToDataUrl(file),
            mimeType,
            fileName: file?.name || 'factura.pdf'
        };
    }
    return {
        fileDataUrl: await compressImage(file),
        mimeType: 'image/jpeg',
        fileName: file?.name || 'factura.jpg'
    };
}

export async function createReceiptPreview(file) {
    const { kind } = validateReceiptFile(file);
    if (kind === 'pdf') return createPdfThumbnail(file);
    const processingDataUrl = await compressImage(file);
    return {
        previewDataUrl: await downscaleDataUrl(processingDataUrl, 480, 0.5),
        pageCount: 1,
        processingDataUrl
    };
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
    receiptMimeType,
    isPdfReceipt,
    validateReceiptFile,
    compressImage,
    createPdfThumbnail,
    createReceiptPreview,
    prepareReceiptForOcr,
    cloneOriginalReceipt,
    blobToDataUrl,
    requestPersistentReceiptStorage,
    receiptThumbnailScale,
    downscaleDataUrl
};
