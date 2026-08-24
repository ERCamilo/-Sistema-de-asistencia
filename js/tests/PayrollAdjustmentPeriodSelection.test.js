import {
    ADJUSTMENT_PLAN_KIND,
    ADJUSTMENT_PLAN_STATUS,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { applyManualAdjustmentMovement } from '../modules/features/payroll/PayrollAdjustmentManualMovement.js';
import {
    ADJUSTMENT_PERIOD_SELECTION_MODE,
    getPayrollAdjustmentPeriodSelection,
    setPayrollAdjustmentPeriodSelection
} from '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';
import {
    applyPayrollAdjustmentInstallmentsForClosure,
    buildPayrollAdjustmentInstallmentPreview,
    undoPayrollAdjustmentInstallmentsForClosure
} from '../modules/features/payroll/PayrollAdjustmentInstallmentSettlement.js';

const PERIOD = { periodStart: '2026-08-01', periodEnd: '2026-08-15' };

function plan(employeeId, {
    kind = ADJUSTMENT_PLAN_KIND.DEDUCTION,
    totalAmount = 400,
    installmentCount = 4,
    seed = employeeId
} = {}) {
    let serial = 0;
    return createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds: [employeeId],
        name: kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Premio' : 'Uniformes',
        totalAmount,
        installmentCount,
        singlePayment: installmentCount === 1,
        firstPeriodStart: PERIOD.periodStart,
        createdAt: 100
    }, { createId: prefix => `${prefix}-${seed}-${++serial}` })[0];
}

function employee(id, adjustmentPlan) {
    return {
        id,
        name: id,
        bonuses: adjustmentPlan.kind === 'bonuses' ? [adjustmentPlan] : [],
        deductions: adjustmentPlan.kind === 'deductions' ? [adjustmentPlan] : []
    };
}

function select(selections, targetPlan, employeeId, choice, period = PERIOD) {
    return setPayrollAdjustmentPeriodSelection(selections, {
        kind: targetPlan.kind,
        planId: targetPlan.id,
        employeeId,
        ...period
    }, choice);
}

function closure(preview, id, supersedesId = null) {
    return {
        id,
        status: 'closed',
        ...PERIOD,
        supersedesId,
        rows: [{
            employeeId: 'EMP-1',
            bonusDetails: preview.bonusDetails,
            deductionDetails: preview.deductionDetails
        }]
    };
}

