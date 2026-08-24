import {
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_RECORD_TYPE,
    ADJUSTMENT_PLAN_STATUS,
    createPayrollAdjustmentInstallmentPlans,
    isPayrollAdjustmentInstallmentPlan,
    normalizeEmployeeAdjustmentEntries,
    setPayrollAdjustmentPlanPaused,
    splitAdjustmentInstallments
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';

function sequentialIds() {
    let value = 0;
    return prefix => `${prefix}-${++value}`;
}

describe('PayrollAdjustmentInstallmentPlan', () => {
    test('creates one fixed plan per employee with a shared group and independent ids', () => {
        const plans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            employeeIds: ['EMP-2', 'EMP-1', 'EMP-2'],
            name: 'Bono de productividad',
            totalAmount: 100,
            installmentCount: 3,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        }, { createId: sequentialIds() });

        expect(plans).toHaveLength(2);
        expect(plans.map(plan => plan.employeeId)).toEqual(['EMP-1', 'EMP-2']);
        expect(new Set(plans.map(plan => plan.groupId)).size).toBe(1);
        expect(new Set(plans.map(plan => plan.id)).size).toBe(2);
        expect(plans[0]).toMatchObject({
            recordType: ADJUSTMENT_PLAN_RECORD_TYPE,
            version: 1,
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            type: 'fixed',
            name: 'Bono de productividad',
            totalAmount: 100,
            balance: 100,
            appliedAmount: 0,
            installmentCount: 3,
            appliedInstallments: 0,
            progressPercent: 0,
            status: ADJUSTMENT_PLAN_STATUS.ACTIVE,
            firstPeriodStart: '2026-08-16',
            history: [],
            createdAt: 1_787_299_200_000,
            updatedAt: 1_787_299_200_000
        });
        expect(plans[0].installments.map(item => item.amount)).toEqual([33.33, 33.33, 33.34]);
        expect(new Set(plans.flatMap(plan => plan.installments.map(item => item.id))).size).toBe(6);
    });

    test('creates one canonical scheduled payment per employee only through the explicit single-payment flow', () => {
        const plans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-2', 'EMP-1'],
            name: 'Herramientas',
            totalAmount: 75,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        }, { createId: sequentialIds() });

        expect(plans).toHaveLength(2);
        expect(new Set(plans.map(plan => plan.groupId)).size).toBe(1);
        expect(new Set(plans.map(plan => plan.id)).size).toBe(2);
        expect(plans.every(plan => plan.installmentCount === 1)).toBe(true);
        expect(plans.map(plan => plan.installments.map(item => item.amount)))
            .toEqual([[75], [75]]);
        expect(() => createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-1'],
            name: 'Herramientas',
            totalAmount: 75,
            installmentCount: 1,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        }, { createId: sequentialIds() })).toThrow('cuotas');
    });

    test('pauses and resumes only pending one-payment plans while completed plans stay final', () => {
        const [plan] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            employeeIds: ['EMP-1'],
            name: 'Reconocimiento',
            totalAmount: 120,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-08-16',
            createdAt: 100
        }, { createId: sequentialIds() });

        const paused = setPayrollAdjustmentPlanPaused(plan, true, 200);
        expect(paused).toMatchObject({ status: 'paused', updatedAt: 200 });
        expect(plan.status).toBe(ADJUSTMENT_PLAN_STATUS.ACTIVE);
        expect(setPayrollAdjustmentPlanPaused(paused, false, 300))
            .toMatchObject({ status: ADJUSTMENT_PLAN_STATUS.ACTIVE, updatedAt: 300 });

        const completed = { ...plan, status: ADJUSTMENT_PLAN_STATUS.COMPLETED, balance: 0 };
        expect(() => setPayrollAdjustmentPlanPaused(completed, true, 400)).toThrow('completado');
        expect(() => setPayrollAdjustmentPlanPaused(completed, false, 400)).toThrow('completado');
    });

    test('creates deterministic output when the same dependencies and input are supplied', () => {
        const input = {
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-9'],
            name: 'Uniforme',
            totalAmount: 10,
            installmentCount: 3,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        };

        const first = createPayrollAdjustmentInstallmentPlans(input, { createId: sequentialIds() });
        const second = createPayrollAdjustmentInstallmentPlans(input, { createId: sequentialIds() });

        expect(second).toEqual(first);
    });

    test.each([
        [{ kind: 'global', employeeIds: ['EMP-1'], totalAmount: 100, installmentCount: 2 }, 'tipo'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: [], totalAmount: 100, installmentCount: 2 }, 'empleado'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1'], totalAmount: 0, installmentCount: 2 }, 'monto'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1'], totalAmount: 100, installmentCount: 1 }, 'cuotas'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1'], totalAmount: 100, installmentCount: 2.5 }, 'cuotas'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1'], totalAmount: 100, installmentCount: 2, firstPeriodStart: '' }, 'primera nómina'],
        [{ kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1'], totalAmount: 100, installmentCount: 2, firstPeriodStart: '2026-02-31' }, 'primera nómina']
    ])('rejects invalid plan input %#', (input, message) => {
        expect(() => createPayrollAdjustmentInstallmentPlans({
            name: 'Ajuste',
            firstPeriodStart: input.firstPeriodStart ?? '2026-08-16',
            createdAt: 1_787_299_200_000,
            ...input
        }, { createId: sequentialIds() })).toThrow(message);
    });

    test('splits money at two decimals and adjusts only the final installment', () => {
        expect(splitAdjustmentInstallments(0.05, 2)).toEqual([0.02, 0.03]);
        expect(splitAdjustmentInstallments(100, 6)).toEqual([16.66, 16.66, 16.66, 16.66, 16.66, 16.7]);
        expect(splitAdjustmentInstallments(10.01, 3).reduce((sum, value) => sum + value, 0)).toBeCloseTo(10.01, 2);
    });

    test('detects modern plans only through their explicit record marker', () => {
        const [modern] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-1'],
            name: 'Equipo',
            totalAmount: 60,
            installmentCount: 3,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        }, { createId: sequentialIds() });
        const legacy = {
            id: 'DED-OLD',
            type: 'fixed',
            value: 20,
            installments: [{ amount: 10 }, { amount: 10 }]
        };

        expect(isPayrollAdjustmentInstallmentPlan(modern)).toBe(true);
        expect(isPayrollAdjustmentInstallmentPlan(legacy)).toBe(false);
        expect(isPayrollAdjustmentInstallmentPlan({ ...modern, version: 99 })).toBe(false);
    });

    test('normalizes modern entries without mutating or converting legacy adjustments', () => {
        const legacy = { id: 'BON-OLD', type: 'fixed', value: 25, name: 'Bono antiguo' };
        const [modern] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            employeeIds: ['EMP-1'],
            name: 'Bono nuevo',
            totalAmount: 75,
            installmentCount: 3,
            firstPeriodStart: '2026-08-16',
            createdAt: 1_787_299_200_000
        }, { createId: sequentialIds() });
        modern.status = ADJUSTMENT_PLAN_STATUS.PAUSED;
        const source = [legacy, modern];

        const normalized = normalizeEmployeeAdjustmentEntries(source);

        expect(normalized).not.toBe(source);
        expect(normalized[0]).toBe(legacy);
        expect(normalized[0]).toEqual({ id: 'BON-OLD', type: 'fixed', value: 25, name: 'Bono antiguo' });
        expect(normalized[1]).not.toBe(modern);
        expect(normalized[1]).toEqual(modern);
        expect(normalized[1].status).toBe(ADJUSTMENT_PLAN_STATUS.PAUSED);
        expect(source).toEqual([legacy, modern]);
    });
});
