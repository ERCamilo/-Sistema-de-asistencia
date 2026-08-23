export const EMPLOYEE_PHOTO_MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const EMPLOYEE_PHOTO_MAX_SOURCE_PIXELS = 40 * 1000 * 1000;
export const EMPLOYEE_PHOTO_MAX_ORIGINAL_DIMENSION = 2048;
export const EMPLOYEE_PHOTO_MAX_THUMBNAIL_SIZE = 512;

const SUPPORTED_IMAGE_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);

export class EmployeePhotoProcessingError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.name = 'EmployeePhotoProcessingError';
        this.code = code;
        if (cause) this.cause = cause;
    }
}

export function validateEmployeePhotoSource(source) {
    if (!(source instanceof Blob)) {
        throw new EmployeePhotoProcessingError('invalid-source', 'Employee photo source must be a Blob');
    }
    if (!SUPPORTED_IMAGE_TYPES.has(String(source.type || '').toLowerCase())) {
        throw new EmployeePhotoProcessingError('unsupported-type', 'Employee photo MIME type is not supported');
    }
    if (source.size <= 0) {
        throw new EmployeePhotoProcessingError('empty-source', 'Employee photo source is empty');
    }
    if (source.size > EMPLOYEE_PHOTO_MAX_SOURCE_BYTES) {
        throw new EmployeePhotoProcessingError('source-too-large', 'Employee photo exceeds the source size limit');
    }
    return source;
}

function requireDimensions(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new EmployeePhotoProcessingError('unsafe-dimensions', 'Employee photo dimensions are invalid');
    }
    if (width * height > EMPLOYEE_PHOTO_MAX_SOURCE_PIXELS) {
        throw new EmployeePhotoProcessingError('unsafe-dimensions', 'Employee photo dimensions exceed the pixel limit');
    }
}

export function calculateSquareCrop(width, height) {
    requireDimensions(width, height);
    const size = Math.min(width, height);
    return {
        x: Math.round((width - size) / 2),
        y: Math.round((height - size) / 2),
        size
    };
}

export function fitImageWithin(width, height, maxDimension) {
    requireDimensions(width, height);
    if (!Number.isFinite(maxDimension) || maxDimension < 1) {
        throw new EmployeePhotoProcessingError('invalid-options', 'Maximum image dimension is invalid');
    }
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function boundedOption(value, fallback, maximum, label) {
    const resolved = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
        throw new EmployeePhotoProcessingError('invalid-options', `${label} is outside its allowed range`);
    }
    return resolved;
}

function defaultCanvasFactory() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        throw new EmployeePhotoProcessingError('unsupported-runtime', 'Canvas is not available');
    }
    return document.createElement('canvas');
}

function encodeCanvas(canvas, quality) {
    return new Promise((resolve, reject) => {
        if (!canvas || typeof canvas.toBlob !== 'function') {
            reject(new EmployeePhotoProcessingError('unsupported-runtime', 'Canvas Blob encoding is not available'));
            return;
        }
        canvas.toBlob(blob => {
            if (blob instanceof Blob && blob.size > 0) resolve(blob);
            else reject(new EmployeePhotoProcessingError('encode-failed', 'Employee photo encoding failed'));
        }, 'image/jpeg', quality);
    });
}

function drawToCanvas(createCanvas, width, height, draw) {
    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext?.('2d', { alpha: false });
    if (!context || typeof context.drawImage !== 'function') {
        throw new EmployeePhotoProcessingError('unsupported-runtime', '2D canvas rendering is not available');
    }
    draw(context);
    return canvas;
}

export async function processEmployeePhoto(source, options = {}) {
    validateEmployeePhotoSource(source);
    const thumbnailSize = boundedOption(
        options.thumbnailSize,
        256,
        EMPLOYEE_PHOTO_MAX_THUMBNAIL_SIZE,
        'Thumbnail size'
    );
    const maxOriginalDimension = boundedOption(
        options.maxOriginalDimension,
        1600,
        EMPLOYEE_PHOTO_MAX_ORIGINAL_DIMENSION,
        'Original dimension'
    );
    const createBitmap = options.createBitmap || globalThis.createImageBitmap;
    const createCanvas = options.createCanvas || defaultCanvasFactory;
    if (typeof createBitmap !== 'function') {
        throw new EmployeePhotoProcessingError('unsupported-runtime', 'Image decoding is not available');
    }

    let bitmap;
    try {
        bitmap = await createBitmap(source);
        requireDimensions(bitmap?.width, bitmap?.height);

        const crop = calculateSquareCrop(bitmap.width, bitmap.height);
        const thumbnailCanvas = drawToCanvas(createCanvas, thumbnailSize, thumbnailSize, context => {
            context.drawImage(
                bitmap,
                crop.x, crop.y, crop.size, crop.size,
                0, 0, thumbnailSize, thumbnailSize
            );
        });
        const dimensions = fitImageWithin(bitmap.width, bitmap.height, maxOriginalDimension);
        const optimizedCanvas = drawToCanvas(createCanvas, dimensions.width, dimensions.height, context => {
            context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, dimensions.width, dimensions.height);
        });
        const [thumbnailBlob, optimizedBlob] = await Promise.all([
            encodeCanvas(thumbnailCanvas, 0.72),
            encodeCanvas(optimizedCanvas, 0.82)
        ]);

        return {
            thumbnailBlob,
            optimizedBlob,
            width: dimensions.width,
            height: dimensions.height,
            mimeType: 'image/jpeg'
        };
    } catch (error) {
        if (error instanceof EmployeePhotoProcessingError) throw error;
        throw new EmployeePhotoProcessingError('decode-failed', 'Employee photo could not be processed', error);
    } finally {
        try { bitmap?.close?.(); } catch (_) { /* noop */ }
    }
}
