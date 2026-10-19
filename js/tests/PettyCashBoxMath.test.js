/**
 * Recuadros de la foto en escala 0–1000 ([y0, x0, y1, x1]): trazar uno nuevo,
 * moverlo y cambiarle el tamaño. Un recuadro puesto a mano manda sobre el del lector.
 */
import { isValidBox, effectiveBox, boxFromDrag, moveBox, resizeBox, MIN_BOX } from '../modules/features/pettycash/PettyCashBoxMath.js';

const rect = { left: 100, top: 50, width: 400, height: 800 };   // la imagen en pantalla

describe('isValidBox', () => {
    test('cuatro números entre 0 y 1000 con el origen antes que el final', () => {
        expect(isValidBox([10, 20, 30, 40])).toBe(true);
        expect(isValidBox([0, 0, 1000, 1000])).toBe(true);
        expect(isValidBox([30, 20, 10, 40])).toBe(false);
        expect(isValidBox([10, 20, 30])).toBe(false);
        expect(isValidBox([10, 20, 30, 1001])).toBe(false);
        expect(isValidBox([10, 20, 30, NaN])).toBe(false);
        expect(isValidBox(null)).toBe(false);
    });
});

describe('effectiveBox', () => {
    const mov = { ocrBoxes: { total: [790, 520, 850, 920], ncf: [100, 100, 150, 500] }, manualBoxes: { total: [700, 500, 760, 900], date: [200, 80, 250, 700] } };
    test('el recuadro a mano gana al del lector; si no hay, vale el del lector; si no, ninguno', () => {
        expect(effectiveBox(mov, 'total')).toEqual({ box: [700, 500, 760, 900], source: 'manual' });
        expect(effectiveBox(mov, 'ncf')).toEqual({ box: [100, 100, 150, 500], source: 'ocr' });
        expect(effectiveBox(mov, 'date')).toEqual({ box: [200, 80, 250, 700], source: 'manual' });
        expect(effectiveBox(mov, 'itbis')).toBeNull();
    });
    test('ignora recuadros mal formados', () => {
        expect(effectiveBox({ manualBoxes: { total: [9, 9, 1, 1] }, ocrBoxes: { total: [10, 20, 30, 40] } }, 'total')).toEqual({ box: [10, 20, 30, 40], source: 'ocr' });
        expect(effectiveBox({}, 'total')).toBeNull();
        expect(effectiveBox(null, 'total')).toBeNull();
    });
});

describe('boxFromDrag', () => {
    test('de un punto a otro de la imagen, en 0–1000 y sin importar la dirección', () => {
        // (200,250) → (300,450) en pantalla = x 25 %–50 %, y 25 %–50 %
        expect(boxFromDrag({ x: 200, y: 250 }, { x: 300, y: 450 }, rect)).toEqual([250, 250, 500, 500]);
        expect(boxFromDrag({ x: 300, y: 450 }, { x: 200, y: 250 }, rect)).toEqual([250, 250, 500, 500]);
    });
    test('lo que se sale de la imagen se recorta a sus bordes', () => {
        expect(boxFromDrag({ x: 50, y: 0 }, { x: 600, y: 900 }, rect)).toEqual([0, 0, 1000, 1000]);
    });
    test('un toque o un trazo diminuto no crea recuadro', () => {
        expect(boxFromDrag({ x: 200, y: 250 }, { x: 201, y: 251 }, rect)).toBeNull();
    });
    test('una imagen sin tamaño no rompe', () => {
        expect(boxFromDrag({ x: 1, y: 1 }, { x: 50, y: 50 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    });
});

describe('moveBox', () => {
    test('se desplaza lo que se arrastró (px → 0–1000)', () => {
        expect(moveBox([250, 250, 500, 500], 40, 80, rect)).toEqual([350, 350, 600, 600]);   // 40/400 = 10 %, 80/800 = 10 %
    });
    test('no sale de la imagen y conserva su tamaño', () => {
        expect(moveBox([250, 250, 500, 500], 1000, 1000, rect)).toEqual([750, 750, 1000, 1000]);
        expect(moveBox([250, 250, 500, 500], -1000, -1000, rect)).toEqual([0, 0, 250, 250]);
    });
});

describe('resizeBox', () => {
    test('la esquina inferior derecha cambia el tamaño', () => {
        expect(resizeBox([250, 250, 500, 500], 40, 80, rect)).toEqual([250, 250, 600, 600]);
    });
    test('no se hace más chico que el mínimo ni sale de la imagen', () => {
        const small = resizeBox([250, 250, 500, 500], -1000, -1000, rect);
        expect(small[2] - small[0]).toBe(MIN_BOX);
        expect(small[3] - small[1]).toBe(MIN_BOX);
        expect(resizeBox([250, 250, 500, 500], 1000, 1000, rect)).toEqual([250, 250, 1000, 1000]);
    });
});
