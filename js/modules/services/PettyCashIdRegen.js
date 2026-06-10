/**
 * 🔄 PettyCashIdRegen.js (Auditoría 2026-06-09, hallazgo L7)
 *
 * Regeneración PURA de ids de caja chica para "preparar datos para cuenta
 * nueva": la cuenta clonada no debe conservar los ids de la cuenta anterior
 * (colisiones al subir, mezclas si ambas cuentas tocan el mismo navegador).
 *
 * Remapea las referencias cruzadas de forma consistente:
 *   period.projectId  → id nuevo del proyecto
 *   movement.projectId/periodId → ids nuevos
 *
 * No toca IndexedDB ni Firestore — devuelve los arreglos nuevos + el idMap
 * (viejo→nuevo) para que el caller re-encadene los comprobantes locales.
 */

/**
 * @param {{projects?: Array, periods?: Array, movements?: Array}|null} data
 * @param {() => string} genId generador de ids (inyectado para testear)
 * @returns {{projects: Array, periods: Array, movements: Array, idMap: Map}}
 */
export function regeneratePettyCashIds(data, genId) {
    const asArray = (x) => (Array.isArray(x) ? x : []);
    const projects = asArray(data?.projects);
    const periods = asArray(data?.periods);
    const movements = asArray(data?.movements);

    const idMap = new Map();
    const now = Date.now();
    const remap = (oldId) => (idMap.has(oldId) ? idMap.get(oldId) : oldId);

    const newProjects = projects.map(p => {
        const id = genId();
        if (p?.id != null) idMap.set(p.id, id);
        return { ...p, id, updatedAt: now };
    });

    const newPeriods = periods.map(p => {
        const id = genId();
        if (p?.id != null) idMap.set(p.id, id);
        return { ...p, id, projectId: remap(p?.projectId), updatedAt: now };
    });

    const newMovements = movements.map(m => {
        const id = genId();
        if (m?.id != null) idMap.set(m.id, id);
        return {
            ...m,
            id,
            projectId: remap(m?.projectId),
            periodId: remap(m?.periodId),
            updatedAt: now
        };
    });

    return { projects: newProjects, periods: newPeriods, movements: newMovements, idMap };
}

export default { regeneratePettyCashIds };
