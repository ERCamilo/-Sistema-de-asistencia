/**
 * Captura de la foto de la factura: resolución completa del sensor cuando el
 * navegador lo permite (ImageCapture), recortada a lo que se ve en el visor,
 * y guardada en WebP (más liviano a la misma calidad) con respaldo a JPEG.
 */
import { photoCrop, fitLongSide, encodeImage, capturePhoto, takeShot, renderShot, photoFromShot, extensionFor, MAX_PHOTO_LONG_SIDE } from '../modules/features/pettycash/PettyCashCapture.js';

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
        expect(shot.origin).toBe('sensor');
        const fallback = await takeShot({ ...deps, ImageCaptureImpl: undefined });
        expect(fallback.origin).toBe('video');
        const canvas = renderShot(shot, { makeCanvas: deps.makeCanvas, maxWidth: 1600 });
        expect(canvas.width).toBe(1600);
        expect(shot.source.close).toHaveBeenCalled();
    });
});

describe('photoFromShot: de la toma a la foto que se guarda', () => {
    const canvas = { width: 100, height: 200 };
    const straight = { width: 90, height: 190 };
    const blobOf = (tag) => new Blob([tag], { type: 'image/jpeg' });
    const deps = (over = {}) => ({
        doc: {},
        render: jest.fn(() => canvas),
        encode: jest.fn(async (c) => blobOf(c === straight ? 'straight' : 'plain')),
        straightenCanvasFn: jest.fn(async () => straight),
        ...over
    });

    test('un archivo ya hecho (galería) pasa tal cual', async () => {
        const file = blobOf('file');
        const d = deps();
        expect(await photoFromShot(file, d)).toBe(file);
        expect(d.render).not.toHaveBeenCalled();
    });
    test('sin esquinas: se dibuja el recorte y se guarda, sin remuestrear', async () => {
        const d = deps();
        const out = await photoFromShot({ source: {}, crop: {} }, d);
        expect(d.straightenCanvasFn).not.toHaveBeenCalled();
        expect(d.encode).toHaveBeenCalledWith(canvas);
        expect(await out.text?.() ?? 'plain').toBe('plain');
    });
    test('con esquinas: se endereza el lienzo del recorte y se guarda el enderezado', async () => {
        const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const d = deps();
        await photoFromShot({ source: {}, crop: {}, quad }, d);
        expect(d.straightenCanvasFn).toHaveBeenCalledWith(canvas, quad, expect.objectContaining({ doc: d.doc }));
        expect(d.encode).toHaveBeenCalledWith(straight);
    });
    test('si enderezar falla o no devuelve nada, se guarda el recorte tal cual (nunca se pierde la foto)', async () => {
        const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const fn of [jest.fn(async () => null), jest.fn(async () => { throw new Error('sin memoria'); })]) {
            const d = deps({ straightenCanvasFn: fn });
            await photoFromShot({ source: {}, crop: {}, quad }, d);
            expect(d.encode).toHaveBeenCalledWith(canvas);
        }
    });
});
