import {
    EMPLOYEE_PHOTO_MAX_SOURCE_BYTES,
    EmployeePhotoProcessingError,
    calculateSquareCrop,
    fitImageWithin,
    processEmployeePhoto,
    validateEmployeePhotoSource
} from '../modules/features/employees/EmployeePhotoProcessor.js';

function createCanvasHarness({ encode = true } = {}) {
    const canvases = [];
    const createCanvas = () => {
        const context = { drawImage: jest.fn() };
        const canvas = {
            width: 0,
            height: 0,
            getContext: jest.fn(() => context),
            toBlob: jest.fn(callback => callback(
                encode ? new Blob(['encoded'], { type: 'image/jpeg' }) : null
            )),
            context
        };
        canvases.push(canvas);
        return canvas;
    };
    return { canvases, createCanvas };
}

describe('Employee photo processing primitives', () => {
    test('calculates a centered square crop for landscape and portrait sources', () => {
        expect(calculateSquareCrop(1200, 600)).toEqual({ x: 300, y: 0, size: 600 });
        expect(calculateSquareCrop(600, 1200)).toEqual({ x: 0, y: 300, size: 600 });
    });

    test('fits dimensions inside the maximum without enlarging', () => {
        expect(fitImageWithin(1200, 600, 300)).toEqual({ width: 300, height: 150 });
        expect(fitImageWithin(120, 60, 300)).toEqual({ width: 120, height: 60 });
    });

    test('validates supported non-empty bounded image blobs', () => {
        const source = new Blob(['photo'], { type: 'image/png' });
        expect(validateEmployeePhotoSource(source)).toBe(source);
    });

    test.each([
        ['data URL', 'data:image/jpeg;base64,temporary'],
        ['empty image', new Blob([], { type: 'image/jpeg' })],
        ['unsupported MIME', new Blob(['gif'], { type: 'image/gif' })]
    ])('rejects %s sources explicitly', (_label, source) => {
        expect(() => validateEmployeePhotoSource(source)).toThrow(EmployeePhotoProcessingError);
    });

    test('rejects source blobs above the byte limit before decoding', () => {
        const source = new Blob(['photo'], { type: 'image/jpeg' });
        Object.defineProperty(source, 'size', { value: EMPLOYEE_PHOTO_MAX_SOURCE_BYTES + 1 });
        expect(() => validateEmployeePhotoSource(source)).toThrow(/size limit/i);
    });
});

describe('Employee photo processing pipeline', () => {
    test('returns Blob thumbnail and bounded optimized image, then closes the bitmap', async () => {
        const bitmap = { width: 1200, height: 600, close: jest.fn() };
        const createBitmap = jest.fn().mockResolvedValue(bitmap);
        const harness = createCanvasHarness();

        const result = await processEmployeePhoto(
            new Blob(['photo'], { type: 'image/jpeg' }),
            {
                thumbnailSize: 256,
                maxOriginalDimension: 300,
                createBitmap,
                createCanvas: harness.createCanvas
            }
        );

        expect(result.thumbnailBlob).toBeInstanceOf(Blob);
        expect(result.optimizedBlob).toBeInstanceOf(Blob);
        expect(result.width).toBe(300);
        expect(result.height).toBe(150);
        expect(harness.canvases[0]).toMatchObject({ width: 256, height: 256 });
        expect(harness.canvases[1]).toMatchObject({ width: 300, height: 150 });
        expect(harness.canvases[0].context.drawImage).toHaveBeenCalledWith(
            bitmap, 300, 0, 600, 600, 0, 0, 256, 256
        );
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });

    test('closes the bitmap and reports an explicit error when encoding fails', async () => {
        const bitmap = { width: 400, height: 300, close: jest.fn() };
        const harness = createCanvasHarness({ encode: false });

        await expect(processEmployeePhoto(
            new Blob(['photo'], { type: 'image/jpeg' }),
            {
                createBitmap: jest.fn().mockResolvedValue(bitmap),
                createCanvas: harness.createCanvas
            }
        )).rejects.toMatchObject({ code: 'encode-failed' });

        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });

    test('rejects unsafe decoded dimensions and still closes the bitmap', async () => {
        const bitmap = { width: 20000, height: 20000, close: jest.fn() };

        await expect(processEmployeePhoto(
            new Blob(['photo'], { type: 'image/jpeg' }),
            {
                createBitmap: jest.fn().mockResolvedValue(bitmap),
                createCanvas: createCanvasHarness().createCanvas
            }
        )).rejects.toMatchObject({ code: 'unsafe-dimensions' });

        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });
});
