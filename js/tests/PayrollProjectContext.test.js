/**
 * F1.6-A1 — PayrollProjectContext: single payroll boundary captures projectId ONCE
 * TDD contract per Direction's frozen A1 spec.
 *
 * - employees/positions/leaders filtered by entityInScope (effectiveProjectId === capturedProjectId)
 * - getAttendance scoped via captured projectId, not live state
 * - stable snapshot: capture A then switch to B, ctxA stays A
 * - same visible number #12 coexists by distinct employeeId
 * - flag OFF preserves exact legacy behavior (no filtering)
 * - buildAttendanceIndex stays RAW (frontier, not modification)
 */
import { createPayrollProjectContext, capturePayrollProjectContext } from 'actual/features/payroll/PayrollProjectContext.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';

const PRJ_A = 'PRJ-A-AAAA';
const PRJ_B = 'PRJ-B-BBBB';
const PRJ_DEFAULT = 'PRJ-DEFAULT';

function makePayrollState() {
    return {
        employees: [
            { id: 'E-A', number: '12', name: 'Juan', projectId: PRJ_A, active: true, positions: ['P-A'] },
            { id: 'E-B', number: '12', name: 'Pedro', projectId: PRJ_B, active: true, positions: ['P-B'] },
        ],
        positions: [
            { id: 'P-A', name: 'Pos A', projectId: PRJ_A, workingDays: [1,2,3,4,5], hourlyRate: 100 },
            { id: 'P-B', name: 'Pos B', projectId: PRJ_B, workingDays: [1,2,3,4,5], hourlyRate: 100 },
        ],
        leaders: [
            { id: 'L-A', name: 'Lead A', projectId: PRJ_A },
            { id: 'L-B', name: 'Lead B', projectId: PRJ_B },
        ],
        attendance: {
            'E-A-2026-08-23': { employeeId: 'E-A', date: '2026-08-23', present: true, hoursWorked: 8, projectId: PRJ_A },
            'E-B-2026-08-23': { employeeId: 'E-B', date: '2026-08-23', present: true, hoursWorked: 7, projectId: PRJ_B },
            'E-A-2026-08-24': { employeeId: 'E-A', date: '2026-08-24', present: true, hoursWorked: 6, projectId: PRJ_A },
        },
        settings: {
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2,
            holidays: [],
            payPeriod: { periodStart: '2026-08-01', periodLength: 21, payDay: '2026-08-22' }
        },
        exportConfig: {},
        attendanceByDate: {}
    };
}

