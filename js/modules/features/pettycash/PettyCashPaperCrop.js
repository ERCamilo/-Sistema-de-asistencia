/**
 * Recorte automático del fondo de una foto de factura (opcional, Configuración → Tests).
 *
 * Busca el papel —la zona clara sobre un fondo más oscuro— en una copia pequeña de la
 * toma y recorta alrededor con margen. Es CONSERVADOR: ante cualquier duda no recorta,
 * porque cortar un dato de la factura es peor que dejar un poco de mesa. No endereza
 * ni corrige perspectiva: solo recorta un rectángulo recto.
 *
 * El rectángulo contiene TODO lo claro que se ve (la caja de las zonas claras importantes), no
 * un perfil de filas y columnas: un recibo enrollado, más angosto o con sombra en un extremo
 * no pierde ese extremo.
 *
 * No recorta cuando: la imagen no tiene dos zonas claramente distintas (factura blanca
 * sobre mesa blanca), la zona clara es muy pequeña o casi todo el cuadro, o no se ve como
 * un papel (una mancha de luz). El resultado sustituye el recorte de la toma, así que lo
 * que se guarda y lo que lee el lector es lo mismo y los recuadros siguen alineados.
 *
 * Probado en js/tests/PettyCashPaperCrop.test.js.
 */
export const PAPER_MARGIN = 0.06;          // margen alrededor del papel, como fracción de su tamaño
export const PAPER_SIZE = 240;             // ancho de la copia que se analiza
const MIN_SEPARATION = 60;                 // diferencia de gris mínima entre papel y fondo
const MIN_AREA = 0.12;                     // el papel debe ocupar al menos esto del cuadro
const MAX_AREA = 0.85;                     // y por encima de esto no hay nada útil que recortar
const MIN_FILL = 0.55;                     // dentro del rectángulo, al menos esto debe ser claro
const SHADE_TOLERANCE = 0.3;               // lo que esté a más de este tramo entre fondo y papel cuenta como papel (sombras)

