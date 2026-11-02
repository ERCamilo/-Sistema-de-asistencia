/**
 * Enderezar la factura (opcional, Configuración → Tests → «Enderezar facturas»).
 *
 * Busca el papel en una copia pequeña de la toma, saca sus CUATRO esquinas y vuelve a
 * dibujarlo como un rectángulo recto (corrige giro y perspectiva). Es CONSERVADOR: ante
 * cualquier duda no hace nada y la foto se queda como salió, porque deformar mal una
 * factura es peor que dejarla ligeramente torcida. En concreto no actúa cuando:
 *   · no hay dos zonas claramente distintas (papel blanco sobre mesa blanca), o la zona clara
 *     no se parece a un papel (mancha de luz, papel diminuto o cortado por el borde del cuadro);
 *   · las esquinas no forman un cuadrilátero convexo casi rectangular;
 *   · el papel se ve apaisado o girado tanto que no se sabe cuál es «arriba» (una factura se
 *     asume en vertical);
 *   · el papel YA está recto: remuestrear suaviza el texto y eso empeora la lectura.
 *
 * El resultado es lo que se guarda y lo que lee el lector, así que los recuadros de datos
 * siguen alineados con la imagen. Probado en js/tests/PettyCashPaperStraighten.test.js.
 */
import { paperThreshold, PAPER_MIN_AREA, PAPER_MAX_AREA, PAPER_SIZE } from './PettyCashPaperCrop.js';

export const STRAIGHTEN_MARGIN = 0.05;        // margen por lado, como fracción del tamaño del papel
export const STRAIGHTEN_MAX_SIDE = 2400;      // lado largo máximo de la imagen enderezada (igual que lo que acepta el lector)
export const MAX_SKEW_DEG = 40;               // más inclinado que esto no se toca
export const STRAIGHT_SKEW_DEG = 3;           // menos que esto (y sin perspectiva) cuenta como recto
export const STRAIGHT_PERSPECTIVE = 1.06;     // relación entre lados opuestos para considerarlos paralelos
const MAX_PERSPECTIVE = 2;                    // lados opuestos muy distintos: no es un papel visto de frente
const MIN_FILL = 0.7;                         // dentro del cuadrilátero, al menos esto debe ser papel claro
const MIN_ANGLE = 60;                         // ángulos interiores entre 60° y 120°
const MAX_ANGLE = 120;
const MIN_PORTRAIT = 1.1;                     // alto / ancho mínimo: una factura se asume en vertical
const BORDER_LIMIT = 0.15;                    // el papel no puede tocar el borde del cuadro en más de esto × (ancho+alto) píxeles

// ── Geometría ────────────────────────────────────────────────────────────

/**
 * Homografía que lleva cada punto de `src` a su punto de `dst` (4 pares). Devuelve 9 números
 * (fila por fila, con el último = 1) o null si los puntos son degenerados.
 */
export function homography(src, dst) {
    const a = [];
    for (let i = 0; i < 4; i++) {
        const [x, y] = src[i];
        const [u, v] = dst[i];
        a.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
        a.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
    }
    for (let col = 0; col < 8; col++) {
        let pivot = col;
        for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        if (Math.abs(a[pivot][col]) < 1e-10) return null;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let r = 0; r < 8; r++) {
            if (r === col) continue;
            const f = a[r][col] / a[col][col];
            if (f) for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
        }
    }
    const h = a.map((row, i) => row[8] / row[i]);
    return [...h, 1];
}

export function applyH(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const polygonArea = (pts) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(s) / 2;
};
const degrees = (rad) => (rad * 180) / Math.PI;

