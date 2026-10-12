/**
 * Factura larga por partes (cámara de facturas).
 *
 * Cada parte nueva debe incluir el final de la anterior: el visor muestra esa
 * franja ("fantasma") arriba como guía. Aquí se busca dónde se ve la franja en
 * la imagen nueva, en vivo (¿hay traslape? ¿falta bajar? ¿se pasó?) y al unir
 * (para recortar lo repetido), y se unen las partes en una sola imagen alta
 * que entra a la cola como cualquier otra foto.
 *
 * Las comparaciones usan versiones pequeñas en gris y correlación normalizada
 * (no les afecta el brillo ni el contraste) con un pequeño corrimiento de lado,
 * porque con la mano el teléfono nunca baja en línea recta.
 *
 * Renglones repetidos (el mismo producto varias veces): la franja chica
 * coincide en varias alturas. Cada candidata se verifica con una franja más
 * alta que incluya un renglón distinto (BAND_STEPS); si aun así no se puede
 * saber, se dice "ambigua" en vez de adivinar.
 *
 * Probado en js/tests/PettyCashStitch.test.js.
 */

import { encodeImage } from './PettyCashCapture.js';

/** Fracción de la altura de la foto que se usa como franja de traslape. */
export const OVERLAP_FRACTION = 0.12;
/**
 * Alturas de franja que se prueban, de menor a mayor. Con el mismo producto
 * en muchos renglones seguidos (factura de supermercado), la franja chica
 * coincide igual en varias alturas; una más alta incluye un renglón distinto
 * y deja de ser ambigua, pero necesita más traslape. Diagnóstico real: 56 %
 * de las revisiones en vivo salían "ambiguas" con una sola franja.
 */
export const BAND_STEPS = [OVERLAP_FRACTION, 0.25, 0.4];
/**
 * Correlación mínima para las franjas altas: si todavía no se ven enteras, su
 * parte repetida coincide sola y da falsos aciertos (~0.7); los verdaderos
 * pasan de 0.9.
 */
export const TALL_MIN_NCC = 0.6;
/** Candidatas de la franja chica que se verifican: hasta esta distancia de la mejor. */
const VERIFY_SPREAD = 0.12;
/** Picos a más de estas filas de la mejor cuentan como otra altura posible. */
const PEAK_NEAR = 3;
/** Alturas candidatas que se miran de cerca (con renglones repetidos hay muchas). */
const MAX_CANDIDATES = 10;
/** Contraste mínimo (desviación, 0–255) para que una franja sirva de guía: el papel en blanco no. */
export const MIN_BAND_CONTRAST = 16;
/** Variación mínima entre renglones (ver rowTexture). */
export const MIN_ROW_TEXTURE = 8;
/** Ancho de las versiones pequeñas en gris. */
export const SAMPLE_WIDTH = 72;
/**
 * Más filas que columnas en las muestras: con una fila por cada 15 px, un
 * renglón de texto ocupa 2 filas y la comparación dependía de cómo cayera
 * entre ellas. Con 3 veces más filas eso deja de importar.
 */
export const V_SCALE = 3;
/** Pasadas de suavizado vertical (toleran inclinación y movimiento de la mano). */
export const SMOOTH_PASSES = 2;
// El lector recibe hasta 1600 px de ancho: más no ayuda y pesa más.
const MAX_STITCH_WIDTH = 1600;
const MAX_STITCH_PIXELS = 12_000_000;

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

/** Correlación mínima (−1…1) para dar la franja por encontrada. */
export const MIN_NCC = 0.5;
/** La mejor altura debe superar a cualquier otra lejana por este margen; si no, es ambigua. */
export const NCC_DISTINCT = 0.08;
/** Corrimiento de lado que se tolera (fracción del ancho). */
const MAX_SHIFT_FRACTION = 0.1;
/** Mitad de arriba: si el final de la parte anterior se ve ahí, la unión queda bien. */
export const OK_ZONE = 0.5;

/**
 * Inclinaciones que se prueban en la pasada fina (filas de diferencia entre
 * el centro y cada borde). Distintas distancias (más cerca / más lejos) no se
 * prueban: costaba 5 veces más y daba alturas equivocadas; la guía en pantalla
 * (el texto de la franja del mismo tamaño) ayuda a mantener la distancia.
 */
