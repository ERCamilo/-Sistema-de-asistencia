/**
 * 🏷️ IdFormat.js
 *
 * Clasifica un id de empleado en uno de los formatos históricos del
 * sistema. Sirve para dos cosas:
 *   1. Tiebreaker en pickMaster cuando todos los demás criterios
 *      empatan (data-quality primero, formato como desempate final).
 *   2. Badge informativo en las cards del wizard de saneamiento — el
 *      formato es solo una pista visual, no afecta enrutamiento ni
 *      identidad. Los ids son inmutables; el badge es display-only.
 *
 * Formatos (de más nuevo a más viejo):
 *   - 'emp-modern'  → 'EMP\d+' (Employee.js constructor: `EMP${Date.now()}`)
 *   - 'emp-seed'    → 'emp-NNN' o 'emp-conflict-NNN' (DemoSeed)
 *   - 'emp-legacy'  → UUID v4 (generateUUID() de Helpers — pre-migración)
 *   - 'emp-unknown' → cualquier otra cosa
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMP_MODERN_RE = /^EMP\d+$/;
const EMP_SEED_RE = /^emp-[a-z0-9-]+$/i;

/**
 * @param {string} id
 * @returns {'emp-modern'|'emp-seed'|'emp-legacy'|'emp-unknown'}
 */
export function classifyEmployeeId(id) {
    if (typeof id !== 'string' || id.length === 0) return 'emp-unknown';
    if (EMP_MODERN_RE.test(id)) return 'emp-modern';
    if (UUID_RE.test(id)) return 'emp-legacy';
    if (EMP_SEED_RE.test(id)) return 'emp-seed';
    return 'emp-unknown';
}

/**
 * Ranking: más nuevo = mayor número. Usado como tiebreaker numérico.
 *   emp-modern  → 3
 *   emp-seed    → 2
 *   emp-legacy  → 1
 *   emp-unknown → 0
 */
export function idFormatRank(id) {
    switch (classifyEmployeeId(id)) {
        case 'emp-modern':  return 3;
        case 'emp-seed':    return 2;
        case 'emp-legacy':  return 1;
        default:            return 0;
    }
}

/** Etiqueta human-friendly para mostrar en cards. */
export function idFormatLabel(id) {
    switch (classifyEmployeeId(id)) {
        case 'emp-modern':  return 'Sistema actual';
        case 'emp-seed':    return 'Datos de demo';
        case 'emp-legacy':  return 'Sistema legacy';
        default:            return 'Formato desconocido';
    }
}

export default { classifyEmployeeId, idFormatRank, idFormatLabel };
