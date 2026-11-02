/**
 * Recorte automático del fondo: busca el papel (la zona clara sobre un fondo más
 * oscuro) y recorta alrededor con margen. Es conservador: ante la duda NO recorta,
 * porque cortar un dato de la factura es peor que dejar un poco de mesa.
 */
import { detectPaper, cropShotToPaper, PAPER_MARGIN } from '../modules/features/pettycash/PettyCashPaperCrop.js';

const W = 240;
const H = 320;
const make = (fn) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    return { data, width: W, height: H };
};
// Texto: renglones oscuros cada 8 px dentro del papel.
const inside = (x, y, r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const paperOn = (bg, rect, paper = 225) => make((x, y) => {
    if (!inside(x, y, rect)) return bg;
    return (y % 8 < 2 && x % 5 < 3) ? 40 : paper;
});
const PAPER = { x0: 70, y0: 60, x1: 170, y1: 260 };      // 100 × 200 de 240 × 320 ≈ 26 % del cuadro

describe('detectPaper', () => {
    test('papel claro con texto sobre una mesa oscura: devuelve su rectángulo con un margen', () => {
        const r = detectPaper(paperOn(40, PAPER));
        expect(r).not.toBeNull();
        const m = PAPER_MARGIN;
        expect(r.x0).toBeLessThanOrEqual(70 / W);
        expect(r.x0).toBeGreaterThan(70 / W - 0.12);
        expect(r.y0).toBeLessThanOrEqual(60 / H);
        expect(r.x1).toBeGreaterThanOrEqual(170 / W);
        expect(r.y1).toBeGreaterThanOrEqual(260 / H);
        expect(r.x1 - r.x0).toBeLessThan(0.75);
        expect(m).toBeGreaterThan(0);
    });
    test('el margen es generoso: ningún borde del papel queda dentro del recorte', () => {
        const r = detectPaper(paperOn(40, PAPER));
        expect(r.x0 * W).toBeLessThan(70 - 2);
        expect(r.y0 * H).toBeLessThan(60 - 2);
        expect(r.x1 * W).toBeGreaterThan(170 + 2);
        expect(r.y1 * H).toBeGreaterThan(260 + 2);
    });
    test('si el papel ocupa casi todo el cuadro no hay nada que recortar', () => {
        expect(detectPaper(paperOn(40, { x0: 4, y0: 4, x1: 236, y1: 316 }))).toBeNull();
    });
    test('una imagen toda clara (factura blanca sobre mesa blanca) no se recorta', () => {
        expect(detectPaper(make(() => 230))).toBeNull();
        expect(detectPaper(paperOn(215, PAPER, 235))).toBeNull();        // poco contraste entre papel y mesa
    });
    test('una imagen toda oscura no se recorta', () => {
        expect(detectPaper(make(() => 40))).toBeNull();
    });
    test('un papel muy pequeño en el cuadro (menos del 12 %) se considera dudoso y no se recorta', () => {
        expect(detectPaper(paperOn(40, { x0: 100, y0: 130, x1: 130, y1: 170 }))).toBeNull();
    });
    test('una mancha clara aislada que no es un papel (luz) no se recorta', () => {
        const spot = make((x, y) => (Math.hypot(x - 60, y - 60) < 25 ? 240 : 40));
        expect(detectPaper(spot)).toBeNull();
    });
    test('un papel con una zona oscura (sombra) igual se recorta sin cortarlo', () => {
        const shaded = make((x, y) => {
            if (!inside(x, y, PAPER)) return 40;
            if (y > 200 && x < 130) return 110;                  // sombra sobre una esquina del papel
            return (y % 8 < 2 && x % 5 < 3) ? 40 : 225;
        });
        const r = detectPaper(shaded);
        expect(r === null || (r.x0 * W < 70 && r.y0 * H < 60 && r.x1 * W > 170 && r.y1 * H > 260)).toBe(true);
    });
    test('datos inválidos no rompen', () => {
        expect(detectPaper(null)).toBeNull();
        expect(detectPaper({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toBeNull();
    });
});

describe('cropShotToPaper', () => {
    const shotWith = (img) => {
        const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: jest.fn(), getImageData: () => img }) }) };
        return { doc, shot: { source: { width: 3000, height: 4000, close: jest.fn() }, crop: { sx: 100, sy: 200, sw: 2400, sh: 3200 } } };
    };
    test('traduce el rectángulo del papel al recorte de la toma, sin salirse de ella', () => {
        const { doc, shot } = shotWith(paperOn(40, PAPER));
        const out = cropShotToPaper(shot, { doc });
        expect(out).not.toBeNull();
        const { crop } = out;
        expect(crop.sx).toBeGreaterThanOrEqual(shot.crop.sx);
        expect(crop.sy).toBeGreaterThanOrEqual(shot.crop.sy);
        expect(crop.sx + crop.sw).toBeLessThanOrEqual(shot.crop.sx + shot.crop.sw);
        expect(crop.sy + crop.sh).toBeLessThanOrEqual(shot.crop.sy + shot.crop.sh);
        expect(crop.sw).toBeLessThan(shot.crop.sw);
        expect(Number.isInteger(crop.sx) && Number.isInteger(crop.sy) && Number.isInteger(crop.sw) && Number.isInteger(crop.sh)).toBe(true);
        expect(out.area).toBeGreaterThan(0.2);
        expect(out.area).toBeLessThan(0.9);
        expect(shot.source.close).not.toHaveBeenCalled();
    });
    test('si no hay papel claro o la toma no se puede medir, devuelve null', () => {
        expect(cropShotToPaper(shotWith(make(() => 230)).shot, { doc: shotWith(make(() => 230)).doc })).toBeNull();
        expect(cropShotToPaper({ source: new Blob(['x']), crop: { sx: 0, sy: 0, sw: 1, sh: 1 } }, { doc: document })).toBeNull();
        expect(cropShotToPaper(null)).toBeNull();
    });
});