const SHEARS = [-3, -1.5, 0, 1.5, 3]; // filas de diferencia entre el centro y cada borde
const COARSE = 3; // la pasada rápida junta de a 3 filas

/** La franja menos el promedio de cada columna: solo cuenta lo que cambia de renglón a renglón. */
function columnResidual(gray, rows, w) {
    const out = new Float32Array(gray.length);
    for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let r = 0; r < rows; r++) sum += gray[r * w + x];
        const mean = sum / rows;
        for (let r = 0; r < rows; r++) out[r * w + x] = gray[r * w + x] - mean;
    }
    return out;
}

/** Sumas acumuladas por columna: promedio de cualquier ventana en O(1). */
function columnPrefix(gray, rows, w) {
    const out = new Float64Array((rows + 1) * w);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < w; x++) out[(y + 1) * w + x] = out[y * w + x] + gray[y * w + x];
    }
    return out;
}

/** Junta de a `k` filas (promedio). */
function shrinkRows(gray, rows, w, k) {
    const outRows = Math.floor(rows / k);
    const out = new Float32Array(outRows * w);
    for (let y = 0; y < outRows; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let i = 0; i < k; i++) sum += gray[(y * k + i) * w + x];
            out[y * w + x] = sum / k;
        }
    }
    return { gray: out, rows: outRows };
}

/**
 * Correlación normalizada entre la franja (ya sin el promedio de cada columna)
 * y `target` con la franja empezando en la fila `y`, corrida `dx` columnas e
 * inclinada `shear` filas hacia cada borde. A cada columna de `target` se le
 * resta su promedio en la ventana (bordes del papel, sombras y fondo no
 * cuentan). No le afectan el brillo ni el contraste.
 */
function ncc(band, target, sums, liveRows, w, y, dx, shear) {
    const { gray: a, rows, width: bw } = band;
    const xOff = Math.round((w - bw) / 2) + dx;
    const half = bw / 2;
    let ab = 0; let aa = 0; let bb = 0; let used = 0;
    for (let xb = 0; xb < bw; xb++) {
        const tx = xb + xOff;
        if (tx < 0 || tx >= w) continue;
        const ty = y + Math.round(shear * (xb - half) / half);
        if (ty < 0 || ty + rows > liveRows) continue;
        const mean = (sums[(ty + rows) * w + tx] - sums[ty * w + tx]) / rows;
        for (let r = 0; r < rows; r++) {
            const av = a[r * bw + xb];
            const bv = target[(ty + r) * w + tx] - mean;
            ab += av * bv; aa += av * av; bb += bv * bv;
        }
        used += 1;
    }
    if (used < bw * 0.6 || !aa || !bb) return -1;
    return ab / Math.sqrt(aa * bb);
}

const prepared = (gray, rows, w) => ({ gray: columnResidual(gray, rows, w), rows, width: w });

/**
 * Busca `band` en `target` a cualquier altura, tolerando corrimiento de
 * lado, algo de inclinación, desenfoque y cambios de luz.
 * Dos pasadas: una rápida (filas juntadas, sin escala ni inclinación) para
 * hallar alturas candidatas y otra fina solo alrededor de ellas.
 */
