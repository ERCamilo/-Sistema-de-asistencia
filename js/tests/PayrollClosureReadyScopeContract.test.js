import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import defaultClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import defaultClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import { ProjectPayrollUIRuntime } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import { Modal } from '../modules/components/Modal.js';

const PROJECT_A = 'PRJ-A-READY';
const DEFAULT_PROJECT = 'PRJ-DEFAULT-READY';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeState() {
    return {
        employees: [], positions: [], attendance: {},
        settings: { regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2,
            holidays: [], payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' }, schemaVersion: 20 },
        exportConfig: { periodStart: '2026-09-01', periodEnd: '2026-09-15', deductions: [], bonuses: [], payrollLoanSelection: [] },
        payrollViewMode: 'history'
    };
}function setupRuntime(getConfig) {
    const state = makeState();
    const configStore = { getConfig: jest.fn(getConfig), putConfig: jest.fn(async c => c) };
    const events = { subscribe: () => () => {} };
    const runtime = new ProjectPayrollUIRuntime({ state, configStore, projectContext: events });
    PayrollUI.init({
        state,
        services: {
            payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 0, neto: 0, breakdown: [] }) },
            payrollRuntime: runtime
        },
        render: jest.fn(),
        saveToLocalStorage: jest.fn()
    });
    return { state, runtime, configStore };
}

function ownedClosure() {
    return {
        id: 'CLOSURE-A-READY-1', projectId: PROJECT_A, status: 'closed',
        periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 1, closedBy: 'tester',
        totals: { gross: 0, net: 0, bonuses: 0, deductions: 0, loans: 0 },
        employeeCount: 0, rows: []
    };
}

describe('Payroll closure requires ready scoped runtime before economic mutation', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });        globalThis.currentUser = { uid: 'ready-scope-test' };
        window.showNotification = jest.fn();
        jest.spyOn(Modal, 'alert').mockResolvedValue(true);
        jest.spyOn(defaultClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        setProjectsEnabled(false);
        resetEntityScope();
        localStorage.clear();
        delete globalThis.currentUser;
        delete window.showNotification;
    });

    test('idle/loading runtime waits for ensureCurrentConfig before reading or mutating a closure', async () => {
        const gate = deferred();
        const { runtime, configStore } = setupRuntime(() => gate.promise);
        const getById = jest.spyOn(defaultClosureStore, 'getById').mockResolvedValue(null);

        const pending = PayrollUI.undoPayrollClosure('CLOSURE-A-READY-1');
        const observed = pending.then(
            value => ({ ok: true, value }),
            error => ({ ok: false, error })
        );
        await Promise.resolve();
        await Promise.resolve();

        expect(configStore.getConfig).toHaveBeenCalledWith(PROJECT_A);
        expect(runtime.getCurrentView().status).toBe('loading');
        expect(getById).not.toHaveBeenCalled();

        gate.resolve(createDefaultConfig(PROJECT_A));
        const result = await observed;
        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('No se encontró el cierre de Nómina');
        runtime.dispose();
    });
    test('unavailable runtime rejects undo before closure store access', async () => {
        const failure = new Error('config unavailable');
        const { runtime } = setupRuntime(async () => { throw failure; });
        const getById = jest.spyOn(defaultClosureStore, 'getById').mockResolvedValue(ownedClosure());

        await expect(PayrollUI.undoPayrollClosure('CLOSURE-A-READY-1')).rejects.toMatchObject({
            code: 'PAYROLL_CONFIG_UNAVAILABLE'
        });
        expect(getById).not.toHaveBeenCalled();
        expect(runtime.getCurrentView().status).toBe('unavailable');
        runtime.dispose();
    });

    test('unavailable runtime keeps owned history detail read-only and hides undo', async () => {
        const { runtime } = setupRuntime(async () => { throw new Error('config unavailable'); });
        await expect(runtime.ensureCurrentConfig()).rejects.toMatchObject({ code: 'PAYROLL_CONFIG_UNAVAILABLE' });

        jest.spyOn(defaultClosureStore, 'getById').mockResolvedValue(ownedClosure());
        jest.spyOn(defaultClosureStore, 'getSyncStates').mockResolvedValue({ 'CLOSURE-A-READY-1': 'synced' });

        await PayrollUI.openPayrollHistoryDetail('CLOSURE-A-READY-1');
        const html = PayrollUI.PayrollTab();
        expect(html).toContain('Consulta de solo lectura para la obra activa');
        expect(html).not.toContain('data-payroll-action="undo-payroll-closure"');
        runtime.dispose();
    });
});