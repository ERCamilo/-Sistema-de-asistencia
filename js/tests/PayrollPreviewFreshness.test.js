import { state, stateManager } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { capturePayrollProjectContext } from '../modules/features/payroll/PayrollProjectContext.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import payrollClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import { clearPayrollAdjustmentPeriodRuntime } from '../modules/features/payroll/PayrollAdjustmentPeriodSelection.js';
import { resolvePayrollLoanSelection } from '../modules/features/payroll/PayrollLoans.js';
const P = 'PRJ-AUDIT';
let runtime, config, clipboard, previous;

const cfg = () => ({
    ...createDefaultConfig(P), projectId: P, updatedAt: 1,
    regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [],
    payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' }
});

const plain = () => ({
    employees: [{
        id: 'e', number: '1', name: 'Ana de prueba', projectId: P, active: true,
        positions: ['p'], bonuses: [], deductions: [],
        loans: [{ id: 'loan', principal: 5000, number: 1, interestRate: 0,
            startDate: '2026-03-01', dueDate: '2026-03-15', status: 'active',
            payments: [], refinancings: [] }]
    }],
    positions: [{ id: 'p', name: 'Puesto', projectId: P, hourlyRate: 100,
        workingDays: [0, 1, 2, 3, 4, 5, 6], leaderId: 'leader' }],
    leaders: [{ id: 'leader', name: 'Líder', projectId: P, active: true }],
    attendance: {
        'e-2026-03-05': { employeeId: 'e', date: '2026-03-05', projectId: P,
            present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p' }
    },
    settings: cfg(),
    exportConfig: { periodStart: '2026-03-01', periodEnd: '2026-03-15',
        rememberedGlobalsHydrated: true, bonuses: [], deductions: [], leaderFilter: 'all' },
    payrollViewMode: 'generator'
});

beforeEach(async () => {
    clearPayrollAdjustmentPeriodRuntime();
    previous = Object.fromEntries(Object.keys(plain()).map(key => [key, stateManager.getState()[key]]));
    localStorage.clear();
    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: P, defaultProjectId: P });
    stateManager.setState(plain(), { silent: true });
    config = cfg();
    runtime = new ProjectPayrollUIRuntime({ state,
        configStore: { getConfig: async () => config },
        projectContext: { subscribe: () => () => {} }
    });
    PayrollUI.init({ state, services: { payroll: {}, payrollRuntime: runtime }, render: () => {} });
    window.PayrollUI = PayrollUI;
    clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async text => clipboard.push(JSON.parse(text)) } });
    await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
});

afterEach(() => {
    runtime.dispose();
    clearPayrollAdjustmentPeriodRuntime();
    stateManager.setState(previous, { silent: true });
    setProjectsEnabled(false);
    resetEntityScope();
});

const exported = async () => {
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    return clipboard.at(-1);
};
const loan = () => resolvePayrollLoanSelection(
    state.employees, state.exportConfig.payrollLoanSelection, '2026-03-15'
)[0];

test('decimal comma applies the chosen loan amount rather than the entire debt', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '900,50');
    expect(loan()).toMatchObject({ mode: 'custom', total: 900.5 });
});

test.each(['', '0', '-100', 'abc', '1,2,3'])('invalid amount %p preserves the previous selection and blocks export until corrected', async value => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    expect(PayrollUI.setPayrollLoanCustomAmount('e', value)).toBe(false);
    expect(loan()).toMatchObject({ mode: 'custom', total: 100 });
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    expect(clipboard).toHaveLength(0);
    expect(PayrollUI.setPayrollLoanCustomAmount('e', '100,50')).toBe(true);
    expect((await exported())[0].monto).toBe(699.5);
});

test('choosing an explicit mode resolves the invalid draft without changing the debt', async () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    PayrollUI.setPayrollLoanCustomAmount('e', '');
    PayrollUI.setPayrollLoanModeFor('e', 'interest');
    expect((await exported())[0].monto).toBe(800);
    expect(state.employees[0].loans[0].principal).toBe(5000);
});

test('changed attendance blocks old exports and refresh preserves the chosen loan deduction', async () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    expect((await exported())[0].monto).toBe(700);
    stateManager.setState({ attendance: { ...state.attendance,
        'e-2026-03-05': { ...state.attendance['e-2026-03-05'], hoursWorked: 16 } } });
    const html = PayrollUI.PayrollTab();
    expect(html).toContain('Actualizar cálculo');
    expect(runtime.getCurrentView()).toMatchObject({ previewStale: true, previewRows: [] });
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    expect(clipboard).toHaveLength(1);
    PayrollUI.togglePayrollPaidConfirmation(true);
    expect(state.exportConfig.payrollPaidConfirmation).toBeFalsy();
    await PayrollUI.refreshScopedPayrollPreview();
    expect(runtime.getCurrentView().previewStale).toBe(false);
    expect((await exported())[0].monto).toBe(1500);
    expect(loan().total).toBe(100);
});

test.each([
    () => { state.positions[0].hourlyRate = 200; },
    () => { state.employees[0].positionSalaries = { p: 200 }; },
    () => { state.leaders[0].restDayFactor = 2; }
])('in-place rate or employee/leader edits invalidate a salary snapshot', edit => {
    edit();
    expect(runtime.getCurrentView().previewStale).toBe(true);
});