const gray = (data, i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

/** Umbral de Otsu: separa «oscuro» de «claro» maximizando la varianza entre clases. */
function otsu(hist, total) {
    let sumAll = 0;
    for (let v = 0; v < 256; v++) sumAll += v * hist[v];
    let wB = 0; let sumB = 0; let best = -1; let threshold = 128; let meanDark = 0; let meanBright = 255;
    for (let v = 0; v < 256; v++) {
        wB += hist[v];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += v * hist[v];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const between = wB * wF * (mB - mF) ** 2;
        if (between > best) { best = between; threshold = v; meanDark = mB; meanBright = mF; }
    }
    return { threshold, meanDark, meanBright };
}

/**
 * Gris de la imagen y umbral que separa el papel (claro) del fondo (oscuro). Lo comparten el
 * recorte recto y el enderezado. Null si no hay dos zonas claramente distintas.
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} image RGBA
 * @returns {{g:Uint8Array, width:number, height:number, threshold:number}|null}
 */
export function paperThreshold(image) {
    const { data, width, height } = image || {};
    if (!data || !(width > 8) || !(height > 8)) return null;
    const total = width * height;
    const g = new Uint8Array(total);
    const hist = new Uint32Array(256);
    for (let p = 0, i = 0; p < total; p++, i += 4) { const v = Math.round(gray(data, i)); g[p] = v; hist[v]++; }
    const split = otsu(hist, total);
    const { meanDark, meanBright } = split;
    if (meanBright - meanDark < MIN_SEPARATION) return null;
    // Más permisivo que Otsu: una sombra sobre el papel sigue siendo papel, y no debe quedar fuera del recorte.
    const threshold = Math.min(split.threshold, Math.round(meanDark + SHADE_TOLERANCE * (meanBright - meanDark)));
    return { g, width, height, threshold };
}

/** Área mínima y máxima (fracción del cuadro) que debe ocupar un papel para recortarlo o enderezarlo. */
export const PAPER_MIN_AREA = MIN_AREA;
export const PAPER_MAX_AREA = MAX_AREA;

const SIGNIFICANT_BLOB = 0.15;            // una zona clara cuenta si tiene al menos esto de la más grande (un papel partido por un doblez)
const MIN_BLOB_FRACTION = 0.005;           // y al menos esto del cuadro (no cuenta el polvo)

/**
 * Zonas claras conectadas (8 vecinos). Devuelve la más grande —sus píxeles extremos, para sacar
 * las esquinas— y la caja y la máscara de TODAS las zonas importantes, para no cortar un papel
 * partido por un doblez o una sombra.
 * @returns {{size:number, corners:number[][], border:number, box:{x0:number,y0:number,x1:number,y1:number}, mask:Uint8Array, count:number}|null}
 */
export function brightBlobs(g, width, height, threshold) {
    const total = width * height;
    const label = new Int32Array(total);
    const stack = new Int32Array(total);
    const sizes = [0];
    let bestId = 0; let bestSize = 0;
    for (let start = 0; start < total; start++) {
        if (label[start] || g[start] <= threshold) continue;
        const id = sizes.length;
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
        sizes.push(size);
        if (size > bestSize) { bestSize = size; bestId = id; }
    }
    if (!bestId) return null;
    const minSize = Math.max(SIGNIFICANT_BLOB * bestSize, MIN_BLOB_FRACTION * total);
    const mask = new Uint8Array(total);
    let tl = null; let tr = null; let br = null; let bl = null; let border = 0; let count = 0;
    let minSum = Infinity; let maxSum = -Infinity; let minDiff = Infinity; let maxDiff = -Infinity;
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
    for (let p = 0; p < total; p++) {
        const id = label[p];
        if (!id || sizes[id] < minSize) continue;
        mask[p] = 1; count++;
        const x = p % width; const y = (p - x) / width;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border++;
        if (id !== bestId) continue;
        const sum = x + y; const diff = x - y;
        if (sum < minSum) { minSum = sum; tl = [x, y]; }
        if (sum > maxSum) { maxSum = sum; br = [x + 1, y + 1]; }
        if (diff > maxDiff) { maxDiff = diff; tr = [x + 1, y]; }
        if (diff < minDiff) { minDiff = diff; bl = [x, y + 1]; }
    }
    return { size: bestSize, corners: [tl, tr, br, bl], border, box: { x0, y0, x1, y1 }, mask, count };
}

/**
 * @param {{data:Uint8ClampedArray|number[], width:number, height:number}} image RGBA
 * @returns {{x0:number, y0:number, x1:number, y1:number}|null} rectángulo (0–1) o null si no hay que recortar
 */
export function detectPaper(image) {
    const base = paperThreshold(image);
    if (!base) return null;
    const { g, width, height, threshold } = base;
    const total = width * height;
    const blobs = brightBlobs(g, width, height, threshold);
    if (!blobs || blobs.count / total < 0.05) return null;
    const { x0, y0, x1, y1 } = blobs.box;
    const boxW = x1 - x0 + 1;
    const boxH = y1 - y0 + 1;
    const area = (boxW * boxH) / total;
    if (area < MIN_AREA || area > MAX_AREA) return null;
    if (blobs.count / (boxW * boxH) < MIN_FILL) return null;

    const mx = boxW * PAPER_MARGIN;
    const my = boxH * PAPER_MARGIN;
    const rect = {
        x0: Math.max(0, (x0 - mx) / width), y0: Math.max(0, (y0 - my) / height),
        x1: Math.min(1, (x1 + 1 + mx) / width), y1: Math.min(1, (y1 + 1 + my) / height)
    };
    // Con el margen ya no se gana casi nada: se deja la toma como está.
    return (rect.x1 - rect.x0) * (rect.y1 - rect.y0) > MAX_AREA ? null : rect;
}

/**
 * Recorte de una toma de la cámara al papel, sin consumirla (dibuja una copia pequeña).
 * @returns {{crop:{sx:number, sy:number, sw:number, sh:number}, area:number}|null}
 */
export function cropShotToPaper(shot, { doc = globalThis.document } = {}) {
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
    const rect = detectPaper(ctx.getImageData(0, 0, w, h));
    if (!rect) return null;
    const sx = crop.sx + Math.round(rect.x0 * crop.sw);
    const sy = crop.sy + Math.round(rect.y0 * crop.sh);
    const sw = Math.min(crop.sx + crop.sw - sx, Math.round((rect.x1 - rect.x0) * crop.sw));
    const sh = Math.min(crop.sy + crop.sh - sy, Math.round((rect.y1 - rect.y0) * crop.sh));
    return { crop: { sx, sy, sw, sh }, area: (rect.x1 - rect.x0) * (rect.y1 - rect.y0) };
}
