import { auth } from '../data/firebase.js';
import { APP_CONFIG } from '../config/Config.js';

const COORDINATE_FIELDS = ['category', 'ownerType', 'ownerId', 'assetId', 'variant'];
const COORDINATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class AppImageError extends Error {
    constructor(message, { status = 0, code = 'APP_IMAGE_REQUEST_FAILED', retryable = false } = {}) {
        super(message);
        this.name = 'AppImageError';
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

function normalizeCoordinates(value = {}) {
    const normalized = {};
    for (const field of COORDINATE_FIELDS) {
        const coordinate = String(value[field] || '').trim();
        if (!COORDINATE_PATTERN.test(coordinate)) {
            throw new TypeError(`Invalid app-image coordinate: ${field}`);
        }
        normalized[field] = coordinate;
    }
    return normalized;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Image encoding failed'));
        reader.readAsDataURL(blob);
    });
}

async function defaultGetIdToken() {
    const user = auth?.currentUser;
    if (!user || typeof user.getIdToken !== 'function') {
        throw new AppImageError('Sesión no disponible', { code: 'AUTH_REQUIRED' });
    }
    const expectedUid = user.uid;
    const token = await user.getIdToken();
    if (!token || auth?.currentUser?.uid !== expectedUid) {
        throw new AppImageError('La sesión cambió durante la solicitud', { code: 'AUTH_CHANGED' });
    }
    return token;
}

export class AppImageClient {
    constructor({
        endpoint = APP_CONFIG.APP_IMAGES_URL,
        getIdToken = defaultGetIdToken,
        fetchImpl = globalThis.fetch
    } = {}) {
        this.endpoint = String(endpoint || '').trim();
        this.getIdToken = getIdToken;
        this.fetchImpl = fetchImpl;
    }

    async request(action, coordinates, extra = {}) {
        if (!this.endpoint || typeof this.fetchImpl !== 'function') {
            throw new AppImageError('Servicio de imágenes no disponible', { code: 'SERVICE_UNAVAILABLE' });
        }
        const idToken = await this.getIdToken();
        const response = await this.fetchImpl(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, idToken, ...normalizeCoordinates(coordinates), ...extra })
        });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok || payload?.ok === false) {
            throw new AppImageError('No se pudo completar la operación de imagen', {
                status: response.status,
                code: String(payload?.error || 'APP_IMAGE_REQUEST_FAILED'),
                retryable: payload?.retryable === true
            });
        }
        return payload || { ok: true };
    }

    async upload(coordinates, blob, originalName = 'image.webp') {
        if (!(blob instanceof Blob) || !UPLOAD_MIME_TYPES.has(String(blob.type || '').toLowerCase())) {
            throw new TypeError('A supported image Blob is required');
        }
        if (blob.size <= 0 || blob.size > 10 * 1024 * 1024) {
            throw new RangeError('Image exceeds the client upload limit');
        }
        return this.request('upload', coordinates, {
            fileBase64: await blobToBase64(blob),
            mimeType: blob.type,
            originalName: String(originalName || 'image.webp').slice(0, 160)
        });
    }

    lookup(coordinates) {
        return this.request('lookup', coordinates);
    }

    delete(coordinates) {
        return this.request('delete', coordinates);
    }

    async lookupAndDownload(coordinates) {
        const lookup = await this.lookup(coordinates);
        if (!lookup?.signedUrl || typeof lookup.signedUrl !== 'string') {
            throw new AppImageError('La imagen remota no está disponible', { code: 'IMAGE_NOT_FOUND' });
        }
        const response = await this.fetchImpl(lookup.signedUrl, { method: 'GET' });
        if (!response.ok) {
            throw new AppImageError('No se pudo descargar la imagen', { status: response.status });
        }
        const blob = await response.blob();
        if (!(blob instanceof Blob) || !UPLOAD_MIME_TYPES.has(String(blob.type || '').toLowerCase())) {
            throw new AppImageError('La respuesta remota no es una imagen válida', { code: 'INVALID_IMAGE' });
        }
        return { asset: lookup.asset || null, blob, expiresIn: lookup.expiresIn || null };
    }
}

export const appImageClient = new AppImageClient();
