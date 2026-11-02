/**
 * Enderezar la factura: encontrar las cuatro esquinas del papel y volver a dibujarlo como
 * rectángulo. Es CONSERVADOR: ante la duda devuelve null (se queda la foto como salió), y si
 * el papel ya está recto no se remuestrea (re-muestrear suaviza el texto).
 */
import {
    homography, applyH, detectQuad, analyzeQuad, expandQuad, quadOutputSize, warpImage, warpImageAsync,
    straightenShotToPaper, straightenCanvas,
    STRAIGHTEN_MARGIN, STRAIGHTEN_MAX_SIDE, MAX_SKEW_DEG
} from '../modules/features/pettycash/PettyCashPaperStraighten.js';

const W = 240;
const H = 320;
const make = (fn) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    return { data, width: W, height: H };
};

/** Textura del papel en coordenadas propias (u,v de 0 a 1): renglones oscuros y un cuadro negro de referencia. */
const texture = (u, v) => {
    if (u > 0.2 && u < 0.3 && v > 0.7 && v < 0.8) return 0;                  // marca
    if (u > 0.1 && u < 0.9 && v > 0.05 && v < 0.6 && Math.floor(v * 80) % 4 === 0) return 40;   // renglones
    return 225;
};

/** Papel rotado `deg` grados alrededor del centro, sobre una mesa oscura. */
const rotatedPaper = (deg, { pw = 110, ph = 200, bg = 40, cx = 120, cy = 160 } = {}) => {
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t); const sin = Math.sin(t);
    return make((x, y) => {
        const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
        const u = (dx * cos + dy * sin) / pw + 0.5;
        const v = (-dx * sin + dy * cos) / ph + 0.5;
        return (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? texture(u, v) : bg;
    });
};

/** Papel en perspectiva: el cuadrilátero `quad` (TL,TR,BR,BL en píxeles) con la misma textura. */
const trapezoidPaper = (quad, bg = 40) => {
    const toUnit = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return make((x, y) => {
        const [u, v] = applyH(toUnit, x + 0.5, y + 0.5);
        return (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? texture(u, v) : bg;
    });
};

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const px = (c) => [c[0] * W, c[1] * H];

describe('homography', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const quad = [[12, 7], [95, 20], [88, 130], [3, 101]];
    test('lleva cada esquina de origen a su esquina de destino', () => {
        const h = homography(square, quad);
        square.forEach((p, i) => {
            const [x, y] = applyH(h, p[0], p[1]);
            expect(x).toBeCloseTo(quad[i][0], 6);
            expect(y).toBeCloseTo(quad[i][1], 6);
        });
    });
    test('mismo cuadrilátero: es la identidad', () => {
        const h = homography(quad, quad);
        const [x, y] = applyH(h, 40, 60);
        expect(x).toBeCloseTo(40, 6);
        expect(y).toBeCloseTo(60, 6);
    });
    test('la inversa deshace la ida', () => {
        const there = homography(square, quad);
        const back = homography(quad, square);
        const [x, y] = applyH(there, 3.5, 6.25);
        const [bx, by] = applyH(back, x, y);
        expect(bx).toBeCloseTo(3.5, 5);
        expect(by).toBeCloseTo(6.25, 5);
    });
    test('puntos degenerados (todos iguales) no revientan: devuelve null', () => {
        expect(homography([[1, 1], [1, 1], [1, 1], [1, 1]], square)).toBeNull();
    });
});

