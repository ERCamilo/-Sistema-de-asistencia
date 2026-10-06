/**
 * ✏️ PayrollAdjustmentPlanEdit — editar y quitar de la lista las bonificaciones
 * y descuentos programados (paso 4 de Nómina).
 *
 * Reglas (maqueta del paso 4, aprobada el 06/10):
 *   - Sin cuotas aplicadas: se edita todo (concepto, monto total, cuotas y
 *     primera nómina).
 *   - Con cuotas aplicadas en nóminas cerradas: esas cuotas quedan con candado;
 *     solo se cambia lo pendiente (monto por repartir, cuotas que faltan y la
 *     nómina desde la que siguen). El total del plan = aplicado + pendiente.
 *   - Completado o cancelado: no se edita; «Quitar de la lista» lo oculta de
 *     Programados (archivedAt) y conserva todo su historial.
 * Cada edición queda en plan.edits con el antes y el después.
 *
 * Funciones puras: devuelven empleados nuevos y no tocan los originales.
 */

import {
    ADJUSTMENT_PLAN_STATUS,
    ADJUSTMENT_INSTALLMENT_STATUS,
    isPayrollAdjustmentInstallmentPlan,
    normalizeFirstPeriodStart,
    recomputePayrollAdjustmentInstallmentPlan,
    splitAdjustmentInstallments,
    getPayrollAdjustmentInstallmentAppliedAmount
} from './PayrollAdjustmentInstallmentPlan.js';

const KINDS = new Set(['bonuses', 'deductions']);
const MAX_INSTALLMENTS = 52;
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const text = value => String(value ?? '').trim();
const clone = value => JSON.parse(JSON.stringify(value));

/** Cuotas con algo aplicado (candado) y cuotas sin empezar. */
export function splitPlanInstallments(plan) {
    const installments = (plan?.installments || []).filter(item => item && item.status !== ADJUSTMENT_INSTALLMENT_STATUS.CANCELLED);
    const locked = installments.filter(item => getPayrollAdjustmentInstallmentAppliedAmount(item) > 0);
    const pending = installments.filter(item => getPayrollAdjustmentInstallmentAppliedAmount(item) === 0);
    return {
        locked,
        pending,
        lockedAmount: money(locked.reduce((sum, item) => sum + money(item.amount), 0)),
        pendingAmount: money(pending.reduce((sum, item) => sum + money(item.amount), 0))
    };
}

/** Inicio de la última nómina en la que se aplicó una cuota (o null). */
export function lastAppliedPeriodStart(plan) {
    return (plan?.history || [])
        .filter(entry => entry && entry.action === 'applied' && !entry.voided && entry.payrollPeriodStart)
        .map(entry => text(entry.payrollPeriodStart))
        .sort()
        .at(-1) || null;
}

export function canEditPayrollAdjustmentPlan(plan) {
    return isPayrollAdjustmentInstallmentPlan(plan) && !plan.archivedAt &&
        [ADJUSTMENT_PLAN_STATUS.ACTIVE, ADJUSTMENT_PLAN_STATUS.PAUSED].includes(plan.status);
}

export function canArchivePayrollAdjustmentPlan(plan) {
    return isPayrollAdjustmentInstallmentPlan(plan) && !plan.archivedAt &&
        [ADJUSTMENT_PLAN_STATUS.COMPLETED, ADJUSTMENT_PLAN_STATUS.CANCELLED].includes(plan.status);
}

function locate(employees, { kind, employeeId, planId, expectedUpdatedAt }) {
    if (!KINDS.has(kind)) throw new Error('El tipo de programación no es válido');
    const index = (employees || []).findIndex(employee => text(employee?.id) === text(employeeId));
    if (index < 0) throw new Error('El empleado ya no existe');
    const employee = employees[index];
    const plans = Array.isArray(employee[kind]) ? employee[kind] : [];
    const planIndex = plans.findIndex(plan => isPayrollAdjustmentInstallmentPlan(plan) && text(plan.id) === text(planId));
    if (planIndex < 0) throw new Error('La programación ya no existe');
    if (expectedUpdatedAt != null && Number(plans[planIndex].updatedAt) !== Number(expectedUpdatedAt)) {
        throw new Error('La programación cambió. Ábrela nuevamente e inténtalo otra vez.');
    }
    return { index, employee, plans, planIndex, plan: clone(plans[planIndex]) };
}

