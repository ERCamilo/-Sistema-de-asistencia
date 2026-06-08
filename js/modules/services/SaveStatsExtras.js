/**
 * SaveStatsExtras.js — métricas extra (puras) para el log de "Save Stats".
 *
 * Calcula el total de préstamos y un resumen de caja chica para mostrarlos
 * junto a employees/positions/leaders/attendance en IndexedDBService.saveState.
 * Sin estado ni IO → testeable.
 */

/**
 * @param {object} state estado global
 * @returns {{ loans: number, pettyCash: { projects:number, periods:number, movements:number } }}
 */
export function computeSaveStatsExtras(state) {
    const s = state || {};

    const employees = Array.isArray(s.employees) ? s.employees : [];
    const loans = employees.reduce(
        (acc, e) => acc + (Array.isArray(e && e.loans) ? e.loans.length : 0),
        0
    );

    let projects = 0, periods = 0, movements = 0;
    const pc = s.pettyCash;
    if (pc && Array.isArray(pc.projects)) {
        projects = pc.projects.length;
        if (Array.isArray(pc.movements)) {
            // Forma plana (futura persistencia real)
            periods = Array.isArray(pc.periods) ? pc.periods.length : 0;
            movements = pc.movements.length;
        } else {
            // Forma anidada (prototipo): projects[].periods[].movimientos[]
            pc.projects.forEach(p => {
                const pers = Array.isArray(p && p.periods) ? p.periods : [];
                periods += pers.length;
                pers.forEach(per => {
                    movements += Array.isArray(per && per.movimientos) ? per.movimientos.length : 0;
                });
            });
        }
    }

    return { loans, pettyCash: { projects, periods, movements } };
}

export default { computeSaveStatsExtras };
