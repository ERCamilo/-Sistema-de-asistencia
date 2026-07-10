/**
 * 🛡️ EmployeeDeletionGuard.js
 *
 * Salvaguardas para eliminar un empleado de forma PERMANENTE (decidido con
 * el usuario 2026-07-06). Eliminar pierde los datos del empleado, así que
 * canDeleteEmployee exige TODO esto antes de permitirlo:
 *
 *   1. Debe estar DESACTIVADO (pausado) — la "papelera" previa al borrado.
 *   2. Debe llevar >= minInactiveDays días desactivado (default 30, ~un ciclo
 *      de nómina) — evita perder el registro de un período reciente trabajado.
 *   3. Sin préstamos ACTIVOS con saldo pendiente — proteger la plata.
 *
 * Función PURA: no toca state ni la nube. La confirmación "ya se le pagó el
 * período actual" NO va acá (no es verificable) — se pide en la UI.
 */

import { getBalance, LOAN_STATUS } from '../features/loans/LoansService.js';

export const DEFAULT_MIN_INACTIVE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ¿El empleado tiene algún préstamo activo con saldo pendiente? */
function hasOutstandingBalance(emp) {
    const loans = Array.isArray(emp?.loans) ? emp.loans : [];
    return loans.some(l => l && l.status === LOAN_STATUS.ACTIVE && getBalance(l) > 0.01);
}

/** Días transcurridos desde la desactivación, o null si no se puede saber. */
function daysSinceInactive(emp, now) {
    const raw = emp?.lastStatusChange;
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const t = new Date(raw + 'T00:00:00').getTime();
    if (!Number.isFinite(t)) return null;
    return Math.floor((now - t) / DAY_MS);
}

/**
 * @param {object|null} emp
 * @param {{now?: number, minInactiveDays?: number}} [opts]
 * @returns {{ok: boolean, reason?: string}}
 */
export function canDeleteEmployee(emp, opts = {}) {
    if (!emp || typeof emp !== 'object') {
        return { ok: false, reason: 'Empleado no válido.' };
    }
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const minDays = Number.isFinite(opts.minInactiveDays) ? opts.minInactiveDays : DEFAULT_MIN_INACTIVE_DAYS;

    if (emp.active) {
        return { ok: false, reason: 'El empleado debe estar desactivado antes de poder eliminarlo.' };
    }

    if (hasOutstandingBalance(emp)) {
        return { ok: false, reason: 'Tiene préstamos activos con saldo pendiente. Saldá o anulá esos préstamos antes de eliminarlo.' };
    }

    const days = daysSinceInactive(emp, now);
    if (days === null) {
        return { ok: false, reason: 'No se puede confirmar hace cuánto está desactivado. Desactivalo de nuevo y esperá el mínimo de días.' };
    }
    if (days < minDays) {
        return { ok: false, reason: `Debe estar desactivado al menos ${minDays} días antes de eliminarlo (lleva ${days}). Así no se pierde el registro de nómina de un período reciente.` };
    }

    return { ok: true };
}

/**
 * Guard MÁS LIVIANO para el wizard de duplicados (Feature #2): un duplicado
 * recién detectado no suele estar pausado ni llevar 30 días, así que acá SOLO
 * se protege la plata — no se puede eliminar si tiene préstamos activos con
 * saldo pendiente. Sin requisito de inactividad ni antigüedad.
 * @param {object|null} emp
 * @returns {{ok: boolean, reason?: string}}
 */
export function canDeleteDuplicateEmployee(emp) {
    if (!emp || typeof emp !== 'object') {
        return { ok: false, reason: 'Empleado no válido.' };
    }
    if (hasOutstandingBalance(emp)) {
        return { ok: false, reason: 'Tiene préstamos activos con saldo pendiente. Saldá o anulá esos préstamos, o unilo al principal en vez de eliminarlo.' };
    }
    return { ok: true };
}

export default canDeleteEmployee;