describe('A1 PayrollProjectContext — frozen single-project boundary', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        jest.resetModules(); // ensure FeatureFlags re-read? flag is localStorage-backed, no module cache needed
    });
    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('ctx A never contains Pedro, ctx B never contains Juan — #12 coexistence by employeeId', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const scopeA = { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
        const scopeB = { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT };
        const ctxA = createPayrollProjectContext({ state, scope: scopeA });
        const ctxB = createPayrollProjectContext({ state, scope: scopeB });

        expect(ctxA.projectId).toBe(PRJ_A);
        expect(ctxB.projectId).toBe(PRJ_B);
        expect(ctxA.employees.map(e => e.id)).toEqual(['E-A']);
        expect(ctxB.employees.map(e => e.id)).toEqual(['E-B']);
        // visible number isolation
        expect(ctxA.employees[0].number).toBe('12');
        expect(ctxB.employees[0].number).toBe('12');
        expect(ctxA.employees.find(e => e.id === 'E-B')).toBeUndefined();
        expect(ctxB.employees.find(e => e.id === 'E-A')).toBeUndefined();
    });

    test('attendance: each context sees only its own record for same date', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const scopeA = { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
        const scopeB = { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT };
        const ctxA = createPayrollProjectContext({ state, scope: scopeA });
        const ctxB = createPayrollProjectContext({ state, scope: scopeB });

        expect(ctxA.getAttendance('E-A', '2026-08-23')).toBeDefined();
        expect(ctxA.getAttendance('E-A', '2026-08-23').hoursWorked).toBe(8);
        expect(ctxA.getAttendance('E-B', '2026-08-23')).toBeUndefined();

        expect(ctxB.getAttendance('E-B', '2026-08-23')).toBeDefined();
        expect(ctxB.getAttendance('E-B', '2026-08-23').hoursWorked).toBe(7);
        expect(ctxB.getAttendance('E-A', '2026-08-23')).toBeUndefined();
    });

    test('positions/leaders: position/leader of A not visible in B context', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const ctxA = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        const ctxB = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT } });

        expect(ctxA.positions.map(p => p.id)).toEqual(['P-A']);
        expect(ctxB.positions.map(p => p.id)).toEqual(['P-B']);
        expect(ctxA.leaders.map(l => l.id)).toEqual(['L-A']);
        expect(ctxB.leaders.map(l => l.id)).toEqual(['L-B']);
    });

    test('async stability: capture context A, switch activeProjectId to B, await tick, context still A', async () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        // simulate global scope capture path: use replaceEntityScope + capturePayrollProjectContext
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        // capture via capturePayrollProjectContext which internally uses captureEntityProjectScope
        // but we test direct create with captured scope frozen before await
        const capturedScope = { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
        const ctxA = createPayrollProjectContext({ state, scope: capturedScope });

        // switch global scope to B BEFORE first await completes
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        // also flip an explicit switch like setProjectsEnabled still true
        await new Promise(r => setTimeout(r, 0));

        // ctxA must remain A — no drift
        expect(ctxA.projectId).toBe(PRJ_A);
        expect(ctxA.employees.map(e => e.id)).toEqual(['E-A']);
        expect(ctxA.getAttendance('E-A', '2026-08-23').hoursWorked).toBe(8);
        expect(ctxA.getAttendance('E-B', '2026-08-23')).toBeUndefined();

        // new context after switch should be B
        const ctxB = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT } });
        expect(ctxB.projectId).toBe(PRJ_B);
        expect(ctxB.employees.map(e => e.id)).toEqual(['E-B']);
    });

    test('flag OFF: both contexts return legacy unfiltered collections (exact parity)', () => {
        setProjectsEnabled(false);
        resetEntityScope();
        const state = makePayrollState();
        // Even if we pass a scoped scope, flag OFF must ignore filtering
        const scopeA = { enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT };
        const scopeB = { enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT };
        const ctxA = createPayrollProjectContext({ state, scope: scopeA });
        const ctxB = createPayrollProjectContext({ state, scope: scopeB });

        // Both should contain ALL employees (legacy exact parity)
        expect(ctxA.employees).toHaveLength(2);
        expect(ctxB.employees).toHaveLength(2);
        const idsA = ctxA.employees.map(e => e.id).sort();
        const idsB = ctxB.employees.map(e => e.id).sort();
        expect(idsA).toEqual(['E-A','E-B']);
        expect(idsB).toEqual(['E-A','E-B']);

        // attendance passthrough: both can see both records
        expect(ctxA.getAttendance('E-A','2026-08-23')).toBeDefined();
        expect(ctxA.getAttendance('E-B','2026-08-23')).toBeDefined();
        expect(ctxB.getAttendance('E-A','2026-08-23')).toBeDefined();
        expect(ctxB.getAttendance('E-B','2026-08-23')).toBeDefined();

        // positions/leaders also unfiltered
        expect(ctxA.positions).toHaveLength(2);
        expect(ctxB.positions).toHaveLength(2);
        expect(ctxA.leaders).toHaveLength(2);
        expect(ctxB.leaders).toHaveLength(2);

        // OFF passthrough should be exact reference (or at least contain same objects)
        // The spec says OFF returns original arrays
        expect(ctxA.employees).toBe(state.employees);
        expect(ctxA.positions).toBe(state.positions);
    });

    test('freeze: collections are shallow-frozen and do not drift after state mutation', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const ctxA = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        expect(Object.isFrozen(ctxA.employees)).toBe(true);
        expect(Object.isFrozen(ctxA.positions)).toBe(true);
        expect(Object.isFrozen(ctxA.leaders)).toBe(true);
        // mutate live state after capture
        state.employees.push({ id: 'E-INJECTED', number: '99', name: 'Inject', projectId: PRJ_A });
        state.positions.push({ id: 'P-INJECTED', name: 'Inject Pos', projectId: PRJ_A });
        state.attendance['E-A-2026-08-25'] = { employeeId: 'E-A', date: '2026-08-25', present:true, projectId: PRJ_A };
        // ctx must not see injected
        expect(ctxA.employees.find(e => e.id === 'E-INJECTED')).toBeUndefined();
        expect(ctxA.positions.find(p => p.id === 'P-INJECTED')).toBeUndefined();
        expect(ctxA.getAttendance('E-A','2026-08-25')).toBeUndefined();
    });

    test('assert helpers throw on cross-project access', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        const ctxA = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        expect(() => ctxA.assertEmployeeInProject('E-A')).not.toThrow();
        expect(() => ctxA.assertEmployeeInProject('E-B')).toThrow();
        expect(() => ctxA.assertNoCross({ id:'E-B', projectId: PRJ_B })).toThrow();
        expect(() => ctxA.assertNoCross({ id:'E-A', projectId: PRJ_A })).not.toThrow();
    });

    test('capturePayrollProjectContext freezes before first await (integration with captureEntityProjectScope)', async () => {
        setProjectsEnabled(true);
        // prime global scope to A via localStorage + replaceEntityScope
        replaceEntityScope({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
        localStorage.setItem('asistencia_default_project_id', PRJ_DEFAULT);
        const state = makePayrollState();
        const ctx = capturePayrollProjectContext(state);
        expect(ctx.projectId).toBe(PRJ_A);
        // flip global to B before await
        replaceEntityScope({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
        await new Promise(r => setTimeout(r, 0));
        expect(ctx.projectId).toBe(PRJ_A);
        expect(ctx.employees.map(e=>e.id)).toEqual(['E-A']);
    });

    test('buildAttendanceIndex stays RAW — context does not mutate global attendanceByDate', () => {
        setProjectsEnabled(true);
        const state = makePayrollState();
        state.attendanceByDate = { '2026-08-23': [{ employeeId:'E-A', projectId: PRJ_A }, { employeeId:'E-B', projectId: PRJ_B }] };
        const before = JSON.stringify(state.attendanceByDate);
        const ctxA = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        // context creation must not have mutated the raw index
        expect(JSON.stringify(state.attendanceByDate)).toBe(before);
        expect(ctxA.employees).toHaveLength(1);
    });

    test('effectiveProjectId fallback: legacy employee without projectId resolves to default', () => {
        setProjectsEnabled(true);
        const state = {
            employees: [
                { id: 'E-LEGACY', number: '12', name: 'Legacy' }, // no projectId → defaults to PRJ_DEFAULT
                { id: 'E-A', number: '12', name: 'Juan', projectId: PRJ_A },
            ],
            positions: [],
            leaders: [],
            attendance: {},
            settings: {}
        };
        const ctxDefault = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT } });
        expect(ctxDefault.employees.map(e=>e.id)).toEqual(['E-LEGACY']);
        const ctxA = createPayrollProjectContext({ state, scope: { enabled:true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT } });
        expect(ctxA.employees.map(e=>e.id)).toEqual(['E-A']);
    });
});
