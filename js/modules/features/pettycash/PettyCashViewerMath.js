/**
 * Zoom y desplazamiento de la foto de la factura (funciones puras).
 *
 * La foto se muestra ajustada al ancho de la ventana (escala 1) y se mueve con
 * `translate(x, y) scale(s)`. `win` es la ventana ({w, h}) y `content` la foto a
 * escala 1 ({w, h}). Los recuadros del lector vienen en 0–1000 ([y0, x0, y1, x1]).
 * Probado en js/tests/PettyCashViewerMath.test.js.
 */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const STEP = 1.4;
const BOX_FILL_W = 0.7;     // el recuadro ocupa hasta el 70 % del ancho de la ventana
const BOX_FILL_H = 0.45;    // y hasta el 45 % de su alto
const BOX_MAX_SCALE = 4.5;  // tampoco se acerca más que esto solo por enfocar un dato

/** Lo más lejos que se puede alejar: la factura entera (sin agrandarla ni pasar de 0.15). */
export function minScale(win, content) {
    return Math.max(0.15, Math.min(1, win.h / content.h, win.w / content.w));
}

/**
 * Lo más cerca que se puede acercar: hasta que cada píxel real de la foto
 * ocupe dos de pantalla. Una miniatura permite menos acercamiento útil, pero
 * siempre se puede mirar un poco más de cerca.
 */
export function maxScale({ winW, naturalW, dpr = 1 }) {
    const perDevicePixel = (Number(naturalW) || 0) / ((Number(winW) || 1) * (Number(dpr) || 1));
    return clamp(perDevicePixel * 2, 3, 10);
}

/** Escala dentro del rango y foto sin salirse: si es más chica que la ventana se centra. */
export function clampView(view, win, content, limits) {
    const s = clamp(view.s, limits.min, limits.max);
    const axis = (pos, winSize, contentSize) => {
        const size = contentSize * s;
        return size <= winSize ? (winSize - size) / 2 : clamp(pos, winSize - size, 0);
    };
    return { s, x: axis(view.x, win.w, content.w), y: axis(view.y, win.h, content.h) };
}

/** Cambia la escala dejando fijo el punto de la pantalla `point` (lo que está bajo el dedo). */
export function zoomAt(view, factor, point, win, content, limits) {
    const s = clamp(view.s * factor, limits.min, limits.max);
    const ratio = s / view.s;
    return clampView({ s, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, win, content, limits);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Pellizco: `start` es la vista al apoyar los dos dedos, `from` y `to` sus posiciones al inicio y ahora. */
export function pinchView(start, from, to, win, content, limits) {
    const d0 = dist(from[0], from[1]);
    const ratio = d0 > 1 ? dist(to[0], to[1]) / d0 : 1;
    const s = clamp(start.s * ratio, limits.min, limits.max);
    const m0 = mid(from[0], from[1]);
    const m1 = mid(to[0], to[1]);
    const cx = (m0.x - start.x) / start.s;
    const cy = (m0.y - start.y) / start.s;
    return clampView({ s, x: m1.x - cx * s, y: m1.y - cy * s }, win, content, limits);
}

/** Acerca (sin alejarse de la escala 1) y centra el recuadro de un dato. */
export function viewForBox(box, win, content, limits) {
    const [y0, x0, y1, x1] = box;
    const bw = Math.max(1, ((x1 - x0) / 1000) * content.w);
    const bh = Math.max(1, ((y1 - y0) / 1000) * content.h);
    const raw = Math.min((win.w * BOX_FILL_W) / bw, (win.h * BOX_FILL_H) / bh);
    const s = clamp(raw, 1, Math.min(limits.max, BOX_MAX_SCALE));
    const cx = ((x0 + x1) / 2 / 1000) * content.w;
    const cy = ((y0 + y1) / 2 / 1000) * content.h;
    return clampView({ s, x: win.w / 2 - cx * s, y: win.h / 2 - cy * s }, win, content, limits);
}

/** Ajustada al ancho, desde arriba. */
export const fitWidthView = () => ({ s: 1, x: 0, y: 0 });

/** La factura entera, centrada. */
export function fitAllView(win, content, limits) {
    return clampView({ s: minScale(win, content), x: 0, y: 0 }, win, content, limits);
}

/** Botones + y −: un paso hacia adentro (dir > 0) o hacia afuera. */
export function zoomStep(view, dir, point, win, content, limits) {
    return zoomAt(view, dir > 0 ? STEP : 1 / STEP, point, win, content, limits);
}
