import { isPayrollAdjustmentInstallmentPlan } from '../payroll/PayrollAdjustmentInstallmentPlan.js';
const id = value => String(value ?? '').trim();
const cents = value => Math.round(Number(value) * 100);

/** Eligibility only. A plan with any financial history requires a separate recovery. */
export function reviewFinancialPlanRepair(employee, kind, planId, projects = [], closures = []) {
    const plan = ['bonuses', 'deductions'].includes(kind)
        ? (employee?.[kind] || []).find(item => id(item?.id) === id(planId)) : null;
    const fail = reason => ({ ok: false, reason });
    if (!employee?.id || !isPayrollAdjustmentInstallmentPlan(plan) || id(plan.employeeId) !== id(employee.id)
        || plan.kind !== kind || plan.type !== 'fixed'
        || (employee[kind] || []).filter(item => id(item?.id) === id(planId)).length !== 1) {
        return fail('No se pudo verificar la identidad del plan y del empleado.');
    }
    const target = projects.find(project => id(project.id) === id(employee.projectId) && project.status === 'active');
    if (!target) return fail('Asigna primero al empleado a una obra activa.');
    if (financialPlanClosureReferences(employee.id, kind, plan.id, closures).length) return fail('El plan figura en cierres de nómina. Revisa esos cierres antes de cambiar su obra.');
    if (id(plan.projectId) === id(target.id)) return { ok: true, noOp: true, plan, target };
    if (projects.some(project => id(project.id) === id(plan.projectId))) return fail('El plan pertenece a otra obra existente. Revisa su origen.');
    if (!['active', 'paused'].includes(plan.status) || !Array.isArray(plan.history) || plan.history.length
        || Number(plan.appliedAmount) !== 0 || Number(plan.appliedInstallments) !== 0
        || !Array.isArray(plan.installments) || !plan.installments.length
        || plan.installments.some(item => item.status !== 'pending' || Number(item.appliedAmount) !== 0)) {
        return fail('El plan tiene historial o cuotas que requieren revisión. Conserva el original y revisa los cierres antes de cambiar su obra.');
    }
    const total = cents(plan.totalAmount);
    const amounts = plan.installments.map(item => cents(item.amount));
    if (!Number.isFinite(Number(plan.updatedAt)) || plan.updatedAt == null
        || new Set(plan.installments.map(item => id(item.id))).size !== plan.installments.length
        || plan.installments.some(item => !id(item.id)) || !Number.isFinite(total) || total <= 0 || amounts.some(amount => !Number.isFinite(amount) || amount <= 0)
        || amounts.reduce((sum, amount) => sum + amount, 0) !== total || cents(plan.balance) !== total
        || Number(plan.installmentCount) !== plan.installments.length) {
        return fail('Los importes o el número de cuotas no coinciden. Revisa el plan antes de asignarlo.');
    }
    return { ok: true, noOp: false, plan, target };
}

/** Includes voided closures: their financial provenance still matters. */
export function financialPlanClosureReferences(employeeId, kind, planId, closures = []) {
    const detailsKey = kind === 'bonuses' ? 'bonusDetails' : 'deductionDetails';
    return (Array.isArray(closures) ? closures : []).filter(closure =>
        (Array.isArray(closure?.rows) ? closure.rows : []).some(row =>
            (Array.isArray(row?.[detailsKey]) ? row[detailsKey] : []).some(detail =>
                detail?.recordType === 'payroll-adjustment-installment-application'
                && id(detail.planId) === id(planId)
                && [row.employeeId, detail.employeeId].some(value => id(value) === id(employeeId)))));
}
