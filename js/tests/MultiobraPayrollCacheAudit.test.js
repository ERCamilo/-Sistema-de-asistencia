
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    setActivePayrollConfig, getActivePayrollSettings, getActiveDayHours,
    updateActiveDayHours, resetActivePayrollSettingsForTests
} from '../modules/features/payroll/ActivePayrollSettings.js';
import { stopProjectCatalogLiveSync } from '../modules/features/projects/ProjectCatalogSync.js';

const A = { projectId: 'A', regularHoursPerDay: 9, payPeriod: { periodStart: '2026-09-01', periodLength: 21 }, dayHours: { '2026-09-30': 9 } };
const B = { projectId: 'B', regularHoursPerDay: 6, payPeriod: { periodStart: '2026-09-15', periodLength: 7 }, dayHours: { '2026-09-30': 6 } };
const legacy = { settings: { regularHoursPerDay: 8, payPeriod: { periodLength: 15 } }, dayHoursConfig: { '2026-09-30': 8 } };
const activate = id => replaceEntityScope({ enabled: true, projectId: id, defaultProjectId: 'A' });
const announce = config => window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: { config, source: 'catalog-sync' } }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
    localStorage.clear();
    setProjectsEnabled(true);
    resetActivePayrollSettingsForTests();
    activate('A');
    setActivePayrollConfig(A, { render: false });
});
afterEach(() => {
    stopProjectCatalogLiveSync();
    resetActivePayrollSettingsForTests();
    resetEntityScope();
    localStorage.clear();
});

test('CONTROL: an update for the active obra refreshes hours and period', () => {
    announce({ ...A, regularHoursPerDay: 10 });
    expect(getActivePayrollSettings(legacy)).toMatchObject({ regularHoursPerDay: 10, payPeriod: A.payPeriod });
});

test('R4: an inactive obra cloud event must preserve the current obra configuration', () => {
    expect(getActivePayrollSettings(legacy).regularHoursPerDay).toBe(9);
    announce(B);
    expect(getActivePayrollSettings(legacy)).toMatchObject({ regularHoursPerDay: 9, payPeriod: A.payPeriod });
    expect(getActiveDayHours(legacy)).toEqual(A.dayHours);
});

test('R4: completing an old obra save must not displace the newly active obra cache', async () => {
    const reached = deferred(), release = deferred();
    const store = { getConfig: async () => A, putConfig: async config => { reached.resolve(); await release.promise; return config; } };
    const pending = updateActiveDayHours({ '2026-09-30': 10 }, { store });
    try {
        await reached.promise;
        activate('B');
        setActivePayrollConfig(B, { render: false });
        expect(getActivePayrollSettings(legacy).regularHoursPerDay).toBe(6);
    } finally { release.resolve(); }
    expect(await pending).toBe(true);
    expect(getActivePayrollSettings(legacy)).toMatchObject({ regularHoursPerDay: 6, payPeriod: B.payPeriod });
    expect(getActiveDayHours(legacy)).toEqual(B.dayHours);
});

test('CONTROL: a same-obra save retains its updated hours', async () => {
    const putConfig = jest.fn(async c => c);
    expect(await updateActiveDayHours({ '2026-09-30': 10 }, { store: { getConfig: async () => A, putConfig } })).toBe(true);
    expect(putConfig).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'A', dayHours: { '2026-09-30': 10 } }));
    expect(getActiveDayHours(legacy)).toEqual({ '2026-09-30': 10 });
});
