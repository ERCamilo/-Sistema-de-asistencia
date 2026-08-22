import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

function planFor(employeeId = 'EMP-1') {
    let value = 0;
    return createPayrollAdjustmentInstallmentPlans({
        kind: ADJUSTMENT_PLAN_KIND.BONUS,
        employeeIds: [employeeId],
        name: 'Bono base',
        totalAmount: 90,
        installmentCount: 3,
        firstPeriodStart: '2026-08-16',
        createdAt: 1_787_385_600_000
    }, { createId: prefix => `${prefix}-${++value}` })[0];
}

describe('EmployeeMerge payroll adjustment plans', () => {
    test('keeps newest plan fields and unions concurrent history and installments by id', () => {
        const base = planFor();
        const serverPlan = {
            ...base,
            name: 'Nombre nuevo',
            balance: 60,
            updatedAt: 300,
            history: [{ id: 'H-SERVER', action: 'applied', updatedAt: 200 }],
            installments: [
                { ...base.installments[0], status: 'applied', appliedAmount: 30, updatedAt: 200 },
                base.installments[1]
            ]
        };
        const localPlan = {
            ...base,
            name: 'Nombre anterior',
            updatedAt: 100,
            history: [{ id: 'H-LOCAL', action: 'noted', updatedAt: 100 }],
            installments: [
                { ...base.installments[1], note: 'local' },
                base.installments[2]
            ]
        };
        const server = { id: 'EMP-1', bonuses: [serverPlan], deductions: [], updatedAt: 300 };
        const local = { id: 'EMP-1', bonuses: [localPlan], deductions: [], updatedAt: 100 };
        const before = JSON.parse(JSON.stringify({ server, local }));

        const result = mergeEmployees(server, local);
        const merged = result.bonuses[0];

        expect(merged.name).toBe('Nombre nuevo');
        expect(merged.balance).toBe(60);
        expect(merged.history.map(entry => entry.id)).toEqual(['H-LOCAL', 'H-SERVER']);
        expect(merged.installments.map(entry => entry.id)).toEqual(base.installments.map(entry => entry.id));
        expect({ server, local }).toEqual(before);
    });

    test('resolves nested id collisions by updatedAt and deterministic content tie-break', () => {
        const base = planFor();
        const historyId = 'H-1';
        const installmentId = base.installments[0].id;
        const serverPlan = {
            ...base,
            updatedAt: 200,
            history: [{ id: historyId, note: 'older', updatedAt: 100 }],
            installments: [{ ...base.installments[0], note: 'zeta', updatedAt: 50 }]
        };
        const localPlan = {
            ...base,
            updatedAt: 100,
            history: [{ id: historyId, note: 'newer', updatedAt: 300 }],
            installments: [{ ...base.installments[0], note: 'alpha', updatedAt: 50 }]
        };

        const merged = mergeEmployees(
            { id: 'EMP-1', bonuses: [serverPlan] },
            { id: 'EMP-1', bonuses: [localPlan] }
        ).bonuses[0];

        expect(merged.history).toEqual([{ id: historyId, note: 'newer', updatedAt: 300 }]);
        expect(merged.installments).toEqual([{
            ...base.installments[0],
            note: 'zeta',
            updatedAt: 50
        }]);
        expect(merged.installments[0].id).toBe(installmentId);
    });

    test('uses the same plan winner on an updatedAt tie regardless of merge direction', () => {
        const base = planFor();
        const alpha = { ...base, name: 'Alpha', updatedAt: 500 };
        const zeta = { ...base, name: 'Zeta', updatedAt: 500 };
        const left = { id: 'EMP-1', bonuses: [alpha] };
        const right = { id: 'EMP-1', bonuses: [zeta] };

        expect(mergeEmployees(left, right).bonuses[0].name).toBe('Zeta');
        expect(mergeEmployees(right, left).bonuses[0].name).toBe('Zeta');
    });

    test('preserves the existing legacy merge behavior', () => {
        const serverLegacy = { id: 'LEGACY', type: 'fixed', value: 10, updatedAt: 100 };
        const localLegacy = { id: 'LEGACY', type: 'fixed', value: 20, updatedAt: 100 };

        const result = mergeEmployees(
            { id: 'EMP-1', bonuses: [serverLegacy] },
            { id: 'EMP-1', bonuses: [localLegacy] }
        );

        expect(result.bonuses).toEqual([localLegacy]);
    });

    test('filters a foreign modern plan even when only one employee copy exists', () => {
        const foreignPlan = planFor('EMP-2');
        const local = {
            id: 'EMP-1',
            bonuses: [foreignPlan, { id: 'LEGACY', type: 'fixed', value: 10 }]
        };

        const result = mergeEmployees(null, local);

        expect(result.bonuses).toEqual([{ id: 'LEGACY', type: 'fixed', value: 10 }]);
        expect(local.bonuses).toHaveLength(2);
    });

    test('does not admit a modern plan owned by another employee or stored under the wrong kind', () => {
        const foreignPlan = planFor('EMP-2');
        const wrongKind = { ...planFor('EMP-1'), kind: ADJUSTMENT_PLAN_KIND.DEDUCTION };
        const legacy = { id: 'LEGACY', type: 'fixed', value: 10 };

        const result = mergeEmployees(
            { id: 'EMP-1', bonuses: [foreignPlan, wrongKind, legacy], deductions: [] },
            { id: 'EMP-1', bonuses: [], deductions: [] }
        );

        expect(result.bonuses).toEqual([legacy]);
    });
});
