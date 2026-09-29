/**
 * 🗂️ ConflictPlanner.js (Tarea #19)
 *
 * Función pura que recibe los grupos de conflicto producidos por
 * analyzeConflicts() y los clasifica en:
 *   - auto-merge: nombres IDÉNTICOS character-por-character (sin
 *     normalización), seguros para fusión automática.
 *   - needs-manual: cualquier diferencia (mayúsculas, acentos, orden,
 *     personas distintas) — el usuario decide explícitamente.
 *
 * Para los auto-merge, propone un master basado en:
 *   1. attendanceCount mayor.
 *   2. updatedAt mayor (desempate).
 *   3. completeness mayor (segundo desempate).
 *
 * El resultado describe el plan sin ejecutarlo — la UI lo muestra como
 * preview, el usuario aprueba/cancela, y un paso aparte lo aplica.
 */

/**
 * Comparación estricta: dos nombres son "idénticos" solo si tienen
 * los mismos caracteres en el mismo orden (incluye case y acentos).
 * Opción B del usuario: cualquier diferencia merece confirmación.
 */
export function namesAreIdentical(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    return a === b;
}

import { idFormatRank } from './IdFormat.js';

function pickMaster(members) {
    // Orden de prioridad (data-quality primero, formato como desempate final):
    //   1. attendanceCount mayor.
    //   2. updatedAt mayor.
    //   3. completeness mayor.
    //   4. idFormatRank mayor — empate de calidad → preferir el formato más
    //      moderno (EMP{timestamp} > emp-seed > UUID legacy). Esto NO cambia
    //      la identidad: el id sigue siendo inmutable. Solo es un tiebreaker
    //      defensivo cuando dos registros son indistinguibles en calidad.
    const sorted = [...members].sort((a, b) => {
        const ac = (b.attendanceCount || 0) - (a.attendanceCount || 0);
        if (ac !== 0) return ac;
        const au = (b.updatedAt || 0) - (a.updatedAt || 0);
        if (au !== 0) return au;
        const co = (b.completeness || 0) - (a.completeness || 0);
        if (co !== 0) return co;
        return idFormatRank(b.id) - idFormatRank(a.id);
    });
    return sorted[0];
}

function classifyGroup(group) {
    if (!group || !Array.isArray(group.members) || group.members.length < 2) {
        return null;
    }
    const first = group.members[0];
    const allIdentical = group.members.every(m => namesAreIdentical(m.name, first.name));
    return allIdentical ? 'auto-merge' : 'needs-manual';
}

function countLoansAcrossMembers(members) {
    return members.reduce((sum, m) => sum + ((m.loans || []).length), 0);
}

function hasCloudLosers(members, masterId) {
    return members.some(m =>
        m.id !== masterId &&
        (m._source === 'cloud' || m._source === 'both')
    );
}

/**
 * @param {Array} conflicts Salida de analyzeConflicts({cloudEmployees}).
 * @returns {Array} Plan. Cada item:
 *   {
 *     number,                 // ficha del grupo
 *     action,                 // 'auto-merge' | 'needs-manual'
 *     members,                // miembros tal cual del conflicto
 *     proposedMasterId,       // id del master sugerido (siempre, incluso para manual)
 *     loserIds,               // [...] ids de los demás
 *     totalLoansAfterMerge,   // suma de loans de todos los miembros
 *     hasCloudLosers          // bool: ¿algún loser tiene _source cloud o both?
 *   }
 */
export function buildConflictPlan(conflicts) {
    if (!Array.isArray(conflicts)) return [];

    const out = [];
    for (const group of conflicts) {
        const action = classifyGroup(group);
        if (!action) continue;

        const master = pickMaster(group.members);
        const loserIds = group.members
            .filter(m => m.id !== master.id)
            .map(m => m.id);

        out.push({
            number: group.number,
            action,
            members: group.members,
            proposedMasterId: master.id,
            loserIds,
            totalLoansAfterMerge: countLoansAcrossMembers(group.members),
            hasCloudLosers: hasCloudLosers(group.members, master.id)
        });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// Ejecutor del plan
// ─────────────────────────────────────────────────────────────────────

import { mergeDuplicateEmployees } from '../features/employees/EmployeeDuplicateService.js';

/**
 * Ejecuta los items del plan con action='auto-merge'. Los 'needs-manual'
 * se cuentan pero NO se tocan — la UI los resuelve uno a uno.
 *
 * Para miembros cloud-only (no presentes en state.employees), trae sus
 * datos al state antes de fusionar usando EmployeeMerge (que une
 * préstamos/adelantos por id sin perder ninguno).
 *
 * Para losers con _source 'cloud' o 'both', encola su id en
 * _pendingCloudDeletes para que el siguiente saveApplicationData borre
 * el doc remoto correspondiente.
 *
 * NO guarda. El caller decide cuándo llamar a saveApplicationData.
 *
 * @param {Array} plan Salida de buildConflictPlan.
 * @returns {{merged: number, skippedManual: number}}
 */
export function executeMergePlan(plan) {
    const result = { merged: 0, skippedManual: 0 };
    if (!Array.isArray(plan)) return result;
    for (const item of plan) {
        if (item.action === 'needs-manual') {
            result.skippedManual++;
            continue;
        }
        if (item.action !== 'auto-merge') continue;
        // Servicio único: fusiona (también copias que solo están en la nube),
        // deja lápida con mergedIntoId y marca la copia para limpiar localmente.
        const outcome = mergeDuplicateEmployees({
            masterId: item.proposedMasterId,
            duplicateIds: item.loserIds || [],
            members: item.members || []
        });
        if (outcome.merged > 0) result.merged++;
    }
    return result;
}

export default { namesAreIdentical, buildConflictPlan, executeMergePlan };
