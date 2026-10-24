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
import { Modal } from '../modules/components/Modal.js';
import * as payrollContext from '../modules/features/payroll/PayrollProjectContext.js';
import * as payrollCalculation from '../modules/features/payroll/PayrollService.js';
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
).find(item => item.employeeId === 'e');

test.each([['available', 100, 800, 0], ['percentage', 30, 240, 560], ['percentage', 50, 400, 400]])(
    '%s at %i percent uses salary before loans and exports the resulting net', async (kind, percentage, deduction, net) => {
        PayrollUI.setPayrollLoanCustomAmount('e', '100');
        expect(PayrollUI.setPayrollLoanSalaryAmount('e', kind, percentage)).toBe(true);
        expect(loan().total).toBe(deduction);
        expect((await exported())[0].monto).toBe(net);
        expect(state.employees[0].loans[0].principal).toBe(5000);
    }
);

test.each([['available', 900, 0], ['recommended', 270, 630]])(
    'bulk %s applies once to adjusted salaries, exports actual amounts and refreshes warning counts', async (kind, amount, net) => {
        state.exportConfig.bonuses = [{ id: 'b', name: 'Bono', type: 'fixed', value: 200, scope: 'global' }];
        state.exportConfig.deductions = [{ id: 'd', name: 'Descuento', type: 'fixed', value: 100, scope: 'global' }];
        await PayrollUI.refreshScopedPayrollPreview();
        PayrollUI.setPayrollLoanCustomAmount('e', '100');
        PayrollUI.setPayrollLoanCustomAmount('e', ''); // A bulk choice also resolves any invalid target draft.
        const before = JSON.stringify(state.employees);
        expect(PayrollUI.setPayrollLoansSalaryBulk(kind)).toBe(true);
        expect(loan().total).toBe(amount);
        expect((await exported())[0].monto).toBe(net);
        expect(PayrollUI.setPayrollLoansSalaryBulk(kind)).toBe(true);
        expect(loan().total).toBe(amount);
        PayrollUI.setPayrollGuideStep('loans');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const summary = host.querySelector('.payroll-loans-warning-summary');
        expect(summary.textContent).toContain('1 con deuda pendiente');
        expect(summary.textContent).toContain(`${kind === 'available' ? 1 : 0} en cero tras cobro`);
        expect(summary.querySelectorAll('svg')).toHaveLength(2);
        expect(JSON.stringify(state.employees)).toBe(before);
    }
);

test('bulk choices respect the project and leader and preserve selections outside that filter', async () => {
    const base = state.employees[0];
    state.positions.push({ ...state.positions[0], id: 'p2', leaderId: 'leader2' });
    state.leaders.push({ id: 'leader2', name: 'Otro líder', projectId: P, active: true });
    state.employees.push({ ...base, id: 'other-leader', number: '2', positions: ['p2'], loans: [{ ...base.loans[0], id: 'loan2' }] });
    state.employees.push({ ...base, id: 'foreign', number: '3', projectId: 'OTHER', loans: [{ ...base.loans[0], id: 'loan3' }] });
    state.attendance['other-leader-2026-03-05'] = { ...state.attendance['e-2026-03-05'], employeeId: 'other-leader', selectedPosition: 'p2' };
    await PayrollUI.refreshScopedPayrollPreview();
    PayrollUI.setPayrollLoanCustomAmount('other-leader', '100');
    PayrollUI.setPayrollLoanCustomAmount('foreign', '75');
    state.exportConfig.leaderFilter = 'leader';
    const before = state.exportConfig.payrollLoanSelection.map(item => ({ ...item }));
    const render = jest.fn();
    PayrollUI.init({ state, services: { payroll: {}, payrollRuntime: runtime }, render });
    expect(PayrollUI.setPayrollLoansSalaryBulk('available')).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(loan().total).toBe(800);
    for (const id of ['other-leader', 'foreign']) {
        expect(state.exportConfig.payrollLoanSelection.find(item => item.employeeId === id))
            .toEqual(before.find(item => item.employeeId === id));
    }
});

test('bulk action is delegated from both new buttons', () => {
    PayrollUI.setPayrollGuideStep('loans');
    document.body.innerHTML = PayrollUI.PayrollTab();
    document.querySelector('[data-payroll-action="set-payroll-loans-salary-bulk"][data-kind="available"]').click();
    expect(loan().total).toBe(800);
    document.querySelector('[data-payroll-action="set-payroll-loans-salary-bulk"][data-kind="recommended"]').click();
    expect(loan().total).toBe(240);
    document.body.innerHTML = '';
});

