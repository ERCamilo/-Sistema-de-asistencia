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
    hasPayrollAdjustmentPlanMovement,
    removeOrCancelPayrollAdjustmentPlans
} from '../modules/features/payroll/PayrollAdjustmentCancellation.js';

function createPlans(employeeIds = ['EMP-1']) {
    let serial = 0;
    return createPayrollAdjustmentInstallmentPlans({
        kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
        employeeIds,
        name: 'Uniforme',
        totalAmount: 90,
        installmentCount: 3,
        firstPeriodStart: '2026-08-01',
        createdAt: 100
    }, { createId: prefix => `${prefix}-${++serial}` });
}

function member(plan) {
    return { employeeId: plan.employeeId, planId: plan.id,
        updatedAt: plan.updatedAt, groupId: plan.groupId };
}

describe('PayrollAdjustmentCancellation', () => {
    test('hard-deletes a virgin plan with a sync-safe tombstone', () => {
        const [plan] = createPlans();
        const legacy = { id: 'LEGACY', type: 'fixed', value: 10 };
        const employees = [{ id: 'EMP-1', deductions: [legacy, plan], bonuses: [] }];
        const result = removeOrCancelPayrollAdjustmentPlans(employees, {
            kind: 'deductions', members: [member(plan)], now: 200
        });
        expect(result).toMatchObject({ deletedCount: 1, cancelledCount: 0 });
        expect(result.employees[0].deductions).toEqual([legacy]);
        expect(result.employees[0].deletedItemIds.deductions).toContain(plan.id);
        expect(employees[0].deductions).toHaveLength(2);
    });

    test('cancels movement while preserving balance, installments and history', () => {
        const [plan] = createPlans();
        plan.appliedAmount = 30;
        plan.balance = 60;
        plan.history.push({ id: 'H-1', amount: 30, action: 'applied' });
        plan.installments[0].appliedAmount = 30;
        plan.installments[0].status = 'applied';
        const result = removeOrCancelPayrollAdjustmentPlans([
            { id: 'EMP-1', deductions: [plan], bonuses: [] }
        ], { kind: 'deductions', members: [member(plan)], now: 250,
            actor: 'operator@example.com', reason: 'Acuerdo' });
        const cancelled = result.employees[0].deductions[0];
        expect(result).toMatchObject({ deletedCount: 0, cancelledCount: 1 });
        expect(cancelled).toMatchObject({ status: ADJUSTMENT_PLAN_STATUS.CANCELLED,
            appliedAmount: 30, balance: 60,
            cancellation: { cancelledAt: 250, cancelledBy: 'operator@example.com', reason: 'Acuerdo' } });
        expect(cancelled.history).toEqual(plan.history);
        expect(cancelled.installments).toEqual(plan.installments);
        expect(hasPayrollAdjustmentPlanMovement(plan)).toBe(true);
    });

    test('handles a mixed group atomically', () => {
        const plans = createPlans(['EMP-1', 'EMP-2']);
        plans[1].history.push({ id: 'H-2', amount: 10 });
        const employees = plans.map(plan => ({ id: plan.employeeId, deductions: [plan], bonuses: [] }));
        const result = removeOrCancelPayrollAdjustmentPlans(employees, {
            kind: 'deductions', members: plans.map(member), now: 300
        });
        expect(result).toMatchObject({ deletedCount: 1, cancelledCount: 1 });
        expect(result.employees[0].deductions).toEqual([]);
        expect(result.employees[1].deductions[0]).toMatchObject({
            status: 'cancelled', groupId: plans[1].groupId
        });
    });

    test('protects completed plans and rejects stale revisions atomically', () => {
        const plans = createPlans(['EMP-1', 'EMP-2']);
        plans[1].status = ADJUSTMENT_PLAN_STATUS.COMPLETED;
        plans[1].balance = 0;
        const employees = plans.map(plan => ({ id: plan.employeeId, deductions: [plan] }));
        expect(() => removeOrCancelPayrollAdjustmentPlans(employees, {
            kind: 'deductions', members: plans.map(member), now: 300
        })).toThrow('completado');
        expect(employees[0].deductions[0].status).toBe('active');
        expect(() => removeOrCancelPayrollAdjustmentPlans(employees, {
            kind: 'deductions', members: [{ ...member(plans[0]), updatedAt: 999 }], now: 300
        })).toThrow('cambió');
    });

    test('undo restores balance without reactivating a later cancellation', () => {
        const [plan] = createPlans();
        const employees = [{ id: 'EMP-1', deductions: [plan], bonuses: [] }];
        const period = { periodStart: '2026-08-01', periodEnd: '2026-08-15' };
        const preview = buildPayrollAdjustmentInstallmentPreview(employees[0], period);
        const closure = { id: 'CLOSE-1', ...period, closedAt: 200, rows: [{
            employeeId: 'EMP-1', deductionDetails: preview.deductionDetails, bonusDetails: []
        }] };
        applyPayrollAdjustmentInstallmentsForClosure(employees, closure, { now: 200 });
        const result = removeOrCancelPayrollAdjustmentPlans(employees, {
            kind: 'deductions', members: [member(plan)], now: 300
        });
        undoPayrollAdjustmentInstallmentsForClosure(result.employees, closure, { now: 400 });
        expect(result.employees[0].deductions[0]).toMatchObject({
            status: 'cancelled', appliedAmount: 0, balance: 90
        });
        expect(buildPayrollAdjustmentInstallmentPreview(result.employees[0], {
            periodStart: '2026-08-16', periodEnd: '2026-08-31'
        }).deductionTotal).toBe(0);
    });
});
