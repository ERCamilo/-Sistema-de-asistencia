import { prepareEmployeePositionAssignments, captureAttendancePositionAssignments, changedAssignmentPositions } from '../modules/features/employees/EmployeePositionAssignments.js';
import { planEmployeeLeaderChange, planPositionLeaderChange, leaderChangeEffectiveAt, countLeaderChangeDays } from '../modules/features/employees/LeaderChangeFromDate.js';
import { calculateEmployeePayrollWithContext } from '../modules/features/payroll/PayrollService.js';
import { filterPayrollRowsByLeader } from '../modules/features/payroll/PayrollPreview.js';
import { getPayrollEmployeesForPeriodWithContext } from '../modules/features/payroll/PayrollPeriod.js';

// Decisión del usuario (2026-11-10): un cambio de líder vale para todo el
// período abierto o desde la fecha que se elija, por si el cambio se anota en
// la app otro día que en la realidad. Igual para todos los empleados.
const PERIOD_START = '2026-11-01';
const day = n => `2026-11-${String(n).padStart(2, '0')}`;
const at = (n, hour = 18) => new Date(`${day(n)}T${String(hour).padStart(2, '0')}:00:00`).getTime();
function world() {
    return { settings: { regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, restDayFactor: 1.5, holidays: [] }, exportConfig: {},
        leaders: [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }, { id: 'L3', name: 'Ana' }],
        positions: [{ id: 'p', name: 'Ayudante', leaderId: 'L2', hourlyRate: 62.5, workingDays: [0, 1, 2, 3, 4, 5, 6] }],
        employees: [{ id: 'pedro', number: '1', name: 'Pedro', positions: ['p'] }, { id: 'juan', number: '2', name: 'Juan', positions: ['p'] }], attendance: {} };
}
const mark = (state, id, n) => { state.attendance[`${id}-${day(n)}`] = captureAttendancePositionAssignments(
    { employeeId: id, date: day(n), present: true, selectedPosition: 'p', hoursWorked: 8, overtimeHours: 0, createdAt: at(n), updatedAt: at(n) }, state, at(n)); };
const commit = (state, plan) => { Object.assign(state.attendance, plan.records); return plan; };
/** Days each leader pays, through the real payroll calculation and leader filter. */
function daysByLeader(state) {
    const ctx = { ...state, projectId: 'obra', getAttendance: (employee, date) => state.attendance[`${employee}-${date}`] };
    const config = { projectId: 'obra', regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, holidays: [] };
    const rows = getPayrollEmployeesForPeriodWithContext({ ...ctx, exportConfig: { leaderFilter: 'all' } }, day(1), day(15)).map(employee => {
        const payroll = calculateEmployeePayrollWithContext(ctx, config, employee.id, day(1), day(15), [], [], [], []);
        return { _employeeId: employee.id, _employeeName: employee.name, _brutoOriginal: payroll.brutoOriginal, monto: payroll.neto,
            _positionBreakdown: payroll.breakdown, _personalAdjustmentPayerId: payroll.personalAdjustmentPayerId };
    });
    return Object.fromEntries(state.leaders.map(leader => [leader.name, Object.fromEntries(
        filterPayrollRowsByLeader(rows, { leaderId: leader.id, positions: state.positions, employees: state.employees })
            .filter(row => row._brutoOriginal > 0).map(row => [row._employeeName, row._brutoOriginal / 500]))]));
}
function changeJobLeader(state, leaderId, fromDate, now = at(8)) {
    const before = { ...state.positions[0] };
    state.positions[0].leaderId = leaderId;
    return commit(state, planPositionLeaderChange(state, { positionBefore: before, fromDate, periodStart: PERIOD_START, now }));
}
function changeOwnLeader(state, leaderId, fromDate, now = at(8)) {
    const juan = state.employees[1];
    juan.positionAssignments = prepareEmployeePositionAssignments(juan, { p: { workLeaderId: leaderId } }, state, leaderChangeEffectiveAt(fromDate));
    return commit(state, planEmployeeLeaderChange(state, { employeeId: 'juan', positionIds: ['p'], fromDate, now }));
}