test('loan selections and guide/leader filters do not invalidate the base salary calculation', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    PayrollUI.setPayrollGuideStep('loans');
    state.exportConfig.leaderFilter = 'leader';
    expect(runtime.getCurrentView().previewStale).toBe(false);
});

test('attendance outside the period does not invalidate the calculation', () => {
    state.attendance['e-2026-04-01'] = { employeeId: 'e', projectId: P, date: '2026-04-01', present: true, hoursWorked: 8 };
    expect(runtime.getCurrentView().previewStale).toBe(false);
});

test('external config invalidates a manual period, blocks fallback and refreshes at the new rate', async () => {
    expect((await exported())[0].monto).toBe(800);
    window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: {
        source: 'catalog-sync', config: { ...config, updatedAt: 2, holidays: ['2026-03-05'] }
    } }));
    expect(runtime.getCurrentView()).toMatchObject({ previewStale: true, previewRows: [],
        period: { periodStart: '2026-03-01', periodEnd: '2026-03-15' } });
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    expect(clipboard).toHaveLength(1);
    await PayrollUI.refreshScopedPayrollPreview();
    expect(runtime.getCurrentView().previewStale).toBe(false);
    expect((await exported())[0].monto).toBe(1600);
});

test('local config changes also invalidate a manually selected period', async () => {
    runtime.configStore.putConfig = async value => value;
    await runtime.updateConfig({ ...config, holidays: ['2026-03-05'] });
    expect(runtime.getCurrentView().previewStale).toBe(true);
    await PayrollUI.refreshScopedPayrollPreview();
    expect((await exported())[0].monto).toBe(1600);
});

test('a valid empty runtime result never falls back to the previous nonempty preview', () => {
    runtime.getCurrentView().request.session.previewRows = [];
    expect(PayrollUI.PayrollTab()).toContain('0 empleados');
});

test('a data change during a calculation cannot certify old captured inputs as current', async () => {
    const pending = PayrollUI.refreshScopedPayrollPreview();
    state.attendance['e-2026-03-05'].hoursWorked = 16;
    await pending;
    expect(runtime.getCurrentView().previewStale).toBe(true);
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    expect(clipboard).toHaveLength(0);
});

test.each(['stale attendance', 'invalid amount'])('%s blocks PDF, JSON, SplitX and closing before any transfer', async scenario => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    if (scenario === 'stale attendance') state.attendance['e-2026-03-05'].hoursWorked = 16;
    else PayrollUI.setPayrollLoanCustomAmount('e', '');
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const pull = jest.spyOn(payrollClosureSync, 'pullPeriod');
    try {
        PayrollUI.copyExportJSON();
        PayrollUI.downloadExportJSON();
        await PayrollUI.exportPayrollPDF();
        PayrollUI.sendToSplitX();
        PayrollUI.togglePayrollPaidConfirmation(true);
        await PayrollUI.openPayrollClosure();
        expect(clipboard).toHaveLength(0);
        expect(open).not.toHaveBeenCalled();
        expect(pull).not.toHaveBeenCalled();
        expect(state.exportConfig.payrollPaidConfirmation).toBeFalsy();
    } finally { open.mockRestore(); pull.mockRestore(); }
});

test('a newer config event invalidates an in-flight calculation from the old config', async () => {
    const pending = PayrollUI.refreshScopedPayrollPreview();
    runtime.applyExternalConfig({ ...config, updatedAt: 2, holidays: ['2026-03-05'] });
    await pending;
    expect(runtime.getCurrentView().previewStale).toBe(true);
    await PayrollUI.refreshScopedPayrollPreview();
    expect((await exported())[0].monto).toBe(1600);
});

test('a config event redraws the screen without losing the selected loan amount', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    const render = jest.fn();
    PayrollUI.init({ state, services: { payroll: {}, payrollRuntime: runtime }, render });
    runtime.applyExternalConfig({ ...config, updatedAt: 2, holidays: ['2026-03-05'] });
    expect(render).toHaveBeenCalled();
    expect(loan().total).toBe(100);
});

test('the last requested period wins when initial configuration requests finish out of order', async () => {
    const resolvers = [];
    const cold = new ProjectPayrollUIRuntime({ state: plain(), configStore: {
        getConfig: () => new Promise(resolve => resolvers.push(resolve))
    }, projectContext: { subscribe: () => () => {} } });
    try {
        const old = cold.generatePreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        const recent = cold.generatePreview({ periodStart: '2026-04-01', periodEnd: '2026-04-15' });
        resolvers[1](config);
        await recent;
        resolvers[0](config);
        expect((await old).current).toBe(false);
        expect(cold.getCurrentView().period.periodStart).toBe('2026-04-01');
    } finally { cold.dispose(); }
});

test('configuration received during initial loading supersedes the older pending store read', async () => {
    let resolve;
    const cold = new ProjectPayrollUIRuntime({ state: plain(), configStore: {
        getConfig: () => new Promise(done => { resolve = done; })
    }, projectContext: { subscribe: () => () => {} } });
    try {
        const pending = cold.generatePreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        cold.applyExternalConfig({ ...config, updatedAt: 2, holidays: ['2026-03-05'] });
        resolve(config);
        expect((await pending).current).toBe(false);
        expect(cold.getCurrentView().config.updatedAt).toBe(2);
        const next = await cold.generatePreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        expect(next.rows[0].monto).toBe(1600);
    } finally { cold.dispose(); }
});
