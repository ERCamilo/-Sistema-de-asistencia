import {
    calculateScopedAdjustment,
    normalizePayrollDefaults,
    resolveAdjustmentScope,
    resolveAdjustmentTargetIds
} from '../modules/features/payroll/PayrollAdjustments.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { setPayrollAdjustmentPeriodSelection } from
    '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';

const scopedRule = (id, scope, targetId, type, value) => ({
    id,
    name: id,
    scope,
    targetId,
    type,
    value
});

function buildState() {
    return {
        settings: { regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2 },
        employees: [{
            id: 'emp-1',
            positions: ['bricklayer', 'helper'],
            positionSalaries: {}
        }],
        positions: [
            { id: 'bricklayer', name: 'Albañil', hourlyRate: 100, leaderId: 'leader-1' },
            { id: 'helper', name: 'Ayudante', hourlyRate: 50, leaderId: 'leader-1' }
        ],
        attendance: {
            'emp-1-2026-07-24': {
                present: true,
                positionHours: [
                    { positionId: 'bricklayer', hours: 8 },
                    { positionId: 'helper', hours: 4 }
                ]
            }
        }
    };
}

describe('PayrollService — scoped adjustments for multiple positions', () => {
    test('uses position, leader and employee gross bases without chaining', () => {
        const service = new PayrollService(buildState());
        const result = service.calculateEmployeePayroll(
            'emp-1',
            '2026-07-24',
            '2026-07-24',
            [
                scopedRule('position-percent', 'position', 'bricklayer', 'percentage', 10),
                scopedRule('leader-percent', 'leader', 'leader-1', 'percentage', 5),
                scopedRule('individual-fixed', 'employee', 'emp-1', 'fixed', 30),
                scopedRule('global-percent', 'global', null, 'percentage', 2)
            ],
            [scopedRule('helper-bonus', 'position', 'helper', 'percentage', 10)],
            []
        );

        expect(result).toMatchObject({
            brutoOriginal: 1000,
            bonuses: 20,
            deductions: 180,
            neto: 840
        });
        const byId = new Map(result.deductionBreakdown.map(item => [item.id, item]));
        expect(byId.get('position-percent')).toMatchObject({
            scope: 'position',
            appliedTo: 800,
            amount: 80,
            matchedPositionIds: ['bricklayer']
        });
        expect(byId.get('leader-percent')).toMatchObject({
            scope: 'leader',
            appliedTo: 1000,
            amount: 50,
            matchedPositionIds: ['bricklayer', 'helper']
        });
        expect(byId.get('individual-fixed')).toMatchObject({
            scope: 'employee',
            appliedTo: 1000,
            amount: 30
        });
        expect(byId.get('global-percent')).toMatchObject({
            scope: 'global',
            appliedTo: 1000,
            amount: 20
        });
    });

    test('includes current employee installment plans without mutating them across recalculations', () => {
        const payrollState = buildState();
        let serial = 0;
        const bonus = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS,
            employeeIds: ['emp-1'],
            name: 'Premio',
            totalAmount: 10,
            installmentCount: 2,
            firstPeriodStart: '2026-07-24',
            createdAt: 100
        }, { createId: prefix => `${prefix}-${++serial}` })[0];
        const deduction = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['emp-1'],
            name: 'Uniforme',
            totalAmount: 6,
            installmentCount: 2,
            firstPeriodStart: '2026-07-24',
            createdAt: 100
        }, { createId: prefix => `${prefix}-${++serial}` })[0];
        payrollState.employees[0].bonuses = [bonus];
        payrollState.employees[0].deductions = [deduction];
        const before = JSON.parse(JSON.stringify(payrollState.employees[0]));
        const service = new PayrollService(payrollState);

        const first = service.calculateEmployeePayroll(
            'emp-1', '2026-07-24', '2026-07-24', [], [], []
        );
        const second = service.calculateEmployeePayroll(
            'emp-1', '2026-07-24', '2026-07-24', [], [], []
        );

        expect(first).toMatchObject({ bonuses: 5, deductions: 3, neto: 1002 });
        expect(second).toEqual(first);
        expect(first.bonusBreakdown[0]).toMatchObject({ planId: bonus.id, sequence: 1 });
        expect(first.deductionBreakdown[0]).toMatchObject({ planId: deduction.id, sequence: 1 });
        expect(payrollState.employees[0]).toEqual(before);
    });

    test('uses the provisional period selection in payroll totals without mutating the plan', () => {
        const payrollState = buildState();
        let serial = 0;
        const deduction = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['emp-1'],
            name: 'Uniforme',
            totalAmount: 60,
            installmentCount: 3,
            firstPeriodStart: '2026-07-24',
            createdAt: 100
        }, { createId: prefix => `${prefix}-${++serial}` })[0];
        payrollState.employees[0].deductions = [deduction];
        const before = JSON.parse(JSON.stringify(deduction));
        const selections = setPayrollAdjustmentPeriodSelection([], {
            kind: deduction.kind,
            planId: deduction.id,
            employeeId: 'emp-1',
            periodStart: '2026-07-24',
            periodEnd: '2026-07-24'
        }, { mode: 'count', count: 2 });

        const result = new PayrollService(payrollState).calculateEmployeePayroll(
            'emp-1', '2026-07-24', '2026-07-24', [], [], [], selections
        );

        expect(result).toMatchObject({ deductions: 40, neto: 960 });
        expect(result.deductionBreakdown.map(item => item.sequence)).toEqual([1, 2]);
        expect(deduction).toEqual(before);
    });

    test('applies a fixed leader rule once even when two positions match', () => {
        const result = new PayrollService(buildState()).calculateEmployeePayroll(
            'emp-1',
            '2026-07-24',
            '2026-07-24',
            [scopedRule('leader-fixed', 'leader', 'leader-1', 'fixed', 200)],
            [],
            []
        );

        expect(result.deductions).toBe(200);
        expect(result.deductionBreakdown).toHaveLength(1);
        expect(result.deductionBreakdown[0].matchedPositionIds)
            .toEqual(['bricklayer', 'helper']);
    });

    test('ignores a position rule when that position was not worked', () => {
        const result = calculateScopedAdjustment(
            scopedRule('other-position', 'position', 'carpenter', 'fixed', 500),
            {
                employeeId: 'emp-1',
                totalGross: 1000,
                breakdown: [{ positionId: 'bricklayer', subtotal: 1000 }],
                positions: []
            }
        );

        expect(result).toBeNull();
    });

    test('applies the complete fixed amount to every employee selected by one rule', () => {
        const rule = {
            id: 'multi-employee-bonus',
            scope: 'employee',
            targetIds: ['emp-1', 'emp-2'],
            type: 'fixed',
            value: 500
        };
        const contextFor = employeeId => ({
            employeeId,
            totalGross: 1000,
            breakdown: [{ positionId: 'bricklayer', subtotal: 1000 }],
            positions: []
        });

        expect(resolveAdjustmentTargetIds(rule)).toEqual(['emp-1', 'emp-2']);
        expect(calculateScopedAdjustment(rule, contextFor('emp-1')).amount).toBe(500);
        expect(calculateScopedAdjustment(rule, contextFor('emp-2')).amount).toBe(500);
        expect(calculateScopedAdjustment(rule, contextFor('emp-3'))).toBeNull();
    });
});

describe('PayrollAdjustments — backward-compatible scopes', () => {
    test('infers legacy global and employee adjustments', () => {
        expect(resolveAdjustmentScope({ id: 'global' }))
            .toEqual({ scope: 'global', targetId: null });
        expect(resolveAdjustmentScope({ id: 'employee', employeeId: 7 }))
            .toEqual({ scope: 'employee', targetId: '7' });
    });

    test('remembered defaults preserve groups and exclude employees', () => {
        const result = normalizePayrollDefaults({
            payrollDefaults: {
                deductions: [
                    scopedRule('leader-rule', 'leader', 'leader-1', 'percentage', 3),
                    scopedRule('employee-rule', 'employee', 'emp-1', 'fixed', 20)
                ]
            }
        });

        expect(result.version).toBe(2);
        expect(result.deductions).toEqual([{
            id: 'leader-rule',
            name: 'leader-rule',
            type: 'percentage',
            value: 3,
            scope: 'leader',
            targetId: 'leader-1'
        }]);
    });
});
