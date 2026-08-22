import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { attachPayrollAdjustmentPlans } from '../modules/features/payroll/PayrollAdjustmentPlanRepository.js';

function planBatch(kind, employeeIds, start = 0) {
    let value = start;
    return createPayrollAdjustmentInstallmentPlans({
        kind,
        employeeIds,
        name: kind === ADJUSTMENT_PLAN_KIND.BONUS ? 'Bono fijo' : 'Descuento fijo',
        totalAmount: 100,
        installmentCount: 3,
        firstPeriodStart: '2026-08-16',
        createdAt: 1_787_385_600_000
    }, { createId: prefix => `${prefix}-${++value}` });
}

describe('PayrollAdjustmentPlanRepository', () => {
    test('atomically attaches each plan to the matching employee and kind without mutating inputs', () => {
        const legacyBonus = { id: 'BON-LEGACY', type: 'fixed', value: 25 };
        const untouchedDeduction = { id: 'DED-LEGACY', type: 'percentage', value: 2 };
        const employees = [
            { id: 'EMP-1', name: 'Ana', bonuses: [legacyBonus], deductions: [untouchedDeduction] },
            { id: 'EMP-2', name: 'Luis', bonuses: [], deductions: [] },
            { id: 'EMP-3', name: 'Sol', bonuses: [], deductions: [] }
        ];
        const plans = planBatch(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-2', 'EMP-1']);
        const before = JSON.parse(JSON.stringify(employees));

        const result = attachPayrollAdjustmentPlans(employees, plans);

        expect(result).not.toBe(employees);
        expect(result[0]).not.toBe(employees[0]);
        expect(result[1]).not.toBe(employees[1]);
        expect(result[2]).toBe(employees[2]);
        expect(result[0].bonuses[0]).toBe(legacyBonus);
        expect(result[0].deductions).toBe(employees[0].deductions);
        expect(result[0].bonuses[1]).toEqual(plans.find(plan => plan.employeeId === 'EMP-1'));
        expect(result[0].bonuses[1]).not.toBe(plans.find(plan => plan.employeeId === 'EMP-1'));
        expect(result[1].bonuses).toHaveLength(1);
        expect(employees).toEqual(before);
    });

    test('stores deductions only in deductions', () => {
        const employees = [{ id: 'EMP-1', bonuses: [], deductions: [] }];
        const [plan] = planBatch(ADJUSTMENT_PLAN_KIND.DEDUCTION, ['EMP-1']);

        const [result] = attachPayrollAdjustmentPlans(employees, [plan]);

        expect(result.bonuses).toBe(employees[0].bonuses);
        expect(result.deductions).toEqual([plan]);
    });

    test('fails atomically when any employee is missing', () => {
        const employees = [{ id: 'EMP-1', bonuses: [], deductions: [] }];
        const plans = planBatch(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1', 'EMP-2']);
        const before = JSON.parse(JSON.stringify(employees));

        expect(() => attachPayrollAdjustmentPlans(employees, plans)).toThrow('EMP-2');
        expect(employees).toEqual(before);
    });

    test.each([
        [plan => ({ ...plan, kind: 'global' }), 'tipo'],
        [plan => ({ ...plan, type: 'percentage' }), 'monto fijo'],
        [plan => ({ ...plan, employeeId: '' }), 'empleado']
    ])('rejects a modern plan that does not match the employee adjustment contract %#', (change, message) => {
        const employees = [{ id: 'EMP-1', bonuses: [], deductions: [] }];
        const [valid] = planBatch(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1']);

        expect(() => attachPayrollAdjustmentPlans(employees, [change(valid)])).toThrow(message);
        expect(employees[0].bonuses).toEqual([]);
    });

    test('fails before writing when a plan id collides anywhere inside its employee', () => {
        const employees = [{
            id: 'EMP-1',
            bonuses: [],
            deductions: [{ id: 'ADJ-PLAN-2', type: 'fixed', value: 15 }]
        }];
        const [plan] = planBatch(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1']);

        expect(plan.id).toBe('ADJ-PLAN-2');
        expect(() => attachPayrollAdjustmentPlans(employees, [plan])).toThrow('ADJ-PLAN-2');
        expect(employees[0].bonuses).toEqual([]);
    });

    test('rejects duplicate incoming plan ids without a partial result', () => {
        const employees = [
            { id: 'EMP-1', bonuses: [], deductions: [] },
            { id: 'EMP-2', bonuses: [], deductions: [] }
        ];
        const plans = planBatch(ADJUSTMENT_PLAN_KIND.BONUS, ['EMP-1', 'EMP-2']);
        const duplicated = [plans[0], { ...plans[1], id: plans[0].id }];

        expect(() => attachPayrollAdjustmentPlans(employees, duplicated)).toThrow(plans[0].id);
        expect(employees.every(employee => employee.bonuses.length === 0)).toBe(true);
    });
});
