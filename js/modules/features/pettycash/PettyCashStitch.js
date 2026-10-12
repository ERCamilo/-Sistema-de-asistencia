/**
 * Factura larga por partes (cámara de facturas).
 *
 * Cada parte nueva debe empezar con el final de la anterior: el visor muestra
 * esa franja ("fantasma") arriba del todo para alinear. Aquí se busca dónde
 * quedó la franja en la foto nueva, tanto en vivo (¿ya está alineada?) como al
 * unir (para recortar lo repetido), y se unen las partes en una sola imagen
 * alta que entra a la cola como cualquier otra foto.
 *
 * Las comparaciones usan versiones pequeñas en gris; a cada fila se le resta
 * su promedio para que un cambio de brillo entre fotos no afecte.
 *
 * Probado en js/tests/PettyCashStitch.test.js.
 */

/** Fracción de la altura de la foto que se usa como franja de traslape. */
export const OVERLAP_FRACTION = 0.12;
/** Diferencia media (0–255) por debajo de la cual dos franjas coinciden. */
export const MATCH_MAX_SCORE = 18;
/** Contraste mínimo (desviación, 0–255) para que una franja sirva de guía: el papel en blanco no. */
export const MIN_BAND_CONTRAST = 16;
/** Variación mínima entre renglones (ver rowTexture). */
export const MIN_ROW_TEXTURE = 8;
/** La mejor altura debe destacar sobre las demás por este margen; si no, la franja es ambigua. */
export const DISTINCT_MARGIN = 6;
/** En vivo el video llega algo borroso y la mano se mueve: umbral algo más estricto tras suavizar. */
const LIVE_MAX_SCORE = 14;
const LIVE_DISTINCT_MARGIN = 2;
/** Ancho de las versiones pequeñas en gris. */
export const SAMPLE_WIDTH = 72;
const MAX_STITCH_WIDTH = 1280;
const MAX_STITCH_PIXELS = 12_000_000;

const rowMean = (px, row, w) => {
    let sum = 0;
    for (let x = 0; x < w; x++) sum += px[row * w + x];
    return sum / w;
};

/**
 * Busca `band` (bandRows filas) dentro de `target` desde la fila 0 hasta maxY.
 * @returns {{y: number, score: number, runnerUp: number}} la fila donde empieza, su
 *   diferencia media y la mejor diferencia lejos de ahí (para saber si es ambigua).
 */
export function matchBand(band, bandRows, target, targetRows, w, maxY) {
    const bandMeans = Array.from({ length: bandRows }, (_, r) => rowMean(band, r, w));
    const targetMeans = Array.from({ length: targetRows }, (_, r) => rowMean(target, r, w));
    const last = Math.min(maxY, targetRows - bandRows);
    const scores = [];
    for (let y = 0; y <= last; y++) {
        let diff = 0;
        for (let r = 0; r < bandRows; r++) {
            const bm = bandMeans[r];
            const tm = targetMeans[y + r];
            const bi = r * w;
            const ti = (y + r) * w;
            for (let x = 0; x < w; x++) diff += Math.abs((band[bi + x] - bm) - (target[ti + x] - tm));
        }
        scores.push(diff / (bandRows * w));
    }
    let y = 0;
    scores.forEach((score, i) => { if (score < scores[y]) y = i; });
    const near = Math.max(2, Math.round(bandRows / 4));
    const runnerUp = scores.reduce((min, score, i) => (Math.abs(i - y) > near && score < min ? score : min), Infinity);
    return { y, score: scores.length ? scores[y] : Infinity, runnerUp };
}

/**
 * Cuánto cambia la franja de un renglón a otro (diferencia media con el
 * promedio de su columna). El texto de una factura alterna renglones con
 * tinta y espacios; el papel en blanco o un dibujo que solo varía por
 * columnas no dice a qué altura está.
 */
export function rowTexture(gray, rows, w) {
    if (!gray?.length || !rows || !w) return 0;
    let total = 0;
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = 0; y < rows; y++) sum += gray[y * w + x];
        const mean = sum / rows;
        for (let y = 0; y < rows; y++) total += Math.abs(gray[y * w + x] - mean);
    }
    return total / (rows * w);
}

/** Desviación estándar de los grises: cuánto "texto" tiene la franja. */
export function bandContrast(gray) {
    if (!gray?.length) return 0;
    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += gray[i];
    const mean = sum / gray.length;
    let sq = 0;
    for (let i = 0; i < gray.length; i++) sq += (gray[i] - mean) ** 2;
    return Math.sqrt(sq / gray.length);
}

/** Suavizado vertical [1 2 1]: tolera desfases de menos de un renglón entre foto y video. */
function smoothRows(gray, rows, w) {
    const out = new Uint8Array(gray.length);
    for (let y = 0; y < rows; y++) {
        const up = Math.max(0, y - 1) * w;
        const down = Math.min(rows - 1, y + 1) * w;
        for (let x = 0; x < w; x++) out[y * w + x] = (gray[up + x] + 2 * gray[y * w + x] + gray[down + x]) >> 2;
    }
    return out;
}

