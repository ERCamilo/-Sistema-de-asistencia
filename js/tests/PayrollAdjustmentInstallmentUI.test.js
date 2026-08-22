import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { updateAdjustmentEmployeeSelection } from '../modules/features/payroll/PayrollAdjustmentDesktop.js';
import { isPayrollAdjustmentInstallmentPlan } from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';

describe('Payroll adjustment installments UI persistence', () => {
    const render = jest.fn();
    const saveToLocalStorage = jest.fn(() => Promise.resolve({ localOk: true, cloudRequested: true }));

    beforeAll(() => {
        window.PayrollUI = PayrollUI;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        window.showNotification = jest.fn();
        state.employees = [
            { id: 'EMP-1', number: '1', name: 'Ada', active: true, deductions: [], bonuses: [] },
            { id: 'EMP-2', number: '2', name: 'Grace', active: true, deductions: [], bonuses: [] }
        ];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        state.attendanceByDate = {};
        state.exportConfig = {
            periodStart: '2026-08-16',
            periodEnd: '2026-08-31',
            deductions: [],
            bonuses: [],
            payrollAdjustmentComposerScopes: { deductions: 'employee', bonuses: 'employee' },
            rememberedGlobalsHydrated: true,
            payrollGuideStep: 'deductions',
            collapsedSteps: []
        };
        PayrollUI.init({
            state,
            services: { payroll: { calculateEmployeePayroll: jest.fn(() => ({ brutoOriginal: 1000, breakdown: [] })) } },
            render,
            saveToLocalStorage
        });
    });

    function installmentForm(kind = 'deductions') {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const form = host.querySelector(`.payroll-adjustment-desktop.is-${kind === 'bonuses' ? 'bonus' : 'deduction'} .payroll-adjustment-composer .payroll-adjustment-form`);
        updateAdjustmentEmployeeSelection(form, ['EMP-1', 'EMP-2'], state.employees);
        form.querySelector('[name="value"]').value = '100';
        form.querySelector('[name="name"]').value = 'Uniformes';
        form.querySelector('[name="installmentsEnabled"]').checked = true;
        form.querySelector('[name="installmentCount"]').value = '3';
        form.querySelector('[name="firstPeriodStart"]').value = '2026-08-16';
        return form;
    }

    test('saves plans on employees, persists once, notifies and creates no temporary payroll rule', async () => {
        const form = installmentForm();

        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions).toEqual([]);
        expect(state.employees.every(employee => employee.deductions.length === 1)).toBe(true);
        expect(state.employees.every(employee => isPayrollAdjustmentInstallmentPlan(employee.deductions[0]))).toBe(true);
        expect(new Set(state.employees.map(employee => employee.deductions[0].groupId)).size).toBe(1);
        expect(saveToLocalStorage).toHaveBeenCalledTimes(1);
        expect(saveToLocalStorage).toHaveBeenCalledWith({
            immediate: true,
            announce: false,
            requireLocalSuccess: true
        });
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('2 deducciones a cuotas'),
            'success'
        );
        expect(render).toHaveBeenCalled();
    });

    test('rolls back employee state when official persistence reports a local failure', async () => {
        const form = installmentForm();
        saveToLocalStorage.mockResolvedValueOnce({ localOk: false, cloudRequested: false });

        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.employees.every(employee => employee.deductions.length === 0)).toBe(true);
        expect(state.exportConfig.deductions).toEqual([]);
        expect(window.showNotification).toHaveBeenLastCalledWith(
            'No se pudieron guardar las cuotas en este dispositivo. No se realizó ningún cambio.',
            'error'
        );
    });

    test('keeps the durable plan when rendering fails after local persistence', async () => {
        const form = installmentForm();
        await new Promise(resolve => setTimeout(resolve, 0));
        render.mockImplementationOnce(() => {
            throw new Error('render failed after commit');
        });

        await expect(PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        )).rejects.toThrow('render failed after commit');

        expect(saveToLocalStorage).toHaveBeenCalledTimes(1);
        expect(state.employees.every(employee => employee.deductions.length === 1)).toBe(true);
        expect(state.employees.every(employee => isPayrollAdjustmentInstallmentPlan(employee.deductions[0]))).toBe(true);
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('2 deducciones a cuotas'),
            'success'
        );
    });

    test('keeps the existing one-time individual flow unchanged when installments are off', async () => {
        const form = installmentForm('bonuses');
        form.querySelector('[name="installmentsEnabled"]').checked = false;
        const employeeSnapshot = state.employees;

        await PayrollUI.addDesktopAdjustment(
            'bonuses',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.employees).toBe(employeeSnapshot);
        expect(state.exportConfig.bonuses).toHaveLength(1);
        expect(state.exportConfig.bonuses[0]).toMatchObject({
            scope: 'employee',
            type: 'fixed',
            value: 100,
            targetIds: ['EMP-1', 'EMP-2']
        });
        expect(saveToLocalStorage).not.toHaveBeenCalled();
    });

    test('legacy importer ignores modern plans instead of creating a zero-value rule', () => {
        state.employees[0].deductions = [
            {
                recordType: 'payroll-adjustment-installment-plan',
                version: 1,
                id: 'PLAN-1',
                type: 'fixed',
                totalAmount: 90,
                name: 'Plan moderno'
            },
            { id: 'LEGACY-1', type: 'fixed', value: 25, name: 'Ajuste anterior' }
        ];

        PayrollUI.addEmployeeDeductionsToExport();

        expect(state.exportConfig.deductions).toHaveLength(1);
        expect(state.exportConfig.deductions[0]).toMatchObject({
            id: 'LEGACY-1',
            value: 25,
            name: 'Ajuste anterior'
        });

        state.employees[0].bonuses = [
            {
                recordType: 'payroll-adjustment-installment-plan',
                version: 1,
                id: 'PLAN-BONUS',
                type: 'fixed',
                totalAmount: 80,
                name: 'Plan moderno'
            },
            { id: 'LEGACY-BONUS', type: 'fixed', value: 15, name: 'Bono anterior' }
        ];
        PayrollUI.addEmployeeBonusesToExport();
        expect(state.exportConfig.bonuses).toHaveLength(1);
        expect(state.exportConfig.bonuses[0]).toMatchObject({
            id: 'LEGACY-BONUS',
            value: 15,
            name: 'Bono anterior'
        });
    });
});