describe('Payroll adjustment period selections', () => {
    test('supports one, several, full balance and temporary pause per employee in one group', () => {
        let serial = 0;
        const groupedPlans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['Juan', 'Pedro', 'María', 'Marcos'],
            name: 'Uniformes',
            totalAmount: 400,
            installmentCount: 4,
            firstPeriodStart: PERIOD.periodStart,
            createdAt: 100
        }, { createId: prefix => `${prefix}-group-${++serial}` });
        const planByEmployee = new Map(groupedPlans.map(item => [item.employeeId, item]));
        const targets = ['Juan', 'Pedro', 'María', 'Marcos'].map(employeeId => {
            const targetPlan = planByEmployee.get(employeeId);
            return { employee: employee(employeeId, targetPlan), plan: targetPlan };
        });
        let selections = [];
        selections = select(selections, targets[0].plan, 'Juan', { mode: 'count', count: 1 });
        selections = select(selections, targets[1].plan, 'Pedro', { mode: 'count', count: 2 });
        selections = select(selections, targets[2].plan, 'María', { mode: 'full' });
        selections = select(selections, targets[3].plan, 'Marcos', { mode: 'pause' });

        const totals = targets.map(({ employee: target }) =>
            buildPayrollAdjustmentInstallmentPreview(target, { ...PERIOD, selections }).deductionTotal
        );
        const counts = targets.map(({ employee: target }) =>
            buildPayrollAdjustmentInstallmentPreview(target, { ...PERIOD, selections }).deductionDetails.length
        );

        expect(new Set(groupedPlans.map(item => item.groupId))).toHaveProperty('size', 1);
        expect(totals).toEqual([100, 200, 400, 0]);
        expect(counts).toEqual([1, 2, 4, 0]);
        expect(targets.every(({ plan: targetPlan }) =>
            targetPlan.status === 'active' && targetPlan.history.length === 0
        )).toBe(true);
    });

    test('sums real remaining amounts in the first concrete pending installments without mutation', () => {
        const targetPlan = plan('EMP-1', { totalAmount: 300, installmentCount: 3 });
        const original = employee('EMP-1', targetPlan);
        const manual = applyManualAdjustmentMovement(original, {
            id: 'MANUAL-40',
            kind: 'deductions',
            planId: targetPlan.id,
            amount: 40,
            date: '2026-07-31',
            recordedBy: 'Operador'
        }, { now: 150 }).employee;
        const before = JSON.parse(JSON.stringify(manual));
        const selections = select([], manual.deductions[0], 'EMP-1', { mode: 'count', count: 2 });

        const first = buildPayrollAdjustmentInstallmentPreview(manual, { ...PERIOD, selections });
        const second = buildPayrollAdjustmentInstallmentPreview(manual, { ...PERIOD, selections });

        expect(first).toEqual(second);
        expect(first.deductionTotal).toBe(160);
        expect(first.deductionDetails.map(item => [item.sequence, item.amount]))
            .toEqual([[1, 60], [2, 100]]);
        expect(manual).toEqual(before);
    });

    test('scopes selection to the exact period and otherwise defaults to one pending installment', () => {
        const targetPlan = plan('EMP-1');
        const target = employee('EMP-1', targetPlan);
        const selections = select([], targetPlan, 'EMP-1', { mode: 'count', count: 3 });

        expect(getPayrollAdjustmentPeriodSelection(selections, {
            kind: 'deductions', planId: targetPlan.id, employeeId: 'EMP-1', ...PERIOD
        })).toMatchObject({ mode: 'count', count: 3 });
        expect(buildPayrollAdjustmentInstallmentPreview(target, { ...PERIOD, selections }).deductionTotal)
            .toBe(300);
        expect(buildPayrollAdjustmentInstallmentPreview(target, {
            periodStart: '2026-08-16', periodEnd: '2026-08-31', selections
        }).deductionTotal).toBe(100);
    });

    test('permanent pause wins over a temporary full override and single payment defaults correctly', () => {
        const pausedPlan = plan('EMP-1');
        pausedPlan.status = ADJUSTMENT_PLAN_STATUS.PAUSED;
        const selections = select([], pausedPlan, 'EMP-1', {
            mode: ADJUSTMENT_PERIOD_SELECTION_MODE.FULL
        });
        expect(buildPayrollAdjustmentInstallmentPreview(
            employee('EMP-1', pausedPlan), { ...PERIOD, selections }
        ).deductionTotal).toBe(0);

        const single = plan('EMP-2', { totalAmount: 75, installmentCount: 1 });
        expect(buildPayrollAdjustmentInstallmentPreview(
            employee('EMP-2', single), PERIOD
        ).deductionTotal).toBe(75);
    });

    test('double close, correction and reopen preserve the manual movement and exact installment set', () => {
        const targetPlan = plan('EMP-1', { totalAmount: 300, installmentCount: 3 });
        const manualEmployee = applyManualAdjustmentMovement(employee('EMP-1', targetPlan), {
            id: 'MANUAL-40', kind: 'deductions', planId: targetPlan.id,
            amount: 40, date: '2026-07-31', recordedBy: 'Operador'
        }, { now: 150 }).employee;
        const livePlan = manualEmployee.deductions[0];
        const selections = select([], livePlan, 'EMP-1', { mode: 'count', count: 2 });
        const preview = buildPayrollAdjustmentInstallmentPreview(manualEmployee, {
            ...PERIOD, selections
        });
        const original = closure(preview, 'PAYROLL-ORIGINAL');

        const first = applyPayrollAdjustmentInstallmentsForClosure([manualEmployee], original, { now: 200 });
        const duplicate = applyPayrollAdjustmentInstallmentsForClosure([manualEmployee], original, { now: 210 });
        const correctionPreview = buildPayrollAdjustmentInstallmentPreview(manualEmployee, PERIOD);
        const corrected = closure(correctionPreview, 'PAYROLL-CORRECTED', original.id);
        const correction = applyPayrollAdjustmentInstallmentsForClosure(
            [manualEmployee], corrected, { now: 220 }
        );
        const reopened = undoPayrollAdjustmentInstallmentsForClosure(
            [manualEmployee], corrected, { now: 230 }
        );

        expect(preview.deductionDetails.map(item => item.amount)).toEqual([60, 100]);
        expect(first).toMatchObject({ appliedCount: 2 });
        expect(duplicate).toMatchObject({ appliedCount: 0 });
        expect(correctionPreview.deductionDetails).toHaveLength(2);
        expect(correction).toMatchObject({ relinkedCount: 2 });
        expect(reopened).toMatchObject({ revertedCount: 2 });
        expect(livePlan).toMatchObject({ appliedAmount: 40, balance: 260, status: 'active' });
        expect(livePlan.history.find(item => item.id === 'MANUAL-40')).toMatchObject({
            source: 'manual', voided: false, amount: 40
        });
        expect(livePlan.history.filter(item => item.source === 'payroll'))
            .toHaveLength(2);
        expect(livePlan.history.filter(item => item.source === 'payroll').every(item => item.voided))
            .toBe(true);
    });
});
