const STORE_NAME = 'employeePhotos';
const IMAGE_MIME_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const MAX_OPTIMIZED_BYTES = 3 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const DELETE_VARIANTS = ['thumbnail', 'original'];

export function ensureEmployeePhotoStore(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'employeeId' });
    }
}

function normalizeEmployeeId(value) {
    const id = String(value || '').trim();
    if (!id || id.length > 160) throw new TypeError('A valid employeeId is required');
    return id;
}

function requireImageBlob(value, field, maxBytes) {
    if (!(value instanceof Blob)) throw new TypeError(`${field} must be a Blob`);
    if (!IMAGE_MIME_TYPES.has(String(value.type || '').toLowerCase())) {
        throw new TypeError(`${field} must use a supported image MIME type`);
    }
    if (value.size <= 0 || value.size > maxBytes) {
        throw new RangeError(`${field} exceeds its cache size limit`);
    }
    return value;
}

function optionalImageBlob(value, field, maxBytes) {
    return value == null ? null : requireImageBlob(value, field, maxBytes);
}

function requireDimension(value, field) {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
        throw new RangeError(`${field} must be a bounded positive integer`);
    }
    return value;
}

function optionalRevision(value) {
    if (value == null) return null;
    const revision = String(value).trim();
    if (!revision || revision.length > 240) throw new RangeError('remoteRevision is invalid');
    return revision;
}

export function buildEmployeePhotoCacheRecord(employeeId, value = {}) {
    const id = normalizeEmployeeId(employeeId);
    if (value.pendingDelete === true) {
        const requestedVariants = Array.isArray(value.pendingDeleteVariants)
            ? value.pendingDeleteVariants
            : DELETE_VARIANTS;
        const pendingDeleteVariants = DELETE_VARIANTS.filter(variant => requestedVariants.includes(variant));
        const deleteIntentAt = Number.isFinite(value.deleteIntentAt) && value.deleteIntentAt >= 0
            ? value.deleteIntentAt
            : Date.now();
        return {
            employeeId: id,
            thumbnailBlob: null,
            optimizedBlob: null,
            thumbnailMimeType: null,
            optimizedMimeType: null,
            width: null,
            height: null,
            version: Number.isInteger(value.version) && value.version > 0 ? value.version : deleteIntentAt,
            updatedAt: deleteIntentAt,
            remoteSyncedVersion: null,
            remoteRevision: optionalRevision(value.remoteRevision),
            remoteSignalUpdatedAt: Number.isFinite(value.remoteSignalUpdatedAt) ? value.remoteSignalUpdatedAt : null,
            pendingDelete: true,
            pendingDeleteVariants,
            deleteIntentAt,
            pendingDeleteSignal: value.pendingDeleteSignal === true,
            deleteRevision: optionalRevision(value.deleteRevision)
        };
    }
    const thumbnailBlob = optionalImageBlob(value.thumbnailBlob, 'thumbnailBlob', MAX_THUMBNAIL_BYTES);
    const optimizedBlob = optionalImageBlob(value.optimizedBlob, 'optimizedBlob', MAX_OPTIMIZED_BYTES);
    if (!thumbnailBlob && !optimizedBlob) throw new TypeError('At least one employee photo Blob is required');
    const version = Number.isInteger(value.version) && value.version > 0
        ? value.version
        : Date.now();
    const updatedAt = Number.isFinite(value.updatedAt) && value.updatedAt >= 0
        ? value.updatedAt
        : Date.now();

    return {
        employeeId: id,
        thumbnailBlob,
        optimizedBlob,
        thumbnailMimeType: thumbnailBlob?.type || null,
        optimizedMimeType: optimizedBlob?.type || null,
        width: requireDimension(value.width, 'width'),
        height: requireDimension(value.height, 'height'),
        version,
        updatedAt,
        remoteSyncedVersion: Number.isInteger(value.remoteSyncedVersion) && value.remoteSyncedVersion > 0
            ? value.remoteSyncedVersion
            : null,
        remoteRevision: optionalRevision(value.remoteRevision),
        remoteSignalUpdatedAt: Number.isFinite(value.remoteSignalUpdatedAt) ? value.remoteSignalUpdatedAt : null,
        pendingDelete: false,
        pendingDeleteVariants: [],
        deleteIntentAt: null,
        pendingDeleteSignal: false,
        deleteRevision: null
    };
}

export async function putEmployeePhotoCache(service, employeeId, value) {
    const record = buildEmployeePhotoCacheRecord(employeeId, value);
    await service.init();
    return new Promise((resolve, reject) => {
        const transaction = service.db.transaction([STORE_NAME], 'readwrite');
        const request = transaction.objectStore(STORE_NAME).put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = () => reject(request.error || new Error('Employee photo cache write failed'));
    });
}

export async function getEmployeePhotoCache(service, employeeId) {
    const id = normalizeEmployeeId(employeeId);
    await service.init();
    return new Promise((resolve, reject) => {
        const transaction = service.db.transaction([STORE_NAME], 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Employee photo cache read failed'));
    });
}

export async function listEmployeePhotosCache(service) {
    await service.init();
    return new Promise((resolve, reject) => {
        const transaction = service.db.transaction([STORE_NAME], 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Employee photo cache list failed'));
    });
}

export async function deleteEmployeePhotoCache(service, employeeId) {
    const id = normalizeEmployeeId(employeeId);
    await service.init();
    return new Promise((resolve, reject) => {
        const transaction = service.db.transaction([STORE_NAME], 'readwrite');
        const request = transaction.objectStore(STORE_NAME).delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error || new Error('Employee photo cache delete failed'));
    });
}
