import {
    calculateScopedAdjustment,
    normalizePayrollDefaults,
    resolveAdjustmentScope
} from '../modules/features/payroll/PayrollAdjustments.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';

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
