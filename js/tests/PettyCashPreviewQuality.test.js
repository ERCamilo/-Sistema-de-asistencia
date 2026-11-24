/**
 * Vista previa guardada en el teléfono (lista, pila de la cámara y respaldo cuando la foto
 * original ya se subió): más grande y nítida que la miniatura de 480 px a calidad 0.5,
 * en WebP cuando el navegador lo sabe hacer para que no pese más.
 */
import { createReceiptPreview, downscaleDataUrl, PREVIEW_MAX_DIM, PREVIEW_QUALITY } from '../modules/features/pettycash/PettyCashPhoto.js';
import { CAMERA_V21 } from '../modules/features/pettycash/PettyCashCameraProfile.js';

const setup = ({ webp = true, width = 2200, height = 3900 } = {}) => {
    const calls = [];
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: (type, q) => {
            calls.push({ type, q, size: [canvas.width, canvas.height] });
            const out = type === 'image/webp' && !webp ? 'image/png' : type;
            return `data:${out};base64,AAAA`;
        }
    };
    jest.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag)));
    global.createImageBitmap = jest.fn().mockResolvedValue({ width, height, close: jest.fn() });
    global.Image = class {
        constructor() { this.naturalWidth = width; this.naturalHeight = height; }
        set src(_) { setTimeout(() => this.onload?.(), 0); }
    };
    return calls;
};
const realImage = global.Image;
afterEach(() => { jest.restoreAllMocks(); delete global.createImageBitmap; global.Image = realImage; });

describe('vista previa de la factura', () => {
    test('por defecto (cámara 2.0): 480 px, JPEG a 0.5, como siempre', async () => {
        expect(PREVIEW_MAX_DIM).toBe(480);
        expect(PREVIEW_QUALITY).toBe(0.5);
        const calls = setup();
        const out = await createReceiptPreview(new File(['x'], 'f.webp', { type: 'image/webp' }));
        expect(out.previewDataUrl.startsWith('data:image/jpeg')).toBe(true);
        expect(calls.at(-1)).toMatchObject({ type: 'image/jpeg', q: 0.5 });
        expect(Math.max(...calls.at(-1).size)).toBe(480);
    });
    test('cámara 2.1: 720 px en WebP a 0.7, y lo del lector a 2800 px', async () => {
        const calls = setup({ width: 3500, height: 4000 });
        const out = await createReceiptPreview(new File(['x'], 'f.webp', { type: 'image/webp' }), { preview: CAMERA_V21.preview, ocrMaxWidth: 2800 });
        expect(out.previewDataUrl.startsWith('data:image/webp')).toBe(true);
        expect(calls[0].size).toEqual([2800, 3200]);
        const last = calls.at(-1);
        expect(Math.max(...last.size)).toBe(720);
        expect(last).toMatchObject({ type: 'image/webp', q: 0.7 });
    });
    test('si el navegador no codifica WebP, sale en JPEG', async () => {
        const calls = setup({ webp: false });
        const out = await downscaleDataUrl('data:image/jpeg;base64,BIG', 720, 0.7, { webp: true });
        expect(out.startsWith('data:image/jpeg')).toBe(true);
        expect(calls.at(-1).type).toBe('image/jpeg');
    });
    test('la poda tras subir (480 px, 0.5) sigue en JPEG', async () => {
        const calls = setup();
        await downscaleDataUrl('data:image/jpeg;base64,BIG', 480, 0.5);
        expect(Math.max(...calls.at(-1).size)).toBe(480);
        expect(calls.at(-1)).toMatchObject({ type: 'image/jpeg', q: 0.5 });
    });
});
