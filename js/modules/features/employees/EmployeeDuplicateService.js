/**
 * 🤝 EmployeeDuplicateService — un solo camino para resolver duplicados.
 *
 * Antes cada pantalla resolvía a su manera (asistente de conflictos, limpieza
 * automática, conflicto de número al editar, asignación de pendientes) y no
 * todas borraban la copia en la nube; las que lo hacían usaban un borrado
 * directo que no dejaba rastro. Además la copia seguía en IndexedDB y volvía
 * al recargar. Resultado: duplicados que «resucitaban» (#004 Wilmer).
 *
 * Reglas:
 *   - Fusionar: la asistencia, préstamos, abonos, puestos y sueldos pasan al
 *     empleado que se conserva (mergeEmployees). La copia recibe una lápida en
 *     la nube con `mergedIntoId` (id del empleado conservado), se anota en el
 *     registro local y se borra de IndexedDB tras guardar.
 *   - Una copia que reaparece (otro dispositivo, respaldo viejo) con una lápida
 *     `mergedIntoId` se une sola a ese empleado: la decisión ya se tomó.
 *   - Cambiar número y eliminar pasan por aquí para que todas las pantallas
 *     hagan exactamente lo mismo.
 */
import { state, stateManager } from '../../core/AppState.js';
import indexedDBService from '../../services/IndexedDBService.js';
import {
    mergeEmployees as mergeInState,
    enqueueEmployeeTombstone,
    reassignEmployeeNumber,
    saveApplicationData
} from '../../services/PersistenceService.js';
import { mergeEmployees as mergeRecords } from '../../services/EmployeeMerge.js';
import { purgeEmployeeAttendanceHistory } from '../../services/AttendanceCleanupRunner.js';
import { rememberEmployeeMerge, mergedTargetOf, isMergedAway } from './EmployeeMergeRegistry.js';

const pendingLocalPurge = new Set();
const idOf = value => String(value ?? '').trim();
const findEmployee = id => (state.employees || []).find(employee => idOf(employee?.id) === idOf(id));

function stripHelpers(record) {
    const copy = { ...record };
    delete copy._source;
    delete copy._reassignTo;
    delete copy.role;
    delete copy.attendanceCount;
    delete copy.lastAttendance;
    delete copy.completeness;
    return copy;
}

/**
 * Fusiona `duplicateIds` en `masterId`. No guarda: llamar a
 * persistDuplicateResolution() al terminar el lote.
 * `members` (opcional): registros vistos en la nube que no están en memoria.
 * @returns {{ merged: number, skipped: string[] }}
 */
export function mergeDuplicateEmployees({ masterId, duplicateIds = [], members = [] } = {}) {
    const result = { merged: 0, skipped: [] };
    const master = idOf(masterId);
    if (!master) return result;
    const memberById = new Map(members.map(member => [idOf(member?.id), member]));
    if (!findEmployee(master)) {
        const cloudMaster = memberById.get(master);
        if (!cloudMaster) return { ...result, skipped: duplicateIds.map(idOf) };
        stateManager.batchSetState(() => { state.employees.push(stripHelpers(cloudMaster)); });
    }
    for (const rawId of duplicateIds) {
        const dup = idOf(rawId);
        if (!dup || dup === master) continue;
        if (findEmployee(dup)) {
            if (!mergeInState(master, dup)) { result.skipped.push(dup); continue; }
        } else if (memberById.has(dup)) {
            // Copia que solo está en la nube: se asimilan sus datos (préstamos
            // por id) sin traerla a la lista.
            const current = findEmployee(master);
            const fused = stripHelpers(mergeRecords(stripHelpers(memberById.get(dup)), current));
            fused.id = master;
            fused.updatedAt = Date.now();
            stateManager.batchSetState(() => {
                const index = state.employees.findIndex(employee => idOf(employee?.id) === master);
                if (index >= 0) state.employees[index] = fused;
            });
        } else {
            result.skipped.push(dup);
            continue;
        }
        const at = Date.now();
        rememberEmployeeMerge(dup, master, at);
        enqueueEmployeeTombstone(dup, at, { mergedIntoId: master });
        pendingLocalPurge.add(dup);
        result.merged++;
    }
    return result;
}

/** Guarda y borra de IndexedDB las copias fusionadas que nada usa ya. */
export async function persistDuplicateResolution(saveOptions = { immediate: true }) {
    await saveApplicationData(saveOptions);
    return purgeMergedEmployeesFromLocalStore();
}