describe('detectQuad', () => {
    test('papel girado 12°: encuentra las cuatro esquinas y mide la inclinación', () => {
        const q = detectQuad(rotatedPaper(12));
        expect(q).not.toBeNull();
        expect(q.straight).toBe(false);
        expect(q.skewDeg).toBeGreaterThan(9);
        expect(q.skewDeg).toBeLessThan(15);
        // esquinas reales del papel
        const t = (12 * Math.PI) / 180;
        const corner = (su, sv) => [120 + su * 55 * Math.cos(t) - sv * 100 * Math.sin(t), 160 + su * 55 * Math.sin(t) + sv * 100 * Math.cos(t)];
        const expected = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        q.corners.forEach((c, i) => {
            const [x, y] = px(c);
            expect(near(x, expected[i][0], 4)).toBe(true);
            expect(near(y, expected[i][1], 4)).toBe(true);
        });
    });
    test('girado hacia el otro lado también (−9°)', () => {
        const q = detectQuad(rotatedPaper(-9));
        expect(q).not.toBeNull();
        expect(q.straight).toBe(false);
        // la esquina superior izquierda queda arriba y a la izquierda de la superior derecha
        expect(q.corners[0][0]).toBeLessThan(q.corners[1][0]);
        expect(q.corners[0][1]).toBeLessThan(q.corners[3][1]);
    });
    test('papel en perspectiva (más ancho abajo): se detecta como no recto', () => {
        const q = detectQuad(trapezoidPaper([[75, 50], [165, 50], [190, 280], [50, 280]]));
        expect(q).not.toBeNull();
        expect(q.straight).toBe(false);
        expect(q.perspective).toBeGreaterThan(1.3);
    });
    test('papel ya recto: se reconoce como recto y no hay que remuestrear', () => {
        const q = detectQuad(rotatedPaper(0));
        expect(q).not.toBeNull();
        expect(q.straight).toBe(true);
        expect(detectQuad(rotatedPaper(1.5)).straight).toBe(true);        // una inclinación mínima no vale una remuestra
    });
    test('el ruido claro suelto no confunde: manda el papel más grande', () => {
        const base = rotatedPaper(10);
        const noisy = { ...base, data: base.data.slice() };
        for (let y = 5; y < 12; y++) for (let x = 5; x < 12; x++) { const i = (y * W + x) * 4; noisy.data[i] = noisy.data[i + 1] = noisy.data[i + 2] = 250; }
        const q = detectQuad(noisy);
        expect(q).not.toBeNull();
        expect(q.corners[0][0] * W).toBeGreaterThan(40);
    });
    test('la corrección tiene tope: un papel girado más de lo razonable no se toca', () => {
        expect(MAX_SKEW_DEG).toBeLessThanOrEqual(45);
        expect(detectQuad(rotatedPaper(60))).toBeNull();
    });
    test('ante la duda devuelve null', () => {
        expect(detectQuad(make(() => 230))).toBeNull();                                  // blanco sobre blanco
        expect(detectQuad(make(() => 40))).toBeNull();                                   // todo oscuro
        expect(detectQuad(rotatedPaper(10, { bg: 215 }))).toBeNull();                    // poco contraste
        expect(detectQuad(make((x, y) => (Math.hypot(x - 120, y - 160) < 70 ? 235 : 40)))).toBeNull();   // mancha de luz redonda
        expect(detectQuad(rotatedPaper(10, { pw: 30, ph: 40 }))).toBeNull();            // papel diminuto
        expect(detectQuad(null)).toBeNull();
        expect(detectQuad({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toBeNull();
    });
    test('un papel cortado por el borde del cuadro no se endereza (las esquinas no están a la vista)', () => {
        expect(detectQuad(rotatedPaper(12, { pw: 260, ph: 400 }))).toBeNull();
        expect(detectQuad(rotatedPaper(10, { pw: 200, ph: 400, cx: 120, cy: 160 }))).toBeNull();
    });
});

describe('analyzeQuad: por qué no se endereza', () => {
    const reason = (img) => analyzeQuad(img).reason;
    test('cada descarte tiene un motivo corto, para calibrar con uso real', () => {
        expect(reason(make(() => 230))).toBe('no-paper');
        expect(reason(make(() => 40))).toBe('no-paper');
        expect(reason(rotatedPaper(12, { pw: 260, ph: 400 }))).toBe('cut-off');
        expect(reason(rotatedPaper(10, { pw: 30, ph: 40 }))).toBe('size');
        expect(reason(rotatedPaper(60))).toBe('landscape');
        expect(reason(make((x, y) => (Math.hypot(x - 120, y - 160) < 70 ? 235 : 40)))).toBeDefined();   // mancha redonda: alguno
        expect(reason(trapezoidPaper([[110, 50], [130, 50], [215, 290], [25, 290]]))).toBe('perspective');
    });
    test('un papel recto sale con su motivo y sin descartar la medición', () => {
        const r = analyzeQuad(rotatedPaper(0));
        expect(r.reason).toBeUndefined();
        expect(r.straight).toBe(true);
    });
    test('detectQuad sigue devolviendo solo esquinas o null', () => {
        expect(detectQuad(make(() => 230))).toBeNull();
        expect(detectQuad(rotatedPaper(12)).corners).toHaveLength(4);
    });
});

describe('expandQuad y tamaño de salida', () => {
    const quad = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]];
    test('el margen aleja cada esquina del centro, sin deformar', () => {
        const out = expandQuad(quad, 0.1);
        expect(out[0][0]).toBeLessThan(0.3);
        expect(out[0][1]).toBeLessThan(0.2);
        expect(out[2][0]).toBeGreaterThan(0.7);
        expect(out[2][1]).toBeGreaterThan(0.8);
        expect((out[1][0] - out[0][0]) / (out[3][1] - out[0][1])).toBeCloseTo((0.4) / (0.6), 6);
    });
    test('margen 0: igual', () => {
        expect(expandQuad(quad, 0)).toEqual(quad);
    });
    test('el tamaño de salida es el de los lados más largos y no pasa del tope', () => {
        const size = quadOutputSize([[0, 0], [100, 0], [100, 300], [0, 300]], 2400);
        expect(size).toEqual({ w: 100, h: 300 });
        const big = quadOutputSize([[0, 0], [3000, 0], [3000, 4000], [0, 4000]], STRAIGHTEN_MAX_SIDE);
        expect(Math.max(big.w, big.h)).toBe(STRAIGHTEN_MAX_SIDE);
        expect(big.w / big.h).toBeCloseTo(0.75, 2);
        const tilted = quadOutputSize([[10, 0], [110, 20], [100, 320], [0, 300]], 2400);
        expect(tilted.w).toBeGreaterThanOrEqual(100);
        expect(tilted.h).toBeGreaterThanOrEqual(300);
    });
    test('el margen por defecto es el mismo que usa el recorte recto o más chico', () => {
        expect(STRAIGHTEN_MARGIN).toBeGreaterThan(0);
        expect(STRAIGHTEN_MARGIN).toBeLessThanOrEqual(0.1);
    });
});

describe('warpImage', () => {
    const toPixels = (q) => q.map(([x, y]) => [x * W, y * H]);
    // oscuros por fila en la salida: con el papel recto, los renglones son filas casi completas
    const rowContrast = (out, w, h) => {
        const dark = [];
        for (let y = 0; y < h; y++) {
            let n = 0;
            for (let x = Math.round(w * 0.15); x < Math.round(w * 0.85); x++) if (out[(y * w + x) * 4] < 120) n++;
            dark.push(n / (w * 0.7));
        }
        const crisp = dark.filter((d) => d > 0.8).length;
        const blank = dark.filter((d) => d < 0.1).length;
        return { crisp, blank, total: h };
    };

    test('papel girado: tras enderezar, los renglones quedan horizontales y la marca en su sitio', () => {
        const img = rotatedPaper(14);
        const q = detectQuad(img);
        const corners = toPixels(q.corners);
        const { w, h } = quadOutputSize(corners, 2400);
        const out = warpImage(img, corners, w, h);
        expect(out.length).toBe(w * h * 4);
        // la marca negra (u .2–.3, v .7–.8) cae donde le toca, dentro de unos pocos píxeles
        let sx = 0; let sy = 0; let n = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[(y * w + x) * 4] < 20) { sx += x; sy += y; n++; }
        expect(n).toBeGreaterThan(20);
        expect(near(sx / n / w, 0.25, 0.04)).toBe(true);
        expect(near(sy / n / h, 0.75, 0.04)).toBe(true);
        // y los renglones son filas nítidas, no manchas diagonales
        const c = rowContrast(out, w, h);
        expect(c.crisp).toBeGreaterThan(h * 0.08);
        expect(c.blank).toBeGreaterThan(h * 0.3);
        // sin enderezar (solo recortando la caja que contiene al papel torcido) los renglones se manchan
        const xs = corners.map((p) => p[0]); const ys = corners.map((p) => p[1]);
        const box = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
        const sized = quadOutputSize(box, 2400);
        const crooked = rowContrast(warpImage(img, box, sized.w, sized.h), sized.w, sized.h);
        expect(c.crisp / h).toBeGreaterThan((crooked.crisp / sized.h) * 2);
    });

    test('papel en perspectiva: la marca y las proporciones se recuperan', () => {
        const quad = [[75, 50], [165, 50], [190, 280], [50, 280]];
        const img = trapezoidPaper(quad);
        const q = detectQuad(img);
        const corners = toPixels(q.corners);
        const { w, h } = quadOutputSize(corners, 2400);
        const out = warpImage(img, corners, w, h);
        let sx = 0; let sy = 0; let n = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[(y * w + x) * 4] < 20) { sx += x; sy += y; n++; }
        expect(n).toBeGreaterThan(10);
        expect(near(sx / n / w, 0.25, 0.05)).toBe(true);
        expect(near(sy / n / h, 0.75, 0.05)).toBe(true);
    });

    test('fuera de la imagen se repite el borde, no se pinta negro ni NaN', () => {
        const img = make(() => 200);
        const out = warpImage(img, [[-30, -30], [W + 30, -30], [W + 30, H + 30], [-30, H + 30]], 20, 20);
        expect(Array.from(out).every((v) => v === 200 || v === 255)).toBe(true);
    });

    test('por tramos da lo mismo que de una vez, y cede el hilo entre tramos', async () => {
        const img = rotatedPaper(8);
        const corners = toPixels(detectQuad(img).corners);
        const { w, h } = quadOutputSize(corners, 2400);
        const whole = warpImage(img, corners, w, h);
        const yields = jest.fn(() => Promise.resolve());
        const parts = await warpImageAsync(img, corners, w, h, { rowsPerChunk: 16, yieldFn: yields });
        expect(Array.from(parts)).toEqual(Array.from(whole));
        expect(yields.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(h / 16) - 1);
    });
});