/** Esquinas TL, TR, BR, BL alejadas del centro: `margin` es la fracción del tamaño que se añade por cada lado. */
export function expandQuad(corners, margin) {
    if (!margin) return corners.map((c) => [c[0], c[1]]);
    const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
    const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
    const k = 1 + 2 * margin;
    return corners.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** Tamaño de la imagen enderezada: los lados más largos de cada par, sin pasar de `maxSide`. */
export function quadOutputSize(corners, maxSide = STRAIGHTEN_MAX_SIDE) {
    const [tl, tr, br, bl] = corners;
    let w = Math.max(dist(tl, tr), dist(bl, br));
    let h = Math.max(dist(tl, bl), dist(tr, br));
    const longest = Math.max(w, h);
    if (longest > maxSide) { const k = maxSide / longest; w *= k; h *= k; }
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

// ── Detección de las cuatro esquinas ─────────────────────────────────────

/** Componente claro más grande (8 vecinos) y sus píxeles extremos. */
function largestBrightBlob(g, width, height, threshold) {
    const total = width * height;
    const label = new Int32Array(total);
    const stack = new Int32Array(total);
    let bestId = 0; let bestSize = 0; let id = 0;
    for (let start = 0; start < total; start++) {
        if (label[start] || g[start] <= threshold) continue;
        id++;
        let size = 0; let top = 0;
        stack[top++] = start; label[start] = id;
        while (top) {
            const p = stack[--top];
            size++;
            const x = p % width; const y = (p - x) / width;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if ((!dx && !dy) || nx < 0 || nx >= width) continue;
                    const q = ny * width + nx;
                    if (!label[q] && g[q] > threshold) { label[q] = id; stack[top++] = q; }
                }
            }
        }
        if (size > bestSize) { bestSize = size; bestId = id; }
    }
    if (!bestId) return null;
    let tl = null; let tr = null; let br = null; let bl = null; let border = 0;
    let minSum = Infinity; let maxSum = -Infinity; let minDiff = Infinity; let maxDiff = -Infinity;
    for (let p = 0; p < total; p++) {
        if (label[p] !== bestId) continue;
        const x = p % width; const y = (p - x) / width;
        const sum = x + y; const diff = x - y;
        if (sum < minSum) { minSum = sum; tl = [x, y]; }
        if (sum > maxSum) { maxSum = sum; br = [x + 1, y + 1]; }
        if (diff > maxDiff) { maxDiff = diff; tr = [x + 1, y]; }
        if (diff < minDiff) { minDiff = diff; bl = [x, y + 1]; }
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border++;
    }
    return { size: bestSize, corners: [tl, tr, br, bl], border };
}

const convex = (pts) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
        const a = pts[i]; const b = pts[(i + 1) % 4]; const c = pts[(i + 2) % 4];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cross) < 1e-9) return false;
        const s = cross > 0 ? 1 : -1;
        if (sign && s !== sign) return false;
        sign = s;
    }
    return true;
};

