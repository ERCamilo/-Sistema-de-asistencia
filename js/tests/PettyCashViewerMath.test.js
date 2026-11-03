/**
 * Zoom y desplazamiento de la foto de la factura: límites, acercar sin que se
 * mueva lo que está bajo el dedo, pellizco y enfoque a un recuadro.
 */
import {
    minScale, maxScale, clampView, zoomAt, pinchView, viewForBox, fitWidthView, fitAllView, zoomStep
} from '../modules/features/pettycash/PettyCashViewerMath.js';

const win = { w: 390, h: 300 };
const content = { w: 390, h: 1000 };            // una factura alta, ajustada al ancho
const limits = { min: 0.3, max: 6 };

describe('límites de escala', () => {
    test('el mínimo deja ver la factura entera (alejar), nunca más grande que ajustada al ancho', () => {
        expect(minScale(win, content)).toBeCloseTo(0.3, 5);
        expect(minScale({ w: 390, h: 2000 }, content)).toBe(1);   // cabe de sobra: no se agranda al alejar
        expect(minScale({ w: 390, h: 5 }, content)).toBeGreaterThanOrEqual(0.15);
    });
    test('el máximo depende de los píxeles reales de la foto, no de un número fijo', () => {
        const hi = maxScale({ winW: 390, naturalW: 3000, dpr: 3 });  // foto grande
        const lo = maxScale({ winW: 390, naturalW: 480, dpr: 3 });   // miniatura
        expect(hi).toBeGreaterThan(lo);
        expect(lo).toBeGreaterThanOrEqual(3);                        // siempre se puede acercar un poco
        expect(hi).toBeLessThanOrEqual(10);
    });
});

describe('clampView', () => {
    test('no deja perder la imagen: los bordes se pegan a la ventana', () => {
        expect(clampView({ s: 2, x: 500, y: 500 }, win, content, limits)).toEqual({ s: 2, x: 0, y: 0 });
        const v = clampView({ s: 2, x: -9999, y: -9999 }, win, content, limits);
        expect(v.x).toBe(390 - 390 * 2);
        expect(v.y).toBe(300 - 1000 * 2);
    });
    test('si la imagen es más chica que la ventana en un eje, se centra', () => {
        const v = clampView({ s: 0.3, x: 0, y: 0 }, win, content, limits);
        expect(v.x).toBeCloseTo((390 - 390 * 0.3) / 2, 5);
        expect(v.y).toBeCloseTo(0, 5);   // 1000 * 0.3 = 300 = alto de la ventana
    });
    test('la escala se limita al rango', () => {
        expect(clampView({ s: 99, x: 0, y: 0 }, win, content, limits).s).toBe(6);
        expect(clampView({ s: 0.01, x: 0, y: 0 }, win, content, limits).s).toBe(0.3);
    });
});

describe('zoomAt', () => {
    test('el punto bajo el dedo no se mueve al acercar', () => {
        const before = { s: 1, x: 0, y: -200 };
        const point = { x: 200, y: 100 };
        const after = zoomAt(before, 2, point, win, content, limits);
        // coordenada de contenido bajo el punto, antes y después
        const under = (v) => ({ cx: (point.x - v.x) / v.s, cy: (point.y - v.y) / v.s });
        expect(under(after).cx).toBeCloseTo(under(before).cx, 5);
        expect(under(after).cy).toBeCloseTo(under(before).cy, 5);
        expect(after.s).toBe(2);
    });
    test('alejar llega al mínimo y se detiene', () => {
        let v = { s: 1, x: 0, y: 0 };
        for (let i = 0; i < 20; i++) v = zoomAt(v, 0.5, { x: 100, y: 100 }, win, content, limits);
        expect(v.s).toBe(0.3);
    });
});

describe('pellizco con dos dedos', () => {
    test('separar los dedos acerca, juntarlos aleja, y mover los dedos desplaza', () => {
        const start = { s: 1, x: 0, y: 0 };
        const a = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
        const apart = pinchView(start, a, [{ x: 50, y: 100 }, { x: 250, y: 100 }], win, content, limits);
        expect(apart.s).toBeCloseTo(2, 5);
        const together = pinchView({ s: 2, x: -100, y: -100 }, a, [{ x: 125, y: 100 }, { x: 175, y: 100 }], win, content, limits);
        expect(together.s).toBeLessThan(2);
        const moved = pinchView({ s: 2, x: -100, y: -100 }, a, [{ x: 100, y: 150 }, { x: 200, y: 150 }], win, content, limits);
        expect(moved.s).toBe(2);
        expect(moved.y).toBe(-50);
    });
    test('dedos en el mismo punto no rompen nada', () => {
        const same = [{ x: 10, y: 10 }, { x: 10, y: 10 }];
        const v = pinchView({ s: 1, x: 0, y: 0 }, same, same, win, content, limits);
        expect(Number.isFinite(v.s) && Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    });
});

describe('viewForBox', () => {
    test('centra el recuadro y lo acerca para leerlo', () => {
        const box = [790, 300, 850, 700];       // [y0,x0,y1,x1] en 0–1000
        const v = viewForBox(box, win, content, limits);
        const cx = ((300 + 700) / 2 / 1000) * content.w;
        const cy = ((790 + 850) / 2 / 1000) * content.h;
        expect(v.s).toBeGreaterThan(1);
        expect(v.x + cx * v.s).toBeCloseTo(win.w / 2, 0);
        expect(v.y + cy * v.s).toBeCloseTo(win.h / 2, 0);
    });
    test('un recuadro enorme no se acerca de más; uno pequeño no pasa del máximo', () => {
        const big = viewForBox([0, 0, 1000, 1000], win, content, limits);
        expect(big.s).toBeLessThanOrEqual(1.0001);
        const tiny = viewForBox([500, 500, 505, 505], win, content, limits);
        expect(tiny.s).toBeLessThanOrEqual(limits.max);
    });
    test('un recuadro pegado al borde no deja espacio vacío', () => {
        const v = viewForBox([5, 5, 40, 200], win, content, limits);
        expect(v.x).toBeLessThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(0);
    });
});

describe('vistas predefinidas y pasos', () => {
    test('ajustar al ancho: arriba a la izquierda a escala 1', () => {
        expect(fitWidthView()).toEqual({ s: 1, x: 0, y: 0 });
    });
    test('ver todo: la factura entera, centrada', () => {
        const v = fitAllView(win, content, limits);
        expect(v.s).toBeCloseTo(0.3, 5);
        expect(v.x).toBeGreaterThan(0);
    });
    test('los botones + y − acercan y alejan por pasos', () => {
        const centre = { x: win.w / 2, y: win.h / 2 };
        const more = zoomStep({ s: 1, x: 0, y: 0 }, 1, centre, win, content, limits);
        const less = zoomStep(more, -1, centre, win, content, limits);
        expect(more.s).toBeGreaterThan(1);
        expect(less.s).toBeCloseTo(1, 5);
    });
});
