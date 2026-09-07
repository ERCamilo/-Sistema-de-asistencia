import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import { SettingsTabCalendar } from 'actual/ui/settings/SettingsCalendarTab.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';

const A = 'PRJ-A-A4-UI';
const B = 'PRJ-B-A4-UI';
const DEFAULT = 'PRJ-DEFAULT-A4-UI';

function config(projectId, periodStart, overrides = {}) {
    return {
        ...createDefaultConfig(projectId),
        payPeriod: { periodStart, periodLength: 1, payDay: periodStart },
        overtimeFactor: projectId === A ? 1.5 : 3,
        ...overrides
    };
}

function state() {
    return {
        employees: [
            { id: 'E-A', number: '12', name: 'Ana', projectId: A, active: true, positions: ['P-A'], bonuses: [], deductions: [] },
            { id: 'E-B', number: '12', name: 'Beto', projectId: B, active: true, positions: ['P-B'], bonuses: [], deductions: [] }
        ],
        positions: [
            { id: 'P-A', name: 'A role', projectId: A, hourlyRate: 100, workingDays: [1,2,3,4,5,6,0] },
            { id: 'P-B', name: 'B role', projectId: B, hourlyRate: 100, workingDays: [1,2,3,4,5,6,0] }
        ],
        leaders: [],
        attendance: {
            'E-A-2026-01-01': { employeeId: 'E-A', date: '2026-01-01', present: true, hoursWorked: 8, overtimeHours: 2, projectId: A },
            'E-B-2026-02-01': { employeeId: 'E-B', date: '2026-02-01', present: true, hoursWorked: 8, overtimeHours: 2, projectId: B }
        },
        settings: {
            companyName: 'Global company',
            regularHoursPerDay: 13,
            overtimeFactor: 5,
            holidayFactor: 5,
            restDayFactor: 1.75,
            holidays: ['2026-12-25'],
            payPeriod: { periodStart: '2026-12-01', periodLength: 20, payDay: null },
            defaultDeductionPercentage: 20
        },
        exportConfig: { leaderFilter: 'all', deductions: [], bonuses: [] },
        payrollViewMode: 'generator',
        settingsCalendarMonth: new Date('2026-01-01T12:00:00'),
        settingsCalendarMode: 'holiday'
    };
}

function events() {
    const listeners = new Set();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit(previousProjectId, projectId) {
            for (const listener of [...listeners]) listener({ previousProjectId, projectId });
        }
    };
}

function store(configs) {
    return {
        getConfig: jest.fn(async projectId => configs.get(projectId) || null),
        putConfig: jest.fn(async next => {
            configs.set(next.projectId, next);
            return next;
        })
    };
}

function initPayroll(currentState, runtime) {
    const render = jest.fn();
    PayrollUI.init({
        state: currentState,
        services: {
            payroll: { calculateEmployeePayroll: jest.fn() },
            payrollRuntime: runtime
        },
        render
    });
    return render;
}