const interiorAngle = (prev, at, next) => {
    const v1 = [prev[0] - at[0], prev[1] - at[1]];
    const v2 = [next[0] - at[0], next[1] - at[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
    return degrees(Math.acos(Math.max(-1, Math.min(1, cos))));
};

/**
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} image RGBA
 * @returns {{corners:number[][], skewDeg:number, perspective:number, straight:boolean, area:number, fill:number}|null}
 *   corners: TL, TR, BR, BL normalizadas (0–1) sobre la imagen analizada.
 */
export function detectQuad(image) {
    const base = paperThreshold(image);
    if (!base) return null;
    const { g, width, height, threshold } = base;
    const total = width * height;
    const blob = largestBrightBlob(g, width, height, threshold);
    if (!blob || blob.corners.some((c) => !c)) return null;
    // Si el papel toca el borde del cuadro no se ven sus esquinas de verdad: no se adivina.
    if (blob.border > BORDER_LIMIT * (width + height)) return null;
    const pts = blob.corners;
    if (!convex(pts)) return null;

    const area = polygonArea(pts) / total;
    if (area < PAPER_MIN_AREA || area > PAPER_MAX_AREA) return null;
    const fill = blob.size / polygonArea(pts);
    if (fill < MIN_FILL) return null;
    for (let i = 0; i < 4; i++) {
        const angle = interiorAngle(pts[(i + 3) % 4], pts[i], pts[(i + 1) % 4]);
        if (angle < MIN_ANGLE || angle > MAX_ANGLE) return null;
    }

    const [tl, tr, br, bl] = pts;
    const top = dist(tl, tr); const bottom = dist(bl, br); const left = dist(tl, bl); const right = dist(tr, br);
    const ratio = (a, b) => Math.max(a, b) / Math.max(1e-9, Math.min(a, b));
    const perspective = Math.max(ratio(top, bottom), ratio(left, right));
    if (perspective > MAX_PERSPECTIVE) return null;
    // Una factura se asume en vertical: un papel apaisado (o girado tanto que lo parece) es ambiguo.
    if ((left + right) / 2 < MIN_PORTRAIT * ((top + bottom) / 2)) return null;

    const angleOf = (a, b, vertical) => Math.abs(degrees(vertical ? Math.atan2(b[0] - a[0], b[1] - a[1]) : Math.atan2(b[1] - a[1], b[0] - a[0])));
    const skewDeg = Math.max(angleOf(tl, tr, false), angleOf(bl, br, false), angleOf(tl, bl, true), angleOf(tr, br, true));
    if (skewDeg > MAX_SKEW_DEG) return null;

    return {
        corners: pts.map(([x, y]) => [x / width, y / height]),
        skewDeg,
        perspective,
        straight: skewDeg < STRAIGHT_SKEW_DEG && perspective < STRAIGHT_PERSPECTIVE,
        area,
        fill
    };
}

// ── Remuestreo ────────────────────────────────────────────────────────────

/**
 * Dibuja el cuadrilátero `corners` (píxeles de `src`, TL, TR, BR, BL) como un rectángulo
 * outW × outH. Interpolación bilineal; fuera de la imagen se repite el borde.
 * `y0`/`y1` limitan las filas de salida (para hacerlo por tramos).
 * @returns {Uint8ClampedArray} RGBA outW × outH
 */
export function warpImage(src, corners, outW, outH, { out = new Uint8ClampedArray(outW * outH * 4), y0 = 0, y1 = outH } = {}) {
    const h = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
    if (!h) return out;
    const { data, width, height } = src;
    const maxX = width - 1; const maxY = height - 1;
    for (let y = y0; y < y1; y++) {
        let o = y * outW * 4;
        const py = y + 0.5;
        for (let x = 0; x < outW; x++, o += 4) {
            const px = x + 0.5;
            const w = h[6] * px + h[7] * py + 1;
            let sx = (h[0] * px + h[1] * py + h[2]) / w - 0.5;
            let sy = (h[3] * px + h[4] * py + h[5]) / w - 0.5;
            if (sx < 0) sx = 0; else if (sx > maxX) sx = maxX;
            if (sy < 0) sy = 0; else if (sy > maxY) sy = maxY;
            const x0 = sx | 0; const y0i = sy | 0;
            const x1 = x0 < maxX ? x0 + 1 : x0; const y1i = y0i < maxY ? y0i + 1 : y0i;
            const fx = sx - x0; const fy = sy - y0i;
            const i00 = (y0i * width + x0) * 4; const i10 = (y0i * width + x1) * 4;
            const i01 = (y1i * width + x0) * 4; const i11 = (y1i * width + x1) * 4;
            const w00 = (1 - fx) * (1 - fy); const w10 = fx * (1 - fy); const w01 = (1 - fx) * fy; const w11 = fx * fy;
            out[o] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
            out[o + 1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
            out[o + 2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
            out[o + 3] = 255;
        }
    }
    return out;
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Igual que `warpImage`, por tramos de filas y cediendo el hilo entre uno y otro (la cámara no se congela). */
export async function warpImageAsync(src, corners, outW, outH, { rowsPerChunk = 64, yieldFn = nextTick } = {}) {
    const out = new Uint8ClampedArray(outW * outH * 4);
    for (let y = 0; y < outH; y += rowsPerChunk) {
        warpImage(src, corners, outW, outH, { out, y0: y, y1: Math.min(outH, y + rowsPerChunk) });
        if (y + rowsPerChunk < outH) await yieldFn();
    }
    return out;
}

// ── Pegamento con la cámara ──────────────────────────────────────────────

/**
 * Analiza una toma de la cámara sin consumirla (dibuja una copia pequeña).
 * @returns {{crop:{sx:number, sy:number, sw:number, sh:number}, quad:number[][], skewDeg:number, perspective:number, area:number}|null}
 *   `crop` es la zona de la toma que contiene el papel; `quad` son sus esquinas (TL, TR, BR, BL)
 *   en fracción (0–1) de ESE recorte (pueden pasar un poco de 0–1 por el margen). Null si no hay
 *   que enderezar.
 */
export function straightenShotToPaper(shot, { doc = globalThis.document } = {}) {
    const source = shot?.source;
    const crop = shot?.crop;
    if (!source || !crop || !doc || typeof source === 'string' || source instanceof Blob) return null;
    const w = Math.min(PAPER_SIZE, crop.sw);
    const h = Math.max(1, Math.round(crop.sh * (w / crop.sw)));
    const canvas = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext?.('2d');
    if (!ctx?.getImageData) return null;
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    const found = detectQuad(ctx.getImageData(0, 0, w, h));
    if (!found || found.straight) return null;

    const grown = expandQuad(found.corners, STRAIGHTEN_MARGIN);
    const xs = grown.map((c) => c[0]); const ys = grown.map((c) => c[1]);
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const bx0 = clamp01(Math.min(...xs)); const by0 = clamp01(Math.min(...ys));
    const bx1 = clamp01(Math.max(...xs)); const by1 = clamp01(Math.max(...ys));
    const ox = Math.round(bx0 * crop.sw); const oy = Math.round(by0 * crop.sh);
    const sw = Math.min(crop.sw - ox, Math.round((bx1 - bx0) * crop.sw));
    const sh = Math.min(crop.sh - oy, Math.round((by1 - by0) * crop.sh));
    if (!(sw > 8) || !(sh > 8)) return null;
    const quad = grown.map(([x, y]) => [(x * crop.sw - ox) / sw, (y * crop.sh - oy) / sh]);
    return {
        crop: { sx: crop.sx + ox, sy: crop.sy + oy, sw, sh },
        quad,
        skewDeg: found.skewDeg,
        perspective: found.perspective,
        area: found.area
    };
}

/**
 * Endereza un lienzo ya dibujado con el recorte de `straightenShotToPaper`.
 * @param {HTMLCanvasElement} canvas lienzo con el recorte
 * @param {number[][]} quad esquinas en fracción (0–1) del lienzo
 * @returns {Promise<HTMLCanvasElement|null>} lienzo nuevo, o null si no se pudo (el original queda intacto)
 */
export async function straightenCanvas(canvas, quad, { doc = globalThis.document, maxSide = STRAIGHTEN_MAX_SIDE, rowsPerChunk, yieldFn } = {}) {
    if (!canvas || !Array.isArray(quad) || quad.length !== 4 || !doc) return null;
    const ctx = canvas.getContext?.('2d');
    if (!ctx?.getImageData) return null;
    const corners = quad.map(([x, y]) => [x * canvas.width, y * canvas.height]);
    const { w, h } = quadOutputSize(corners, maxSide);
    if (!homography([[0, 0], [w, 0], [w, h], [0, h]], corners)) return null;
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = await warpImageAsync(src, corners, w, h, { rowsPerChunk, yieldFn });
    const out = doc.createElement('canvas');
    out.width = w;
    out.height = h;
    const outCtx = out.getContext('2d');
    const ImageDataCtor = doc.defaultView?.ImageData || globalThis.ImageData;
    outCtx.putImageData(ImageDataCtor ? new ImageDataCtor(pixels, w, h) : { data: pixels, width: w, height: h }, 0, 0);
    return out;
}
