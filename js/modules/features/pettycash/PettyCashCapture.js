/**
 * Foto de la factura desde la cámara de la app.
 *
 * - Usa la resolución completa del sensor cuando el navegador lo permite
 *   (ImageCapture.takePhoto, Chrome en Android). El video del visor da unos
 *   2 MP; el sensor, 8–12 MP: mejor para letra pequeña y facturas largas.
 * - La foto se recorta a la forma del visor, para que se guarde exactamente
 *   lo que se veía en el recuadro.
 * - Si takePhoto no existe, falla, tarda demasiado o la foto viene en otra
 *   orientación, se usa el cuadro del video (como antes).
 * - Se guarda en WebP: a la misma calidad pesa bastante menos que JPEG. Si el
 *   navegador no sabe codificar WebP, se usa JPEG.
 *
 * Probado en js/tests/PettyCashCapture.test.js.
 */

/** Lado largo máximo de la foto guardada (≈ 6–7 MP en una factura vertical). */
export const MAX_PHOTO_LONG_SIDE = 3000;
export const PHOTO_QUALITY = 0.9;
const TAKE_PHOTO_TIMEOUT_MS = 2500;

/** Recorte centrado de la foto a la forma del visor; null si la orientación no coincide. */
export function photoCrop(photoW, photoH, viewW, viewH) {
    if (!photoW || !photoH || !viewW || !viewH) return null;
    if ((photoW > photoH) !== (viewW > viewH) && photoW !== photoH && viewW !== viewH) return null;
    const view = viewW / viewH;
    if (photoW / photoH > view) {
        const sw = Math.round(photoH * view);
        return { sx: Math.round((photoW - sw) / 2), sy: 0, sw, sh: photoH };
    }
    const sh = Math.round(photoW / view);
    return { sx: 0, sy: Math.round((photoH - sh) / 2), sw: photoW, sh };
}

/** Tamaño reducido para que el lado largo no pase de `max` (nunca agranda). */
export function fitLongSide(w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
}

export const extensionFor = (type) => (type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg');

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(
    blob => (blob ? resolve(blob) : reject(new Error('No se pudo guardar la imagen'))), type, quality));

/** WebP si el navegador lo codifica; si no (devuelve otro formato), JPEG. */
export async function encodeImage(canvas, quality = PHOTO_QUALITY) {
    const webp = await toBlob(canvas, 'image/webp', quality).catch(() => null);
    if (webp?.type === 'image/webp') return webp;
    return toBlob(canvas, 'image/jpeg', Math.min(0.92, quality + 0.02));
}

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/**
 * Paso rápido (al tocar el botón): la foto del sensor si se puede, o una
 * copia del cuadro actual del video. Devuelve `{ source, crop }` sin
 * codificar nada; `renderShot` y `encodeImage` hacen lo lento después.
 */
export async function takeShot({
    video,
    track = null,
    doc = globalThis.document,
    makeCanvas = () => doc.createElement('canvas'),
    toBitmap = (blob) => globalThis.createImageBitmap(blob),
    ImageCaptureImpl = globalThis.ImageCapture,
    timeoutMs = TAKE_PHOTO_TIMEOUT_MS
} = {}) {
    if (ImageCaptureImpl && track) {
        let bitmap = null;
        try {
            const raw = await withTimeout(new ImageCaptureImpl(track).takePhoto(), timeoutMs);
            bitmap = await toBitmap(raw);
            const crop = photoCrop(bitmap.width, bitmap.height, video.videoWidth, video.videoHeight);
            if (crop) return { source: bitmap, crop, origin: 'sensor' };
        } catch (_) { /* se usa el video */ }
        try { bitmap?.close?.(); } catch (_) { /* ya liberada */ }
    }
    // Copia del cuadro de este instante (el video sigue corriendo).
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 1706;
    const frame = makeCanvas();
    frame.width = w;
    frame.height = h;
    frame.getContext('2d').drawImage(video, 0, 0, w, h);
    return { source: frame, crop: { sx: 0, sy: 0, sw: w, sh: h }, origin: 'video' };
}

/** Recorta y reduce la toma (sin codificar): un lienzo listo para guardar o unir. */
export function renderShot(shot, { doc = globalThis.document, makeCanvas = () => doc.createElement('canvas'), maxLongSide = MAX_PHOTO_LONG_SIDE, maxWidth = Infinity } = {}) {
    const { source, crop } = shot;
    let size = fitLongSide(crop.sw, crop.sh, maxLongSide);
    if (size.w > maxWidth) size = { w: Math.round(maxWidth), h: Math.round(size.h * (maxWidth / size.w)) };
    const canvas = makeCanvas();
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext('2d').drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.w, size.h);
    try { source?.close?.(); } catch (_) { /* ya liberada */ }
    return canvas;
}

/** Toma, recorta y guarda en WebP (o JPEG) en un solo paso. */
export async function capturePhoto(options = {}) {
    const shot = await takeShot(options);
    return encodeImage(renderShot(shot, options));
}
