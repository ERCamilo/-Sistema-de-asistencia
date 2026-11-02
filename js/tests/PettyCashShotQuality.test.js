/**
 * Aviso de foto borrosa u oscura en el momento de disparar. Las imágenes son
 * sintéticas (texto de trazos finos sobre papel) para probar la medición sin un teléfono.
 */
import { measureShot, assessShot, assessCapturedShot, BLURRY_BELOW, DARK_BELOW, FLAT_BELOW, QUALITY_SIZE } from '../modules/features/pettycash/PettyCashShotQuality.js';

const W = 480;
const H = 640;
const make = (fn) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fn(x, y); const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    return { data, width: W, height: H };
};
// Renglones de caracteres de 6x9 px con trazos de 2 px, como una factura vista a 480 px.
const text = (x, y) => {
    const row = Math.floor(y / 16); const yy = y % 16;
    if (yy < 3 || yy > 11) return 235;
    const cx = x % 7; const seed = (Math.floor(x / 7) * 31 + row * 17) % 7;
    const stroke = cx < 2 || ((yy >= 6 && yy < 8) && cx < 6) || (seed < 3 && cx >= 4 && cx < 6);
    return cx < 6 && stroke ? 30 : 235;
};
const blur = (img, passes) => {
    const { data, width, height } = img;
    let src = Float32Array.from({ length: width * height }, (_, p) => data[p * 4]);
    for (let k = 0; k < passes; k++) {
        const dst = new Float32Array(src.length);
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * width + x + dx];
            dst[y * width + x] = s / 9;
        }
        src = dst;
    }
    const out = new Uint8ClampedArray(data.length);
    for (let p = 0; p < src.length; p++) { out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = src[p]; out[p * 4 + 3] = 255; }
    return { data: out, width, height };
};
const verdict = (img) => assessShot(measureShot(img));
const sharp = make(text);

describe('measureShot y assessShot', () => {
    test('una factura nítida y bien iluminada está bien', () => {
        const m = measureShot(sharp);
        expect(m.sharpness).toBeGreaterThan(0.5);
        expect(m.brightness).toBeGreaterThan(150);
        expect(verdict(sharp)).toEqual({ ok: true, issues: [], hint: null });
    });
    test('un poco de suavizado (foto normal reducida) no genera aviso', () => {
        expect(verdict(blur(sharp, 1)).ok).toBe(true);
    });
    test('borrosa: avisa y dice qué hacer', () => {
        const out = verdict(blur(sharp, 4));
        expect(out.ok).toBe(false);
        expect(out.issues).toEqual(['blurry']);
        expect(out.hint).toMatch(/borrosa/);
        expect(out.hint).toMatch(/repít/);
    });
    test('oscura: avisa de la poca luz antes que de lo borroso', () => {
        const dark = make((x, y) => text(x, y) * 0.2);
        const out = verdict(dark);
        expect(out.issues).toEqual(['dark']);
        expect(out.hint).toMatch(/luz/);
    });
    test('sin contraste (papel en blanco o fuera de foco total): lo dice', () => {
        const out = verdict(make(() => 200));
        expect(out.issues).toEqual(['flat']);
        expect(out.hint).toMatch(/contraste/);
    });
    test('un patrón muy fino de 1 px no se confunde con borroso', () => {
        expect(verdict(make((x, y) => ((x + y) % 2 ? 60 : 230))).ok).toBe(true);
    });
    test('datos inválidos no rompen y no avisan nada raro', () => {
        expect(measureShot(null)).toEqual({ sharpness: 0, brightness: 0, contrast: 0 });
        expect(measureShot({ data: new Uint8ClampedArray(4), width: 1, height: 1 })).toEqual({ sharpness: 0, brightness: 0, contrast: 0 });
        expect(assessShot(null).issues.length).toBeLessThanOrEqual(1);
    });
    test('los umbrales son los documentados', () => {
        expect(BLURRY_BELOW).toBe(0.25);
        expect(DARK_BELOW).toBe(65);
        expect(FLAT_BELOW).toBe(30);
        expect(QUALITY_SIZE).toBe(480);
    });
});

describe('assessCapturedShot', () => {
    const shotWith = (img) => {
        const draws = [];
        const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...a) => draws.push(a), getImageData: () => img }) }) };
        return { doc, draws, shot: { source: { width: 4000, height: 3000, close: jest.fn() }, crop: { sx: 100, sy: 50, sw: 2000, sh: 3000 } } };
    };
    test('mide una copia pequeña y NO cierra la toma (se necesita después para guardarla)', () => {
        const { doc, draws, shot } = shotWith(blur(sharp, 4));
        const out = assessCapturedShot(shot, { doc });
        expect(out.assessment.issues).toEqual(['blurry']);
        expect(shot.source.close).not.toHaveBeenCalled();
        expect(draws[0].slice(1, 5)).toEqual([100, 50, 2000, 3000]);   // dibuja solo el recorte
    });
    test('una toma que es un archivo (Blob) no se puede medir y no se avisa', () => {
        expect(assessCapturedShot({ source: new Blob(['x']), crop: { sx: 0, sy: 0, sw: 1, sh: 1 } }, { doc: document })).toBeNull();
        expect(assessCapturedShot(new Blob(['x']), { doc: document })).toBeNull();
        expect(assessCapturedShot(null)).toBeNull();
    });
});
