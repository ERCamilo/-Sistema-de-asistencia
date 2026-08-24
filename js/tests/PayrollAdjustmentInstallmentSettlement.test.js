import {
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    createPayrollAdjustmentInstallmentPlans,
    setPayrollAdjustmentPlanPaused
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    applyPayrollAdjustmentInstallmentsForClosure,
    buildPayrollAdjustmentInstallmentPreview,
    undoPayrollAdjustmentInstallmentsForClosure
} from '../modules/features/payroll/PayrollAdjustmentInstallmentSettlement.js';

function createPlan(kind, {
    employeeId = 'EMP-1',
    totalAmount = 90,
    installmentCount = 3,
    firstPeriodStart = '2026-08-01',
    seed = kind
} = {}) {
    let serial = 0;
    return createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds: [employeeId],
        name: kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Premio' : 'Uniforme',
        totalAmount,
        installmentCount,
        firstPeriodStart,
        createdAt: 100
    }, { createId: prefix => `${prefix}-${seed}-${++serial}` })[0];
}

function employee({ bonuses = [], deductions = [] } = {}) {
    return { id: 'EMP-1', name: 'Ada', bonuses, deductions, updatedAt: 50 };
}

function closureFor(preview, {
    id = 'PAYROLL-CLOSURE-1',
    periodStart = '2026-08-01',
    periodEnd = '2026-08-15',
    supersedesId = null
} = {}) {
    return {
        id,
        status: 'closed',
        periodStart,
        periodEnd,
        closedAt: 200,
        closedBy: 'operator-1',
        supersedesId,
        rows: [{
            employeeId: 'EMP-1',
            bonusDetails: preview.bonusDetails,
            deductionDetails: preview.deductionDetails
        }]
    };
}

