/**
 * Imagen que se manda al lector de facturas. Con 1600 px y calidad 0.82 se perdía
 * la letra pequeña (montos y totales mal leídos): ahora se manda más grande y
 * con más calidad, sin agrandar nunca una foto chica.
 */
import { compressImage, OCR_MAX_WIDTH, OCR_QUALITY } from '../modules/features/pettycash/PettyCashPhoto.js';

const setup = (width, height) => {
    const calls = { draw: null, toDataURL: null, size: null };
    global.createImageBitmap = jest.fn().mockResolvedValue({ width, height, close: jest.fn() });
    const canvas = {
        set width(v) { this._w = v; }, get width() { return this._w; },
        set height(v) { this._h = v; }, get height() { return this._h; },
        getContext: () => ({ drawImage: (...args) => { calls.draw = args; } }),
        toDataURL: (type, quality) => { calls.toDataURL = [type, quality]; calls.size = [canvas.width, canvas.height]; return 'data:image/jpeg;base64,AAAA'; }
    };
    jest.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag)));
    return calls;
};
afterEach(() => { jest.restoreAllMocks(); delete global.createImageBitmap; });

describe('compressImage (lo que ve el lector)', () => {
    test('los valores por defecto son 2400 px y calidad 0.9', () => {
        expect(OCR_MAX_WIDTH).toBe(2400);
        expect(OCR_QUALITY).toBe(0.9);
    });
    test('una foto de 3000 px de ancho se reduce a 2400 y sale en JPEG de calidad 0.9', async () => {
        const calls = setup(3000, 4000);
        const url = await compressImage(new Blob(['x'], { type: 'image/webp' }));
        expect(url.startsWith('data:image/jpeg')).toBe(true);
        expect(calls.size).toEqual([2400, 3200]);
        expect(calls.toDataURL).toEqual(['image/jpeg', 0.9]);
    });
    test('una foto más chica no se agranda', async () => {
        const calls = setup(1200, 1600);
        await compressImage(new Blob(['x'], { type: 'image/jpeg' }));
        expect(calls.size).toEqual([1200, 1600]);
    });
    test('una factura larga unida (ancho normal, mucha altura) conserva su altura', async () => {
        const calls = setup(2400, 9000);
        await compressImage(new Blob(['x'], { type: 'image/jpeg' }));
        expect(calls.size).toEqual([2400, 9000]);
    });
    test('si el resultado es demasiado grande para el servidor, se reduce una vez más', async () => {
        const calls = setup(2400, 20000);
        const big = 'data:image/jpeg;base64,' + 'A'.repeat(9_500_000);
        const seen = [];
        const canvas = document.createElement('canvas');
        canvas.toDataURL = (type, q) => { seen.push([canvas.width, canvas.height, q]); return seen.length === 1 ? big : 'data:image/jpeg;base64,BBBB'; };
        const url = await compressImage(new Blob(['x'], { type: 'image/jpeg' }));
        expect(seen).toHaveLength(2);
        expect(seen[1][0]).toBeLessThan(seen[0][0]);
        expect(seen[1][2]).toBeLessThan(seen[0][2]);
        expect(url).toBe('data:image/jpeg;base64,BBBB');
        expect(calls.draw).not.toBeNull();
    });
    test('los parámetros se pueden indicar (la miniatura sigue usando los suyos)', async () => {
        const calls = setup(3000, 3000);
        await compressImage(new Blob(['x']), 480, 0.5);
        expect(calls.size).toEqual([480, 480]);
        expect(calls.toDataURL[1]).toBe(0.5);
    });
});
