/**
 * Registro local de fusiones de empleados: id de la copia → id del empleado en
 * que se fusionó. Complementa la lápida con `mergedIntoId` que viaja a la nube:
 * mientras esa lápida no se haya subido (sin red, pestaña cerrada), la copia no
 * debe volver desde IndexedDB ni desde la nube (caso real 2026-09-29: Wilmer
 * #004, fusionado en #031, volvió sin obra al descargar antes de subir).
 *
 * Sin dependencias para poder usarse desde la carga de datos.
 */
export const EMPLOYEE_MERGE_REGISTRY_KEY = 'asistencia_employee_merges_v1';
const MAX_ENTRIES = 2000;

function read() {
    try {
        const parsed = JSON.parse(localStorage.getItem(EMPLOYEE_MERGE_REGISTRY_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

function write(entries) {
    try {
        const ids = Object.keys(entries);
        if (ids.length > MAX_ENTRIES) {
            ids.sort((a, b) => (entries[a]?.at || 0) - (entries[b]?.at || 0))
                .slice(0, ids.length - MAX_ENTRIES).forEach(id => { delete entries[id]; });
        }
        localStorage.setItem(EMPLOYEE_MERGE_REGISTRY_KEY, JSON.stringify(entries));
    } catch (_) { /* sin almacenamiento: queda la lápida en la nube */ }
}

export function rememberEmployeeMerge(duplicateId, intoId, at = Date.now()) {
    const dup = String(duplicateId ?? '').trim();
    const into = String(intoId ?? '').trim();
    if (!dup || !into || dup === into) return;
    const entries = read();
    entries[dup] = { into, at };
    write(entries);
}

/** Id final en que terminó una copia (sigue cadenas A→B→C), o null. */
export function mergedTargetOf(employeeId) {
    const entries = read();
    let id = String(employeeId ?? '').trim();
    let target = null;
    for (let hop = 0; hop < 10 && entries[id]?.into; hop++) {
        target = entries[id].into;
        id = target;
    }
    return target;
}

export function isMergedAway(employeeId) {
    return Boolean(read()[String(employeeId ?? '').trim()]?.into);
}

/** Quita de una lista las copias ya fusionadas (no muta la lista). */
export function withoutMergedAway(employees = []) {
    const entries = read();
    if (!Object.keys(entries).length) return employees;
    return employees.filter(employee => !entries[String(employee?.id ?? '').trim()]?.into);
}