describe('the leader of a job changes in the catalogue', () => {
    const base = () => { const state = world(); for (const n of [3, 4, 5, 6]) mark(state, 'pedro', n); return state; };

    test('whole open period: every recorded day goes to the new leader and nothing is rewritten', () => {
        const state = base();
        const plan = changeJobLeader(state, 'L1', PERIOD_START);
        expect(plan.dateKeys).toEqual([]);
        expect(daysByLeader(state)).toEqual({ Luis: { Pedro: 4 }, Marcos: {}, Ana: {} });
    });

    test('from a chosen date: earlier days stay with the previous leader', () => {
        const state = base();
        const plan = changeJobLeader(state, 'L1', day(5));
        expect(plan.dateKeys.sort()).toEqual([day(3), day(4)]);
        expect(daysByLeader(state)).toEqual({ Luis: { Pedro: 2 }, Marcos: { Pedro: 2 }, Ana: {} });
        for (const n of [3, 4]) expect(state.attendance[`pedro-${day(n)}`].updatedAt).toBe(at(8));
        expect(state.attendance[`pedro-${day(5)}`].updatedAt).toBe(at(5));
    });

    test('only the open period is rewritten, and repeating the change is a no-op', () => {
        const state = base();
        state.attendance['pedro-2026-10-20'] = { employeeId: 'pedro', date: '2026-10-20', present: true, selectedPosition: 'p', hoursWorked: 8, updatedAt: 1 };
        changeJobLeader(state, 'L1', day(5));
        expect(state.attendance['pedro-2026-10-20'].updatedAt).toBe(1);
        const again = planPositionLeaderChange(state, { positionBefore: { ...state.positions[0], leaderId: 'L2' }, fromDate: day(5), periodStart: PERIOD_START, now: at(9) });
        expect(again.dateKeys).toEqual([]);
    });

    test('a later change for the whole period also moves days that an earlier dated change had kept', () => {
        const state = base();
        changeJobLeader(state, 'L1', day(5));
        changeJobLeader(state, 'L3', PERIOD_START, at(9));
        expect(daysByLeader(state)).toEqual({ Luis: {}, Marcos: {}, Ana: { Pedro: 4 } });
    });

    test('a second dated change keeps both earlier stretches', () => {
        const state = base();
        changeJobLeader(state, 'L1', day(4));
        changeJobLeader(state, 'L3', day(6), at(9));
        expect(daysByLeader(state)).toEqual({ Luis: { Pedro: 2 }, Marcos: { Pedro: 1 }, Ana: { Pedro: 1 } });
    });

    test('an employee with his own leader, deleted days and other jobs are left alone', () => {
        const state = base();
        state.employees[1].positionAssignments = prepareEmployeePositionAssignments(state.employees[1], { p: { workLeaderId: 'L3' } }, state, at(1, 8));
        mark(state, 'juan', 3);
        state.attendance[`pedro-${day(2)}`] = { employeeId: 'pedro', date: day(2), present: false, deletedAt: 5, selectedPosition: 'p', updatedAt: 5 };
        state.attendance[`pedro-${day(1)}`] = { employeeId: 'pedro', date: day(1), present: true, selectedPosition: 'other', hoursWorked: 8, updatedAt: 5 };
        const plan = changeJobLeader(state, 'L1', day(5));
        expect(Object.keys(plan.records).sort()).toEqual([`pedro-${day(3)}`, `pedro-${day(4)}`]);
        expect(daysByLeader(state).Ana).toEqual({ Juan: 1 });
    });

    test('the number of recorded days tells whether there is anything to ask about', () => {
        const state = base();
        expect(countLeaderChangeDays(state, { positionIds: ['p'], periodStart: PERIOD_START })).toBe(4);
        expect(countLeaderChangeDays(state, { positionIds: ['p'], periodStart: day(10) })).toBe(0);
        expect(countLeaderChangeDays(state, { positionIds: ['p'], periodStart: PERIOD_START, employeeId: 'juan' })).toBe(0);
    });
});