export function findBand(band, live, liveRows, { maxShift = Math.max(1, Math.round(band.width * MAX_SHIFT_FRACTION)), smoothPasses = SMOOTH_PASSES } = {}) {
    const w = band.width;
    const smooth = (g, rows) => { let out = g; for (let i = 0; i < smoothPasses; i++) out = smoothRows(out, rows, w); return out; };
    const bandS = smooth(band.gray, band.rows);
    const liveS = smooth(live, liveRows);
    const none = { found: false, ambiguous: false, y: null, dx: 0, ncc: -1, runnerUp: -1 };
    if (liveRows < band.rows) return none;

    // Pasada rápida.
    const k = band.rows >= COARSE * 4 ? COARSE : 1;
    const cb = shrinkRows(bandS, band.rows, w, k);
    const cl = shrinkRows(liveS, liveRows, w, k);
    const cBand = prepared(cb.gray, cb.rows, w);
    const cSums = columnPrefix(cl.gray, cl.rows, w);
    const coarse = [];
    for (let y = 0; y <= cl.rows - cb.rows; y++) {
        let best = { v: -1, dx: 0 };
        for (let dx = -maxShift; dx <= maxShift; dx++) {
            const v = ncc(cBand, cl.gray, cSums, cl.rows, w, y, dx, 0);
            if (v > best.v) best = { v, dx };
        }
        coarse.push({ y, ...best });
    }
    if (!coarse.length) return none;
    const ranked = coarse.slice().sort((p, q) => q.v - p.v);
    const candidates = [];
    for (const c of ranked) {
        if (candidates.length >= MAX_CANDIDATES) break;
        if (candidates.every(o => Math.abs(o.y - c.y) > 2)) candidates.push(c);
    }

    // Pasada fina alrededor de las candidatas.
    const sums = columnPrefix(liveS, liveRows, w);
    const fine = prepared(bandS, band.rows, w);
    let best = { v: -1, y: 0, dx: 0 };
    const byRow = new Map(); // mejor valor por altura
    for (const c of candidates) {
        // ±3 filas gruesas: cubre el hueco hasta la candidata vecina más cercana.
        for (let y = Math.max(0, (c.y - 3) * k); y <= Math.min(liveRows - 2, (c.y + 3) * k + k - 1); y++) {
            if (y + band.rows > liveRows || byRow.has(y)) continue;
            let local = { v: -1, y, dx: 0 };
            for (let dx = c.dx - 2; dx <= c.dx + 2; dx++) {
                for (const shear of SHEARS) {
                    const v = ncc(fine, liveS, sums, liveRows, w, y, dx, shear);
                    if (v > local.v) local = { v, y, dx };
                }
            }
            byRow.set(y, local);
            if (local.v > best.v) best = local;
        }
    }
    // Máximos locales (con renglones repetidos hay varios casi iguales y
    // vecinos): se verifican después con una franja más alta.
    const peaks = [...byRow.values()].filter(p => p.v > -1
        && p.v >= (byRow.get(p.y - 1)?.v ?? -2) && p.v >= (byRow.get(p.y + 1)?.v ?? -2));
    // ¿Ambigua? La mejor altura debe superar a las lejanas, de la pasada rápida
    // y de la fina (la rápida, con filas juntadas, puede subestimar un pico).
    const near = Math.max(2, Math.round(band.rows / 3));
    const runnerUp = Math.max(
        coarse.reduce((m, p) => (Math.abs(p.y * k - best.y) > near && p.v > m ? p.v : m), -1),
        // Picos finos: son máximos locales (no la ladera del mejor), así que
        // cuenta cualquiera a más de 3 filas; con renglones repetidos el
        // siguiente está a un solo renglón.
        peaks.reduce((m, p) => (Math.abs(p.y - best.y) > PEAK_NEAR && p.v > m ? p.v : m), -1)
    );
    const value = best.v;
    return {
        found: value >= MIN_NCC && value - runnerUp >= NCC_DISTINCT,
        ambiguous: value >= MIN_NCC && value - runnerUp < NCC_DISTINCT,
        y: best.y, dx: best.dx, ncc: value, runnerUp, peaks
    };
}

/**
 * Correlación de `band` en `live` justo en la fila `y` (corrimiento cerca de
 * `dx`, con las mismas inclinaciones): para verificar una candidata.
 */
function scoreAt(band, live, liveRows, y, dx0, smoothPasses = SMOOTH_PASSES) {
    const w = band.width;
    if (y < 0 || y + band.rows > liveRows) return -1;
    const smooth = (g, rows) => { let out = g; for (let i = 0; i < smoothPasses; i++) out = smoothRows(out, rows, w); return out; };
    // Solo la ventana necesaria del video (con margen para la inclinación).
    const from = Math.max(0, y - 4);
    const to = Math.min(liveRows, y + band.rows + 4);
    const win = smooth(live.subarray(from * w, to * w), to - from);
    const sums = columnPrefix(win, to - from, w);
    const fine = prepared(smooth(band.gray, band.rows), band.rows, w);
    let v = -1;
    for (let dx = dx0 - 2; dx <= dx0 + 2; dx++) {
        for (const shear of SHEARS) v = Math.max(v, ncc(fine, win, sums, to - from, w, y - from, dx, shear));
    }
    return v;
}

