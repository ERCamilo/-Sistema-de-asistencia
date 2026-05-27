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

function pickMaster(members) {
    // Copia para no mutar el input.
    const sorted = [...members].sort((a, b) => {
        const ac = (b.attendanceCount || 0) - (a.attendanceCount || 0);
        if (ac !== 0) return ac;
        const au = (b.updatedAt || 0) - (a.updatedAt || 0);
        if (au !== 0) return au;
        return (b.completeness || 0) - (a.completeness || 0);
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

import { state } from '../core/AppState.js';
import {
    mergeEmployees as fuseLocally,
    enqueueCloudEmployeeDelete
} from './PersistenceService.js';
import { mergeEmployees as fuseObjects } from './EmployeeMerge.js';

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

        const masterId = item.proposedMasterId;

        // Garantizar que el master esté en state. Si vino solo de la nube,
        // lo materializamos (descartando el helper field _source).
        let master = state.employees.find(e => e.id === masterId);
        if (!master) {
            const masterMember = (item.members || []).find(m => m.id === masterId);
            if (!masterMember) continue;
            master = { ...masterMember };
            delete master._source;
            state.employees.push(master);
        }

        for (const loserId of item.loserIds || []) {
            const loserMember = (item.members || []).find(m => m.id === loserId);
            if (!loserMember) continue;

            const loserInState = state.employees.find(e => e.id === loserId);

            if (loserInState) {
                // Loser en state local → usa la lógica existente que
                // remapea attendance keys, fusiona advances/bonuses/etc.
                fuseLocally(masterId, loserId);
            } else {
                // Loser cloud-only → asimila sus datos al master con
                // EmployeeMerge (preserva préstamos por id).
                // Llamado: fuseObjects(loser, master) — master es "local"
                // (2do arg) para que sus escalares ganen en empate.
                const merged = fuseObjects(loserMember, master);
                delete merged._source;
                const idx = state.employees.findIndex(e => e.id === masterId);
                if (idx >= 0) state.employees[idx] = merged;
                master = merged;
            }

            // Si el loser tenía representación remota, encolamos su
            // borrado de la subcolección de Firebase.
            if (loserMember._source === 'cloud' || loserMember._source === 'both') {
                enqueueCloudEmployeeDelete(loserId);
            }
        }
        result.merged++;
    }
    return result;
}

export default { namesAreIdentical, buildConflictPlan, executeMergePlan };