/**
 * ¿La franja de la parte anterior (`band`) ya está arriba del todo en `live`?
 * Una franja sin texto no permite saberlo: nunca se da por alineada.
 */
export function judgeAlignment(band, live, liveRows) {
    if (!band || bandContrast(band.gray) < MIN_BAND_CONTRAST || rowTexture(band.gray, band.rows, band.width) < MIN_ROW_TEXTURE) {
        return { aligned: false, flat: true, y: null, score: Infinity };
    }
    const w = band.width;
    const r = matchBand(smoothRows(band.gray, band.rows, w), band.rows, smoothRows(live, liveRows, w), liveRows, w, liveRows - band.rows);
    const tolerance = Math.max(2, Math.round(band.rows * 0.35));
    const ambiguous = r.runnerUp - r.score < LIVE_DISTINCT_MARGIN;
    return { aligned: !ambiguous && r.score < LIVE_MAX_SCORE && r.y <= tolerance, flat: false, ambiguous, y: r.y, score: r.score };
}

/**
 * Qué filas tomar de cada parte. `overlaps[i]` dice dónde apareció, en la
 * parte i+1, la franja final de la parte i ({ y, band } en filas de la parte
 * i+1) o null si no hubo coincidencia confiable: entonces se asume arriba.
 */
export function planStitch(heights, overlaps, { band = 0 } = {}) {
    const slices = heights.map((rows, part) => {
        if (part === 0) return { part, from: 0, rows };
        const o = overlaps[part - 1];
        const from = Math.min(rows - 1, o ? o.y + o.band : band);
        return { part, from, rows: rows - from };
    });
    return { slices, height: slices.reduce((acc, s) => acc + s.rows, 0) };
}

// ── Navegador ──────────────────────────────────────────────────────────────

const makeCanvas = (doc, w, h) => {
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
};

/** Versión pequeña en gris de una región de `source` (video, imagen o bitmap). */
export function sampleGray(doc, source, sx, sy, sw, sh, width = SAMPLE_WIDTH) {
    const rows = Math.max(1, Math.round(sh * (width / sw)));
    const canvas = makeCanvas(doc, width, rows);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, rows);
    const { data } = ctx.getImageData(0, 0, width, rows);
    const gray = new Uint8Array(width * rows);
    for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
    return { gray, rows, width };
}

const sizeOf = (src) => ({ w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height });

/** Franja final de una parte, en gris, para comparar en vivo. */
export function bottomBand(doc, bitmap) {
    const { w, h } = sizeOf(bitmap);
    const bandH = Math.round(h * OVERLAP_FRACTION);
    return sampleGray(doc, bitmap, 0, h - bandH, w, bandH);
}

/** ¿El final de la parte anterior está ya arriba del todo en el visor? */
export function liveAlignment(doc, video, band) {
    const { w, h } = sizeOf(video);
    if (!w || !h || !band) return { aligned: false, score: Infinity };
    const searchH = Math.round(h * OVERLAP_FRACTION * 2.5);
    const live = sampleGray(doc, video, 0, 0, w, searchH, band.width);
    return judgeAlignment(band, live.gray, live.rows);
}

/** Une las partes (ImageBitmap/imagen, de arriba abajo) en un solo JPEG. */
export async function stitchParts(doc, bitmaps, { quality = 0.9 } = {}) {
    if (!bitmaps.length) throw new Error('No hay partes para unir');
    const sizes = bitmaps.map(sizeOf);
    const overlaps = [];
    for (let i = 1; i < bitmaps.length; i++) {
        const band = bottomBand(doc, bitmaps[i - 1]);
        const next = sampleGray(doc, bitmaps[i], 0, 0, sizes[i].w, sizes[i].h * 0.45, band.width);
        const r = matchBand(band.gray, band.rows, next.gray, next.rows, band.width, next.rows - band.rows);
        // Pasar de filas de la muestra a filas de la foto. Sin texto en la franja, no se confía.
        const k = sizes[i].w / band.width;
        const reliable = r.score < MATCH_MAX_SCORE && r.runnerUp - r.score >= DISTINCT_MARGIN
            && bandContrast(band.gray) >= MIN_BAND_CONTRAST && rowTexture(band.gray, band.rows, band.width) >= MIN_ROW_TEXTURE;
        overlaps.push(reliable ? { y: Math.round(r.y * k), band: Math.round(band.rows * k) } : null);
    }
    const plan = planStitch(sizes.map(s => s.h), overlaps, { band: Math.round(sizes[1]?.h * OVERLAP_FRACTION || 0) });
    // Todas las partes vienen de la misma cámara; se limita el ancho y el área total.
    const scale = Math.min(1, MAX_STITCH_WIDTH / sizes[0].w, Math.sqrt(MAX_STITCH_PIXELS / (sizes[0].w * plan.height)));
    const canvas = makeCanvas(doc, sizes[0].w * scale, plan.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const s of plan.slices) {
        const { w } = sizes[s.part];
        const k = (sizes[0].w / w) * scale;
        ctx.drawImage(bitmaps[s.part], 0, s.from, w, s.rows, 0, y, w * k, s.rows * k);
        y += s.rows * k;
    }
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('No se pudo unir la factura'))), 'image/jpeg', quality));
}
