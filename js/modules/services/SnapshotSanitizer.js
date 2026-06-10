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
    return {
        projects: asArray(pettyCash.projects),
        periods: asArray(pettyCash.periods),
        movements: asArray(pettyCash.movements)
    };
}

export default { sanitizePettyCashForSnapshot };
