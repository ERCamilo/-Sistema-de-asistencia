import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { ProjectPayrollUIRuntime } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import payrollClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import { Modal } from '../modules/components/Modal.js';
import { state as appState } from '../modules/core/AppState.js';

// Obras activas: descuentos programados recuperados de antes de las obras
// (projectRecovery), 3 cuotas pendientes de 500, primera nómina 2026-08-01,
// fuera de la cuadrícula de 21 días de la obra (2026-09-11 / 2026-10-01).
const PROJECT = 'PRJ-OBRA-1';
const GROUP = 'ADJ-GROUP-1789054901233-1-group';
const PERIOD = { periodStart: '2026-09-11', periodEnd: '2026-10-01' };

function plan(id, employeeId, overrides = {}) {
    return {
        id,
        groupId: GROUP,
        employeeId,
        recordType: 'payroll-adjustment-installment-plan',
        version: 1,
        kind: 'deductions',
        type: 'fixed',
        name: 'Herramienta',
        status: 'active',
        projectId: PROJECT,
        projectRecovery: { originalProjectId: null, recoveredAt: 1790698493329, originalHistory: [] },
        totalAmount: 1500,
        installmentCount: 3,
        appliedInstallments: 0,
        appliedAmount: 0,
        balance: 1500,
        progressPercent: 0,
        firstPeriodStart: '2026-08-01',
        createdAt: 1789054901233,
        updatedAt: 1790698493329,
        installments: [1, 2, 3].map(sequence => ({
            id: `${id}-${sequence}`, sequence, amount: 500, appliedAmount: 0, status: 'pending'
        })),
        history: [],
        ...overrides
    };
}

function employee(id, number, plans = []) {
    return {
        id, number, name: `Empleado ${number}`, active: true, projectId: PROJECT,
        positions: [`POS-${id}`], loans: [], bonuses: [], deductions: plans
    };
}

function setup() {
    const employees = [
        employee('emp-26', '026', [plan('PLAN-26', 'emp-26')]),
        employee('emp-30', '030', [plan('PLAN-30', 'emp-30')]),
        employee('emp-40', '040', [plan('PLAN-40', 'emp-40', {
            groupId: 'ADJ-GROUP-done', status: 'cancelled', balance: 0,
            installments: [], installmentCount: 1, totalAmount: 500
        })])
    ];
    // El estado real de la app: stateManager.setState escribe sobre él.
    const state = Object.assign(appState, {
        employees,
        positions: employees.map(item => ({ id: `POS-${item.id}`, name: 'Operario', projectId: PROJECT, hourlyRate: 100, workingDays: [0, 1, 2, 3, 4, 5, 6] })),
        leaders: [],
        attendance: {},
        settings: {
            regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2, holidays: [], schemaVersion: 20,
            payPeriod: { periodStart: '2026-09-11', periodLength: 21, payDay: '2026-10-03' }
        },
        // Como en producción: el periodo de la obra vive en la vista scoped;
        // periodStart/periodEnd de exportConfig son transitorios y faltan.
        exportConfig: { deductions: [], bonuses: [], payrollLoanSelection: [] },
        payrollViewMode: 'generator'
    });
    const runtime = new ProjectPayrollUIRuntime({
        state,
        configStore: {
            getConfig: jest.fn(async pid => ({ ...createDefaultConfig(pid || PROJECT, state.settings), payPeriod: state.settings.payPeriod })),
            putConfig: jest.fn(async config => config)
        },
        projectContext: { subscribe: () => () => {}, emit: () => {} }
    });
    const saveToLocalStorage = jest.fn(async () => ({ localOk: true }));
    PayrollUI.init({
        state,
        services: {
            payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 5000, neto: 5000, breakdown: [] }) },
            payrollRuntime: runtime
        },
        render: jest.fn(),
        saveToLocalStorage
    });
    return { state, runtime, saveToLocalStorage };
}

