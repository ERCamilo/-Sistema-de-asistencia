import {
    buildPayrollAdjustmentInstallmentSave,
    filterLegacyEmployeeAdjustments
} from '../modules/features/payroll/PayrollAdjustmentInstallmentWorkflow.js';
import { ADJUSTMENT_PLAN_RECORD_TYPE } from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';

function idFactory(values = []) {
    let index = 0;
    return prefix => values[index++] || `${prefix}-${index}`;
}

const draft = {
    name: 'Uniformes',
    type: 'fixed',
    value: 100,
    scope: 'employee',
    targetId: 'EMP-1',
    targetIds: ['EMP-2', 'EMP-1'],
    remembered: true,
    installmentsEnabled: true,
    installmentCount: 3,
    firstPeriodStart: '2026-08-16'
};

describe('PayrollAdjustmentInstallmentWorkflow', () => {
    test('builds one complete plan per selected employee and one clear notice', () => {
        const employees = [{ id: 'EMP-1', deductions: [] }, { id: 'EMP-2', deductions: [] }];
        const result = buildPayrollAdjustmentInstallmentSave({
            employees,
            kind: 'deductions',
            draft,
            createdAt: 1_787_299_200_000
        }, { createId: idFactory() });

        expect(result.plans).toHaveLength(2);
        expect(result.plans.map(plan => plan.totalAmount)).toEqual([100, 100]);
        expect(new Set(result.plans.map(plan => plan.groupId)).size).toBe(1);
        expect(result.employees[0].deductions[0].recordType).toBe(ADJUSTMENT_PLAN_RECORD_TYPE);
        expect(result.employees[1].deductions[0].recordType).toBe(ADJUSTMENT_PLAN_RECORD_TYPE);
        expect(result.notice).toContain('2 deducciones a cuotas');
        expect(result.notice).toContain('Dom, 16 ago 2026');
        expect(employees).toEqual([{ id: 'EMP-1', deductions: [] }, { id: 'EMP-2', deductions: [] }]);
    });

    test('builds saved individual fixed adjustments as one-payment plans when splitting is off', () => {
        const employees = [{ id: 'EMP-1', bonuses: [] }, { id: 'EMP-2', bonuses: [] }];
        const result = buildPayrollAdjustmentInstallmentSave({
            employees,
            kind: 'bonuses',
            draft: {
                ...draft,
                name: 'Reconocimiento',
                installmentsEnabled: false
            },
            createdAt: 1_787_299_200_000
        }, { createId: idFactory() });

        expect(result.plans).toHaveLength(2);
        expect(result.plans.every(plan => plan.installmentCount === 1)).toBe(true);
        expect(result.plans.every(plan => plan.installments.length === 1)).toBe(true);
        expect(result.notice).toContain('2 pagos programados');
        expect(employees.every(employee => employee.bonuses.length === 0)).toBe(true);
    });

    test('is atomic when any generated plan collides with an existing employee adjustment', () => {
        const employees = [
            { id: 'EMP-1', deductions: [{ id: 'PLAN-COLLISION', type: 'fixed', value: 20 }] },
            { id: 'EMP-2', deductions: [] }
        ];

        expect(() => buildPayrollAdjustmentInstallmentSave({
            employees,
            kind: 'deductions',
            draft,
            createdAt: 1_787_299_200_000
        }, {
            createId: idFactory(['GROUP', 'PLAN-COLLISION', 'I-1', 'I-2', 'I-3', 'PLAN-2', 'I-4', 'I-5', 'I-6'])
        })).toThrow('ya existe');
        expect(employees[0].deductions).toEqual([{ id: 'PLAN-COLLISION', type: 'fixed', value: 20 }]);
        expect(employees[1].deductions).toEqual([]);
    });

    test.each([
        [{ ...draft, type: 'percentage' }, 'monto fijo'],
        [{ ...draft, scope: 'global' }, 'individual'],
        [{ ...draft, installmentCount: 1 }, 'cuotas'],
        [{ ...draft, installmentCount: 53 }, 'cuotas'],
        [{ ...draft, firstPeriodStart: 'no-es-fecha' }, 'primera nómina']
    ])('rejects invalid installment drafts without returning employee changes', (invalidDraft, message) => {
        expect(() => buildPayrollAdjustmentInstallmentSave({
            employees: [{ id: 'EMP-1' }, { id: 'EMP-2' }],
            kind: 'deductions',
            draft: invalidDraft,
            createdAt: 1_787_299_200_000
        }, { createId: idFactory() })).toThrow(message);
    });

    test('keeps legacy employee adjustments available while ignoring modern plans', () => {
        const legacy = { id: 'LEGACY', type: 'fixed', value: 25 };
        const modern = { id: 'MODERN', recordType: ADJUSTMENT_PLAN_RECORD_TYPE, version: 1 };
        expect(filterLegacyEmployeeAdjustments([modern, legacy])).toEqual([legacy]);
    });
});