describe('straightenShotToPaper', () => {
    const shotWith = (img) => {
        const ctx = { drawImage: jest.fn(), getImageData: () => img };
        const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
        return { doc, shot: { source: { width: 3000, height: 4000, close: jest.fn() }, crop: { sx: 100, sy: 200, sw: 2400, sh: 3200 } } };
    };
    test('papel torcido: devuelve un recorte dentro de la toma y las esquinas relativas a ese recorte', () => {
        const { doc, shot } = shotWith(rotatedPaper(12));
        const out = straightenShotToPaper(shot, { doc });
        expect(out).not.toBeNull();
        const { crop, quad } = out;
        expect(crop.sx).toBeGreaterThanOrEqual(shot.crop.sx);
        expect(crop.sy).toBeGreaterThanOrEqual(shot.crop.sy);
        expect(crop.sx + crop.sw).toBeLessThanOrEqual(shot.crop.sx + shot.crop.sw);
        expect(crop.sy + crop.sh).toBeLessThanOrEqual(shot.crop.sy + shot.crop.sh);
        expect(Number.isInteger(crop.sx + crop.sy + crop.sw + crop.sh)).toBe(true);
        expect(quad).toHaveLength(4);
        // las esquinas (0–1 del recorte) pueden quedar un poco fuera por el margen, pero cerca
        quad.forEach(([x, y]) => { expect(x).toBeGreaterThan(-0.2); expect(x).toBeLessThan(1.2); expect(y).toBeGreaterThan(-0.2); expect(y).toBeLessThan(1.2); });
        expect(out.skewDeg).toBeGreaterThan(9);
        expect(shot.source.close).not.toHaveBeenCalled();
    });
    test('papel recto, sin papel o toma ilegible: null (no se remuestrea) y se avisa por qué', () => {
        const a = shotWith(rotatedPaper(0));
        const onDecline = jest.fn();
        expect(straightenShotToPaper(a.shot, { doc: a.doc, onDecline })).toBeNull();
        expect(onDecline).toHaveBeenLastCalledWith('straight');
        const b = shotWith(make(() => 230));
        expect(straightenShotToPaper(b.shot, { doc: b.doc, onDecline })).toBeNull();
        expect(onDecline).toHaveBeenLastCalledWith('no-paper');
        expect(straightenShotToPaper(b.shot, { doc: b.doc })).toBeNull();          // sin callback también funciona
        expect(straightenShotToPaper({ source: new Blob(['x']), crop: { sx: 0, sy: 0, sw: 1, sh: 1 } }, { doc: document })).toBeNull();
        expect(straightenShotToPaper(null)).toBeNull();
    });
});