describe('Payroll adjustment installment settlement', () => {
    test('a paused one-payment plan is excluded from preview and cannot be closed until resumed', () => {
        let serial = 0;
        const [active] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-1'],
            name: 'Pago único',
            totalAmount: 90,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-08-01',
            createdAt: 100
        }, { createId: prefix => prefix + '-' + (++serial) });
        const target = employee({ deductions: [active] });
        const activePreview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        target.deductions[0] = setPayrollAdjustmentPlanPaused(active, true, 150);

        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        })).toMatchObject({ bonusTotal: 0, deductionTotal: 0 });
        expect(() => applyPayrollAdjustmentInstallmentsForClosure(
            [target], closureFor(activePreview), { now: 200 }
        )).toThrow('cambió');

        target.deductions[0] = setPayrollAdjustmentPlanPaused(target.deductions[0], false, 250);
        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        }).deductionTotal).toBe(90);
    });

    test('preview is repeatable and does not mutate the employee or plan', () => {
        const target = employee({ bonuses: [createPlan(ADJUSTMENT_PLAN_KIND.BONUS)] });
        const before = JSON.parse(JSON.stringify(target));

        const first = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const second = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });

        expect(first).toEqual(second);
        expect(first).toMatchObject({ bonusTotal: 30, deductionTotal: 0 });
        expect(first.bonusDetails[0]).toMatchObject({
            employeeId: 'EMP-1',
            kind: 'bonuses',
            sequence: 1,
            amount: 30,
            source: 'payroll-adjustment-installment'
        });
        expect(target).toEqual(before);
    });

    test('does not expose a plan before its first payroll period', () => {
        const target = employee({
            deductions: [createPlan(ADJUSTMENT_PLAN_KIND.DEDUCTION, {
                firstPeriodStart: '2026-08-16'
            })]
        });

        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        })).toMatchObject({ bonusTotal: 0, deductionTotal: 0 });
    });

    test('ignores legacy, foreign, wrong-category and non-active records', () => {
        const valid = createPlan(ADJUSTMENT_PLAN_KIND.BONUS);
        const target = employee({
            bonuses: [
                { id: 'LEGACY', type: 'fixed', value: 999 },
                { ...valid, id: 'FOREIGN', employeeId: 'EMP-2' },
                { ...valid, id: 'WRONG-KIND', kind: ADJUSTMENT_PLAN_KIND.DEDUCTION },
                { ...valid, id: 'CANCELLED', status: ADJUSTMENT_PLAN_STATUS.CANCELLED },
                valid
            ]
        });

        const preview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });

        expect(preview.bonusDetails).toHaveLength(1);
        expect(preview.bonusDetails[0].planId).toBe(valid.id);
        expect(preview.deductionDetails).toEqual([]);
    });

    test('double close applies one installment once with payroll audit identity', () => {
        const target = employee({ deductions: [createPlan(ADJUSTMENT_PLAN_KIND.DEDUCTION)] });
        const preview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const closure = closureFor(preview);

        const first = applyPayrollAdjustmentInstallmentsForClosure([target], closure, {
            now: 300, recordedBy: 'operator-1'
        });
        const second = applyPayrollAdjustmentInstallmentsForClosure([target], closure, {
            now: 400, recordedBy: 'operator-2'
        });
        const plan = target.deductions[0];

        expect(first).toMatchObject({ appliedCount: 1, affectedEmployeeIds: ['EMP-1'] });
        expect(second).toMatchObject({ appliedCount: 0, affectedEmployeeIds: [] });
        expect(plan).toMatchObject({ balance: 60, appliedAmount: 30, appliedInstallments: 1 });
        expect(plan.history).toHaveLength(1);
        expect(plan.history[0]).toMatchObject({
            action: 'applied',
            payrollClosureId: closure.id,
            payrollPeriodStart: closure.periodStart,
            payrollPeriodEnd: closure.periodEnd,
            recordedBy: 'operator-1',
            source: 'payroll'
        });
    });

    test('relinks the same period installment only to its explicit correction successor', () => {
        const target = employee({ deductions: [createPlan(ADJUSTMENT_PLAN_KIND.DEDUCTION)] });
        const firstPreview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const firstClosure = closureFor(firstPreview, { id: 'PAYROLL-ORIGINAL' });
        applyPayrollAdjustmentInstallmentsForClosure([target], firstClosure, { now: 300 });
        const correctionPreview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const correction = closureFor(correctionPreview, {
            id: 'PAYROLL-CORRECTION', supersedesId: firstClosure.id
        });

        const result = applyPayrollAdjustmentInstallmentsForClosure([target], correction, {
            now: 400
        });
        const originalUndo = undoPayrollAdjustmentInstallmentsForClosure(
            [target], firstClosure, { now: 450 }
        );

        expect(correctionPreview.deductionDetails[0].sequence).toBe(1);
        expect(result).toMatchObject({ appliedCount: 0, relinkedCount: 1 });
        expect(originalUndo.revertedCount).toBe(0);
        expect(target.deductions[0]).toMatchObject({
            appliedInstallments: 1, appliedAmount: 30, balance: 60
        });
        expect(target.deductions[0].history).toHaveLength(1);
        expect(target.deductions[0].history[0]).toMatchObject({
            payrollClosureId: correction.id,
            payrollSupersedesClosureId: firstClosure.id
        });
    });

    test('relinks the final installment from a completed plan when correcting the same payroll', () => {
        const target = employee({ bonuses: [createPlan(ADJUSTMENT_PLAN_KIND.BONUS, {
            totalAmount: 25,
            installmentCount: 2
        })] });
        const firstPeriod = { periodStart: '2026-08-01', periodEnd: '2026-08-15' };
        const finalPeriod = { periodStart: '2026-08-16', periodEnd: '2026-08-31' };
        const beforeFinalPreview = buildPayrollAdjustmentInstallmentPreview(target, firstPeriod);
        const beforeFinalClosure = closureFor(beforeFinalPreview, {
            id: 'PAYROLL-BEFORE-FINAL',
            ...firstPeriod
        });
        applyPayrollAdjustmentInstallmentsForClosure([target], beforeFinalClosure, { now: 250 });
        const finalPreview = buildPayrollAdjustmentInstallmentPreview(target, finalPeriod);
        const firstClosure = closureFor(finalPreview, {
            id: 'PAYROLL-FINAL-ORIGINAL',
            ...finalPeriod
        });
        applyPayrollAdjustmentInstallmentsForClosure([target], firstClosure, { now: 300 });

        expect(target.bonuses[0].status).toBe(ADJUSTMENT_PLAN_STATUS.COMPLETED);
        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-09-01', periodEnd: '2026-09-15'
        }).bonusDetails).toEqual([]);

        const correctionPreview = buildPayrollAdjustmentInstallmentPreview(target, finalPeriod);
        const correction = closureFor(correctionPreview, {
            id: 'PAYROLL-FINAL-CORRECTION',
            supersedesId: firstClosure.id,
            ...finalPeriod
        });
        const relink = applyPayrollAdjustmentInstallmentsForClosure([target], correction, {
            now: 400
        });
        const undo = undoPayrollAdjustmentInstallmentsForClosure([target], correction, {
            now: 500,
            voidedBy: 'operator-2'
        });

        expect(correctionPreview.bonusDetails).toHaveLength(1);
        expect(correctionPreview.bonusDetails[0]).toMatchObject({ sequence: 2, amount: 12.5 });
        expect(relink).toMatchObject({ appliedCount: 0, relinkedCount: 1 });
        expect(undo).toMatchObject({ revertedCount: 1, affectedEmployeeIds: ['EMP-1'] });
        expect(target.bonuses[0]).toMatchObject({
            status: ADJUSTMENT_PLAN_STATUS.ACTIVE,
            appliedInstallments: 1,
            appliedAmount: 12.5,
            balance: 12.5
        });
        expect(target.bonuses[0].installments[1]).toMatchObject({
            status: 'pending', appliedAmount: 0
        });
        expect(target.bonuses[0].history).toHaveLength(2);
        expect(target.bonuses[0].history[1]).toMatchObject({
            payrollClosureId: correction.id,
            payrollSupersedesClosureId: firstClosure.id,
            voided: true,
            voidedAt: 500,
            voidedBy: 'operator-2'
        });
    });

    test('double reopen restores exactly that payroll movement once', () => {
        const target = employee({ bonuses: [createPlan(ADJUSTMENT_PLAN_KIND.BONUS)] });
        const preview = buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        });
        const closure = closureFor(preview);
        applyPayrollAdjustmentInstallmentsForClosure([target], closure, { now: 300 });

        const first = undoPayrollAdjustmentInstallmentsForClosure([target], closure, {
            now: 400, voidedBy: 'operator-2'
        });
        const afterFirst = JSON.parse(JSON.stringify(target));
        const second = undoPayrollAdjustmentInstallmentsForClosure([target], closure, {
            now: 500, voidedBy: 'operator-3'
        });
        const plan = target.bonuses[0];

        expect(first).toMatchObject({ revertedCount: 1, affectedEmployeeIds: ['EMP-1'] });
        expect(second).toMatchObject({ revertedCount: 0, affectedEmployeeIds: [] });
        expect(target).toEqual(afterFirst);
        expect(plan).toMatchObject({
            status: 'active', balance: 90, appliedAmount: 0, appliedInstallments: 0
        });
        expect(plan.installments[0]).toMatchObject({ status: 'pending', appliedAmount: 0 });
        expect(plan.history[0]).toMatchObject({ voided: true, voidedAt: 400, voidedBy: 'operator-2' });
    });

    test('uses the exact rounded remainder in the final installment and completes the plan', () => {
        const target = employee({ bonuses: [createPlan(ADJUSTMENT_PLAN_KIND.BONUS, {
            totalAmount: 100,
            installmentCount: 3
        })] });
        const periods = [
            ['2026-08-01', '2026-08-15'],
            ['2026-08-16', '2026-08-31'],
            ['2026-09-01', '2026-09-15']
        ];
        const applied = periods.map(([periodStart, periodEnd], index) => {
            const preview = buildPayrollAdjustmentInstallmentPreview(target, { periodStart, periodEnd });
            const closure = closureFor(preview, { id: `PAYROLL-${index + 1}`, periodStart, periodEnd });
            applyPayrollAdjustmentInstallmentsForClosure([target], closure, { now: 300 + index });
            return preview.bonusDetails[0].amount;
        });

        expect(applied).toEqual([33.33, 33.33, 33.34]);
        expect(target.bonuses[0]).toMatchObject({
            status: 'completed', balance: 0, appliedAmount: 100, appliedInstallments: 3,
            progressPercent: 100
        });
    });

    test('projects bonus and deduction installments independently', () => {
        const target = employee({
            bonuses: [createPlan(ADJUSTMENT_PLAN_KIND.BONUS, { totalAmount: 10, installmentCount: 2 })],
            deductions: [createPlan(ADJUSTMENT_PLAN_KIND.DEDUCTION, {
                totalAmount: 6, installmentCount: 2, seed: 'deduction'
            })]
        });

        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-01', periodEnd: '2026-08-15'
        })).toMatchObject({ bonusTotal: 5, deductionTotal: 3 });
    });
});