describe('the individual leader of an employee changes', () => {
    function base() {
        const state = world();
        state.employees[1].positionAssignments = prepareEmployeePositionAssignments(state.employees[1], { p: { workLeaderId: 'L2' } }, state, at(1, 8));
        for (const n of [3, 4, 5, 6]) mark(state, 'juan', n);
        return state;
    }

    test('whole open period: recorded days move to the new leader', () => {
        const state = base();
        const plan = changeOwnLeader(state, 'L1', PERIOD_START);
        expect(plan.dateKeys.sort()).toEqual([day(3), day(4), day(5), day(6)]);
        expect(daysByLeader(state)).toEqual({ Luis: { Juan: 4 }, Marcos: {}, Ana: {} });
    });

    test('from a chosen date: earlier days stay with the previous leader', () => {
        const state = base();
        const plan = changeOwnLeader(state, 'L1', day(5));
        expect(plan.dateKeys.sort()).toEqual([day(5), day(6)]);
        expect(daysByLeader(state)).toEqual({ Luis: { Juan: 2 }, Marcos: { Juan: 2 }, Ana: {} });
    });

    test('days without recorded terms follow the chosen date too', () => {
        const state = base();
        for (const n of [3, 4, 5, 6]) delete state.attendance[`juan-${day(n)}`].positionAssignments;
        changeOwnLeader(state, 'L1', day(5));
        expect(daysByLeader(state)).toEqual({ Luis: { Juan: 2 }, Marcos: { Juan: 2 }, Ana: {} });
    });

    test('a loan position moves the payer from the chosen date and keeps hours and rate untouched', () => {
        const state = base();
        const juan = state.employees[1];
        juan.positionAssignments = prepareEmployeePositionAssignments(juan, { p: { workLeaderId: 'L1', isLoanPosition: true, payerLeaderId: 'L3' } }, state, leaderChangeEffectiveAt(day(5)));
        const plan = commit(state, planEmployeeLeaderChange(state, { employeeId: 'juan', positionIds: ['p'], fromDate: day(5), now: at(8) }));
        expect(daysByLeader(state)).toEqual({ Luis: {}, Marcos: { Juan: 2 }, Ana: { Juan: 2 } });
        const rewritten = plan.records[`juan-${day(5)}`];
        expect(rewritten).toMatchObject({ hoursWorked: 8, selectedPosition: 'p', present: true });
        expect(rewritten.positionAssignments.p).toMatchObject({ schemaVersion: 1, workLeaderId: 'L1', payerLeaderId: 'L3', isLoanPosition: true });
    });

    test('other employees and other jobs of the same employee are not touched', () => {
        const state = base(); mark(state, 'pedro', 5);
        const plan = changeOwnLeader(state, 'L1', day(5));
        expect(Object.keys(plan.records).every(key => key.startsWith('juan-'))).toBe(true);
    });
});

test('only real leader or payer changes of jobs the employee already had are detected', () => {
    const state = world();
    state.positions.push({ id: 'q', name: 'Albañil', leaderId: 'L1' });
    const pedro = state.employees[0];
    expect(changedAssignmentPositions(pedro, { p: { workLeaderId: 'L2' } }, state.positions)).toEqual([]);
    expect(changedAssignmentPositions(pedro, { p: { workLeaderId: 'L1' } }, state.positions)).toEqual(['p']);
    expect(changedAssignmentPositions(pedro, { p: { workLeaderId: 'L2', isLoanPosition: true, payerLeaderId: 'L3' } }, state.positions)).toEqual(['p']);
    expect(changedAssignmentPositions(pedro, { q: { workLeaderId: 'L3' } }, state.positions)).toEqual([]);
});
