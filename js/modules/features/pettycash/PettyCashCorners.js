/**
 * Esquinas de la factura puestas a mano (editor de esquinas): de dónde parten, cuándo el
 * cuadrilátero es válido y qué pasa con los recuadros de los datos al enderezar la foto.
 *
 * Los recuadros (`ocrBoxes` del lector y `manualBoxes` del usuario) están en escala 0–1000
 * sobre la foto vieja: al enderezar hay que pasarlos por la misma transformación o quedarían
 * sobre el dato equivocado. Los que ya no caben en la foto nueva se descartan.
 *
 * Todo puro; probado en js/tests/PettyCashCorners.test.js.
 */
import { homography, applyH, expandQuad, STRAIGHTEN_MARGIN } from './PettyCashPaperStraighten.js';
import { isValidBox } from './PettyCashBoxMath.js';

const INSET = 0.06;               // partida: rectángulo un poco hacia adentro
const MIN_QUAD_AREA = 0.05;       // el cuadrilátero debe cubrir al menos esto de la foto
const MIN_SIDE = 0.05;            // y cada lado medir al menos esto
const MIN_INSIDE = 0.5;           // un recuadro se conserva si al menos esto de su área cae en la foto nueva
const SCALE = 1000;

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const pt = ([x, y]) => [clamp01(x), clamp01(y)];

export function defaultCorners() {
    return [[INSET, INSET], [1 - INSET, INSET], [1 - INSET, 1 - INSET], [INSET, 1 - INSET]];
}

/**
 * Esquinas de partida: las del enderezado automático (con su margen), si no el rectángulo del
 * recorte, si no un rectángulo hacia adentro. Los detectores se inyectan (cada uno devuelve su
 * resultado sobre una copia pequeña de la foto) y un fallo nunca impide abrir el editor.
 * @returns {{corners:number[][], source:'quad'|'rect'|'default'}}
 */
export function startingCorners({ analyze = () => null, detect = () => null } = {}) {
    try {
        const found = analyze();
        if (found && Array.isArray(found.corners)) {
            const corners = expandQuad(found.corners, STRAIGHTEN_MARGIN).map(pt);
            if (isValidQuad(corners)) return { corners, source: 'quad' };
        }
    } catch (_) { /* se prueba con lo siguiente */ }
    try {
        const rect = detect();
        if (rect) {
            const corners = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]].map(pt);
            if (isValidQuad(corners)) return { corners, source: 'rect' };
        }
    } catch (_) { /* se usa el de partida */ }
    return { corners: defaultCorners(), source: 'default' };
}

const edge = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Cuatro esquinas (TL, TR, BR, BL en 0–1) que forman un cuadrilátero convexo y no diminuto. */
export function isValidQuad(corners) {
    if (!Array.isArray(corners) || corners.length !== 4) return false;
    if (!corners.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
        const a = corners[i]; const b = corners[(i + 1) % 4]; const c = corners[(i + 2) % 4];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cross) < 1e-9) return false;
        const s = cross > 0 ? 1 : -1;
        if (sign && s !== sign) return false;
        sign = s;
    }
    let area = 0;
    for (let i = 0; i < 4; i++) { const p = corners[i]; const q = corners[(i + 1) % 4]; area += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(area) / 2 < MIN_QUAD_AREA) return false;
    return corners.every((p, i) => edge(p, corners[(i + 1) % 4]) >= MIN_SIDE);
}

/** Copia de las esquinas con la `index` movida a `point` ({x,y} en 0–1), sin salirse de la foto. */
export function moveCorner(corners, index, point) {
    const next = corners.map((p) => p.slice());
    if (!Number.isInteger(index) || index < 0 || index > 3 || !point) return next;
    next[index] = [clamp01(point.x), clamp01(point.y)];
    return next;
}

/**
 * Pasa recuadros [y0,x0,y1,x1] (0–1000 de la foto vieja) a la foto enderezada: cada esquina
 * del recuadro por la transformación y, de lo que resulta, la caja que lo contiene, recortada
 * a la foto. Se descarta el recuadro si menos de la mitad de su área queda dentro.
 * @param {Object<string, number[]>} boxes
 * @param {number[][]} quad esquinas (TL, TR, BR, BL en 0–1) de la foto vieja que forman la nueva
 */
export function mapBoxesThroughQuad(boxes, quad) {
    const out = {};
    if (!boxes || typeof boxes !== 'object') return out;
    const h = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    if (!h || !h.every(Number.isFinite)) return out;
    for (const [key, box] of Object.entries(boxes)) {
        if (!isValidBox(box)) continue;
        const [y0, x0, y1, x1] = box.map((n) => n / SCALE);
        const mapped = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => applyH(h, x, y));
        if (!mapped.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
        const us = mapped.map((p) => p[0]); const vs = mapped.map((p) => p[1]);
        const u0 = Math.min(...us); const u1 = Math.max(...us); const v0 = Math.min(...vs); const v1 = Math.max(...vs);
        const area = (u1 - u0) * (v1 - v0);
        if (!(area > 0)) continue;
        const cu0 = clamp01(u0); const cu1 = clamp01(u1); const cv0 = clamp01(v0); const cv1 = clamp01(v1);
        if (!(cu1 > cu0) || !(cv1 > cv0) || ((cu1 - cu0) * (cv1 - cv0)) / area < MIN_INSIDE) continue;
        const result = [cv0, cu0, cv1, cu1].map((n) => Math.round(n * SCALE));
        if (isValidBox(result)) out[key] = result;
    }
    return out;
}

/** Recuadros de la foto nueva; el gasto no se toca (se escriben al guardar, ver `applyStagedBoxes`). */
export function stagedBoxes(movement, quad) {
    return {
        ocrBoxes: mapBoxesThroughQuad(movement?.ocrBoxes, quad),
        manualBoxes: mapBoxesThroughQuad(movement?.manualBoxes, quad)
    };
}

/** El gasto tal como se ve con la foto nueva (copia); sin foto nueva, el mismo gasto. */
export function boxesForDisplay(movement, staged) {
    return staged ? { ...movement, ocrBoxes: staged.ocrBoxes, manualBoxes: staged.manualBoxes } : movement;
}

/** Escribe en el gasto los recuadros de la foto nueva; los vacíos se quitan. */
export function applyStagedBoxes(movement, staged) {
    if (!movement || !staged) return movement;
    for (const key of ['ocrBoxes', 'manualBoxes']) {
        if (staged[key] && Object.keys(staged[key]).length) movement[key] = staged[key];
        else delete movement[key];
    }
    return movement;
}
