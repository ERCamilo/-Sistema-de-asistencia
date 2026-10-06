import { createPayrollAdjustmentInstallmentPlans, ADJUSTMENT_PLAN_KIND } from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { editPayrollAdjustmentPlan, archivePayrollAdjustmentPlan } from '../modules/features/payroll/PayrollAdjustmentPlanEdit.js';
import { removeOrCancelPayrollAdjustmentPlans } from '../modules/features/payroll/PayrollAdjustmentCancellation.js';
import { buildScheduledAdjustmentGroups, renderScheduledAdjustmentGroups } from '../modules/features/payroll/PayrollAdjustmentScheduled.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

let serial = 0;
function setup({ total = 6000, count = 4 } = {}) {
    const [plan] = createPayrollAdjustmentInstallmentPlans({
        kind: ADJUSTMENT_PLAN_KIND.DEDUCTION, employeeIds: ['E2'], name: 'Herramienta perdida',
        totalAmount: total, installmentCount: count, singlePayment: count === 1, firstPeriodStart: '2026-08-21', createdAt: 100
    }, { createId: prefix => `${prefix}-${++serial}` });
    return [{ id: 'E2', number: '002', name: 'Empleado 002', bonuses: [], deductions: [plan], updatedAt: 1 }];
}

/** Aplica las primeras `n` cuotas como en un cierre de nómina. */
function applyFirst(employees, n, periods) {
    const plan = employees[0].deductions[0];
    for (let i = 0; i < n; i++) {
        const inst = plan.installments[i];
        Object.assign(inst, { status: 'applied', appliedAmount: inst.amount });
        plan.history.push({ id: `H-${i}`, action: 'applied', installmentId: inst.id, sequence: i + 1, amount: inst.amount, payrollClosureId: `C-${i}`, payrollPeriodStart: periods[i], payrollPeriodEnd: periods[i], recordedAt: 200 + i, source: 'payroll', voided: false });
    }
    plan.appliedInstallments = n;
    plan.appliedAmount = plan.installments.slice(0, n).reduce((t, x) => t + x.amount, 0);
    plan.balance = plan.totalAmount - plan.appliedAmount;
    plan.updatedAt = 300;
    return plan;
}

const ref = (employees, extra = {}) => ({ kind: 'deductions', employeeId: 'E2', planId: employees[0].deductions[0].id, expectedUpdatedAt: employees[0].deductions[0].updatedAt, now: 1000, ...extra });
const live = plan => plan.installments.filter(i => i.status !== 'cancelled');

describe('Editar y quitar planes programados', () => {
    test('sin cuotas aplicadas se edita todo y se puede borrar por completo', () => {
        const employees = setup();
        const before = JSON.stringify(employees);
        const { employees: next, plan } = editPayrollAdjustmentPlan(employees, ref(employees, { name: 'Botas', amount: 3000, installmentCount: 2, firstPeriodStart: '2026-10-02' }));
        expect(JSON.stringify(employees)).toBe(before); // no muta
        expect(plan).toMatchObject({ name: 'Botas', totalAmount: 3000, installmentCount: 2, firstPeriodStart: '2026-10-02', status: 'active', balance: 3000 });
        expect(live(plan).map(i => i.amount)).toEqual([1500, 1500]);
        expect(plan.edits).toHaveLength(1);
        expect(plan.edits[0].before).toMatchObject({ name: 'Herramienta perdida', totalAmount: 6000, installmentCount: 4 });
        // Editar no cuenta como movimiento: «Borrar» lo elimina por completo.
        const removed = removeOrCancelPayrollAdjustmentPlans(next, { kind: 'deductions', members: [{ employeeId: 'E2', planId: plan.id, groupId: plan.groupId, updatedAt: plan.updatedAt }], now: 2000, actor: null });
        expect(removed.employees[0].deductions).toHaveLength(0);
    });

    test('con cuotas aplicadas solo cambia lo pendiente; lo aplicado queda igual', () => {
        const employees = setup();
        applyFirst(employees, 2, ['2026-08-21', '2026-09-11']);
        expect(() => editPayrollAdjustmentPlan(employees, ref(employees, { amount: 2000, installmentCount: 1, firstPeriodStart: '2026-09-11' })))
            .toThrow(/posterior a la última cuota aplicada/);
        const { plan } = editPayrollAdjustmentPlan(employees, ref(employees, { amount: 2000, installmentCount: 1, firstPeriodStart: '2026-10-02' }));
        expect(plan).toMatchObject({ totalAmount: 5000, appliedAmount: 3000, balance: 2000, installmentCount: 3, status: 'active' });
        expect(live(plan).map(i => [i.sequence, i.amount, i.status])).toEqual([[1, 1500, 'applied'], [2, 1500, 'applied'], [3, 2000, 'pending']]);
        expect(plan.history.filter(h => h.action === 'applied')).toHaveLength(2);
    });

    test('una copia vieja de otro dispositivo no reactiva las cuotas reemplazadas', () => {
        const employees = setup();
        const { employees: next } = editPayrollAdjustmentPlan(employees, ref(employees, { amount: 3000, installmentCount: 2, firstPeriodStart: '2026-10-02' }));
        const merged = mergeEmployees(employees[0], next[0]);
        const plan = merged.deductions[0];
        expect(plan.totalAmount).toBe(3000);
        expect(live(plan).map(i => i.amount)).toEqual([1500, 1500]);
    });

    test('completado: no se edita, se quita de la lista y deja de verse en Programados', () => {
        const employees = setup({ total: 1500, count: 1 });
        const plan = applyFirst(employees, 1, ['2026-09-11']);
        plan.status = 'completed';
        plan.balance = 0;
        expect(() => editPayrollAdjustmentPlan(employees, ref(employees, { amount: 100, installmentCount: 1 }))).toThrow(/completado/);
        const period = { periodStart: '2026-10-02', periodEnd: '2026-10-22' };
        const html = renderScheduledAdjustmentGroups('deductions', buildScheduledAdjustmentGroups('deductions', employees, period));
        expect(html).toContain('Quitar de la lista');
        const { employees: next, plan: archived } = archivePayrollAdjustmentPlan(employees, ref(employees));
        expect(archived.archivedAt).toBe(1000);
        expect(archived.history).toHaveLength(1);
        expect(buildScheduledAdjustmentGroups('deductions', next, period)).toHaveLength(0);
    });

    test('activo con nómina abierta: muestra Editar con el formulario y sin ids internos', () => {
        const employees = setup();
        applyFirst(employees, 1, ['2026-08-21']);
        const html = renderScheduledAdjustmentGroups('deductions', buildScheduledAdjustmentGroups('deductions', employees, { periodStart: '2026-09-11', periodEnd: '2026-10-01' }));
        expect(html).toContain('Editar');
        expect(html).toContain('Monto pendiente por repartir');
        expect(html).toContain('🔒 Ya aplicadas en nóminas cerradas');
        expect(html).toContain('data-payroll-action="save-scheduled-adjustment-edit"');
        expect(html).not.toContain(employees[0].deductions[0].id);
    });
});
