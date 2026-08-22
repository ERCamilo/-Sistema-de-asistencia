import {
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    applyPayrollAdjustmentInstallmentsForClosure,
    buildPayrollAdjustmentInstallmentPreview,
    undoPayrollAdjustmentInstallmentsForClosure
} from '../modules/features/payroll/PayrollAdjustmentInstallmentSettlement.js';
import {
    applyManualAdjustmentMovement,
    MANUAL_ADJUSTMENT_MOVEMENT_RECORD_TYPE
} from '../modules/features/payroll/PayrollAdjustmentManualMovement.js';

function employeeWithPlan(kind = ADJUSTMENT_PLAN_KIND.DEDUCTION) {
    let serial = 0;
    const plan = createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds: ['EMP-1'],
        name: kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Premio' : 'Uniforme',
        totalAmount: 90,
        installmentCount: 3,
        firstPeriodStart: '2026-08-01',
        createdAt: 100
    }, { createId: prefix => `${prefix}-${kind}-${++serial}` })[0];
    return { employee: { id: 'EMP-1', name: 'Ada', bonuses: [], deductions: [], updatedAt: 50 }, plan };
}

function input(plan, overrides = {}) {
    return {
        kind: plan.kind,
        planId: plan.id,
        id: 'MANUAL-1',
        amount: 10,
        date: '2026-08-10',
        recordedBy: 'María',
        note: 'Pago en efectivo',
        ...overrides
    };
}

function closureFor(preview, id = 'PAYROLL-1') {
    return {
        id,
        status: 'closed',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        closedAt: 300,
        closedBy: 'operator-1',
        rows: [{
            employeeId: 'EMP-1',
            bonusDetails: preview.bonusDetails,
            deductionDetails: preview.deductionDetails
        }]
    };
}