describe('straightenCanvas', () => {
    const fakeCanvas = (img) => ({
        width: img.width, height: img.height,
        getContext: () => ({ getImageData: () => img, putImageData: jest.fn(), drawImage: jest.fn() })
    });
    const makeDoc = () => {
        const made = [];
        return {
            made,
            createElement: () => {
                const ctx = { putImageData: jest.fn(), drawImage: jest.fn(), getImageData: jest.fn() };
                const c = { width: 0, height: 0, getContext: () => ctx, ctx };
                made.push(c);
                return c;
            }
        };
    };
    test('dibuja el papel enderezado en un lienzo nuevo del tamaño de los lados y no toca el original', async () => {
        const img = rotatedPaper(10);
        const q = detectQuad(img);
        const doc = makeDoc();
        const canvas = fakeCanvas(img);
        const out = await straightenCanvas(canvas, q.corners, { doc, yieldFn: async () => {} });
        expect(out).toBe(doc.made[0]);
        expect(out.width).toBeGreaterThan(80);
        expect(out.height).toBeGreaterThan(out.width);
        expect(out.ctx.putImageData).toHaveBeenCalledTimes(1);
        const [placed] = out.ctx.putImageData.mock.calls[0];
        expect(placed.width).toBe(out.width);
        expect(placed.height).toBe(out.height);
    });
    test('el tope de tamaño se respeta (la foto enderezada no sale más chica que la normal)', async () => {
        const big = { width: 1300, height: 3000, getContext: () => ({ getImageData: () => rotatedPaper(10) }) };
        const doc = makeDoc();
        // esquinas que ocupan todo el lienzo grande: el lado largo debe poder llegar a 3000
        const out = await straightenCanvas(big, [[0, 0], [1, 0], [1, 1], [0, 1]], { doc, maxSide: 3000, yieldFn: async () => {}, rowsPerChunk: 4000 });
        expect(Math.max(out.width, out.height)).toBe(3000);
    });
    test('sin esquinas válidas devuelve null', async () => {
        const out = await straightenCanvas(fakeCanvas(rotatedPaper(10)), null, { doc: makeDoc(), yieldFn: async () => {} });
        expect(out).toBeNull();
    });
});
