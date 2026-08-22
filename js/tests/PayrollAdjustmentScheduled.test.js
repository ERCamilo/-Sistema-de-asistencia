import {
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    buildEmployeeScheduledAdjustmentPlans,
    buildScheduledAdjustmentGroups,
    renderEmployeeScheduledAdjustments,
    renderScheduledAdjustmentGroups
} from '../modules/features/payroll/PayrollAdjustmentScheduled.js';

function plansFor(kind, employeeIds, {
    name = 'Uniformes',
    totalAmount = 90,
    installmentCount = 3,
    firstPeriodStart = '2026-08-01',
    seed = kind
} = {}) {
    let serial = 0;
    return createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds,
        name,
        totalAmount,
        installmentCount,
        firstPeriodStart,
        createdAt: 100
    }, { createId: prefix => `${prefix}-${seed}-${++serial}` });
}

function completeFirstInstallment(plan, {
    closureId = 'PAYROLL-1',
    periodStart = '2026-08-01',
    periodEnd = '2026-08-15'
} = {}) {
    plan.installments[0].status = 'applied';
    plan.installments[0].appliedAmount = plan.installments[0].amount;
    plan.appliedInstallments = 1;
    plan.appliedAmount = plan.installments[0].amount;
    plan.balance = Number((plan.totalAmount - plan.appliedAmount).toFixed(2));
    plan.progressPercent = Number(((plan.appliedAmount / plan.totalAmount) * 100).toFixed(2));
    plan.history.push({
        id: `HISTORY-${plan.id}`,
        action: 'applied',
        installmentId: plan.installments[0].id,
        sequence: 1,
        amount: plan.installments[0].amount,
        payrollClosureId: closureId,
        payrollPeriodStart: periodStart,
        payrollPeriodEnd: periodEnd,
        recordedAt: Date.UTC(2026, 7, 15),
        source: 'payroll',
        voided: false
    });
}

