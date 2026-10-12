/**
 * Factura larga por partes: buscar dónde se repite la franja de la parte
 * anterior en la siguiente (para alinear en vivo y para unir sin duplicar).
 */
import { planStitch, judgeAlignment, findBand } from '../modules/features/pettycash/PettyCashStitch.js';

// "Factura" sintética: cada fila tiene un patrón distinto y no se repite (renglones de texto).
const W = 24;
const receipt = (rows) => {
    const px = new Uint8Array(W * rows);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < W; x++) {
            const h = Math.imul(y * 131 + 7, 2654435761) ^ Math.imul(x * 17 + 3, 40503);
            const ink = ((h >>> 7) % 7 < 3) && (y % 5 !== 0);
            px[y * W + x] = ink ? 40 : 230;
        }
    }
    return px;
};
const slice = (px, from, rows) => px.slice(from * W, (from + rows) * W);

describe('planStitch', () => {
    test('recorta de cada parte la franja repetida', () => {
        // Tres partes de 100 filas; la franja de la anterior aparece en y=4 y y=0.
        const plan = planStitch([100, 100, 100], [{ y: 4, band: 12 }, { y: 0, band: 12 }]);
        expect(plan.slices).toEqual([
            { part: 0, from: 0, rows: 100 },
            { part: 1, from: 16, rows: 84 },
            { part: 2, from: 12, rows: 88 }
        ]);
        expect(plan.height).toBe(272);
    });

    test('sin coincidencia confiable: asume la franja arriba (como guía el visor)', () => {
        const plan = planStitch([100, 100], [null], { band: 12 });
        expect(plan.slices[1]).toEqual({ part: 1, from: 12, rows: 88 });
    });
});

describe('findBand: dónde se ve el final de la parte anterior (correlación, tolera luz y corrimiento)', () => {
    const doc = receipt(200);
    const band = { gray: slice(doc, 100, 12), rows: 12, width: W };

    test('la encuentra donde está', () => {
        const r = findBand(band, slice(doc, 90, 60), 60);
        expect(r.found).toBe(true);
        expect(r.y).toBe(10);
        expect(r.ncc).toBeGreaterThan(0.95);
    });

    test('con otro contraste y brillo (la cámara ajustó la exposición)', () => {
        const live = slice(doc, 90, 60).map(v => Math.round(128 + (v - 128) * 0.6 + 15));
        const r = findBand(band, live, 60);
        expect(r.found).toBe(true);
        expect(r.y).toBe(10);
    });

    test('con el teléfono corrido un poco de lado', () => {
        const base = slice(doc, 90, 60);
        const shifted = new Uint8Array(base.length).fill(230);
        for (let y = 0; y < 60; y++) for (let x = 0; x < W - 2; x++) shifted[y * W + x + 2] = base[y * W + x];
        const r = findBand(band, shifted, 60);
        expect(r.found).toBe(true);
        expect(r.y).toBe(10);
        expect(r.dx).toBe(2);
    });

    test('si no está, no la encuentra', () => {
        expect(findBand(band, slice(doc, 130, 60), 60).found).toBe(false);
    });
});

describe('judgeAlignment (en vivo): qué decirle a quien toma la foto', () => {
    const doc = receipt(200);
    const band = { gray: slice(doc, 100, 12), rows: 12, width: W };

    test('en la mitad de arriba: hay traslape, se puede tomar (no hace falta exactitud)', () => {
        const r = judgeAlignment(band, slice(doc, 90, 60), 60);
        expect(r).toMatchObject({ status: 'ok', aligned: true });
        expect(r.yFrac).toBeCloseTo(10 / 60, 2);
    });

    test('todavía abajo: sigue bajando', () => {
        const r = judgeAlignment(band, slice(doc, 60, 60), 60);
        expect(r).toMatchObject({ status: 'below', aligned: false });
    });

    test('ya no se ve: te pasaste (quedaría un hueco)', () => {
        expect(judgeAlignment(band, slice(doc, 130, 60), 60)).toMatchObject({ status: 'lost', aligned: false });
    });

    test('una franja sin texto (papel en blanco) nunca se da por buena', () => {
        const flat = new Uint8Array(W * 12).fill(230);
        const r = judgeAlignment({ gray: flat, rows: 12, width: W }, new Uint8Array(W * 40).fill(228), 40);
        expect(r).toMatchObject({ aligned: false, flat: true, status: 'flat' });
    });

    test('dibujos que no cambian de renglón a renglón (solo columnas) tampoco sirven', () => {
        const columns = (rows) => new Uint8Array(W * rows).map((_, i) => ((i % W) < 6 ? 40 : 230));
        const r = judgeAlignment({ gray: columns(12), rows: 12, width: W }, columns(40), 40);
        expect(r).toMatchObject({ aligned: false, flat: true });
    });
});

describe('franjas ambiguas', () => {
    test('una franja que coincide igual en varias alturas (patrón repetido) no se da por buena', () => {
        const stripes = (rows) => {
            const px = new Uint8Array(W * rows);
            for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) px[y * W + x] = (y % 4 < 2) ? 40 : 230;
            return px;
        };
        const r = judgeAlignment({ gray: stripes(12), rows: 12, width: W }, stripes(40), 40);
        expect(r.aligned).toBe(false);
        expect(r.status).toBe('unsure');
    });
});