test('bulk choices refuse stale previews, invalid actions and disabled loans without changing the selection', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    const before = JSON.stringify(state.exportConfig.payrollLoanSelection);
    expect(PayrollUI.setPayrollLoansSalaryBulk('invalid')).toBe(false);
    state.exportConfig.payrollPreviewInclusion = { loans: false };
    expect(PayrollUI.setPayrollLoansSalaryBulk('available')).toBe(false);
    PayrollUI.setPayrollGuideStep('loans');
    const host = document.createElement('div');
    host.innerHTML = PayrollUI.PayrollTab();
    expect([...host.querySelectorAll('[data-payroll-action="set-payroll-loans-salary-bulk"]')].every(button => button.disabled)).toBe(true);
    state.exportConfig.payrollPreviewInclusion = { loans: true };
    state.attendance['e-2026-03-05'].hoursWorked = 4;
    expect(PayrollUI.setPayrollLoansSalaryBulk('available')).toBe(false);
    expect(JSON.stringify(state.exportConfig.payrollLoanSelection)).toBe(before);
});

test('bulk selection clears earlier charges for people without salary and does not charge a registered period', async () => {
    const base = state.employees[0];
    state.employees.push({ ...base, id: 'absent', number: '2', loans: [{ ...base.loans[0], id: 'absent-loan' }] });
    await PayrollUI.refreshScopedPayrollPreview();
    PayrollUI.setPayrollLoanCustomAmount('absent', '100');
    expect(PayrollUI.setPayrollLoansSalaryBulk('available')).toBe(true);
    expect(state.exportConfig.payrollLoanSelection.map(item => item.employeeId)).toEqual(['e']);
    state.exportConfig.payrollRegistration = { periodStart: '2026-03-01', periodEnd: '2026-03-15' };
    expect(PayrollUI.setPayrollLoansSalaryBulk('recommended')).toBe(false);
    expect(loan().total).toBe(800);
});

test.each([['available', 800], ['recommended', 240]])('bulk %s also uses the legacy payroll calculation', (kind, expected) => {
    setProjectsEnabled(false);
    resetEntityScope();
    PayrollUI.init({ state, services: { payroll: new payrollCalculation.PayrollService(state), payrollRuntime: runtime }, render: () => {} });
    expect(PayrollUI.setPayrollLoansSalaryBulk(kind)).toBe(true);
    expect(loan().total).toBe(expected);
});

test('salary percentage includes bonuses and subtracts other deductions', async () => {
    state.exportConfig.bonuses = [{ id: 'b', name: 'Bono', type: 'fixed', value: 200, scope: 'global' }];
    state.exportConfig.deductions = [{ id: 'd', name: 'Descuento', type: 'fixed', value: 100, scope: 'global' }];
    await PayrollUI.refreshScopedPayrollPreview();
    expect(PayrollUI.setPayrollLoanSalaryAmount('e', 'percentage', 30)).toBe(true);
    expect(loan().total).toBe(270);
    expect((await exported())[0].monto).toBe(630);
});

test('salary shortcut cannot use a stale preview or an invalid percentage', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    expect(PayrollUI.setPayrollLoanSalaryAmount('e', 'percentage', 150)).toBe(false);
    expect(loan().total).toBe(100);
    state.attendance['e-2026-03-05'].hoursWorked = 4;
    expect(PayrollUI.setPayrollLoanSalaryAmount('e', 'available')).toBe(false);
    expect(loan().total).toBe(100);
});

test('slider previews the money immediately without capturing payroll and applies automatically on release', () => {
    PayrollUI.setPayrollGuideStep('loans');
    document.body.innerHTML = PayrollUI.PayrollTab();
    const captures = jest.spyOn(runtime, 'captureContext');
    try {
        const slider = document.querySelector('[data-payroll-loan-percentage="range"]');
        slider.value = '50';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.querySelector('[data-payroll-loan-percentage="number"]').value).toBe('50');
        expect(document.querySelector('[data-payroll-loan-custom-amount]').value).toBe('400.00');
        expect(state.exportConfig.payrollLoanSelection || []).toHaveLength(0);
        expect(captures).not.toHaveBeenCalled();
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        expect(loan().total).toBe(400);
    } finally { captures.mockRestore(); document.body.innerHTML = ''; }
});

test('empty percentage blocks export without replacing the previous amount until it is corrected', async () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '100');
    PayrollUI.setPayrollGuideStep('loans');
    document.body.innerHTML = PayrollUI.PayrollTab();
    const input = document.querySelector('[data-payroll-loan-percentage="number"]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('[data-payroll-loan-percentage-error]').hidden).toBe(false);
    PayrollUI.copyExportJSON();
    await Promise.resolve();
    expect(clipboard).toHaveLength(0);
    expect(loan().total).toBe(100);
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(loan().total).toBe(320);
    expect((await exported())[0].monto).toBe(480);
    document.body.innerHTML = '';
});

