/**
 * Recuadros de la foto en escala 0–1000 ([y0, x0, y1, x1]), la misma que usa el
 * lector de facturas. Trazar uno nuevo, moverlo y cambiarle el tamaño; un
 * recuadro puesto a mano (`manualBoxes`) manda sobre el del lector (`ocrBoxes`).
 * Probado en js/tests/PettyCashBoxMath.test.js.
 */
export const MIN_BOX = 12;
const SCALE = 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function isValidBox(box) {
    return Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(n) && n >= 0 && n <= SCALE)
        && box[0] < box[2] && box[1] < box[3];
}

/** Recuadro de un dato: el puesto a mano, si no el del lector, si no ninguno. */
export function effectiveBox(movement, key) {
    const manual = movement?.manualBoxes?.[key];
    if (isValidBox(manual)) return { box: manual.slice(), source: 'manual' };
    const ocr = movement?.ocrBoxes?.[key];
    if (isValidBox(ocr)) return { box: ocr.slice(), source: 'ocr' };
    return null;
}

const toScale = (value, size) => Math.round(clamp(value / size, 0, 1) * SCALE);

/** Recuadro trazado de un punto a otro (coordenadas de pantalla) sobre la imagen `rect`. */
export function boxFromDrag(a, b, rect) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    const x0 = toScale(Math.min(a.x, b.x) - rect.left, rect.width);
    const x1 = toScale(Math.max(a.x, b.x) - rect.left, rect.width);
    const y0 = toScale(Math.min(a.y, b.y) - rect.top, rect.height);
    const y1 = toScale(Math.max(a.y, b.y) - rect.top, rect.height);
    return x1 - x0 >= MIN_BOX && y1 - y0 >= MIN_BOX ? [y0, x0, y1, x1] : null;
}

/** Desplaza el recuadro dx, dy píxeles sin salirse de la imagen ni cambiar su tamaño. */
export function moveBox(box, dx, dy, rect) {
    const [y0, x0, y1, x1] = box;
    const h = y1 - y0;
    const w = x1 - x0;
    const ny0 = clamp(Math.round(y0 + (dy / rect.height) * SCALE), 0, SCALE - h);
    const nx0 = clamp(Math.round(x0 + (dx / rect.width) * SCALE), 0, SCALE - w);
    return [ny0, nx0, ny0 + h, nx0 + w];
}

/** Mueve la esquina inferior derecha: el tamaño nunca baja del mínimo ni pasa de la imagen. */
export function resizeBox(box, dx, dy, rect) {
    const [y0, x0, y1, x1] = box;
    const ny1 = clamp(Math.round(y1 + (dy / rect.height) * SCALE), y0 + MIN_BOX, SCALE);
    const nx1 = clamp(Math.round(x1 + (dx / rect.width) * SCALE), x0 + MIN_BOX, SCALE);
    return [y0, x0, ny1, nx1];
}