/**
 * Verifica las candidatas de la franja chica con una franja más alta: con
 * renglones repetidos la chica coincide en varias alturas y solo la correcta
 * sigue coincidiendo al mirar más arriba. Todas se comparan con la misma
 * altura (la más alta que cabe en todas): comparar una franja alta en unas con
 * la chica en otras elegía mal. null si ninguna franja más alta cabe en todas.
 */
function verifyTaller(band, steps, peaks, live, liveRows) {
    const base = steps[0];
    const top = Math.min(...peaks.map(p => p.y));
    const n = [...steps].reverse().find(rows => rows > base && top - (rows - base) >= 0);
    if (!n) return null;
    const scored = peaks
        .map(p => ({ ...p, n, score: scoreAt(subBand(band, n), live, liveRows, p.y - (n - base), p.dx) }))
        .sort((a, b) => b.score - a.score);
    const [best] = scored;
    const second = scored.find(p => Math.abs(p.y - best.y) > PEAK_NEAR)?.score ?? -1;
    return { ...best, distinct: best.score - second >= NCC_DISTINCT };
}

/**
 * Qué decirle a quien toma la factura larga, según dónde se ve en vivo el
 * final de la parte anterior (`band`):
 *   ok    → en la mitad de arriba: hay traslape, la unión queda bien;
 *   below → todavía más abajo: sigue bajando;
 *   lost  → ya no se ve: te pasaste (quedaría un hueco);
 *   flat  → la franja no tiene texto: no se puede saber;
 *   unsure→ coincide igual en varias alturas.
 */
/** Las últimas `n` filas de la franja (escalón). */
const subBand = (band, n) => (n === band.rows ? band : { gray: band.gray.subarray((band.rows - n) * band.width), rows: n, width: band.width });

/**
 * `band` puede traer escalones (`steps`: filas de cada franja, de menor a
 * mayor, contadas desde abajo; ver bottomBand). Se prueba la chica y, solo si
 * es ambigua, las más altas. `y` siempre se refiere a la franja chica.
 */
export function judgeAlignment(band, live, liveRows) {
    const steps = band?.steps?.length ? band.steps : [band?.rows];
    const base = band && subBand(band, steps[0]);
    if (!band || bandContrast(base.gray) < MIN_BAND_CONTRAST || rowTexture(base.gray, base.rows, base.width) < MIN_ROW_TEXTURE) {
        return { aligned: false, flat: true, status: 'flat', y: null, yFrac: null };
    }
    const r = findBand(base, live, liveRows);
    const placed = (y, dx, value, rows) => {
        const yFrac = y / liveRows;
        const status = yFrac <= OK_ZONE ? 'ok' : 'below';
        return { aligned: status === 'ok', flat: false, status, y, yFrac, dx, ncc: value, rows };
    };
    const unsure = (y, value) => ({ aligned: false, flat: false, status: 'unsure', y, yFrac: y / liveRows, ncc: value, candidates: close.map(p => p.y) });
    if (!r.found && !r.ambiguous) return { aligned: false, flat: false, status: 'lost', y: null, yFrac: null, ncc: r.ncc };
    const close = r.peaks.filter(p => p.v >= Math.max(MIN_NCC, r.ncc - VERIFY_SPREAD));
    // Varias alturas casi tan buenas como la mejor (renglones repetidos; con
    // la mano movida, una incorrecta puede pasar por única): se elige la que
    // también coincide con más contexto arriba, si eso es concluyente.
    if (steps.length > 1 && close.length > 1) {
        const v = verifyTaller(band, steps, close, live, liveRows);
        if (v && v.score >= TALL_MIN_NCC) return v.distinct ? placed(v.y, v.dx, v.score, v.n) : unsure(v.y, v.score);
        // Sin franja alta que confirme: vale lo que diga la chica.
    }
    if (r.ambiguous) return unsure(r.y, r.ncc);
    return placed(r.y, r.dx, r.ncc, steps[0]);
}

/** Hasta dónde puede estar una candidata de la pista de la guía (fracción de la altura). */
export const HINT_TOLERANCE = 0.08;

