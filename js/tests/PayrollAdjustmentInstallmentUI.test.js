import { Modal } from '../modules/components/Modal.js';
import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { updateAdjustmentEmployeeSelection } from '../modules/features/payroll/PayrollAdjustmentDesktop.js';
import {
    ADJUSTMENT_PLAN_KIND,
    createPayrollAdjustmentInstallmentPlans,
    isPayrollAdjustmentInstallmentPlan
} from '../modules/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import {
    buildScheduledAdjustmentGroups,
    renderScheduledAdjustmentGroups
} from '../modules/features/payroll/PayrollAdjustmentScheduled.js';
import {
    clearPayrollAdjustmentPeriodRuntime,
    getPayrollAdjustmentPeriodRuntimeSelections,
    setPayrollAdjustmentPeriodRuntimeSelection
} from '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';

describe('Payroll adjustment installments UI persistence', () => {
    const render = jest.fn();
    const saveToLocalStorage = jest.fn(() => Promise.resolve({ localOk: true, cloudRequested: true }));

    beforeAll(() => {
        window.PayrollUI = PayrollUI;
    });

    beforeEach(() => {
        jest.restoreAllMocks();
        render.mockReset();
        saveToLocalStorage.mockReset().mockResolvedValue({
            localOk: true,
            cloudRequested: true
        });
        window.showNotification = jest.fn();
        clearPayrollAdjustmentPeriodRuntime();
        state.employees = [
            { id: 'EMP-1', number: '1', name: 'Ada', active: true, deductions: [], bonuses: [] },
            { id: 'EMP-2', number: '2', name: 'Grace', active: true, deductions: [], bonuses: [] }
        ];
        state.positions = [{ id: 'POS-1', name: 'Albañil', active: true }];
        state.leaders = [{ id: 'LEAD-1', name: 'Equipo Norte', active: true }];
        state.attendance = {};
        state.attendanceByDate = {};
        state.exportConfig = {
            periodStart: '2026-08-16',
            periodEnd: '2026-08-31',
            deductions: [],
            bonuses: [],
            payrollAdjustmentPeriodSelections: [{ legacy: true }],
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
        form.querySelector('[name="remembered"]').checked = true;
        form.querySelector('[name="installmentsEnabled"]').checked = true;
        form.querySelector('[name="installmentCount"]').value = '3';
        form.querySelector('[name="firstPeriodStart"]').value = '2026-08-16';
        return form;
    }

    function renderScheduledAction(kind, action = 'pause') {
        const host = document.createElement('div');
        host.innerHTML = renderScheduledAdjustmentGroups(
            kind,
            buildScheduledAdjustmentGroups(kind, state.employees)
        );
        return host.querySelector(
            `[data-payroll-action="${action}-scheduled-adjustment"]`
        )?.dataset.scheduledReference;
    }

    function onePayment(kind, employeeId, name, seed) {
        let serial = 0;
        return createPayrollAdjustmentInstallmentPlans({
            kind: kind === 'bonuses'
                ? ADJUSTMENT_PLAN_KIND.BONUS
                : ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: [employeeId],
            name,
            totalAmount: 25,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-08-16',
            createdAt: 100
        }, { createId: prefix => `${prefix}-${seed}-${++serial}` })[0];
    }

    test.each(['deductions', 'bonuses'])(
        'updates the active %s form from delegated click and change events',
        kind => {
            state.exportConfig.payrollAdjustmentComposerScopes[kind] = 'global';
            document.body.innerHTML = PayrollUI.PayrollTab();
            const form = document.body.querySelector(
                `.payroll-adjustment-desktop.is-${kind === 'bonuses' ? 'bonus' : 'deduction'} `
                + '.payroll-adjustment-composer .payroll-adjustment-form'
            );
            const workspace = form.closest('.payroll-adjustment-desktop');
            workspace.addEventListener('click', event => event.stopPropagation());
            workspace.addEventListener('change', event => event.stopPropagation());
            const employeeTarget = form.querySelector('.payroll-adjustment-form__target--employee');
            const installmentOption = form.querySelector('[data-installment-option]');

            const individual = form.querySelector('input[name="scope"][value="employee"]');
            individual.click();

            expect(form.dataset.adjustmentScope).toBe('employee');
            expect(employeeTarget.classList).toContain('is-visible');
            expect(installmentOption.hidden).toBe(true);
            expect(form.querySelector('.payroll-adjustment-remember').textContent)
                .toContain('Guardar como pago programado');

            form.querySelector('[name="remembered"]').checked = true;
            form.querySelector('[name="remembered"]').dispatchEvent(
                new Event('change', { bubbles: true })
            );
            expect(installmentOption.hidden).toBe(false);
            expect(installmentOption.textContent).toContain('Dividir en cuotas');

            const percentage = form.querySelector('input[name="type"][value="percentage"]');
            percentage.checked = true;
            percentage.dispatchEvent(new Event('change', { bubbles: true }));
            expect(installmentOption.hidden).toBe(true);

            const fixed = form.querySelector('input[name="type"][value="fixed"]');
            fixed.click();
            expect(installmentOption.hidden).toBe(false);

            const general = form.querySelector('input[name="scope"][value="global"]');
            general.click();

            expect(form.dataset.adjustmentScope).toBe('global');
            expect(employeeTarget.classList).not.toContain('is-visible');
            expect(installmentOption.hidden).toBe(true);
        }
    );

    test('keeps the deduction scope, target and preview aligned when the committed radio input does not bubble', async () => {
        state.employees.push(
            { id: 'EMP-3', number: '3', name: 'Katherine', active: true, deductions: [], bonuses: [] },
            { id: 'EMP-4', number: '4', name: 'Dorothy', active: true, deductions: [], bonuses: [] },
            { id: 'EMP-5', number: '5', name: 'Mary', active: true, deductions: [], bonuses: [] }
        );
        state.exportConfig.payrollAdjustmentComposerScopes.deductions = 'global';
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        neto: 1000,
                        brutoOriginal: 1000,
                        bruto: 1000,
                        bonuses: 0,
                        deductions: 0,
                        breakdown: [],
                        bonusBreakdown: [],
                        deductionBreakdown: []
                    }))
                }
            },
            render,
            saveToLocalStorage
        });
        document.body.innerHTML = PayrollUI.PayrollTab();
        const form = document.body.querySelector(
            '.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer .payroll-adjustment-form'
        );
        const previewEmployees = form.querySelector('[data-preview-employees]');
        const scopeInput = scope => form.querySelector(
            'input[name="scope"][value="' + scope + '"]'
        );
        const selectScope = scope => {
            const input = scopeInput(scope);
            input.addEventListener('input', event => event.stopPropagation());
            input.checked = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        expect(previewEmployees.textContent).toBe('5');

        selectScope('employee');
        expect(form.dataset.adjustmentScope).toBe('employee');
        expect(form.querySelector('.payroll-adjustment-form__target--employee').classList)
            .toContain('is-visible');
        expect(previewEmployees.textContent).toBe('0');

        selectScope('leader');
        expect(form.dataset.adjustmentScope).toBe('leader');
        expect(form.querySelector('.payroll-adjustment-form__target--leader').classList)
            .toContain('is-visible');

        selectScope('position');
        expect(form.dataset.adjustmentScope).toBe('position');
        expect(form.querySelector('.payroll-adjustment-form__target--position').classList)
            .toContain('is-visible');

        selectScope('employee');
        updateAdjustmentEmployeeSelection(form, ['EMP-1'], state.employees);
        form.querySelector('[name="value"]').value = '25';
        form.querySelector('[name="name"]').value = '';
        const remembered = form.querySelector('[name="remembered"]');
        remembered.addEventListener('input', event => event.stopPropagation());
        remembered.checked = true;
        remembered.dispatchEvent(new Event('input', { bubbles: true }));

        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(window.showNotification).toHaveBeenLastCalledWith(
            'Escribe un concepto antes de guardar este ajuste.',
            'error'
        );
        expect(state.employees.every(employee => employee.deductions.length === 0)).toBe(true);
    });

    test.each([
        ['leader', 'leaderTarget', 'LEAD-1'],
        ['position', 'positionTarget', 'POS-1'],
        ['employee', null, null]
    ])('requires a concept only when %s scope is saved', async (scope, targetName, targetValue) => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const form = host.querySelector(
            '.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer .payroll-adjustment-form'
        );
        form.querySelector('input[name="scope"][value="' + scope + '"]').checked = true;
        if (targetName) form.querySelector('[name="' + targetName + '"]').value = targetValue;
        if (scope === 'employee') {
            updateAdjustmentEmployeeSelection(form, ['EMP-1'], state.employees);
        }
        form.querySelector('[name="value"]').value = '25';
        form.querySelector('[name="name"]').value = '';
        form.querySelector('[name="remembered"]').checked = true;

        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(window.showNotification).toHaveBeenLastCalledWith(
            'Escribe un concepto antes de guardar este ajuste.',
            'error'
        );
        expect(state.exportConfig.deductions).toEqual([]);
        expect(state.employees.every(employee => employee.deductions.length === 0)).toBe(true);

        form.querySelector('[name="remembered"]').checked = false;
        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions).toHaveLength(1);
        expect(state.exportConfig.deductions[0].name).toBe('Descuento');
    });

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

    test('saves one payment for every selected employee without a duplicate temporary rule', async () => {
        const form = installmentForm('bonuses');
        form.querySelector('[name="installmentsEnabled"]').checked = false;

        await PayrollUI.addDesktopAdjustment(
            'bonuses',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.bonuses).toEqual([]);
        expect(state.employees.every(employee => employee.bonuses.length === 1)).toBe(true);
        expect(state.employees.every(employee => employee.bonuses[0].installmentCount === 1)).toBe(true);
        expect(state.employees.every(employee => employee.bonuses[0].installments.length === 1)).toBe(true);
        expect(new Set(state.employees.map(employee => employee.bonuses[0].groupId)).size).toBe(1);
        expect(new Set(state.employees.map(employee => employee.bonuses[0].id)).size).toBe(2);
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('2 pagos programados'),
            'success'
        );
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

    test('keeps the existing one-time individual flow unchanged when save is off', async () => {
        const form = installmentForm('bonuses');
        form.querySelector('[name="remembered"]').checked = false;
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

    test('removes a virgin individual plan, clears its current choice and explains the impact', async () => {
        let serial = 0;
        const [plan] = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION, employeeIds: ['EMP-1'], name: 'Uniforme',
            totalAmount: 90, installmentCount: 3, firstPeriodStart: '2026-08-16', createdAt: 100
        }, { createId: prefix => `${prefix}-remove-ui-${++serial}` });
        state.employees[0].deductions = [plan];
        setPayrollAdjustmentPeriodRuntimeSelection({ kind: 'deductions', planId: plan.id,
            employeeId: 'EMP-1', periodStart: '2026-08-16', periodEnd: '2026-08-31'
        }, { mode: 'count', count: 2 });
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const token = host.querySelector(
            '.is-deduction [data-payroll-action="remove-scheduled-adjustment-plan"]'
        ).dataset.scheduledReference;
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        jest.clearAllMocks();

        await expect(PayrollUI.removeScheduledAdjustment(token)).resolves.toBe(true);

        expect(state.employees[0].deductions).toEqual([]);
        expect(state.employees[0].deletedItemIds.deductions).toContain(plan.id);
        expect(getPayrollAdjustmentPeriodRuntimeSelections('2026-08-16', '2026-08-31')).toEqual([]);
        expect(Modal.confirm).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Quitar pago programado',
            message: expect.stringContaining('En esta nómina')
        }));
        expect(saveToLocalStorage).toHaveBeenCalledWith({
            immediate: true, announce: false, requireLocalSuccess: true
        });
    });

    test('cancels a mixed group atomically and retains the plan with history', async () => {
        let serial = 0;
        const plans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.BONUS, employeeIds: ['EMP-1', 'EMP-2'], name: 'Premio',
            totalAmount: 60, installmentCount: 2, firstPeriodStart: '2026-08-16', createdAt: 100
        }, { createId: prefix => `${prefix}-group-remove-${++serial}` });
        plans[1].history.push({ id: 'H-1', source: 'manual', amount: 10 });
        state.employees[0].bonuses = [plans[0]];
        state.employees[1].bonuses = [plans[1]];
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const token = host.querySelector(
            '.is-bonus [data-payroll-action="cancel-scheduled-adjustment-group"]'
        ).dataset.scheduledReference;
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        jest.clearAllMocks();

        await expect(PayrollUI.removeScheduledAdjustment(token)).resolves.toBe(true);

        expect(state.employees[0].bonuses).toEqual([]);
        expect(state.employees[1].bonuses[0]).toMatchObject({
            status: 'cancelled', groupId: plans[1].groupId
        });
        expect(state.employees[1].bonuses[0].history).toEqual(plans[1].history);
        expect(saveToLocalStorage).toHaveBeenCalledTimes(1);
    });

    test('rolls back removal on local failure and keeps the provisional choice', async () => {
        const plan = onePayment('deductions', 'EMP-1', 'Equipo', 'remove-failure');
        state.employees[0].deductions = [plan];
        setPayrollAdjustmentPeriodRuntimeSelection({ kind: 'deductions', planId: plan.id,
            employeeId: 'EMP-1', periodStart: '2026-08-16', periodEnd: '2026-08-31'
        }, { mode: 'pause' });
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const token = host.querySelector(
            '.is-deduction [data-payroll-action="remove-scheduled-adjustment-plan"]'
        ).dataset.scheduledReference;
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        saveToLocalStorage.mockResolvedValueOnce({ localOk: false, cloudRequested: false });
        jest.clearAllMocks();

        await expect(PayrollUI.removeScheduledAdjustment(token)).resolves.toBe(false);

        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(getPayrollAdjustmentPeriodRuntimeSelections('2026-08-16', '2026-08-31'))
            .toEqual([expect.objectContaining({ planId: plan.id, mode: 'pause' })]);
        expect(render).not.toHaveBeenCalled();
        expect(window.showNotification).not.toHaveBeenCalledWith(expect.any(String), 'success');
    });

    test('keeps a committed removal when the postcommit render fails', async () => {
        const plan = onePayment('deductions', 'EMP-1', 'Equipo', 'remove-render');
        state.employees[0].deductions = [plan];
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const token = host.querySelector(
            '.is-deduction [data-payroll-action="remove-scheduled-adjustment-plan"]'
        ).dataset.scheduledReference;
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        render.mockImplementationOnce(() => { throw new Error('render failed after removal'); });

        await expect(PayrollUI.removeScheduledAdjustment(token))
            .rejects.toThrow('render failed after removal');
        expect(state.employees[0].deductions).toEqual([]);
        expect(saveToLocalStorage).toHaveBeenCalledTimes(1);
        expect(window.showNotification).toHaveBeenCalledWith('Programación eliminada.', 'success');
    });

    test('revalidates a removal after confirmation and rejects an in-place revision race', async () => {
        const plan = onePayment('bonuses', 'EMP-1', 'Premio', 'remove-race');
        state.employees[0].bonuses = [plan];
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const token = host.querySelector(
            '.is-bonus [data-payroll-action="remove-scheduled-adjustment-plan"]'
        ).dataset.scheduledReference;
        let answer;
        jest.spyOn(Modal, 'confirm').mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));

        const pending = PayrollUI.removeScheduledAdjustment(token);
        await Promise.resolve();
        state.employees[0].bonuses[0].updatedAt = 999;
        answer(true);

        await expect(pending).resolves.toBe(false);
        expect(state.employees[0].bonuses).toHaveLength(1);
        expect(saveToLocalStorage).not.toHaveBeenCalled();
    });

    test('pauses and resumes a saved payment with durable local persistence', async () => {
        const form = installmentForm();
        form.querySelector('[name="installmentsEnabled"]').checked = false;
        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        jest.clearAllMocks();
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);

        const pauseReference = renderScheduledAction('deductions');
        await expect(PayrollUI.setScheduledAdjustmentPaused(pauseReference, true))
            .resolves.toBe(true);
        expect(state.employees[0].deductions[0].status).toBe('paused');

        jest.clearAllMocks();
        const resumeReference = renderScheduledAction('deductions', 'resume');
        await expect(PayrollUI.setScheduledAdjustmentPaused(resumeReference, false))
            .resolves.toBe(true);
        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(saveToLocalStorage).toHaveBeenCalledWith({
            immediate: true,
            announce: false,
            requireLocalSuccess: true
        });
        expect(window.showNotification).toHaveBeenCalledWith(
            'Pago programado reanudado.',
            'success'
        );
    });

    test('rolls back pause on local failure and never starts cloud persistence', async () => {
        const form = installmentForm();
        form.querySelector('[name="installmentsEnabled"]').checked = false;
        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        jest.clearAllMocks();
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        saveToLocalStorage.mockResolvedValueOnce({ localOk: false, cloudRequested: false });

        await PayrollUI.setScheduledAdjustmentPaused(renderScheduledAction('deductions'), true);

        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(saveToLocalStorage).toHaveBeenCalledWith({
            immediate: true,
            announce: false,
            requireLocalSuccess: true
        });
        expect(window.showNotification).toHaveBeenLastCalledWith(
            'No se pudo pausar el pago programado en este dispositivo. No se realizó ningún cambio.',
            'error'
        );
        expect(render).not.toHaveBeenCalled();
    });

    test('keeps a committed pause when the postcommit render fails', async () => {
        const form = installmentForm();
        form.querySelector('[name="installmentsEnabled"]').checked = false;
        await PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        jest.clearAllMocks();
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);
        saveToLocalStorage.mockResolvedValueOnce({ localOk: true, cloudRequested: true });
        render.mockImplementationOnce(() => {
            throw new Error('render failed after pause commit');
        });

        await expect(PayrollUI.setScheduledAdjustmentPaused(
            renderScheduledAction('deductions'),
            true
        ))
            .rejects.toThrow('render failed after pause commit');

        expect(state.employees[0].deductions[0].status).toBe('paused');
        expect(window.showNotification).toHaveBeenCalledWith(
            'Pago programado pausado.',
            'success'
        );
    });

    test.each(['deductions', 'bonuses'])(
        'keeps a rendered %s action bound to its original plan after projection reorder',
        async kind => {
            state.employees = [
                {
                    id: 'EMP-C', number: '3', name: 'Celia', active: true,
                    deductions: kind === 'deductions' ? [onePayment(kind, 'EMP-C', 'C', 'c')] : [],
                    bonuses: kind === 'bonuses' ? [onePayment(kind, 'EMP-C', 'C', 'c')] : []
                }
            ];
            const reference = renderScheduledAction(kind);
            const planC = state.employees[0][kind][0];

            const planA = onePayment(kind, 'EMP-A', 'A', 'a');
            const planB = onePayment(kind, 'EMP-B', 'B', 'b');
            state.employees = [
                {
                    id: 'EMP-A', number: '1', name: 'Ana', active: true,
                    deductions: kind === 'deductions' ? [planA] : [],
                    bonuses: kind === 'bonuses' ? [planA] : []
                },
                {
                    id: 'EMP-B', number: '2', name: 'Bea', active: true,
                    deductions: kind === 'deductions' ? [planB] : [],
                    bonuses: kind === 'bonuses' ? [planB] : []
                },
                {
                    id: 'EMP-C', number: '3', name: 'Celia', active: true,
                    deductions: kind === 'deductions' ? [planC] : [],
                    bonuses: kind === 'bonuses' ? [planC] : []
                }
            ];
            jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(true);

            await PayrollUI.setScheduledAdjustmentPaused(reference, true);

            expect(state.employees[0][kind][0].status).toBe('active');
            expect(state.employees[1][kind][0].status).toBe('active');
            expect(state.employees[2][kind][0].status).toBe('paused');
        }
    );

    test('rejects invalid and expired scheduled references without changing a plan', async () => {
        state.employees[0].deductions = [onePayment('deductions', 'EMP-1', 'C', 'stale')];
        const expiredReference = renderScheduledAction('deductions');
        renderScheduledAction('deductions');
        jest.spyOn(Modal, 'confirm');

        await PayrollUI.setScheduledAdjustmentPaused(expiredReference, true);
        await PayrollUI.setScheduledAdjustmentPaused('scheduled-action-invalid', true);

        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(saveToLocalStorage).not.toHaveBeenCalled();
        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenCalledTimes(2);
        expect(window.showNotification).toHaveBeenLastCalledWith(
            'Esta lista cambió. Abre nuevamente Programados e inténtalo otra vez.',
            'error'
        );
    });

    test('revalidates a scheduled reference after confirmation before mutating or saving', async () => {
        state.employees[0].deductions = [onePayment('deductions', 'EMP-1', 'C', 'confirm-race')];
        const reference = renderScheduledAction('deductions');
        let resolveConfirmation;
        jest.spyOn(Modal, 'confirm').mockReturnValueOnce(new Promise(resolve => {
            resolveConfirmation = resolve;
        }));
        jest.clearAllMocks();

        const pendingPause = PayrollUI.setScheduledAdjustmentPaused(reference, true);
        await Promise.resolve();
        renderScheduledAction('deductions');
        resolveConfirmation(true);
        const outcome = await pendingPause;

        expect(outcome).toBe(false);
        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(saveToLocalStorage).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(window.showNotification).not.toHaveBeenCalledWith(
            expect.any(String),
            'success'
        );
        expect(window.showNotification).toHaveBeenLastCalledWith(
            'Esta lista cambió. Abre nuevamente Programados e inténtalo otra vez.',
            'error'
        );
    });

    test('cancels a valid scheduled pause without mutating, saving or rendering success', async () => {
        state.employees[0].deductions = [onePayment('deductions', 'EMP-1', 'C', 'cancel')];
        const reference = renderScheduledAction('deductions');
        jest.spyOn(Modal, 'confirm').mockResolvedValueOnce(false);
        jest.clearAllMocks();

        const outcome = await PayrollUI.setScheduledAdjustmentPaused(reference, true);

        expect(outcome).toBe(false);
        expect(state.employees[0].deductions[0].status).toBe('active');
        expect(saveToLocalStorage).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(window.showNotification).not.toHaveBeenCalledWith(
            expect.any(String),
            'success'
        );
    });

    test('applies group quick actions, keeps employee exceptions and rejects stale selection tokens', () => {
        let serial = 0;
        const plans = createPayrollAdjustmentInstallmentPlans({
            kind: ADJUSTMENT_PLAN_KIND.DEDUCTION,
            employeeIds: ['EMP-1', 'EMP-2'],
            name: 'Uniformes',
            totalAmount: 90,
            installmentCount: 3,
            firstPeriodStart: '2026-08-16',
            createdAt: 100
        }, { createId: prefix => `${prefix}-period-ui-${++serial}` });
        state.employees[0].deductions = [plans[0]];
        state.employees[1].deductions = [plans[1]];
        state.exportConfig.periodStart = '2026-08-16';
        state.exportConfig.periodEnd = '2026-08-31';

        const firstHost = document.createElement('div');
        firstHost.innerHTML = PayrollUI.PayrollTab();
        const groupPause = firstHost.querySelector(
            '.is-deduction [data-selection-value="pause"]'
        );
        const staleReference = groupPause.dataset.scheduledReference;

        expect(PayrollUI.setScheduledAdjustmentGroupPeriodSelection(
            staleReference,
            'pause'
        )).toBe(true);
        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            state.exportConfig.periodStart,
            state.exportConfig.periodEnd
        )).toEqual(expect.arrayContaining([
                expect.objectContaining({ employeeId: 'EMP-1', mode: 'pause' }),
                expect.objectContaining({ employeeId: 'EMP-2', mode: 'pause' })
            ]));
        expect(state.exportConfig).not.toHaveProperty('payrollAdjustmentPeriodSelections');
        expect(JSON.stringify(state)).not.toContain(staleReference);
        expect(saveToLocalStorage).not.toHaveBeenCalled();

        const secondHost = document.createElement('div');
        secondHost.innerHTML = PayrollUI.PayrollTab();
        const adaSelect = [...secondHost.querySelectorAll(
            '.is-deduction [data-payroll-adjustment-period-selection]'
        )].find(select => select.getAttribute('aria-label').includes('Ada'));
        expect(PayrollUI.setScheduledAdjustmentPeriodSelection(
            adaSelect.dataset.scheduledReference,
            'count:2'
        )).toBe(true);
        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            state.exportConfig.periodStart,
            state.exportConfig.periodEnd
        )).toEqual(expect.arrayContaining([
                expect.objectContaining({ employeeId: 'EMP-1', mode: 'count', count: 2 }),
                expect.objectContaining({ employeeId: 'EMP-2', mode: 'pause' })
            ]));
        const retainedHost = document.createElement('div');
        retainedHost.innerHTML = PayrollUI.PayrollTab();
        const retainedAda = [...retainedHost.querySelectorAll(
            '.is-deduction [data-payroll-adjustment-period-selection]'
        )].find(select => select.getAttribute('aria-label').includes('Ada'));
        expect(retainedAda.value).toBe('count:2');

        const before = getPayrollAdjustmentPeriodRuntimeSelections(
            state.exportConfig.periodStart,
            state.exportConfig.periodEnd
        );
        render.mockClear();
        expect(PayrollUI.setScheduledAdjustmentGroupPeriodSelection(
            staleReference,
            'count:1'
        )).toBe(false);
        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            state.exportConfig.periodStart,
            state.exportConfig.periodEnd
        )).toEqual(before);
        expect(render).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenLastCalledWith(
            'Esta lista cambió. Abre nuevamente Programados e inténtalo otra vez.',
            'error'
        );

        PayrollUI.updateExportPeriod('start', '2026-09-01');
        PayrollUI.updateExportPeriod('end', '2026-09-15');
        expect(getPayrollAdjustmentPeriodRuntimeSelections(
            '2026-09-01', '2026-09-15'
        )).toEqual([]);
        const newPeriodHost = document.createElement('div');
        newPeriodHost.innerHTML = PayrollUI.PayrollTab();
        const newPeriodAda = [...newPeriodHost.querySelectorAll(
            '.is-deduction [data-payroll-adjustment-period-selection]'
        )].find(select => select.getAttribute('aria-label').includes('Ada'));
        expect(newPeriodAda.value).toBe('count:1');
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
