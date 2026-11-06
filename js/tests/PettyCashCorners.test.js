/**
 * Esquinas de la factura puestas a mano: punto de partida, validez del cuadrilátero y qué pasa
 * con los recuadros de los datos (lector y marcas del usuario) cuando la foto se endereza.
 */
import {
    defaultCorners, isValidQuad, moveCorner, mapBoxesThroughQuad, stagedBoxes, boxesForDisplay, applyStagedBoxes, startingCorners
} from '../modules/features/pettycash/PettyCashCorners.js';

const unit = [[0, 0], [1, 0], [1, 1], [0, 1]];

describe('defaultCorners / startingCorners', () => {
    test('el cuadrilátero de partida es un rectángulo un poco hacia adentro, en orden TL, TR, BR, BL', () => {
        const q = defaultCorners();
        expect(q).toHaveLength(4);
        expect(q[0][0]).toBeGreaterThan(0);
        expect(q[0][0]).toBeLessThan(0.15);
        expect(q[0][0]).toBeLessThan(q[1][0]);
        expect(q[0][1]).toBeLessThan(q[3][1]);
        expect(isValidQuad(q)).toBe(true);
    });
    test('usa las esquinas que detecta el enderezado automático, con su margen', () => {
        const found = { corners: [[0.2, 0.1], [0.8, 0.12], [0.82, 0.9], [0.18, 0.88]] };
        const out = startingCorners({ analyze: () => found, detect: () => null });
        expect(out.source).toBe('quad');
        expect(out.corners[0][0]).toBeLessThan(0.2);         // con margen hacia afuera
        expect(isValidQuad(out.corners)).toBe(true);
    });
    test('si no, usa el rectángulo del recorte; si tampoco, el de partida', () => {
        const rect = startingCorners({ analyze: () => ({ reason: 'curved' }), detect: () => ({ x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95 }) });
        expect(rect.source).toBe('rect');
        expect(rect.corners).toEqual([[0.1, 0.05], [0.9, 0.05], [0.9, 0.95], [0.1, 0.95]]);
        const none = startingCorners({ analyze: () => ({ reason: 'no-paper' }), detect: () => null });
        expect(none.source).toBe('default');
        expect(none.corners).toEqual(defaultCorners());
    });
    test('un error del detector no impide abrir el editor', () => {
        const out = startingCorners({ analyze: () => { throw new Error('boom'); }, detect: () => { throw new Error('boom'); } });
        expect(out.source).toBe('default');
    });
    test('las esquinas siempre quedan dentro de la imagen', () => {
        const out = startingCorners({ analyze: () => ({ corners: [[0.01, 0.01], [0.99, 0.01], [0.99, 0.99], [0.01, 0.99]] }), detect: () => null });
        out.corners.forEach(([x, y]) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); });
    });
});

