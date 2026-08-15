/**
 * 🧼 SnapshotSanitizer.js (Auditoría 2026-06-09, hallazgo C3)
 *
 * state.pettyCash mezcla DATOS (projects/periods/movements) con estado de
 * UI: form y _editPhoto pueden contener fotos base64 de cientos de KB.
 * Si eso entra a un payload de Firestore:
 *   - El doc puede superar el límite de 1 MB → la escritura falla entera.
 *   - Los snapshots se inflan y disparan el costo de Storage.
 *
 * Este módulo es puro (sin IO) para que sea testeable de verdad.
 */

/**
 * Devuelve una copia de pettyCash con SOLO los datos durables.
 * Descarta form, periodForm, editMov, selección de UI, fotos en memoria y
 * cualquier campo de estado transitorio.
 *
 * @param {object|null|undefined} pettyCash - state.pettyCash
 * @returns {{projects: Array, periods: Array, movements: Array}|null}
 */
export function sanitizePettyCashForSnapshot(pettyCash) {
    if (!pettyCash || typeof pettyCash !== 'object') return null;
    const asArray = (x) => (Array.isArray(x) ? x : []);
    const sanitizeValue = (value, key = '') => {
        const normalizedKey = String(key).toLowerCase();
        const compactKey = normalizedKey.replace(/[^a-z0-9]/g, '');
        if (
            compactKey.includes('base64') ||
            normalizedKey === 'originalblob' || normalizedKey === 'previewdataurl' ||
            normalizedKey === 'dataurl' || normalizedKey === 'filedataurl' ||
            normalizedKey === 'imagedataurl' || normalizedKey === 'signedurl' ||
            (normalizedKey.includes('signed') && normalizedKey.includes('url'))
        ) return undefined;
        if (typeof value === 'string' && value.trim().toLowerCase().startsWith('data:')) return undefined;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
        if (Array.isArray(value)) return value.map(item => sanitizeValue(item)).filter(item => item !== undefined);
        if (!value || typeof value !== 'object') return value;
        return Object.entries(value).reduce((copy, [childKey, childValue]) => {
            const clean = sanitizeValue(childValue, childKey);
            if (clean !== undefined) copy[childKey] = clean;
            return copy;
        }, {});
    };
    return {
        projects: asArray(pettyCash.projects).map(item => sanitizeValue(item)),
        periods: asArray(pettyCash.periods).map(item => sanitizeValue(item)),
        movements: asArray(pettyCash.movements).map(item => sanitizeValue(item))
    };
}

/** Prepares imported metadata without pretending that an absent local blob exists. */
export function preparePettyCashBackupForRestore(pettyCash) {
    const clean = sanitizePettyCashForSnapshot(pettyCash) || { projects: [], periods: [], movements: [] };
    let unrecoverableReceiptCount = 0;
    const movements = clean.movements.map((movement) => {
        const onlyLocal = movement?.hasReceipt && !movement?.receiptUrl && movement?.receiptStorage !== 'supabase';
        if (!onlyLocal) return movement;
        unrecoverableReceiptCount++;
        return { ...movement, receiptRecovery: 'not-recoverable-from-backup' };
    });
    return { pettyCash: { ...clean, movements }, unrecoverableReceiptCount };
}

export default { sanitizePettyCashForSnapshot, preparePettyCashBackupForRestore };
