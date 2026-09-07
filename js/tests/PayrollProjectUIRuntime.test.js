import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import {
    clearPayrollAdjustmentPeriodRuntime,
    getPayrollAdjustmentPeriodRuntimeSelections,
    setPayrollAdjustmentPeriodRuntimeSelection
} from 'actual/features/payroll/PayrollAdjustmentPeriodSelection.js';
import {
    createProjectPayrollSettingsView,
    ProjectPayrollUIRuntime,
    PayrollConfigUnavailableError
} from 'actual/features/payroll/ProjectPayrollUIRuntime.js';

const PRJ_A = 'PRJ-A-A4';
const PRJ_B = 'PRJ-B-A4';
const PRJ_DEFAULT = 'PRJ-DEFAULT-A4';

function makeState() {
    return {
        employees: [],
        positions: [],
        leaders: [],
        attendance: {},
        settings: {
            regularHoursPerDay: 13,
            overtimeFactor: 4,
            holidayFactor: 5,
            holidays: ['2026-12-25'],
            payPeriod: { periodStart: '2026-12-01', periodLength: 31, payDay: null },
            defaultDeductionPercentage: 17,
            restDayFactor: 1.75,
            companyName: 'Legacy company'
        },
        exportConfig: {}
    };
}

function makeConfig(projectId, overrides = {}) {
    return {
        ...createDefaultConfig(projectId),
        ...overrides,
        projectId
    };
}