test.each([['all', 5000, 625], ['interest', 500, 62.5], ['custom', 200, 25]])(
    'the %s choice keeps the amount and equivalent percentage together', (mode, amount, percentage) => {
        if (mode === 'interest') state.employees[0].loans[0].interestRate = 10;
        PayrollUI.setPayrollLoanModeFor('e', mode, amount);
        PayrollUI.setPayrollGuideStep('loans');
        document.body.innerHTML = PayrollUI.PayrollTab();
        expect(Number(document.querySelector('[data-payroll-loan-custom-amount]').value)).toBe(amount);
        expect(Number(document.querySelector('[data-payroll-loan-percentage="number"]').value)).toBe(percentage);
        expect(Number(document.querySelector('[data-payroll-loan-percentage="range"]').value)).toBe(Math.min(100, percentage));
        if (percentage > 100) expect(document.body.textContent).toContain('No tiene saldo suficiente');
        document.body.innerHTML = '';
    }
);

test('typing a money amount moves the slider immediately, and zero percent removes the deduction', async () => {
    PayrollUI.setPayrollGuideStep('loans');
    document.body.innerHTML = PayrollUI.PayrollTab();
    const input = document.querySelector('[data-payroll-loan-custom-amount]');
    input.value = '200,50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(Number(document.querySelector('[data-payroll-loan-percentage="number"]').value)).toBe(25.0625);
    const slider = document.querySelector('[data-payroll-loan-percentage="range"]');
    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('0.00');
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.exportConfig.payrollLoanSelection).toEqual([]);
    expect((await exported())[0].monto).toBe(800);
    document.body.innerHTML = '';
});

test('capped percentages and fractional percentages do not drift when the slider commits', () => {
    PayrollUI.setPayrollGuideStep('loans');
    document.body.innerHTML = PayrollUI.PayrollTab();
    const slider = document.querySelector('[data-payroll-loan-percentage="range"]');
    slider.value = '33.3333';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(loan().total).toBe(266.66);
    document.body.innerHTML = '';
});

test('a manual amount above selected debt stores the actual deduction, keeping every control consistent', () => {
    PayrollUI.setPayrollLoanCustomAmount('e', '9000');
    expect(state.exportConfig.payrollLoanSelection[0].amount).toBe(5000);
    expect(loan().total).toBe(5000);
});

test('opening the employee picker reuses one snapshot and cached active salaries', async () => {
    PayrollUI.setPayrollGuideStep('deductions');
    document.body.innerHTML = PayrollUI.PayrollTab();
    const captures = jest.spyOn(runtime, 'captureContext');
    const factory = jest.spyOn(payrollContext, 'createPayrollProjectContext');
    const calculation = jest.spyOn(payrollCalculation, 'calculateEmployeePayrollWithContext');
    let content;
    const open = jest.spyOn(Modal.prototype, 'open').mockImplementation(function () {
        content = this.content;
        this.buttons[0].onClick.call(this);
        return this;
    });
    try {
        await PayrollUI.openAdjustmentEmployeePicker(document.querySelector('.payroll-adjustment-form button'));
        expect(captures).toHaveBeenCalledTimes(1);
        expect(factory).not.toHaveBeenCalled();
        expect(calculation).not.toHaveBeenCalled();
        expect(content).toContain('$800.00');
        expect(content).toContain('Ana de prueba');
    } finally { open.mockRestore(); captures.mockRestore(); factory.mockRestore(); calculation.mockRestore(); document.body.innerHTML = ''; }
});

test('picker recalculates changed attendance, includes inactive people and excludes another project', async () => {
    state.attendance['e-2026-03-05'].hoursWorked = 16;
    state.employees.push({ id: 'inactive', name: 'Inactivo de prueba', number: '2', projectId: P, active: false, positions: ['p'] });
    state.employees.push({ id: 'foreign', name: 'Otra obra', number: '3', projectId: 'OTHER', active: true, positions: [] });
    // A stale view hides the form, so retain a form representing the picker trigger already clicked.
    const form = document.createElement('form');
    form.className = 'payroll-adjustment-form';
    const target = document.createElement('button');
    form.appendChild(target);
    let content;
    const open = jest.spyOn(Modal.prototype, 'open').mockImplementation(function () {
        content = this.content;
        this.buttons[0].onClick.call(this);
        return this;
    });
    try {
        await PayrollUI.openAdjustmentEmployeePicker(target);
        expect(content).toContain('$1,600.00');
        expect(content).toContain('Inactivo de prueba');
        expect(content).not.toContain('Otra obra');
    } finally { open.mockRestore(); }
});

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
