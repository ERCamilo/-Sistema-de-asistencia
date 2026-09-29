/**
 * Nombres de obra únicos. Dos obras no pueden llamarse igual: se compara sin
 * distinguir mayúsculas y con los espacios normalizados ("Torre  Norte" y
 * "torre norte" son el mismo nombre). Aplica a todas las obras del catálogo,
 * también las cerradas o archivadas, para que el historial no sea ambiguo.
 */

export function projectNameKey(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

/** Otra obra (distinta de `excludeId`) que ya usa ese nombre, o null. */
export function findProjectNameConflict(name, projects = [], { excludeId = null } = {}) {
    const key = projectNameKey(name);
    if (!key) return null;
    const excluded = excludeId == null ? null : String(excludeId);
    return (projects || []).find(project => project
        && (excluded == null || String(project.id) !== excluded)
        && projectNameKey(project.name) === key) || null;
}

export function duplicateProjectNameMessage(conflict) {
    return `Ya existe una obra con el nombre "${conflict?.name ?? ''}". Elige otro nombre.`;
}

/** Primer nombre libre a partir de `base`: "Mi obra", "Mi obra 2", "Mi obra 3"… */
export function firstAvailableProjectName(base, projects = []) {
    if (!findProjectNameConflict(base, projects)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base} ${n}`;
        if (!findProjectNameConflict(candidate, projects)) return candidate;
    }
}
