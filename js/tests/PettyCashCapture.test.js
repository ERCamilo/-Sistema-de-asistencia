/**
 * Captura de la foto de la factura: resolución completa del sensor cuando el
 * navegador lo permite (ImageCapture), recortada a lo que se ve en el visor,
 * y guardada en WebP (más liviano a la misma calidad) con respaldo a JPEG.
 */
import { photoCrop, fitLongSide, encodeImage, capturePhoto, takeShot, renderShot, extensionFor, MAX_PHOTO_LONG_SIDE } from '../modules/features/pettycash/PettyCashCapture.js';

describe('photoCrop: la foto del sensor se recorta a la forma del visor', () => {
    test('misma forma: se usa completa', () => {
        expect(photoCrop(3000, 4000, 1440, 1920)).toEqual({ sx: 0, sy: 0, sw: 3000, sh: 4000 });
    });

    test('sensor 3:4 y visor 9:16: recorta los lados, centrado', () => {
        expect(photoCrop(3000, 4000, 1080, 1920)).toEqual({ sx: 375, sy: 0, sw: 2250, sh: 4000 });
    });

    test('foto más alta que el visor: recorta arriba y abajo', () => {
        expect(photoCrop(3000, 4000, 1080, 1080)).toEqual({ sx: 0, sy: 500, sw: 3000, sh: 3000 });
    });

    test('orientación distinta (foto acostada, visor de pie): no se puede confiar → null', () => {
        expect(photoCrop(4000, 3000, 1080, 1920)).toBeNull();
    });
});

describe('fitLongSide', () => {
    test('reduce hasta el lado largo máximo, sin agrandar', () => {
        expect(fitLongSide(3000, 4000, 3000)).toEqual({ w: 2250, h: 3000 });
        expect(fitLongSide(1080, 1920, 3000)).toEqual({ w: 1080, h: 1920 });
    });
});

const fakeCanvas = (supportsWebp = true) => {
    const calls = [];
    return {
        width: 0, height: 0, calls,
        getContext: () => ({ drawImage: (...a) => calls.push(a), fillRect() {}, set fillStyle(_) {} }),
        toBlob(cb, type, quality) {
            calls.push(['toBlob', type, quality]);
            const out = type === 'image/webp' && !supportsWebp ? 'image/png' : type;
            cb(new Blob(['x'], { type: out }));
        }
    };
};

describe('encodeImage', () => {
    test('WebP cuando el navegador lo sabe codificar', async () => {
        const blob = await encodeImage(fakeCanvas(true), 0.9);
        expect(blob.type).toBe('image/webp');
    });

    test('si no sabe WebP (devuelve otro formato), usa JPEG', async () => {
        const canvas = fakeCanvas(false);
        const blob = await encodeImage(canvas, 0.9);
        expect(blob.type).toBe('image/jpeg');
        expect(canvas.calls.filter(c => c[0] === 'toBlob').map(c => c[1])).toEqual(['image/webp', 'image/jpeg']);
    });

    test('extensión del archivo según el formato', () => {
        expect(extensionFor('image/webp')).toBe('webp');
        expect(extensionFor('image/jpeg')).toBe('jpg');
    });
});

describe('capturePhoto', () => {
    const video = { videoWidth: 1080, videoHeight: 1920 };
    const usedVideo = (canvases) => canvases.some(c => c.calls.some(x => x[0] === video));
    const makeDeps = (over = {}) => {
        const canvases = [];
        return {
            canvases,
            deps: {
                video,
                track: { kind: 'video' },
                makeCanvas: () => { const c = fakeCanvas(true); canvases.push(c); return c; },
                toBitmap: async () => ({ width: 3000, height: 4000, close: jest.fn() }),
                ImageCaptureImpl: class { constructor(t) { this.track = t; } takePhoto() { return Promise.resolve(new Blob(['raw'], { type: 'image/jpeg' })); } },
                ...over
            }
        };
    };

    test('con ImageCapture: foto del sensor, recortada al visor y limitada en tamaño', async () => {
        const { deps, canvases } = makeDeps();
        const blob = await capturePhoto(deps);
        expect(blob.type).toBe('image/webp');
        const canvas = canvases.at(-1);
        expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(MAX_PHOTO_LONG_SIDE);
        expect(canvas.width / canvas.height).toBeCloseTo(1080 / 1920, 2);
        const draw = canvas.calls.find(c => c.length === 9);
        expect(draw.slice(1, 5)).toEqual([375, 0, 2250, 4000]);
    });

    test('sin ImageCapture: toma el cuadro del video', async () => {
        const { deps, canvases } = makeDeps({ ImageCaptureImpl: undefined });
        const blob = await capturePhoto(deps);
        expect(blob.type).toBe('image/webp');
        expect(canvases.at(-1).width).toBe(1080);
        expect(usedVideo(canvases)).toBe(true);
    });

    test('si takePhoto falla o la foto viene acostada, usa el cuadro del video', async () => {
        const failing = makeDeps({ ImageCaptureImpl: class { takePhoto() { return Promise.reject(new Error('busy')); } } });
        await capturePhoto(failing.deps);
        expect(usedVideo(failing.canvases)).toBe(true);
        const rotated = makeDeps({ toBitmap: async () => ({ width: 4000, height: 3000, close: jest.fn() }) });
        await capturePhoto(rotated.deps);
        expect(usedVideo(rotated.canvases)).toBe(true);
    });

    test('si takePhoto tarda demasiado, no deja esperando: usa el cuadro del video', async () => {
        const { deps, canvases } = makeDeps({ ImageCaptureImpl: class { takePhoto() { return new Promise(() => {}); } }, timeoutMs: 20 });
        await capturePhoto(deps);
        expect(usedVideo(canvases)).toBe(true);
    });

    test('tomar es rápido y no codifica; recortar respeta un ancho máximo (partes de factura larga)', async () => {
        const { deps, canvases } = makeDeps();
        const shot = await takeShot(deps);
        expect(canvases.some(c => c.calls.some(x => x[0] === 'toBlob'))).toBe(false);
        expect(shot.crop).toEqual({ sx: 375, sy: 0, sw: 2250, sh: 4000 });
        const canvas = renderShot(shot, { makeCanvas: deps.makeCanvas, maxWidth: 1600 });
        expect(canvas.width).toBe(1600);
        expect(shot.source.close).toHaveBeenCalled();
    });
});