function replace(employees, found, plan, now) {
    const plans = found.plans.map((item, i) => (i === found.planIndex ? plan : item));
    const employee = { ...found.employee, [plan.kind]: plans, updatedAt: Math.max(Number(found.employee.updatedAt) || 0, now) };
    return employees.map((item, i) => (i === found.index ? employee : item));
}

const snapshot = plan => ({
    name: plan.name,
    totalAmount: money(plan.totalAmount),
    installmentCount: Number(plan.installmentCount) || 0,
    firstPeriodStart: plan.firstPeriodStart,
    pendingAmount: splitPlanInstallments(plan).pendingAmount
});

/**
 * @param {object} params
 *   kind, employeeId, planId, expectedUpdatedAt
 *   name, amount (total si no hay cuotas aplicadas; si hay, lo pendiente),
 *   installmentCount (todas, o las que faltan), firstPeriodStart, now, actor
 */
export function editPayrollAdjustmentPlan(employees, params = {}) {
    const now = Number(params.now) || Date.now();
    const found = locate(employees, params);
    const plan = found.plan;
    if (!canEditPayrollAdjustmentPlan(plan)) {
        throw new Error(plan.status === ADJUSTMENT_PLAN_STATUS.COMPLETED
            ? 'Un pago programado completado no se edita; puedes quitarlo de la lista.'
            : 'Esta programación ya no se puede editar.');
    }
    const name = text(params.name ?? plan.name);
    if (!name) throw new Error('Escribe el concepto');
    const amount = money(params.amount);
    if (!(amount > 0)) throw new Error('El monto debe ser mayor a 0');
    const count = Math.trunc(Number(params.installmentCount));
    if (!(count >= 1 && count <= MAX_INSTALLMENTS)) throw new Error(`Las cuotas deben ser entre 1 y ${MAX_INSTALLMENTS}`);
    const firstPeriodStart = normalizeFirstPeriodStart(params.firstPeriodStart ?? plan.firstPeriodStart);
    const { locked, pending, lockedAmount } = splitPlanInstallments(plan);
    const lastApplied = lastAppliedPeriodStart(plan);
    if (locked.length && lastApplied && firstPeriodStart <= lastApplied) {
        throw new Error('Lo pendiente debe seguir en una nómina posterior a la última cuota aplicada');
    }
    const before = snapshot(plan);
    const amounts = count === 1 ? [amount] : splitAdjustmentInstallments(amount, count);
    const firstSequence = locked.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0);
    // Las pendientes anteriores quedan canceladas (no se borran): así una copia vieja
    // de otro dispositivo no las vuelve a activar al sincronizar.
    const pendingIds = new Set(pending.map(item => text(item.id)));
    const replaced = (plan.installments || []).filter(item => pendingIds.has(text(item.id)))
        .map(item => ({ ...item, status: ADJUSTMENT_INSTALLMENT_STATUS.CANCELLED, cancelledAt: now, updatedAt: now }));
    const untouched = (plan.installments || []).filter(item => !pendingIds.has(text(item.id)) && !locked.includes(item));
    const fresh = amounts.map((value, i) => ({
        id: `${plan.id}-E${now}-${i + 1}`,
        sequence: firstSequence + i + 1,
        amount: money(value),
        appliedAmount: 0,
        status: ADJUSTMENT_INSTALLMENT_STATUS.PENDING
    }));
    plan.name = name;
    plan.installments = [...locked, ...fresh, ...untouched, ...replaced];
    plan.installmentCount = locked.length + fresh.length;
    plan.totalAmount = money(lockedAmount + amount);
    plan.firstPeriodStart = firstPeriodStart;
    recomputePayrollAdjustmentInstallmentPlan(plan, now);
    // Las ediciones van aparte del historial de cuotas (que solo guarda lo aplicado).
    plan.edits = [...(plan.edits || []), {
        id: `${plan.id}-EDIT-${now}`,
        recordedAt: now,
        recordedBy: params.actor ?? null,
        before,
        after: snapshot(plan)
    }];
    return { employees: replace(employees, found, plan, now), plan };
}

/** «Quitar de la lista» un plan completado o cancelado (conserva el historial). */
export function archivePayrollAdjustmentPlan(employees, params = {}) {
    const now = Number(params.now) || Date.now();
    const found = locate(employees, params);
    const plan = found.plan;
    if (!canArchivePayrollAdjustmentPlan(plan)) {
        throw new Error('Solo se quitan de la lista los pagos completados o cancelados');
    }
    plan.archivedAt = now;
    plan.archivedBy = params.actor ?? null;
    plan.updatedAt = now;
    return { employees: replace(employees, found, plan, now), plan };
}