describe('Payroll adjustment manual movements', () => {
    test('applies a partial amount to the oldest pending installment without mutating the source', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];
        const before = JSON.parse(JSON.stringify(employee));

        const result = applyManualAdjustmentMovement(employee, input(plan), { now: 200 });
        const changedPlan = result.employee.deductions[0];

        expect(result.changed).toBe(true);
        expect(employee).toEqual(before);
        expect(changedPlan).toMatchObject({
            appliedAmount: 10,
            balance: 80,
            appliedInstallments: 0,
            progressPercent: 11.11,
            status: ADJUSTMENT_PLAN_STATUS.ACTIVE
        });
        expect(changedPlan.installments[0]).toMatchObject({
            status: 'pending', appliedAmount: 10
        });
        expect(changedPlan.history[0]).toMatchObject({
            id: 'MANUAL-1',
            recordType: MANUAL_ADJUSTMENT_MOVEMENT_RECORD_TYPE,
            source: 'manual',
            amount: 10,
            date: '2026-08-10',
            recordedBy: 'María',
            note: 'Pago en efectivo',
            allocations: [{ sequence: 1, amount: 10 }]
        });
    });

    test('covers several installments chronologically and leaves the last one partial', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];

        const result = applyManualAdjustmentMovement(employee, input(plan, { amount: 50 }), {
            now: 200
        });
        const installments = result.employee.deductions[0].installments;

        expect(installments[0]).toMatchObject({ status: 'applied', appliedAmount: 30 });
        expect(installments[1]).toMatchObject({ status: 'pending', appliedAmount: 20 });
        expect(installments[2]).toMatchObject({ status: 'pending', appliedAmount: 0 });
        expect(result.employee.deductions[0]).toMatchObject({
            appliedAmount: 50, balance: 40, appliedInstallments: 1
        });
    });

    test.each([
        ADJUSTMENT_PLAN_KIND.BONUS,
        ADJUSTMENT_PLAN_KIND.DEDUCTION
    ])('accepts the exact final amount and completes a %s plan', kind => {
        const { employee, plan } = employeeWithPlan(kind);
        employee[kind] = [plan];

        const result = applyManualAdjustmentMovement(employee, input(plan, { amount: 90 }), {
            now: 200
        });

        expect(result.employee[kind][0]).toMatchObject({
            appliedAmount: 90,
            balance: 0,
            appliedInstallments: 3,
            progressPercent: 100,
            status: ADJUSTMENT_PLAN_STATUS.COMPLETED
        });
    });

    test('rejects an amount above the balance and a completed, invalid owner or wrong-category plan', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];

        expect(() => applyManualAdjustmentMovement(
            employee, input(plan, { amount: 90.01 }), { now: 200 }
        )).toThrow('mayor que el saldo');

        plan.status = ADJUSTMENT_PLAN_STATUS.COMPLETED;
        expect(() => applyManualAdjustmentMovement(
            employee, input(plan), { now: 200 }
        )).toThrow('completado');

        plan.status = ADJUSTMENT_PLAN_STATUS.ACTIVE;
        plan.employeeId = 'EMP-2';
        expect(() => applyManualAdjustmentMovement(
            employee, input(plan), { now: 200 }
        )).toThrow('no pertenece');

        plan.employeeId = employee.id;
        employee.deductions = [];
        employee.bonuses = [plan];
        expect(() => applyManualAdjustmentMovement(
            employee, input(plan), { now: 200 }
        )).toThrow('plan seleccionado no es válido');
    });

    test('is idempotent by movement id', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];
        const first = applyManualAdjustmentMovement(employee, input(plan), { now: 200 });
        const second = applyManualAdjustmentMovement(
            first.employee,
            input(first.employee.deductions[0], { amount: 25, note: 'Reintento diferente' }),
            { now: 300 }
        );

        expect(second.changed).toBe(false);
        expect(second.employee).toBe(first.employee);
        expect(second.employee.deductions[0]).toMatchObject({ appliedAmount: 10, balance: 80 });
        expect(second.employee.deductions[0].history).toHaveLength(1);
    });

    test('correction relinks only the payroll portion and reopening preserves the manual payment', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];
        const manual = applyManualAdjustmentMovement(employee, input(plan), { now: 200 }).employee;

        const originalPreview = buildPayrollAdjustmentInstallmentPreview(manual, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const originalClosure = closureFor(originalPreview, 'PAYROLL-1');
        applyPayrollAdjustmentInstallmentsForClosure([manual], originalClosure, { now: 300 });

        const correctionPreview = buildPayrollAdjustmentInstallmentPreview(manual, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const correctionClosure = {
            ...closureFor(correctionPreview, 'PAYROLL-2'),
            supersedesId: 'PAYROLL-1'
        };

        expect(correctionPreview.deductionTotal).toBe(20);
        expect(correctionPreview.deductionDetails[0].amount).toBe(20);
        expect(() => applyPayrollAdjustmentInstallmentsForClosure(
            [manual], correctionClosure, { now: 400 }
        )).not.toThrow();
        expect(manual.deductions[0]).toMatchObject({
            appliedAmount: 30, balance: 60, appliedInstallments: 1
        });
        expect(manual.deductions[0].history.find(entry =>
            entry.source === 'payroll'
        )).toMatchObject({
            amount: 20,
            payrollClosureId: 'PAYROLL-2',
            payrollSupersedesClosureId: 'PAYROLL-1',
            voided: false
        });

        undoPayrollAdjustmentInstallmentsForClosure(
            [manual], correctionClosure, { now: 500 }
        );
        expect(manual.deductions[0]).toMatchObject({
            appliedAmount: 10, balance: 80, appliedInstallments: 0
        });
        expect(manual.deductions[0].installments[0]).toMatchObject({
            status: 'pending', appliedAmount: 10
        });
        expect(manual.deductions[0].history.find(entry =>
            entry.source === 'manual'
        )).toMatchObject({ id: 'MANUAL-1', amount: 10, voided: false });
    });

    test('preview and payroll closure use only the remaining installment and undo preserves manual value', () => {
        const { employee, plan } = employeeWithPlan();
        employee.deductions = [plan];
        const manual = applyManualAdjustmentMovement(employee, input(plan), { now: 200 }).employee;

        const preview = buildPayrollAdjustmentInstallmentPreview(manual, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const closure = closureFor(preview);
        applyPayrollAdjustmentInstallmentsForClosure([manual], closure, { now: 300 });

        expect(preview.deductionTotal).toBe(20);
        expect(manual.deductions[0]).toMatchObject({
            appliedAmount: 30, balance: 60, appliedInstallments: 1
        });
        expect(manual.deductions[0].history).toHaveLength(2);

        undoPayrollAdjustmentInstallmentsForClosure([manual], closure, { now: 400 });
        expect(manual.deductions[0]).toMatchObject({
            appliedAmount: 10, balance: 80, appliedInstallments: 0
        });
        expect(manual.deductions[0].installments[0]).toMatchObject({
            status: 'pending', appliedAmount: 10
        });
        expect(manual.deductions[0].history[0]).toMatchObject({
            id: 'MANUAL-1', voided: false
        });
    });
});