describe('Payroll scheduled adjustments', () => {
    test('groups canonical plans by shared group without mixing bonus and deduction records', () => {
        const bonuses = plansFor(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1', 'EMP-2'], {
            name: 'Premio de obra', totalAmount: 100, installmentCount: 2, seed: 'bonus'
        });
        bonuses[1].totalAmount = 120;
        bonuses[1].balance = 120;
        bonuses[1].installments[0].amount = 60;
        bonuses[1].installments[1].amount = 60;
        const deduction = plansFor(ADJUSTMENT_PLAN_KIND.DEDUCTION, ['EMP-1'], {
            seed: 'deduction'
        })[0];
        const legacy = { id: 'LEGACY-1', name: 'Anterior', type: 'fixed', value: 999 };
        const employees = [
            { id: 'EMP-1', number: '1', name: 'Ada', bonuses: [bonuses[0], legacy], deductions: [deduction] },
            { id: 'EMP-2', number: '2', name: 'Grace', bonuses: [bonuses[1]], deductions: [] }
        ];
        const before = JSON.parse(JSON.stringify(employees));

        const bonusGroups = buildScheduledAdjustmentGroups('bonuses', employees);
        const deductionGroups = buildScheduledAdjustmentGroups('deductions', employees);

        expect(bonusGroups).toHaveLength(1);
        expect(bonusGroups[0]).toMatchObject({
            name: 'Premio de obra',
            kindLabel: 'Bonificación',
            employeeCount: 2,
            totalPerEmployee: null,
            hasDifferentTotals: true,
            installmentCount: 2,
            statusLabel: 'En curso'
        });
        expect(bonusGroups[0].employees.map(item => item.name)).toEqual(['Ada', 'Grace']);
        expect(deductionGroups).toHaveLength(1);
        expect(deductionGroups[0]).toMatchObject({ kindLabel: 'Descuento', employeeCount: 1 });
        expect(JSON.stringify(bonusGroups)).not.toContain('LEGACY-1');
        expect(employees).toEqual(before);
    });

    test('includes completed and missing employees with current totals, next installment and history', () => {
        const [known, missing] = plansFor(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1', 'EMP-MISSING'], {
            name: 'Meta mensual', totalAmount: 60, installmentCount: 2, seed: 'history'
        });
        completeFirstInstallment(known);
        missing.installments.forEach(item => {
            item.status = 'applied';
            item.appliedAmount = item.amount;
        });
        missing.appliedInstallments = 2;
        missing.appliedAmount = 60;
        missing.balance = 0;
        missing.progressPercent = 100;
        missing.status = ADJUSTMENT_PLAN_STATUS.COMPLETED;
        const employees = [
            { id: 'EMP-1', number: '1', name: 'Ada', bonuses: [known], deductions: [] },
            { id: 'ARCHIVED-HOLDER', number: '99', name: 'Registro archivado', bonuses: [missing], deductions: [] }
        ];

        const [group] = buildScheduledAdjustmentGroups('bonuses', employees);
        const ada = group.employees.find(item => item.employeeId === 'EMP-1');
        const unknown = group.employees.find(item => item.employeeId === 'EMP-MISSING');

        expect(group.statusLabel).toBe('En curso');
        expect(group.progressLabel).toBe('3 de 4 cuotas aplicadas');
        expect(ada).toMatchObject({
            name: 'Ada', totalAmount: 60, appliedAmount: 30, balance: 30,
            nextInstallment: { sequence: 2, amount: 30 }, statusLabel: 'En curso'
        });
        expect(ada.history[0]).toMatchObject({
            amount: 30,
            dateLabel: '15/08/2026',
            payrollLabel: 'Nómina del 01/08/2026 al 15/08/2026',
            statusLabel: 'Aplicada'
        });
        expect(unknown).toMatchObject({
            name: 'Empleado no disponible',
            statusLabel: 'Completado',
            nextInstallment: null
        });
    });

    test('renders employee plans and manual history without mutating modern or legacy data', () => {
        const bonus = plansFor(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1'], {
            name: 'Premio', totalAmount: 60, installmentCount: 2, seed: 'employee-bonus'
        })[0];
        const deduction = plansFor(ADJUSTMENT_PLAN_KIND.DEDUCTION, ['EMP-1'], {
            name: 'Uniforme', totalAmount: 90, installmentCount: 3, seed: 'employee-deduction'
        })[0];
        deduction.installments[0].appliedAmount = 10;
        deduction.appliedAmount = 10;
        deduction.balance = 80;
        deduction.progressPercent = 11.11;
        deduction.history.push({
            id: 'MANUAL-SECRET',
            recordType: 'payroll-adjustment-manual-movement',
            action: 'applied',
            source: 'manual',
            installmentId: deduction.installments[0].id,
            sequence: 1,
            amount: 10,
            date: '2026-08-12',
            recordedAt: Date.UTC(2026, 7, 12),
            recordedBy: 'María',
            note: 'Pago en efectivo',
            voided: false
        });
        const legacy = { id: 'LEGACY-SECRET', type: 'fixed', value: 999, name: 'Anterior' };
        const target = {
            id: 'EMP-1', number: '1', name: 'Ada',
            bonuses: [bonus], deductions: [deduction, legacy]
        };
        const before = JSON.parse(JSON.stringify(target));

        const plans = buildEmployeeScheduledAdjustmentPlans(target);
        const markup = renderEmployeeScheduledAdjustments(target, {
            draft: {
                kind: deduction.kind,
                planId: deduction.id,
                date: '2026-08-22',
                recordedBy: 'María'
            }
        });
        const host = document.createElement('div');
        host.innerHTML = markup;

        expect(plans).toHaveLength(2);
        expect(plans.find(item => item.kind === ADJUSTMENT_PLAN_KIND.DEDUCTION)
            .nextInstallment).toMatchObject({ sequence: 1, amount: 20 });
        expect(host.textContent).toContain('Bonificaciones y descuentos programados');
        expect(host.textContent).toContain('Registrar entrega');
        expect(host.textContent).toContain('Registrar abono');
        expect(host.textContent).toContain('María');
        expect(host.textContent).toContain('Pago en efectivo');
        expect(host.querySelector('[name="manualAmount"]')).not.toBeNull();
        expect(host.querySelector('[name="manualDate"]').value).toBe('2026-08-22');
        expect(host.querySelector('[name="manualRecordedBy"]').value).toBe('María');
        expect(host.textContent).not.toContain('LEGACY-SECRET');
        expect(markup).not.toContain(deduction.id);
        expect(markup).not.toContain(bonus.id);
        expect(markup).not.toContain('data-arg2');
        expect(markup).toContain('data-app-fn="openManualAdjustmentMovementAt"');
        expect(markup).toContain('data-app-fn="submitManualAdjustmentMovementAt"');
        expect(target).toEqual(before);

        const empty = document.createElement('div');
        empty.innerHTML = renderEmployeeScheduledAdjustments({
            id: 'EMP-EMPTY', name: 'Sin planes', bonuses: [], deductions: [legacy]
        });
        expect(empty.textContent).toContain('No hay bonificaciones ni descuentos programados');
    });

    test('renders clear empty and expandable detail states without exposing internal identifiers', () => {
        const [known, missing] = plansFor(ADJUSTMENT_PLAN_KIND.DEDUCTION, ['EMP-1', 'EMP-MISSING'], {
            name: 'Equipo de trabajo', totalAmount: 80, installmentCount: 2, seed: 'dom'
        });
        completeFirstInstallment(known, {
            closureId: 'SECRET-CLOSURE',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15'
        });
        missing.totalAmount = 100;
        missing.balance = 100;
        missing.installments[0].amount = 50;
        missing.installments[1].amount = 50;
        const employees = [
            { id: 'EMP-1', number: '1', name: 'Ada', bonuses: [], deductions: [known] },
            { id: 'ARCHIVED-HOLDER', name: 'Registro archivado', bonuses: [], deductions: [missing] }
        ];
        const before = JSON.parse(JSON.stringify(employees));
        const groups = buildScheduledAdjustmentGroups('deductions', employees);
        const markup = renderScheduledAdjustmentGroups('deductions', groups);
        expect(renderScheduledAdjustmentGroups('deductions', groups)).toBe(markup);
        const host = document.createElement('div');
        host.innerHTML = markup;

        const groupDetail = host.querySelector('[data-scheduled-group]');
        const employeeDetail = host.querySelector('.payroll-scheduled__employee');
        expect(host.querySelector('[data-scheduled-adjustments]')).not.toBeNull();
        expect(host.textContent).toContain('Programados');
        expect(host.textContent).toContain('Descuento');
        expect(host.textContent).toContain('2 empleados');
        expect(host.textContent).toContain('Importes distintos por empleado');
        expect(host.textContent).toContain('Empleado no disponible');
        expect(host.textContent).toContain('Sin movimientos todavía');
        expect(host.textContent).toContain('Nómina del 01/08/2026 al 15/08/2026');
        expect(host.textContent).not.toContain(known.groupId);
        expect(host.textContent).not.toContain(known.id);
        expect(host.textContent).not.toContain('SECRET-CLOSURE');

        groupDetail.open = true;
        employeeDetail.open = true;
        groupDetail.open = false;
        expect(employees).toEqual(before);

        const empty = document.createElement('div');
        empty.innerHTML = renderScheduledAdjustmentGroups('bonuses', []);
        expect(empty.textContent).toContain('No hay bonificaciones programadas');
    });
});
