/**
 * Factura larga por partes: buscar dónde se repite la franja de la parte
 * anterior en la siguiente (para alinear en vivo y para unir sin duplicar).
 */
import { matchBand, planStitch, judgeAlignment, MATCH_MAX_SCORE } from '../modules/features/pettycash/PettyCashStitch.js';

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
const brighter = (px, d) => px.map(v => Math.min(255, v + d));

describe('matchBand', () => {
    const doc = receipt(200);

    test('encuentra la franja exactamente donde está', () => {
        const band = slice(doc, 90, 12);
        const next = slice(doc, 70, 80);
        const r = matchBand(band, 12, next, 80, W, 60);
        expect(r.y).toBe(20);
        expect(r.score).toBeLessThan(1);
    });

    test('tolera un cambio de brillo entre una foto y otra', () => {
        const band = slice(doc, 90, 12);
        const next = brighter(slice(doc, 85, 80), 18);
        const r = matchBand(band, 12, next, 80, W, 60);
        expect(r.y).toBe(5);
        expect(r.score).toBeLessThan(MATCH_MAX_SCORE);
    });

    test('si la franja no está, el puntaje lo dice', () => {
        const band = slice(doc, 10, 12);
        const other = new Uint8Array(W * 80).map((_, i) => (i * 37) % 251);
        expect(matchBand(band, 12, other, 80, W, 60).score).toBeGreaterThan(MATCH_MAX_SCORE);
    });
});

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

describe('judgeAlignment (en vivo)', () => {
    const doc = receipt(200);

    test('alineado cuando la franja está arriba del todo', () => {
        const band = slice(doc, 100, 12);
        expect(judgeAlignment({ gray: band, rows: 12, width: W }, slice(doc, 100, 40), 40).aligned).toBe(true);
    });

    test('no alineado si la franja quedó más abajo', () => {
        const band = slice(doc, 100, 12);
        const r = judgeAlignment({ gray: band, rows: 12, width: W }, slice(doc, 80, 40), 40);
        expect(r.aligned).toBe(false);
        expect(r.y).toBe(20);
    });

    test('una franja sin texto (papel en blanco) nunca se da por alineada', () => {
        const flat = new Uint8Array(W * 12).fill(230);
        const r = judgeAlignment({ gray: flat, rows: 12, width: W }, new Uint8Array(W * 40).fill(228), 40);
        expect(r.aligned).toBe(false);
        expect(r.flat).toBe(true);
    });

    test('dibujos que no cambian de renglón a renglón (solo columnas) tampoco sirven para alinear', () => {
        const columns = (rows) => new Uint8Array(W * rows).map((_, i) => ((i % W) < 6 ? 40 : 230));
        const r = judgeAlignment({ gray: columns(12), rows: 12, width: W }, columns(40), 40);
        expect(r.aligned).toBe(false);
        expect(r.flat).toBe(true);
    });
});

describe('franjas ambiguas', () => {
    test('una franja que coincide igual en varias alturas (patrón repetido) no se da por alineada', () => {
        const stripes = (rows) => {
            const px = new Uint8Array(W * rows);
            for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) px[y * W + x] = (y % 4 < 2) ? 40 : 230;
            return px;
        };
        const r = judgeAlignment({ gray: stripes(12), rows: 12, width: W }, stripes(40), 40);
        expect(r.aligned).toBe(false);
        expect(r.ambiguous).toBe(true);
    });
});