export async function purgeMergedEmployeesFromLocalStore() {
    let removed = 0;
    for (const id of [...pendingLocalPurge]) {
        if (findEmployee(id)) continue;
        try {
            await indexedDBService.delete('employees', id);
            pendingLocalPurge.delete(id);
            removed++;
        } catch (error) {
            console.warn(`⚠️ No se pudo borrar del dispositivo la copia fusionada ${id}:`, error?.message || error);
        }
    }
    return removed;
}

/** Cambia el número de ficha (mismo comportamiento en todas las pantallas). */
export function changeEmployeeNumber(employeeId, newNumber, options = {}) {
    return reassignEmployeeNumber(employeeId, newNumber, options);
}

/**
 * Elimina un duplicado sobrante (lápida sin fusión). Con `purgeAttendance`
 * también borra su historial de asistencia.
 */
export function deleteDuplicateEmployee(employeeId, { purgeAttendance = true, at = Date.now() } = {}) {
    const id = idOf(employeeId);
    if (!id) return false;
    stateManager.batchSetState(() => {
        state.employees = state.employees.filter(employee => idOf(employee?.id) !== id);
    });
    enqueueEmployeeTombstone(id, at);
    if (purgeAttendance) purgeEmployeeAttendanceHistory(id);
    return true;
}

/**
 * Aplica las decisiones de un grupo de la pantalla «Duplicados» (plan de
 * DuplicateGroups.planGroupDecisions). Un solo camino para las cuatro
 * acciones: unir, cambiar ficha, eliminar y conservar.
 *   - Un integrante que solo está en la nube y se queda (conservar u otra
 *     persona) se trae a la lista antes de tocarlo.
 *   - Las fichas se cambian antes de unir, para que el principal no herede un
 *     número repetido.
 * No guarda: llamar a persistDuplicateResolution() al terminar.
 * @returns {{ merged: number, renumbered: number, deleted: number, skipped: string[] }}
 */
export function applyDuplicateGroupPlan(group, plan) {
    const result = { merged: 0, renumbered: 0, deleted: 0, skipped: [] };
    if (!group || !plan?.ok) return result;
    const members = (group.members || []).map(member => ({ ...(member.record || member), id: member.id }));
    const staying = new Set([plan.keeperId, ...plan.renumber.map(item => item.id)].filter(Boolean));
    for (const member of members) {
        if (!staying.has(member.id) || findEmployee(member.id)) continue;
        stateManager.batchSetState(() => { state.employees.push(stripHelpers(member)); });
    }
    for (const { id, number } of plan.renumber) {
        // allowCollision: la ficha ya se validó dentro de su obra; otra obra
        // puede usar el mismo número sin conflicto.
        if (changeEmployeeNumber(id, number, { allowCollision: true })) result.renumbered++;
        else result.skipped.push(id);
    }
    if (plan.keeperId && plan.mergeIds.length) {
        const merged = mergeDuplicateEmployees({ masterId: plan.keeperId, duplicateIds: plan.mergeIds, members });
        result.merged += merged.merged;
        result.skipped.push(...merged.skipped);
    }
    const at = Date.now();
    for (const id of plan.deleteIds) {
        if (deleteDuplicateEmployee(id, { at })) result.deleted++;
    }
    return result;
}

/**
 * Antes de aplicar la lista de la nube:
 *   - una lápida con `mergedIntoId` cuya copia sigue viva aquí se une a ese
 *     empleado (su asistencia o préstamos solo-locales no se pierden);
 *   - una copia que el registro local marca como fusionada se descarta aunque
 *     la nube todavía no tenga su lápida.
 * Devuelve la lista entrante sin esas copias vivas.
 */
export function absorbIncomingMergeMarkers(incoming = []) {
    let absorbed = 0;
    for (const record of incoming) {
        const id = idOf(record?.id);
        const into = idOf(record?.mergedIntoId);
        if (!id || !into || !Number.isFinite(record?.deletedAt)) continue;
        rememberEmployeeMerge(id, into, Number(record.mergedAt) || Number(record.deletedAt));
        const target = mergedTargetOf(id) || into;
        if (findEmployee(id) && findEmployee(target) && mergeInState(target, id)) {
            pendingLocalPurge.add(id);
            absorbed++;
        }
    }
    const filtered = [];
    for (const record of incoming) {
        if (Number.isFinite(record?.deletedAt) || !isMergedAway(record?.id)) { filtered.push(record); continue; }
        // La nube sigue con la copia viva (su lápida se perdió, p. ej. al
        // descargar antes de subir): se vuelve a encolar para corregirla.
        const id = idOf(record?.id);
        const into = mergedTargetOf(id);
        if (into) enqueueEmployeeTombstone(id, Date.now(), { mergedIntoId: into });
    }
    return { incoming: filtered, absorbed };
}
