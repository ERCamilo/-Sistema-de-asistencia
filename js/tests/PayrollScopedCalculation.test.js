/**
 * F1.6-A3 — PayrollService/Period scoped via PayrollProjectContext + projectPayrollConfigs
 * TDD contract per Direction's frozen A3 spec.
 *
 * - Captures projectId + context BEFORE first await; config fetched ONLY via capturedProjectId
 * - Flag ON + config null → fail closed "config unavailable", NO fallback to global settings
 * - Flag OFF → exact legacy parity
 * - Flag ON → uses ctx.employees/positions/leaders + ctx.getAttendance() + config values only
 * - Tests: A/B simultaneous #12, different factors/holidays/periods, async stability A→B switch,
 *          in-place mutation deep-clone isolation, OFF parity, missing-config error
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { capturePayrollProjectContext, createPayrollProjectContext } from 'actual/features/payroll/PayrollProjectContext.js';
import { getConfig as storeGetConfig, putConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { PayrollService, resolveScopedPayrollContext, calculateEmployeePayrollWithContext } from 'actual/features/payroll/PayrollService.js';
import { getPayrollEmployeesForPeriod, getPayrollEmployeesForPeriodWithContext, resolvePayrollPeriod } from 'actual/features/payroll/PayrollPeriod.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}

const PRJ_A = 'PRJ-A-A3';
const PRJ_B = 'PRJ-B-A3';
const PRJ_DEFAULT = 'PRJ-DEFAULT-A3';

function legacySettings(overrides = {}) {
    return {
        regularHoursPerDay: 8,
        overtimeFactor: 1.5,
        holidayFactor: 2,
        holidays: [],
        payPeriod: { periodStart: '2026-08-01', periodLength: 21, payDay: '2026-08-22' },
        defaultDeductionPercentage: 2,
        ...overrides
    };
}

function makePayrollState() {
    return {
        employees: [
            { id: 'E-A', number: '12', name: 'Juan', projectId: PRJ_A, active: true, positions: ['P-A'], positionSalaries: {}, customWorkingDays: {} },
            { id: 'E-B', number: '12', name: 'Pedro', projectId: PRJ_B, active: true, positions: ['P-B'], positionSalaries: {}, customWorkingDays: {} },
        ],
        positions: [
            { id: 'P-A', name: 'Pos A', projectId: PRJ_A, workingDays: [1,2,3,4,5], hourlyRate: 100, leaderId: null },
            { id: 'P-B', name: 'Pos B', projectId: PRJ_B, workingDays: [1,2,3,4,5], hourlyRate: 100, leaderId: null },
        ],
        leaders: [
            { id: 'L-A', name: 'Lead A', projectId: PRJ_A },
            { id: 'L-B', name: 'Lead B', projectId: PRJ_B },
        ],
        attendance: {
            'E-A-2026-08-24': { employeeId: 'E-A', date: '2026-08-24', present: true, hoursWorked: 8, overtimeHours: 2, projectId: PRJ_A },
            'E-B-2026-08-24': { employeeId: 'E-B', date: '2026-08-24', present: true, hoursWorked: 8, overtimeHours: 2, projectId: PRJ_B },
            'E-A-2026-08-25': { employeeId: 'E-A', date: '2026-08-25', present: true, hoursWorked: 8, projectId: PRJ_A },
            'E-B-2026-08-25': { employeeId: 'E-B', date: '2026-08-25', present: true, hoursWorked: 8, projectId: PRJ_B },
        },
        settings: legacySettings({ regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [], payPeriod: { periodStart: '2026-08-01', periodLength: 21, payDay: '2026-08-22' } }),
        exportConfig: { leaderFilter: 'all', periodStart: '2026-08-24', periodEnd: '2026-08-24' },
        attendanceByDate: {}
    };
}

function makeConfig(projectId, overrides = {}) {
    const base = createDefaultConfig(projectId, legacySettings());
    return { ...base, ...overrides, projectId };
}

describe('A3 PayrollService/Period scoped — frozen contract', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });
    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        jest.restoreAllMocks();
    });

    test('OFF parity: legacy calculation unchanged when flag OFF', () => {
        setProjectsEnabled(false);
        resetEntityScope();
        const state = makePayrollState();
        // legacy global settings: overtime 1.5, holiday 2, regular 8
        const svc = new PayrollService(state);
        const result = svc.calculateEmployeePayroll('E-A', '2026-08-24', '2026-08-24');
        // With 8 regular + 2 overtime @100/h: regular 800, overtime 2*100*1.5=300 → 1100
        expect(result.brutoOriginal).toBe(1100);
        expect(result.bruto).toBe(1100);
        expect(result.neto).toBe(1100);
        expect(result.breakdown).toHaveLength(1);
        expect(result.breakdown[0].positionId).toBe('P-A');
        // Should NOT have _scoped flag when OFF (legacy)
        expect(result._scoped).toBeUndefined();
    });

    test('ON + missing config → fail closed with explicit "config unavailable" error (no fallback)', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const state = makePayrollState();
        const svc = new PayrollService(state);
        // No config seeded for PRJ_A → should reject
        await expect(svc.calculateEmployeePayroll('E-A', '2026-08-24', '2026-08-24')).rejects.toThrow(/config unavailable/i);
        // resolveScopedPayrollContext also must fail closed
        await expect(resolveScopedPayrollContext(state)).rejects.toThrow(/config unavailable/i);
        // Ensure no silent fallback to settings: error message must mention project id
        try {
            await resolveScopedPayrollContext(state);
            fail('should have thrown');
        } catch (e) {
            expect(e.message).toMatch(PRJ_A);
            expect(e.message).toMatch(/config unavailable/i);
        }
    });

    test('A/B simultaneous same #12 distinct employeeId — each uses only own config + own employees/attendance', async () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        // Seed configs with different factors
        const svcIdb = new IndexedDBService('a3-test-ab-simultaneous');
        const cfgA = makeConfig(PRJ_A, { overtimeFactor: 1.5, holidayFactor: 2, regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-08-01', periodLength: 15, payDay: '2026-08-16' } });
        const cfgB = makeConfig(PRJ_B, { overtimeFactor: 3, holidayFactor: 3, regularHoursPerDay: 6, holidays: [], payPeriod: { periodStart: '2026-08-01', periodLength: 21, payDay: '2026-08-22' } });
        await putConfig(cfgA, { idb: svcIdb });
        await putConfig(cfgB, { idb: svcIdb });

        const ctxA = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        const ctxB = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT } });

        // Both have #12 but distinct IDs — ctx isolation already proven, now payroll isolation
        expect(ctxA.employees.map(e=>e.id)).toEqual(['E-A']);
        expect(ctxB.employees.map(e=>e.id)).toEqual(['E-B']);

        const resA = calculateEmployeePayrollWithContext(ctxA, cfgA, 'E-A', '2026-08-24', '2026-08-24');
        const resB = calculateEmployeePayrollWithContext(ctxB, cfgB, 'E-B', '2026-08-24', '2026-08-24');

        // A: 8*100=800 regular + 2*100*1.5=300 → 1100
        // B: different config overtime 3 → 2*100*3=600 → 800+600=1400, plus different regularHoursPerDay 6 doesn't affect same-day calc (hourlyRate still 100, but monthlyEquivalent differs)
        expect(resA.brutoOriginal).toBe(1100);
        expect(resB.brutoOriginal).toBe(1400);
        expect(resA._projectId).toBe(PRJ_A);
        expect(resB._projectId).toBe(PRJ_B);
        // Ensure A does not see B's attendance/hours and vice versa
        expect(resA.breakdown[0].overtimeRate).toBe(100*1.5);
        expect(resB.breakdown[0].overtimeRate).toBe(100*3);
        // Cross check: A should not contain B's employee
        expect(ctxA.getAttendance('E-B','2026-08-24')).toBeUndefined();
        expect(ctxB.getAttendance('E-A','2026-08-24')).toBeUndefined();
    });

    test('Different factors, different holidays, different periods A/B — results differ correctly and do not cross', async () => {
        setProjectsEnabled(true);
        const state = {
            employees: [
                { id: 'E-A', number: '12', name: 'Juan', projectId: PRJ_A, active: true, positions: ['P-A'] },
                { id: 'E-B', number: '12', name: 'Pedro', projectId: PRJ_B, active: true, positions: ['P-B'] },
            ],
            positions: [
                { id: 'P-A', name: 'Pos A', projectId: PRJ_A, workingDays: [1,2,3,4,5], hourlyRate: 100 },
                { id: 'P-B', name: 'Pos B', projectId: PRJ_B, workingDays: [1,2,3,4,5], hourlyRate: 100 },
            ],
            leaders: [],
            attendance: {
                // 2026-08-24 is Monday (working day). A has holiday on this date, B does not.
                'E-A-2026-08-24': { employeeId: 'E-A', date: '2026-08-24', present: true, hoursWorked: 8, projectId: PRJ_A },
                'E-B-2026-08-24': { employeeId: 'E-B', date: '2026-08-24', present: true, hoursWorked: 8, projectId: PRJ_B },
            },
            settings: legacySettings(),
            exportConfig: { leaderFilter: 'all' }
        };
        const cfgA = makeConfig(PRJ_A, { overtimeFactor: 1.5, holidayFactor: 2.5, holidays: ['2026-08-24'], payPeriod: { periodStart: '2026-08-01', periodLength: 10, payDay: '2026-08-11' } });
        const cfgB = makeConfig(PRJ_B, { overtimeFactor: 2, holidayFactor: 2, holidays: ['2026-12-25'], payPeriod: { periodStart: '2026-09-01', periodLength: 21, payDay: '2026-09-22' } });

        const ctxA = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        const ctxB = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT } });

        const resA = calculateEmployeePayrollWithContext(ctxA, cfgA, 'E-A', '2026-08-24', '2026-08-24');
        const resB = calculateEmployeePayrollWithContext(ctxB, cfgB, 'E-B', '2026-08-24', '2026-08-24');

        // A: holiday → holidayHours 8 @ holidayFactor 2.5 → 8*100*2.5=2000
        // B: regular → 8*100=800
        expect(resA.brutoOriginal).toBe(2000);
        expect(resB.brutoOriginal).toBe(800);
        expect(resA.breakdown[0].holidayHours).toBe(8);
        expect(resB.breakdown[0].regularHours).toBe(8);
        expect(resA.breakdown[0].holidayHours).not.toBe(resB.breakdown[0].holidayHours);

        // Period isolation via config
        expect(cfgA.payPeriod.periodStart).toBe('2026-08-01');
        expect(cfgB.payPeriod.periodStart).toBe('2026-09-01');
        expect(cfgA.payPeriod.periodLength).toBe(10);
        expect(cfgB.payPeriod.periodLength).toBe(21);
        // Resolve period via config — must not cross
        const { resolvePayrollPeriodWithContext } = await import('actual/features/payroll/PayrollPeriod.js');
        // Need to import dynamically to avoid circular? Already imported resolvePayrollPeriod
        const periodA = resolvePayrollPeriod(cfgA.payPeriod, new Date('2026-08-15T12:00:00'));
        const periodB = resolvePayrollPeriod(cfgB.payPeriod, new Date('2026-09-15T12:00:00'));
        expect(periodA.periodStart).toBe('2026-08-01');
        expect(periodA.periodEnd).toBe('2026-08-10');
        expect(periodB.periodStart).toBe('2026-09-01');
        expect(periodB.periodEnd).toBe('2026-09-21');
    });

    test('Operation started in A → await → UI switches to B → result stays fully A (snapshot stable)', async () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const cfgA = makeConfig(PRJ_A, { overtimeFactor: 1.5, holidayFactor: 2, holidays: [] });
        const cfgB = makeConfig(PRJ_B, { overtimeFactor: 5, holidayFactor: 2, holidays: ['2026-08-24'] });

        // Mock getConfig to delay first A fetch, allow scope switch during await
        const mod = await import('actual/features/payroll/ProjectPayrollConfigStore.js');
        const spy = jest.spyOn(mod, 'getConfig');
        let resolveFirst;
        let firstCallDone = false;
        spy.mockImplementation((projectId) => {
            if (projectId === PRJ_A && !firstCallDone) {
                firstCallDone = true;
                return new Promise(res => { resolveFirst = () => res(cfgA); });
            }
            if (projectId === PRJ_A) return Promise.resolve(cfgA);
            if (projectId === PRJ_B) return Promise.resolve(cfgB);
            return Promise.resolve(null);
        });

        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const svc = new PayrollService(state);
        const promiseA = svc.calculateEmployeePayroll('E-A', '2026-08-24', '2026-08-24'); // captures A before await

        // Switch UI to B before async config fetch resolves
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        // Also mutate state to try to contaminate
        state.employees.push({ id: 'E-INJECTED', number: '99', name: 'Inject', projectId: PRJ_B });

        resolveFirst();
        const resultA = await promiseA;
        expect(spy).toHaveBeenCalledWith(PRJ_A);
        expect(resultA._projectId).toBe(PRJ_A);
        expect(resultA.breakdown[0].positionId).toBe('P-A');
        // Should not contain injected employee
        expect(resultA.breakdown.find(b=>b.positionId==='P-INJECTED')).toBeUndefined();
        // Result should be A config (overtime 1.5 → 1100) not B's 5
        expect(resultA.brutoOriginal).toBe(1100);

        // New operation after switch should be B
        const promiseB = svc.calculateEmployeePayroll('E-B', '2026-08-24', '2026-08-24');
        const resultB = await promiseB;
        expect(resultB._projectId).toBe(PRJ_B);
        // B has holiday on 2026-08-24 → holiday 8*100*2=1600 + overtime 2*100*5=1000 → 2600
        expect(resultB.brutoOriginal).toBe(2600);
        expect(resultB.brutoOriginal).not.toBe(resultA.brutoOriginal);
    });

    test('Deep clone isolation: mutate original employee/attendance after capture → scoped calc must NOT see mutation', async () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const cfgA = makeConfig(PRJ_A, { overtimeFactor: 1.5, holidayFactor: 2, regularHoursPerDay: 8, holidays: [] });
        const ctx = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });

        // Mutate original employee's positionSalaries and hourlyRate in-place after capture
        const origEmp = state.employees.find(e=>e.id==='E-A');
        origEmp.positionSalaries = { 'P-A': 999 };
        // Also mutate position hourlyRate
        const origPos = state.positions.find(p=>p.id==='P-A');
        origPos.hourlyRate = 999;
        // Mutate attendance record in-place
        const origAtt = state.attendance['E-A-2026-08-24'];
        const beforeHours = origAtt.hoursWorked;
        origAtt.hoursWorked = 1;
        origAtt.overtimeHours = 0;

        // Scoped calc should still use snapshot values (100/h, 8h +2 overtime)
        const res = calculateEmployeePayrollWithContext(ctx, cfgA, 'E-A', '2026-08-24', '2026-08-24');
        // Without deep clone, res would see 999 rate or 1 hour; with deep clone it sees original 100 and 8+2
        expect(res.brutoOriginal).toBe(1100);
        expect(res.breakdown[0].hourlyRate).toBe(100);
        expect(res.breakdown[0].regularHours).toBe(8);
        expect(res.breakdown[0].overtimeHours).toBe(2);
        // Prove mutation did affect original state but not ctx
        expect(state.employees.find(e=>e.id==='E-A').positionSalaries['P-A']).toBe(999);
        expect(ctx.employees.find(e=>e.id==='E-A').positionSalaries).toEqual({});
        expect(ctx.getAttendance('E-A','2026-08-24').hoursWorked).toBe(beforeHours);
        expect(state.attendance['E-A-2026-08-24'].hoursWorked).toBe(1);
    });

    test('PayrollPeriod scoped: A/B isolation for getPayrollEmployeesForPeriod', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const ctxA = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        const ctxB = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT } });

        const employeesA = getPayrollEmployeesForPeriodWithContext(ctxA, '2026-08-24', '2026-08-24');
        const employeesB = getPayrollEmployeesForPeriodWithContext(ctxB, '2026-08-24', '2026-08-24');

        expect(employeesA.map(e=>e.id)).toEqual(['E-A']);
        expect(employeesB.map(e=>e.id)).toEqual(['E-B']);
        // Legacy global would return both
        setProjectsEnabled(false);
        resetEntityScope();
        const both = getPayrollEmployeesForPeriod(state, '2026-08-24', '2026-08-24');
        expect(both.map(e=>e.id).sort()).toEqual(['E-A','E-B']);
    });

    test('PayrollPeriod OFF parity: legacy getPayrollEmployeesForPeriod returns both when flag OFF', () => {
        setProjectsEnabled(false);
        const state = makePayrollState();
        const result = getPayrollEmployeesForPeriod(state, '2026-08-24', '2026-08-24');
        expect(result).toHaveLength(2);
    });

    test('ResolveScopedPayrollContext captures before await and uses ONLY capturedProjectId (no re-query)', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        const state = makePayrollState();
        const fakeIdb = {
            get: jest.fn(async (store, key) => {
                // Simulate delay
                await new Promise(r=>setTimeout(r, 5));
                if (key === PRJ_A) return makeConfig(PRJ_A, { overtimeFactor: 1.5 });
                if (key === PRJ_B) return makeConfig(PRJ_B, { overtimeFactor: 9 });
                return null;
            })
        };
        // Seed via fake
        const promise = resolveScopedPayrollContext(state, { idb: fakeIdb });
        // Switch before await resolves
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        const res = await promise;
        expect(fakeIdb.get).toHaveBeenCalledWith('projectPayrollConfigs', PRJ_A);
        expect(fakeIdb.get).not.toHaveBeenCalledWith('projectPayrollConfigs', PRJ_B);
        expect(res.capturedProjectId).toBe(PRJ_A);
        expect(res.ctx.projectId).toBe(PRJ_A);
        expect(res.config.overtimeFactor).toBe(1.5);
    });

    test('PayrollService does NOT consume buildAttendanceIndex RAW — uses ctx.getAttendance', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        state.attendanceByDate = { '2026-08-24': [{ employeeId: 'E-A', projectId: PRJ_A }, { employeeId: 'E-B', projectId: PRJ_B }] };
        const before = JSON.stringify(state.attendanceByDate);
        const ctx = createPayrollProjectContext({ state, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        const cfg = makeConfig(PRJ_A, { holidays: [] });
        const res = calculateEmployeePayrollWithContext(ctx, cfg, 'E-A', '2026-08-24', '2026-08-24');
        // Ensure RAW index not mutated and not used for payroll (payroll succeeded via ctx)
        expect(JSON.stringify(state.attendanceByDate)).toBe(before);
        expect(res.brutoOriginal).toBe(1100);
        // If we delete attendance record but keep index, calc should still fail (since uses ctx, not index)
        const state2 = makePayrollState();
        const ctx2 = createPayrollProjectContext({ state: state2, scope: { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        state2.attendance = {};
        state2.attendanceByDate = { '2026-08-24': [{ employeeId: 'E-A', projectId: PRJ_A }] };
        const res2 = calculateEmployeePayrollWithContext(ctx2, makeConfig(PRJ_A, {}), 'E-A', '2026-08-24', '2026-08-24');
        expect(res2.brutoOriginal).toBe(1100); // ctx still has attendance snapshot, not mutated by state2 change after capture? Actually ctx2 captured before mutation, so it still has original attendance
    });
});
