/**
 * 🗑️ EmployeeDeletion.js
 *
 * Orquestador del borrado PERMANENTE de un empleado. Junta el guard
 * (canDeleteEmployee) con los efectos, inyectados para poder testear sin
 * nube ni state real:
 *
 *   - enqueueTombstone(id, deletedAt): encola el tombstone durable en el
 *     outbox (soft-delete robusto — no resucita multi-dispositivo).
 *   - removeFromState(id): saca el empleado de la vista local.
 *   - persist(): guarda + dispara el drenado del outbox.
 *
 * ORDEN: encolar el tombstone ANTES de sacarlo de state — el tombstone es la
 * fuente durable del borrado; sacarlo de state es solo cosmético para la
 * sesión actual (el filtro de carga/sync lo mantiene fuera después).
 *
 * NO borra la asistencia histórica del empleado: el guard de días ya protege
 * la nómina reciente, y la asistencia queda como registro de auditoría (no se
 * muestra en vistas por-empleado porque el empleado ya no está en la lista).
 */

import { canDeleteEmployee } from './EmployeeDeletionGuard.js';

/**
 * @param {object|null} emp
 * @param {{
 *   now?: number,
 *   minInactiveDays?: number,
 *   enqueueTombstone: (id: string, deletedAt: number) => void,
 *   removeFromState: (id: string) => void,
 *   persist: () => void
 * }} deps
 * @returns {{ok: boolean, reason?: string}}
 */
export function deleteEmployeePermanently(emp, deps = {}) {
    const now = Number.isFinite(deps.now) ? deps.now : Date.now();
    const check = canDeleteEmployee(emp, { now, minInactiveDays: deps.minInactiveDays });
    if (!check.ok) return check;

    const id = emp.id;
    deps.enqueueTombstone(id, now);   // durable primero
    deps.removeFromState(id);         // cosmético para la sesión actual
    deps.persist();                   // guarda + drena el outbox
    return { ok: true };
}

export default deleteEmployeePermanently;
