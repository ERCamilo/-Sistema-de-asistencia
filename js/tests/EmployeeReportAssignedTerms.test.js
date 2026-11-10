import { buildEmployeeReportData } from '../modules/features/analytics/EmployeeReportData.js';
import { prepareEmployeePositionAssignments, captureAttendancePositionAssignments } from '../modules/features/employees/EmployeePositionAssignments.js';
import { calculateEmployeePayrollWithContext } from '../modules/features/payroll/PayrollService.js';
import { parseDate } from '../modules/utils/DateUtils.js';

// The worked-days report must value a day exactly as payroll pays it, whether
// or not the employee has an individual leader.
const NOW = new Date('2026-11-02T09:00:00').getTime();
const HOLIDAY = '2026-11-09', SUNDAY = '2026-11-15';
function scenario() {
    const state = {
        settings: { regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, restDayFactor: 1.5, holidays: [] },
        leaders: [{ id: 'L1', name: 'Luis', restDayFactor: 3 }, { id: 'L2', name: 'Marcos', restDayFactor: 2 }],
        positions: [{ id: 'p', name: 'Ayudante', active: true, leaderId: 'L2', hourlyRate: 62.5, workingDays: [1, 2, 3, 4, 5, 6] }],
        employees: [{ id: 'plain', number: '1', name: 'Pedro', active: true, positions: ['p'] },
            { id: 'own', number: '2', name: 'Juan', active: true, positions: ['p'] }],
        attendance: {}
    };
    state.employees[1].positionAssignments = prepareEmployeePositionAssignments(state.employees[1], { p: { workLeaderId: 'L1' } }, state, NOW);
    return state;
}
function attend(state, date, extra = {}) {
    for (const id of ['plain', 'own']) state.attendance[`${id}-${date}`] = captureAttendancePositionAssignments(
        { employeeId: id, date, present: true, selectedPosition: 'p', hoursWorked: 8, overtimeHours: 0, ...extra }, state, NOW + 1000);
}
function reportDays(state, date, projectHolidayFactor = state.settings.holidayFactor) {
    const report = buildEmployeeReportData({ employees: state.employees, positions: state.positions, attendance: state.attendance,
        days: [{ date: parseDate(date), isHoliday: (state.settings.holidays || []).includes(date) }], startDate: date, endDate: date,
        regularHours: 8, holidayFactor: projectHolidayFactor, leaders: state.leaders, settings: state.settings,
        restDayFactor: state.settings.restDayFactor });
    return Object.fromEntries(report.positions.flatMap(group => group.employees.map(employee => [employee.id, employee.total])));
}
function paidDays(state, date, projectHolidayFactor = state.settings.holidayFactor) {
    const ctx = { ...state, projectId: 'obra', getAttendance: (id, day) => state.attendance[`${id}-${day}`] };
    const config = { projectId: 'obra', regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: projectHolidayFactor, holidays: state.settings.holidays };
    return Object.fromEntries(['plain', 'own'].map(id =>
        [id, calculateEmployeePayrollWithContext(ctx, config, id, date, date, [], [], [], []).brutoOriginal / (62.5 * 8)]));
}

test('a holiday counts double, one extra day, for both employees and matches payroll', () => {
    const state = scenario(); attend(state, HOLIDAY, { isHoliday: true });
    expect(reportDays(state, HOLIDAY)).toEqual({ plain: 2, own: 2 });
    expect(paidDays(state, HOLIDAY)).toEqual({ plain: 2, own: 2 });
});

test('a holiday added to the calendar after the work was recorded reaches both employees', () => {
    const state = scenario(); attend(state, HOLIDAY);
    state.settings.holidays = [HOLIDAY];
    expect(reportDays(state, HOLIDAY)).toEqual(paidDays(state, HOLIDAY));
    expect(reportDays(state, HOLIDAY)).toEqual({ plain: 2, own: 2 });
});

test('the holiday factor of the project is the one reported for every employee', () => {
    const state = scenario(); attend(state, HOLIDAY, { isHoliday: true });
    expect(reportDays(state, HOLIDAY, 3)).toEqual({ plain: 3, own: 3 });
    expect(paidDays(state, HOLIDAY, 3)).toEqual({ plain: 3, own: 3 });
});

test('a rest day is valued with what the leader of that work pays, also after he changes it', () => {
    const state = scenario(); attend(state, SUNDAY);
    expect(reportDays(state, SUNDAY)).toEqual({ plain: 2, own: 3 });
    expect(paidDays(state, SUNDAY)).toEqual({ plain: 2, own: 3 });
    state.leaders[0].restDayFactor = 4;
    expect(reportDays(state, SUNDAY)).toEqual({ plain: 2, own: 4 });
    expect(paidDays(state, SUNDAY)).toEqual({ plain: 2, own: 4 });
});

describe('a day split between two jobs is reported the way payroll pays it', () => {
    function split(record) {
        const state = scenario();
        state.positions.push({ id: 'q', name: 'Albañil', active: true, leaderId: 'L2', hourlyRate: 62.5, workingDays: [1, 2, 3, 4, 5, 6] });
        state.employees = [{ id: 'plain', number: '1', name: 'Pedro', active: true, positions: ['p', 'q'] }];
        state.attendance = { [`plain-${HOLIDAY}`]: { employeeId: 'plain', date: HOLIDAY, present: true, selectedPosition: 'p', hoursWorked: 8, ...record } };
        const report = buildEmployeeReportData({ employees: state.employees, positions: state.positions, attendance: state.attendance,
            days: [{ date: parseDate(HOLIDAY), isHoliday: false }], startDate: HOLIDAY, endDate: HOLIDAY, regularHours: 8, holidayFactor: 2,
            leaders: state.leaders, settings: state.settings });
        const ctx = { ...state, projectId: 'obra', getAttendance: (id, day) => state.attendance[`${id}-${day}`] };
        const payroll = calculateEmployeePayrollWithContext(ctx, { projectId: 'obra', regularHoursPerDay: 8, overtimeFactor: 1.35, holidayFactor: 2, holidays: [] },
            'plain', HOLIDAY, HOLIDAY, [], [], [], []);
        return {
            reported: Object.fromEntries(report.positions.map(group => [group.position.id, group.employees[0]?.total || 0])),
            paid: Object.fromEntries(payroll.breakdown.map(part => [part.positionId, part.regularHours / 8]))
        };
    }
    const hours = [{ positionId: 'p', hours: 4 }, { positionId: 'q', hours: 4 }];

    test('hours per job count even when the record lacks the multi-position mark', () => {
        const { reported, paid } = split({ multiPosition: false, positionHours: hours });
        expect(paid).toEqual({ p: 0.5, q: 0.5 });
        expect(reported).toEqual(paid);
    });

    test('a marked multi-position day keeps working', () => {
        const { reported, paid } = split({ multiPosition: true, positionHours: hours });
        expect(reported).toEqual({ p: 0.5, q: 0.5 });
        expect(reported).toEqual(paid);
    });

    test('a marked day with an empty hour list falls back to the selected job, like payroll', () => {
        const { reported, paid } = split({ multiPosition: true, positionHours: [] });
        expect(paid).toEqual({ p: 1 });
        expect(reported.p).toBe(1);
    });

    test('job identifiers are compared as text, like payroll', () => {
        const { reported } = split({ positionHours: [{ positionId: 'p', hours: 4 }, { positionId: 'q', hours: 4 }], selectedPosition: 'p' });
        expect(reported.q).toBe(0.5);
    });
});