function makeProjectEvents() {
    const listeners = new Set();
    return {
        subscribe: jest.fn(listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
        emit(previousProjectId, projectId) {
            for (const listener of [...listeners]) listener({ previousProjectId, projectId });
        }
    };
}

describe('A4 ProjectPayrollUIRuntime', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        clearPayrollAdjustmentPeriodRuntime();
        setProjectsEnabled(false);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        clearPayrollAdjustmentPeriodRuntime();
        setProjectsEnabled(false);
    });

    test('OFF never touches ProjectPayrollConfigStore and preserves the legacy settings reference', async () => {
        const state = makeState();
        const configStore = { getConfig: jest.fn(), putConfig: jest.fn() };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore });

        const loaded = await runtime.loadConfig();
        const saved = await runtime.saveConfig({ regularHoursPerDay: 4 });

        expect(loaded.config).toBe(state.settings);
        expect(saved.config).toBe(state.settings);
        expect(configStore.getConfig).not.toHaveBeenCalled();
        expect(configStore.putConfig).not.toHaveBeenCalled();
        runtime.dispose();
    });

    test('ON load captures A before await, reads only A, and exposes a stale-request guard after A to B', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const state = makeState();
        const events = makeProjectEvents();
        const configA = makeConfig(PRJ_A, { regularHoursPerDay: 7 });
        let resolveA;
        const configStore = {
            getConfig: jest.fn(() => new Promise(resolve => { resolveA = resolve; })),
            putConfig: jest.fn()
        };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore, projectContext: events });

        const pendingA = runtime.loadConfig();
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        events.emit(PRJ_A, PRJ_B);
        resolveA(configA);
        const loadedA = await pendingA;

        expect(configStore.getConfig).toHaveBeenCalledTimes(1);
        expect(configStore.getConfig).toHaveBeenCalledWith(PRJ_A);
        expect(loadedA.projectId).toBe(PRJ_A);
        expect(loadedA.config).toEqual(configA);
        expect(runtime.isCurrent(loadedA.request)).toBe(false);
        expect(runtime.commitIfCurrent(loadedA.request, jest.fn())).toBe(false);
        runtime.dispose();
    });

    test('ON save normalizes and validates for captured projectId, writes only scoped store, and never dual-writes settings', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const state = makeState();
        const settingsBefore = JSON.stringify(state.settings);
        const configStore = {
            getConfig: jest.fn(),
            putConfig: jest.fn(async config => config)
        };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore });

        const saved = await runtime.saveConfig({
            ...makeConfig(PRJ_B),
            regularHoursPerDay: '6',
            overtimeFactor: '2.5',
            holidays: ['2026-05-01', 'bad', '2026-05-01'],
            payPeriod: { periodStart: '2026-05-01', periodLength: '15', payDay: '2026-05-16' },
            updatedAt: 'invalid',
            companyName: 'Must stay global',
            restDayFactor: 4.5
        });

        const payload = configStore.putConfig.mock.calls[0][0];
        expect(payload.projectId).toBe(PRJ_A);
        expect(payload.regularHoursPerDay).toBe(6);
        expect(payload.overtimeFactor).toBe(2.5);
        expect(payload.holidays).toEqual(['2026-05-01']);
        expect(payload.payPeriod.periodLength).toBe(15);
        expect(payload.schemaVersion).toBe(1);
        expect(Number.isFinite(payload.updatedAt)).toBe(true);
        expect(payload.companyName).toBeUndefined();
        expect(payload.restDayFactor).toBeUndefined();
        expect(saved.config).toBe(payload);
        expect(configStore.getConfig).not.toHaveBeenCalled();
        expect(JSON.stringify(state.settings)).toBe(settingsBefore);
        runtime.dispose();
    });

    test('settings adapter overlays only project-owned fields and keeps company/visual/rest-day settings global', () => {
        const legacy = makeState().settings;
        const config = makeConfig(PRJ_A, { regularHoursPerDay: 6, holidayFactor: 3 });
        const view = createProjectPayrollSettingsView(legacy, config);

        expect(view.regularHoursPerDay).toBe(6);
        expect(view.holidayFactor).toBe(3);
        expect(view.companyName).toBe(legacy.companyName);
        expect(view.restDayFactor).toBe(legacy.restDayFactor);
        expect(view.payPeriod).not.toBe(config.payPeriod);
    });

    test('missing config fails closed and neutral initialization does not copy global settings', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        const state = makeState();
        const configStore = {
            getConfig: jest.fn(async () => null),
            putConfig: jest.fn(async config => config)
        };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore });

        await expect(runtime.loadConfig()).rejects.toBeInstanceOf(PayrollConfigUnavailableError);
        await expect(runtime.loadConfig()).rejects.toThrow(/Payroll config unavailable.*PRJ-B-A4/i);

        const initialized = await runtime.initializeConfig();
        expect(initialized.config.projectId).toBe(PRJ_B);
        expect(initialized.config.regularHoursPerDay).toBe(8);
        expect(initialized.config.overtimeFactor).toBe(1);
        expect(initialized.config.holidays).toEqual([]);
        expect(initialized.config.regularHoursPerDay).not.toBe(state.settings.regularHoursPerDay);
        expect(configStore.putConfig).toHaveBeenCalledTimes(1);
        runtime.dispose();
    });

    test('A to B invalidates A4 transients synchronously; B to A reloads durable A into a fresh generation', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const state = makeState();
        const events = makeProjectEvents();
        const configA = makeConfig(PRJ_A, { holidayFactor: 2.5 });
        const configB = makeConfig(PRJ_B, { holidayFactor: 3.5 });
        const configStore = {
            getConfig: jest.fn(async projectId => projectId === PRJ_A ? configA : configB),
            putConfig: jest.fn()
        };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore, projectContext: events });
        const firstA = await runtime.loadConfig();
        Object.assign(firstA.session, {
            selectedPeriod: { start: '2026-01-01', end: '2026-01-15' },
            preset: 'payPeriod',
            source: 'configured',
            previewRows: [{ employeeId: 'E-A' }],
            previewKey: 'A-preview',
            temporaryInclusion: { loans: false },
            temporarySelection: ['E-A'],
            adjustmentSelections: { planA: 'count:1' }
        });
        Object.assign(state.exportConfig, {
            periodStart: '2026-01-01',
            periodEnd: '2026-01-15',
            activePreset: 'payPeriod',
            periodSource: 'configured',
            payrollPreviewInclusion: { loans: false },
            payrollLoanSelection: [{ employeeId: 'E-A' }],
            payrollAdjustmentPeriodSelections: { planA: 'count:1' },
            payrollAdjustmentComposerScopes: { formA: 'employee' },
            leaderFilter: 'all'
        });
        const adjustmentReference = {
            kind: 'deductions', planId: 'plan-A', employeeId: 'E-A',
            periodStart: '2026-01-01', periodEnd: '2026-01-15'
        };
        setPayrollAdjustmentPeriodRuntimeSelection(adjustmentReference, { mode: 'count', count: 1 });

        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        events.emit(PRJ_A, PRJ_B);

        for (const key of [
            'periodStart', 'periodEnd', 'activePreset', 'periodSource',
            'payrollPreviewInclusion', 'payrollLoanSelection',
            'payrollAdjustmentPeriodSelections', 'payrollAdjustmentComposerScopes'
        ]) expect(state.exportConfig[key]).toBeUndefined();
        expect(state.exportConfig.leaderFilter).toBe('all');
        expect(getPayrollAdjustmentPeriodRuntimeSelections('2026-01-01', '2026-01-15')).toEqual([]);
        const loadedB = await runtime.loadConfig();
        expect(loadedB.config).toEqual(configB);
        expect(loadedB.session.previewRows).toEqual([]);

        loadedB.session.temporarySelection = ['E-B'];
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        events.emit(PRJ_B, PRJ_A);
        const secondA = await runtime.loadConfig();

        expect(secondA.config).toEqual(configA);
        expect(secondA.session).not.toBe(firstA.session);
        expect(secondA.session.temporarySelection).toEqual([]);
        expect(secondA.session.previewRows).toEqual([]);
        expect(secondA.session.key).not.toBe(firstA.session.key);
        expect(configStore.getConfig.mock.calls.map(([id]) => id)).toEqual([PRJ_A, PRJ_B, PRJ_A]);
        runtime.dispose();
    });
});
