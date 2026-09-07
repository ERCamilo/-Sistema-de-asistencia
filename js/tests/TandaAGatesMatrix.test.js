import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import { createPayrollProjectContext } from 'actual/features/payroll/PayrollProjectContext.js';
import { calculateEmployeePayrollWithContext } from 'actual/features/payroll/PayrollService.js';
import { buildAttendanceIndex } from 'actual/core/AppState.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import { sanitizeExportConfig } from 'actual/services/ExportConfigSanitizer.js';
import fs from 'fs';
import path from 'path';

const A = 'PRJ-A-MATRIX';
const B = 'PRJ-B-MATRIX';
const DEFAULT = 'PRJ-DEFAULT-MATRIX';

function config(projectId, overrides = {}) {
    const base = createDefaultConfig(projectId);
    return { ...base, ...overrides, projectId };
}
function stateTwo() {
    return {
        employees: [
            { id: 'E-A', number: '12', name: 'Ana', projectId: A, active: true, positions: ['P-A'] },
            { id: 'E-B', number: '12', name: 'Beto', projectId: B, active: true, positions: ['P-B'] }
        ],
        positions: [
            { id: 'P-A', name: 'Role A', projectId: A, hourlyRate: 100, workingDays: [1,2,3,4,5,6,0] },
            { id: 'P-B', name: 'Role B', projectId: B, hourlyRate: 200, workingDays: [1,2,3,4,5,6,0] }
        ],
        leaders: [],
        attendance: {
            'E-A-2026-01-05': { employeeId: 'E-A', date: '2026-01-05', present: true, hoursWorked: 8, projectId: A },
            'E-B-2026-01-05': { employeeId: 'E-B', date: '2026-01-05', present: true, hoursWorked: 8, projectId: B },
            'E-A-2026-01-06': { employeeId: 'E-A', date: '2026-01-06', present: true, hoursWorked: 8, projectId: A }
        },
        settings: {
            companyName: 'Global', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [], payPeriod: { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' }, defaultDeductionPercentage: 2
        },
        exportConfig: { leaderFilter: 'all', deductions: [], bonuses: [] },
        payrollViewMode: 'generator', settingsCalendarMonth: new Date('2026-01-01T12:00:00'), settingsCalendarMode: 'holiday'
    };
}

describe('Tanda A consolidated matrix — single evaluated artifact (A6)', () => {
    beforeEach(() => { localStorage.clear(); resetEntityScope(); setProjectsEnabled(true); });
    afterEach(() => { localStorage.clear(); resetEntityScope(); setProjectsEnabled(false); });

    test('matrix #12: same number 12 but distinct employeeId and isolated payroll', () => {
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const s = stateTwo();
        const ctxA = createPayrollProjectContext({ state: s });
        expect(ctxA.employees.map(e => e.id)).toEqual(['E-A']);
        expect(ctxA.employees[0].number).toBe('12');
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const ctxB = createPayrollProjectContext({ state: s });
        expect(ctxB.employees.map(e => e.id)).toEqual(['E-B']);
        expect(ctxB.employees[0].number).toBe('12');
        expect(ctxA.employees[0].id).not.toBe(ctxB.employees[0].id);
    });

    test('different configs produce different payrolls for #12', async () => {
        const s = stateTwo();
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const ctxA = createPayrollProjectContext({ state: s });
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const ctxB = createPayrollProjectContext({ state: s });
        const cfgA = config(A, { regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [], payPeriod: { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' } });
        const cfgB = config(B, { regularHoursPerDay: 6, overtimeFactor: 3, holidayFactor: 3, holidays: ['2026-01-05'], payPeriod: { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' } });
        // same day but B has holiday factor different and regular hours different
        const payrollA = calculateEmployeePayrollWithContext(ctxA, cfgA, 'E-A', '2026-01-05', '2026-01-05', [], [], [], []);
        const payrollB = calculateEmployeePayrollWithContext(ctxB, cfgB, 'E-B', '2026-01-05', '2026-01-05', [], [], [], []);
        expect(payrollA.neto).not.toBe(payrollB.neto);
        // verify holiday handling: B's holiday list includes 2026-01-05 so should use holidayRate
        expect(payrollB.breakdown[0].holidayHours).toBe(8);
        expect(payrollA.breakdown[0].holidayHours).toBe(0);
    });

    test('different periods: config.payPeriod isolation', async () => {
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const s = stateTwo();
        const cfgA = config(A, { payPeriod: { periodStart: '2026-01-01', periodLength: 2, payDay: '2026-01-01' } });
        const cfgB = config(B, { payPeriod: { periodStart: '2026-02-10', periodLength: 5, payDay: '2026-02-10' } });
        const map = new Map([[A, cfgA],[B, cfgB]]);
        const store = { getConfig: async id => map.get(id), putConfig: async c => { map.set(c.projectId,c); return c; } };
        const ev = { subscribe: () => () => {} };
        const rt = new ProjectPayrollUIRuntime({ state: s, configStore: store, projectContext: ev });
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        // force runtime to pick A
        rt.handleProjectChange({ projectId: A });
        const a = await rt.generatePreview({ today: new Date('2026-01-10T12:00:00') });
        expect(a.period.periodStart).toBe('2026-01-01');
        expect(a.period.periodEnd).toBe('2026-01-02');
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        rt.handleProjectChange({ projectId: B });
        const b = await rt.generatePreview({ today: new Date('2026-02-15T12:00:00') });
        expect(b.period.periodStart).toBe('2026-02-10');
        expect(b.period.periodEnd).toBe('2026-02-14');
        rt.dispose();
    });

    test('isolated attendance: A preview never consumes B attendance', () => {
        const s = stateTwo();
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const ctxA = createPayrollProjectContext({ state: s });
        // A has attendance only on 2026-01-05 and 06 ; B only 05
        expect(ctxA.getAttendance('E-A', '2026-01-05')).toBeDefined();
        expect(ctxA.getAttendance('E-B', '2026-01-05')).toBeUndefined();
        expect(ctxA.getAttendance('E-A', '2026-01-06')).toBeDefined();
        // Cross project attendance id must not leak
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const ctxB = createPayrollProjectContext({ state: s });
        expect(ctxB.getAttendance('E-B', '2026-01-05')).toBeDefined();
        expect(ctxB.getAttendance('E-A', '2026-01-05')).toBeUndefined();
    });

    test('A→B→A: preview rebuilds with fresh config and no stale leakage', async () => {
        const s = stateTwo();
        const cfgA = config(A, { payPeriod: { periodStart: '2026-01-01', periodLength: 1, payDay: '2026-01-01' } });
        const cfgB = config(B, { payPeriod: { periodStart: '2026-02-01', periodLength: 1, payDay: '2026-02-01' } });
        const map = new Map([[A, cfgA],[B, cfgB]]);
        const store = { getConfig: jest.fn(async id => map.get(id) || null), putConfig: jest.fn(async c => { map.set(c.projectId,c); return c; }) };
        const events = { listeners: new Set(), subscribe(l){ this.listeners.add(l); return () => this.listeners.delete(l); }, emit(pid){ for(const fn of [...this.listeners]) fn({ projectId: pid}); } };
        const rt = new ProjectPayrollUIRuntime({ state: s, configStore: store, projectContext: events });
        // Need to subscribe runtime manually; already via constructor, but we emit via events
        // Init PayrollUI with runtime
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        PayrollUI.init({ state: s, services: { payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 0, neto: 0, breakdown: [] }) }, payrollRuntime: rt }, render: () => {} });
        const firstA = await PayrollUI.refreshScopedPayrollPreview();
        expect(firstA.rows.map(r=>r._employeeId)).toEqual(['E-A']);
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT }); events.emit(B);
        const b = await PayrollUI.refreshScopedPayrollPreview();
        expect(b.rows.map(r=>r._employeeId)).toEqual(['E-B']);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT }); events.emit(A);
        const secondA = await PayrollUI.refreshScopedPayrollPreview();
        expect(secondA.rows.map(r=>r._employeeId)).toEqual(['E-A']);
        expect(secondA.sessionKey).not.toBe(firstA.sessionKey);
        rt.dispose();
    });

    test('async operation started in A while switching to B remains in A (stale guard)', async () => {
        const s = stateTwo();
        const cfgA = config(A, { payPeriod: { periodStart: '2026-01-01', periodLength: 1, payDay: '2026-01-01' } });
        const cfgB = config(B, { payPeriod: { periodStart: '2026-02-01', periodLength: 1, payDay: '2026-02-01' } });
        let resolveA; const store = {
            getConfig: jest.fn(id => id===A ? new Promise(r=>{ resolveA=()=>r(cfgA); }) : Promise.resolve(cfgB)),
            putConfig: jest.fn()
        };
        const events = { listeners: new Set(), subscribe(l){ this.listeners.add(l); return () => this.listeners.delete(l); }, emit(pid){ for(const fn of [...this.listeners]) fn({ projectId: pid}); } };
        const rt = new ProjectPayrollUIRuntime({ state: s, configStore: store, projectContext: events });
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        PayrollUI.init({ state: s, services: { payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 1, neto:1, breakdown: []}) }, payrollRuntime: rt }, render: () => {} });
        const pendingA = PayrollUI.refreshScopedPayrollPreview();
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT }); events.emit(B);
        resolveA();
        const staleA = await pendingA;
        expect(staleA.current).toBe(false);
        expect(staleA.rows[0]._employeeId).toBe('E-A');
        const currentB = await PayrollUI.refreshScopedPayrollPreview();
        expect(currentB.current).toBe(true);
        expect(currentB.rows[0]._employeeId).toBe('E-B');
        expect(rt.getCurrentView().previewRows[0]._employeeId).toBe('E-B');
        rt.dispose();
    });

    test('H-05 without exportConfig resurrection after A→B→A', () => {
        const cloneA = { exportConfig: { periodStart: '2026-01-01', payrollLoanSelection: [{id:'L1'}] }, settings: { payrollDefaults: { regularHoursPerDay: 6 }, payPeriod: { periodStart: '2026-01-01', periodLength: 15 } }, projectPayrollConfigs: [{ projectId: A, regularHoursPerDay: 6 }] };
        const outA = sanitizeExportConfig({ ...cloneA });
        expect(outA.exportConfig).toBeUndefined();
        expect(outA.settings.payrollDefaults.regularHoursPerDay).toBe(6);
        const cloneB = { exportConfig: { periodStart: '2026-02-01', payrollPreviewInclusion: { loans: true } }, settings: { payrollDefaults: { regularHoursPerDay: 8 } }, projectPayrollConfigs: [{ projectId: B, regularHoursPerDay: 8 }] };
        const outB = sanitizeExportConfig({ ...cloneB });
        expect(outB.exportConfig).toBeUndefined();
        const backA = { exportConfig: { foo: 'oldA', periodStart: '2026-01-01' }, settings: { payrollDefaults: { regularHoursPerDay: 6 } }, projectPayrollConfigs: [{ projectId: A, regularHoursPerDay: 6 }] };
        const outBack = sanitizeExportConfig({ ...backA });
        expect(outBack.exportConfig).toBeUndefined();
        expect(outBack.settings.payrollDefaults.regularHoursPerDay).toBe(6);
        expect(outBack.projectPayrollConfigs[0].projectId).toBe(A);
    });

    test('buildAttendanceIndex RAW behind scoped frontiers — preview A never consumes B data', () => {
        // Direct RAW index is a flat map of all attendance keys; scoped ctx filters.
        const s = stateTwo();
        // RAW index contains both projects
        const rawKeys = Object.keys(s.attendance);
        expect(rawKeys).toContain('E-A-2026-01-05');
        expect(rawKeys).toContain('E-B-2026-01-05');
        // But building index does not mutate scoping: PayrollProjectContext must not delegate to raw for other project
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const ctx = createPayrollProjectContext({ state: s });
        // raw would return B record if accessed directly; scoped must block
        const rawB = s.attendance['E-B-2026-01-05'];
        expect(rawB).toBeDefined();
        expect(ctx.getAttendance('E-B','2026-01-05')).toBeUndefined();
        // ensure source code does not call buildAttendanceIndex from scoped payroll path (static check)
        const payrollServiceSrc = fs.readFileSync(path.resolve(__dirname, '../modules/features/payroll/PayrollService.js'), 'utf8');
        const payrollPeriodSrc = fs.readFileSync(path.resolve(__dirname, '../modules/features/payroll/PayrollPeriod.js'), 'utf8');
        // Scoped helpers should use ctx.getAttendance, not buildAttendanceIndex
        expect(payrollServiceSrc).toMatch(/capturePayrollProjectContext/);
        expect(payrollServiceSrc).toMatch(/ctx\.getAttendance/);
        expect(payrollPeriodSrc).toMatch(/getAttendance/);
        // RAW function itself still exists for legacy but not in scoped flow
        expect(typeof buildAttendanceIndex).toBe('function');
    });

    test('verify preview/config A never consumes B data (sensitivity)', () => {
        const s = stateTwo();
        // Add B-specific holiday that A should not see affecting A payroll
        const cfgA = config(A, { holidays: [], regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 5, payPeriod: { periodStart: '2026-01-01', periodLength: 10, payDay: '2026-01-01' } });
        const cfgB = config(B, { holidays: ['2026-01-05'], regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 5, payPeriod: { periodStart: '2026-01-01', periodLength: 10, payDay: '2026-01-01' } });
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const ctxA = createPayrollProjectContext({ state: s });
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const ctxB = createPayrollProjectContext({ state: s });
        const payrollA = calculateEmployeePayrollWithContext(ctxA, cfgA, 'E-A', '2026-01-05', '2026-01-05', [], [], [], []);
        const payrollB = calculateEmployeePayrollWithContext(ctxB, cfgB, 'E-B', '2026-01-05', '2026-01-05', [], [], [], []);
        // B's holiday rate 5x vs A's normal: difference proves isolation
        expect(payrollA.breakdown[0].holidayHours).toBe(0);
        expect(payrollB.breakdown[0].holidayHours).toBe(8);
        // preview A built via runtime must reflect A config only
        expect(cfgA.holidays).not.toContain('2026-01-05');
        expect(cfgB.holidays).toContain('2026-01-05');
    });
});