describe('isValidQuad', () => {
    test('un cuadrilátero convexo y grande es válido', () => {
        expect(isValidQuad([[0.1, 0.1], [0.9, 0.15], [0.85, 0.9], [0.12, 0.85]])).toBe(true);
    });
    test('esquinas cruzadas (no convexo) no valen', () => {
        expect(isValidQuad([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]])).toBe(false);
    });
    test('un cuadrilátero con una esquina hundida (cóncavo) no vale', () => {
        expect(isValidQuad([[0.1, 0.1], [0.9, 0.1], [0.5, 0.4], [0.1, 0.9]])).toBe(false);
    });
    test('demasiado pequeño no vale', () => {
        expect(isValidQuad([[0.4, 0.4], [0.45, 0.4], [0.45, 0.45], [0.4, 0.45]])).toBe(false);
    });
    test('datos inválidos no vale (ni revienta)', () => {
        expect(isValidQuad(null)).toBe(false);
        expect(isValidQuad([[0, 0]])).toBe(false);
        expect(isValidQuad([[NaN, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
    });
});

describe('moveCorner', () => {
    const q = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
    test('mueve solo la esquina elegida y devuelve una copia', () => {
        const out = moveCorner(q, 2, { x: 0.8, y: 0.95 });
        expect(out[2]).toEqual([0.8, 0.95]);
        expect(out[0]).toEqual(q[0]);
        expect(q[2]).toEqual([0.9, 0.9]);
    });
    test('no se sale de la imagen', () => {
        expect(moveCorner(q, 0, { x: -0.5, y: 1.5 })[0]).toEqual([0, 1]);
    });
    test('un índice inválido no cambia nada', () => {
        expect(moveCorner(q, 7, { x: 0.5, y: 0.5 })).toEqual(q);
    });
});

describe('mapBoxesThroughQuad: los recuadros siguen sobre su dato en la foto enderezada', () => {
    test('con el cuadrilátero igual a la imagen entera no cambian', () => {
        const out = mapBoxesThroughQuad({ total: [790, 300, 850, 700] }, unit);
        expect(out.total).toEqual([790, 300, 850, 700]);
    });
    test('recortar la mitad de arriba acerca el dato: sube y se hace más alto', () => {
        // La imagen nueva es la mitad de abajo: y' = (y - 0.5) / 0.5
        const quad = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
        const out = mapBoxesThroughQuad({ total: [700, 200, 800, 600] }, quad);
        expect(out.total).toEqual([400, 200, 600, 600]);
    });
    test('un cuadrilátero girado: el recuadro es la caja que contiene al dato girado', () => {
        const quad = [[0.1, 0], [1, 0.1], [0.9, 1], [0, 0.9]];            // papel ligeramente girado
        const out = mapBoxesThroughQuad({ ncf: [450, 450, 550, 550] }, quad);
        const [y0, x0, y1, x1] = out.ncf;
        expect(y0).toBeGreaterThan(300);
        expect(y1).toBeLessThan(700);
        expect(x0).toBeLessThan(500);
        expect(x1).toBeGreaterThan(500);
        expect(y1 - y0).toBeGreaterThanOrEqual(100);                       // la caja de un recuadro girado no es más chica que el original
    });
    test('un recuadro que queda fuera de la foto nueva se descarta', () => {
        const quad = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
        const out = mapBoxesThroughQuad({ fecha: [50, 100, 120, 300], total: [700, 200, 800, 600] }, quad);
        expect(out.fecha).toBeUndefined();
        expect(out.total).toBeDefined();
    });
    test('uno que queda a medias fuera se descarta; uno casi todo dentro se recorta al borde', () => {
        const quad = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];
        expect(mapBoxesThroughQuad({ a: [350, 100, 600, 500] }, quad).a).toBeUndefined();             // 60 % de su alto fuera
        const edge = mapBoxesThroughQuad({ b: [480, 100, 600, 500] }, quad).b;                          // solo 17 % fuera
        expect(edge[0]).toBe(0);
    });
    test('todos los resultados son recuadros válidos (0–1000, y0<y1, x0<x1)', () => {
        const quad = [[0.05, 0.05], [0.95, 0.1], [0.9, 0.95], [0.1, 0.9]];
        const boxes = { total: [790, 300, 850, 700], subtotal: [10, 10, 60, 400], rncEmisor: [900, 900, 999, 999] };
        Object.values(mapBoxesThroughQuad(boxes, quad)).forEach((b) => {
            expect(b.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)).toBe(true);
            expect(b[0]).toBeLessThan(b[2]);
            expect(b[1]).toBeLessThan(b[3]);
        });
    });
    test('recuadros inválidos o sin datos no revientan', () => {
        expect(mapBoxesThroughQuad(null, unit)).toEqual({});
        expect(mapBoxesThroughQuad({ total: 'x', itbis: [1, 2] }, unit)).toEqual({});
        expect(mapBoxesThroughQuad({ total: [10, 10, 20, 20] }, [[0, 0], [0, 0], [0, 0], [0, 0]])).toEqual({});
    });
});

describe('stagedBoxes / boxesForDisplay / applyStagedBoxes', () => {
    const mov = {
        id: 'g1',
        ocrBoxes: { total: [700, 200, 800, 600], fecha: [50, 100, 120, 300] },
        manualBoxes: { ncf: [800, 100, 900, 500] }
    };
    const quad = [[0, 0.5], [1, 0.5], [1, 1], [0, 1]];

    test('stagedBoxes calcula los recuadros de la foto nueva sin tocar el gasto', () => {
        const staged = stagedBoxes(mov, quad);
        expect(staged.ocrBoxes.total).toEqual([400, 200, 600, 600]);
        expect(staged.ocrBoxes.fecha).toBeUndefined();
        expect(staged.manualBoxes.ncf).toBeDefined();
        expect(mov.ocrBoxes.fecha).toEqual([50, 100, 120, 300]);        // el original no se toca
    });
    test('boxesForDisplay muestra los de la foto nueva sin mutar el gasto, y sin staged no cambia nada', () => {
        const staged = stagedBoxes(mov, quad);
        const shown = boxesForDisplay(mov, staged);
        expect(shown.ocrBoxes).toEqual(staged.ocrBoxes);
        expect(shown).not.toBe(mov);
        expect(mov.ocrBoxes.fecha).toBeDefined();
        expect(boxesForDisplay(mov, null)).toBe(mov);
    });
    test('applyStagedBoxes los escribe al guardar y quita los que ya no existen', () => {
        const copy = JSON.parse(JSON.stringify(mov));
        applyStagedBoxes(copy, stagedBoxes(mov, quad));
        expect(copy.ocrBoxes).toEqual({ total: [400, 200, 600, 600] });
        expect(copy.manualBoxes.ncf).toBeDefined();
        const none = JSON.parse(JSON.stringify(mov));
        applyStagedBoxes(none, { ocrBoxes: {}, manualBoxes: {} });
        expect(none.ocrBoxes).toBeUndefined();
        expect(none.manualBoxes).toBeUndefined();
    });
    test('un gasto sin recuadros da recuadros vacíos', () => {
        expect(stagedBoxes({ id: 'x' }, quad)).toEqual({ ocrBoxes: {}, manualBoxes: {} });
    });
});
