/**
 * Vista previa guardada en el teléfono (lista, pila de la cámara y respaldo cuando la foto
 * original ya se subió): más grande y nítida que la miniatura de 480 px a calidad 0.5,
 * en WebP cuando el navegador lo sabe hacer para que no pese más.
 */
import { createReceiptPreview, downscaleDataUrl, PREVIEW_MAX_DIM, PREVIEW_QUALITY } from '../modules/features/pettycash/PettyCashPhoto.js';

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
    test('720 px de lado largo y calidad 0.7', () => {
        expect(PREVIEW_MAX_DIM).toBe(720);
        expect(PREVIEW_QUALITY).toBe(0.7);
    });
    test('createReceiptPreview guarda la vista previa a 720 px en WebP', async () => {
        const calls = setup();
        const out = await createReceiptPreview(new File(['x'], 'f.webp', { type: 'image/webp' }));
        expect(out.previewDataUrl.startsWith('data:image/webp')).toBe(true);
        const last = calls.at(-1);
        expect(Math.max(...last.size)).toBe(720);
        expect(last).toMatchObject({ type: 'image/webp', q: 0.7 });
    });
    test('sin WebP en el navegador, sale en JPEG', async () => {
        const calls = setup({ webp: false });
        const out = await downscaleDataUrl('data:image/jpeg;base64,BIG', 720, 0.7);
        expect(out.startsWith('data:image/jpeg')).toBe(true);
        expect(calls.at(-1).type).toBe('image/jpeg');
    });
    test('la poda tras subir (480 px, 0.5) sigue funcionando igual', async () => {
        const calls = setup();
        await downscaleDataUrl('data:image/jpeg;base64,BIG', 480, 0.5);
        expect(Math.max(...calls.at(-1).size)).toBe(480);
        expect(calls.at(-1).q).toBe(0.5);
    });
});