/**
 * Al unir: fila de la parte siguiente donde empieza la franja chica del final
 * de la anterior, buscando en toda la parte (con mucho traslape queda muy
 * abajo). Si sigue ambigua, `hintFrac` (dónde la vio la guía en vivo al tomar
 * la foto, si era confiable) elige entre las candidatas: nunca se usa sola.
 * null si no hay coincidencia confiable.
 */
export function locateOverlap(band, gray, rows, { hintFrac = null } = {}) {
    const r = judgeAlignment(band, gray, rows);
    if (r.status === 'ok' || r.status === 'below') return { y: r.y, ncc: r.ncc };
    if (r.status !== 'unsure' || !Number.isFinite(hintFrac) || !r.candidates?.length) return null;
    const target = hintFrac * rows;
    const nearest = r.candidates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return Math.abs(nearest - target) <= HINT_TOLERANCE * rows ? { y: nearest, ncc: r.ncc, fromHint: true } : null;
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
export function sampleGray(doc, source, sx, sy, sw, sh, width = SAMPLE_WIDTH, vScale = V_SCALE) {
    const rows = Math.max(1, Math.round(sh * (width / sw) * vScale));
    const canvas = makeCanvas(doc, width, rows);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Reducción de calidad alta (promedia cada zona): con la normal, cada
    // columna tomaba un punto suelto y cambiaba mucho con un corrimiento mínimo.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, rows);
    const { data } = ctx.getImageData(0, 0, width, rows);
    const gray = new Uint8Array(width * rows);
    for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
    return { gray, rows, width };
}

const sizeOf = (src) => ({ w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height });

/**
 * Final de una parte, en gris, para comparar en vivo y al unir: la franja más
 * alta de BAND_STEPS, con `steps` = filas de cada escalón (desde abajo).
 */
export function bottomBand(doc, bitmap) {
    const { w, h } = sizeOf(bitmap);
    const tallest = BAND_STEPS[BAND_STEPS.length - 1];
    const bandH = Math.round(h * tallest);
    const sample = sampleGray(doc, bitmap, 0, h - bandH, w, bandH);
    return { ...sample, steps: BAND_STEPS.map(f => Math.max(1, Math.round(sample.rows * (f / tallest)))) };
}

/** ¿El final de la parte anterior está ya arriba del todo en el visor? */
export function liveAlignment(doc, video, band) {
    const { w, h } = sizeOf(video);
    if (!w || !h || !band) return { aligned: false, status: 'lost', yFrac: null };
    // Toda la imagen: así se sabe si todavía está abajo o si ya no se ve.
    const live = sampleGray(doc, video, 0, 0, w, h, band.width);
    return judgeAlignment(band, live.gray, live.rows);
}

/**
 * Une las partes (ImageBitmap/imagen, de arriba abajo) en una sola imagen (WebP o JPEG).
 * `hints[i]`: dónde vio la guía en vivo el final de la parte i al tomar la
 * i+1 (fracción de la altura), o null.
 */
export async function stitchParts(doc, bitmaps, { quality = 0.9, onInfo = null, hints = [] } = {}) {
    if (!bitmaps.length) throw new Error('No hay partes para unir');
    const sizes = bitmaps.map(sizeOf);
    const overlaps = [];
    for (let i = 1; i < bitmaps.length; i++) {
        const band = bottomBand(doc, bitmaps[i - 1]);
        // En toda la parte siguiente: con mucho traslape, el final de la
        // anterior queda muy abajo (antes solo se buscaba en el 60 % de arriba).
        const next = sampleGray(doc, bitmaps[i], 0, 0, sizes[i].w, sizes[i].h, band.width);
        const r = locateOverlap(band, next.gray, next.rows, { hintFrac: hints[i - 1] });
        // Filas de la muestra → filas de la foto (con el alto real: las muestras
        // tienen más filas que columnas). Sin coincidencia confiable, se asume arriba.
        const k = sizes[i].h / next.rows;
        overlaps.push(r ? { y: Math.round(r.y * k), band: Math.round(band.steps[0] * k) } : null);
    }
    onInfo?.({ found: overlaps.filter(Boolean).length, total: overlaps.length });
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
    return encodeImage(canvas, quality);
}