function renderDeductionsStep(state) {
    state.exportConfig.payrollGuideStep = 'deductions';
    document.body.innerHTML = PayrollUI.PayrollTab();
}

function actionFor(action, employeeName) {
    return [...document.querySelectorAll(`[data-payroll-action="${action}"]`)]
        .find(node => (node.getAttribute('aria-label') || '').includes(employeeName));
}

function plansOf(state, employeeId) {
    return state.employees.find(item => item.id === employeeId).deductions;
}

describe('Programados con obras activas', () => {
    let harness;

    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT, defaultProjectId: PROJECT });
        globalThis.currentUser = { uid: 'scoped-scheduled-user' };
        window.showNotification = jest.fn();
        jest.spyOn(payrollClosureStore, 'getByPeriod').mockResolvedValue([]);
        jest.spyOn(payrollClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
        jest.spyOn(Modal, 'confirm').mockResolvedValue(true);
        harness = setup();
        await PayrollUI.refreshScopedPayrollPreview(PERIOD);
    });

    afterEach(() => {
        harness.runtime.dispose();
        jest.restoreAllMocks();
        resetEntityScope();
        setProjectsEnabled(false);
        localStorage.clear();
        delete globalThis.currentUser;
        delete window.showNotification;
        document.body.innerHTML = '';
    });

    test('shows Editar, Borrar and Quitar de la lista for the recovered plans', () => {
        renderDeductionsStep(harness.state);
        expect(actionFor('save-scheduled-adjustment-edit', 'Empleado 026')).toBeTruthy();
        expect(actionFor('remove-scheduled-adjustment-plan', 'Empleado 030')).toBeTruthy();
        expect(actionFor('archive-scheduled-adjustment', 'Empleado 040')).toBeTruthy();
    });

    test('Editar saves the new amount', async () => {
        renderDeductionsStep(harness.state);
        const button = actionFor('save-scheduled-adjustment-edit', 'Empleado 026');
        const form = button.closest('form');
        form.querySelector('[name="amount"]').value = '900';
        form.querySelector('[name="installmentCount"]').value = '3';

        await expect(PayrollUI.saveScheduledAdjustmentEdit(button.dataset.scheduledReference, form)).resolves.toBe(true);

        const saved = plansOf(harness.state, 'emp-26')[0];
        expect(saved.totalAmount).toBe(900);
        expect(saved.projectId).toBe(PROJECT);
        expect(harness.saveToLocalStorage).toHaveBeenCalled();
    });

    test('Borrar removes the plan of that employee only', async () => {
        renderDeductionsStep(harness.state);
        const button = actionFor('remove-scheduled-adjustment-plan', 'Empleado 030');

        await expect(PayrollUI.removeScheduledAdjustment(button.dataset.scheduledReference)).resolves.toBe(true);

        expect(plansOf(harness.state, 'emp-30').filter(item => item.status === 'active')).toHaveLength(0);
        expect(plansOf(harness.state, 'emp-26')[0].status).toBe('active');
    });

    test('Quitar de la lista archives the cancelled plan', async () => {
        renderDeductionsStep(harness.state);
        const button = actionFor('archive-scheduled-adjustment', 'Empleado 040');

        await expect(PayrollUI.archiveScheduledAdjustment(button.dataset.scheduledReference)).resolves.toBe(true);

        expect(plansOf(harness.state, 'emp-40')[0].archivedAt).toEqual(expect.any(Number));
    });

    test('Borrar also works for a plan that starts after the open payroll', async () => {
        const later = plansOf(harness.state, 'emp-26')[0];
        later.firstPeriodStart = '2026-10-02';
        renderDeductionsStep(harness.state);
        const button = actionFor('remove-scheduled-adjustment-plan', 'Empleado 026');

        await expect(PayrollUI.removeScheduledAdjustment(button.dataset.scheduledReference)).resolves.toBe(true);

        expect(plansOf(harness.state, 'emp-26').filter(item => item.status === 'active')).toHaveLength(0);
    });
});