describe('A4 productive project payroll UI wiring', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        window.PayrollUI = PayrollUI;
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('A to B to A rebuilds project config, configured period and isolated #12 preview', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const currentState = state();
        const projectEvents = events();
        const configA = config(A, '2026-01-01');
        const configB = config(B, '2026-02-01');
        const configStore = store(new Map([[A, configA], [B, configB]]));
        const runtime = new ProjectPayrollUIRuntime({ state: currentState, configStore, projectContext: projectEvents });
        initPayroll(currentState, runtime);

        const firstA = await PayrollUI.refreshScopedPayrollPreview({ today: new Date('2026-03-01T12:00:00') });
        expect(firstA.period).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-01-01', source: 'configured' });
        expect(firstA.rows.map(row => row._employeeId)).toEqual(['E-A']);
        expect(firstA.rows[0]._number).toBe('12');
        expect(firstA.rows[0].monto).toBe(1100);

        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        projectEvents.emit(A, B);
        const resultB = await PayrollUI.refreshScopedPayrollPreview();
        expect(resultB.period.periodStart).toBe('2026-02-01');
        expect(resultB.rows.map(row => row._employeeId)).toEqual(['E-B']);
        expect(resultB.rows[0]._number).toBe('12');
        expect(resultB.rows[0].monto).toBe(1400);

        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        projectEvents.emit(B, A);
        const secondA = await PayrollUI.refreshScopedPayrollPreview();
        expect(secondA.config).toEqual(configA);
        expect(secondA.period.periodStart).toBe('2026-01-01');
        expect(secondA.rows.map(row => row._employeeId)).toEqual(['E-A']);
        expect(secondA.sessionKey).not.toBe(firstA.sessionKey);
        expect(configStore.getConfig.mock.calls.map(([id]) => id)).toEqual([A, B, A]);
        runtime.dispose();
    });

    test('stale A preview returns A but cannot replace current B; a new preview uses B', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const currentState = state();
        const projectEvents = events();
        const configA = config(A, '2026-01-01');
        const configB = config(B, '2026-02-01');
        let resolveA;
        const configStore = {
            getConfig: jest.fn(projectId => projectId === A
                ? new Promise(resolve => { resolveA = () => resolve(configA); })
                : Promise.resolve(configB)),
            putConfig: jest.fn()
        };
        const runtime = new ProjectPayrollUIRuntime({ state: currentState, configStore, projectContext: projectEvents });
        initPayroll(currentState, runtime);

        const pendingA = PayrollUI.refreshScopedPayrollPreview();
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        projectEvents.emit(A, B);
        resolveA();
        const staleA = await pendingA;
        expect(staleA.current).toBe(false);
        expect(staleA.rows.map(row => row._employeeId)).toEqual(['E-A']);

        const currentB = await PayrollUI.refreshScopedPayrollPreview();
        expect(currentB.current).toBe(true);
        expect(currentB.rows.map(row => row._employeeId)).toEqual(['E-B']);
        expect(runtime.getCurrentView().previewRows.map(row => row._employeeId)).toEqual(['E-B']);
        runtime.dispose();
    });

    test('ON renderer is base preview only and exposes none of the forbidden economic surfaces', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const currentState = state();
        const runtime = new ProjectPayrollUIRuntime({
            state: currentState,
            configStore: store(new Map([[A, config(A, '2026-01-01')]])),
            projectContext: events()
        });
        initPayroll(currentState, runtime);
        await PayrollUI.refreshScopedPayrollPreview();
        const html = PayrollUI.PayrollTab();

        expect(html).toContain('PRJ-A-A4-UI');
        expect(html).toContain('2026-01-01');
        expect(html).toContain('Ana');
        for (const forbidden of [
            'change-payroll-view-mode', 'add-export-deduction', 'add-export-bonus',
            'add-payroll-loans', 'toggle-payroll-paid', 'open-payroll-closure',
            'copy-export-json', 'download-export-json', 'export-payroll-pdf',
            'send-to-splitx', 'payroll-adjustment', 'Préstamos / Adelantos', 'Historial'
        ]) expect(html).not.toContain(forbidden);
        runtime.dispose();
    });

    test('missing config fails closed in controller and renders explicit unavailable status', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const currentState = state();
        const runtime = new ProjectPayrollUIRuntime({
            state: currentState,
            configStore: store(new Map()),
            projectContext: events()
        });
        initPayroll(currentState, runtime);

        await expect(PayrollUI.refreshScopedPayrollPreview()).rejects.toThrow(/Payroll config unavailable.*PRJ-B-A4-UI/i);
        expect(PayrollUI.PayrollTab()).toMatch(/Payroll config unavailable.*PRJ-B-A4-UI/i);
        runtime.dispose();
    });

    test('project settings render/save use scoped values without dual-writing global settings', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const currentState = state();
        const configStore = store(new Map([[A, config(A, '2026-01-01')]]));
        const runtime = new ProjectPayrollUIRuntime({ state: currentState, configStore, projectContext: events() });
        await runtime.ensureCurrentConfig();
        const view = runtime.getCurrentView();
        const html = SettingsTabCalendar({
            state: currentState,
            icons: { get: () => '' },
            holidayService: { renderSettingsCalendar: settings => `${settings.payPeriod.periodStart}|${settings.holidays.join(',')}` },
            payrollSettings: view.settingsView,
            payrollConfigStatus: view.status,
            payrollProjectId: view.projectId
        });
        expect(html).toContain('value="8"');
        expect(html).toContain('value="1.5"');
        expect(html).toContain('2026-01-01');
        expect(html).toContain('value="1.75"');

        const settingsBefore = JSON.stringify(currentState.settings);
        await runtime.updateConfig(current => ({ ...current, regularHoursPerDay: 6 }));
        expect(configStore.putConfig.mock.calls[0][0].regularHoursPerDay).toBe(6);
        expect(JSON.stringify(currentState.settings)).toBe(settingsBefore);
        runtime.dispose();
    });

    test('OFF with composed runtime returns byte-identical legacy markup and synchronous behavior', () => {
        const currentState = state();
        const payroll = { calculateEmployeePayroll: jest.fn(() => ({ brutoOriginal: 0, bruto: 0, bonuses: 0, deductions: 0, neto: 0, breakdown: [] })) };
        PayrollUI.init({ state: currentState, services: { payroll }, render: jest.fn() });
        const legacy = PayrollUI.PayrollTab();
        const configStore = { getConfig: jest.fn(), putConfig: jest.fn() };
        const runtime = new ProjectPayrollUIRuntime({ state: currentState, configStore });
        PayrollUI.init({ state: currentState, services: { payroll, payrollRuntime: runtime }, render: jest.fn() });

        expect(PayrollUI.PayrollTab()).toBe(legacy);
        expect(configStore.getConfig).not.toHaveBeenCalled();
        expect(configStore.putConfig).not.toHaveBeenCalled();
        runtime.dispose();
    });
});
