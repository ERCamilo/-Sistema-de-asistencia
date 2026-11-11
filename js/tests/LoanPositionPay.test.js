import { normalizeLoanPay, resolveWorkPayFactors } from '../modules/features/payroll/PayrollFactors.js';
import { prepareEmployeePositionAssignments, captureAttendancePositionAssignments } from '../modules/features/employees/EmployeePositionAssignments.js';
import { PayrollService, calculateEmployeePayrollWithContext } from '../modules/features/payroll/PayrollService.js';
import { buildEmployeeReportData } from '../modules/features/analytics/EmployeeReportData.js';
import { Position } from '../modules/features/employees/Position.js';
import { parseDate } from '../modules/utils/DateUtils.js';

// Decisión del usuario (2026-11-11): en el editor del puesto, «Avanzado» fija
// cómo se paga el día libre, el feriado y las horas extra cuando un empleado
// tiene ese puesto como préstamo de personal. Los demás no cambian.
const NOW = new Date('2026-11-02T09:00:00').getTime();
const MONDAY = '2026-11-09', SUNDAY = '2026-11-15';
function world(loanPay) {
    const state = {
        settings: { regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.5, holidays: [] }, exportConfig: {},
        leaders: [{ id: 'L1', name: 'Luis', restDayFactor: 3 }, { id: 'L2', name: 'Marcos' }, { id: 'L3', name: 'Ana', restDayFactor: 2 }],
        positions: [{ id: 'p', name: 'Ayudante', active: true, leaderId: 'L2', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6], ...(loanPay ? { loanPay } : {}) }],
        employees: [{ id: 'loan', number: '1', name: 'Juan', active: true, positions: ['p'] }, { id: 'own', number: '2', name: 'Rosa', active: true, positions: ['p'] },
            { id: 'plain', number: '3', name: 'Pedro', active: true, positions: ['p'] }], attendance: {}
    };
    // Juan: préstamo, trabaja para el equipo de Luis (3x) y paga Ana (2x). Rosa: líder individual Luis, sin préstamo.
    state.employees[0].positionAssignments = prepareEmployeePositionAssignments(state.employees[0], { p: { workLeaderId: 'L1', isLoanPosition: true, payerLeaderId: 'L3' } }, state, NOW);
    state.employees[1].positionAssignments = prepareEmployeePositionAssignments(state.employees[1], { p: { workLeaderId: 'L1' } }, state, NOW);
    return state;
}
function attend(state, date, extra = {}) {
    for (const employee of state.employees) state.attendance[`${employee.id}-${date}`] = captureAttendancePositionAssignments(
        { employeeId: employee.id, date, present: true, selectedPosition: 'p', hoursWorked: 8, overtimeHours: 0, ...extra }, state, NOW + 1000);
}
const legacy = (state, id, date) => new PayrollService(state).calculateEmployeePayroll(id, date, date, [], [], []).brutoOriginal;
const scoped = (state, id, date) => calculateEmployeePayrollWithContext(
    { ...state, projectId: 'obra', getAttendance: (employee, day) => state.attendance[`${employee}-${day}`] },
    { projectId: 'obra', regularHoursPerDay: 8, overtimeFactor: state.settings.overtimeFactor, holidayFactor: state.settings.holidayFactor, holidays: state.settings.holidays },
    id, date, date, [], [], [], []).brutoOriginal;
const paths = [['legacy', legacy], ['scoped', scoped]];
const paid = (pay, state, date) => Object.fromEntries(state.employees.map(employee => [employee.name, pay(state, employee.id, date)]));

describe('normalizing the advanced loan settings of a job', () => {
    test('nothing chosen means no setting is stored', () => {
        for (const value of [undefined, null, {}, { restDay: { source: 'team' }, holiday: { source: 'general' }, overtime: { source: 'general' } }]) {
            expect(normalizeLoanPay(value)).toBeNull();
        }
    });

    test('only valid sources and factors between 1 and 5 are kept', () => {
        expect(normalizeLoanPay({ restDay: { source: 'payer' }, holiday: { source: 'custom', factor: '2.5' }, overtime: { source: 'custom', factor: 9 } }))
            .toEqual({ restDay: { source: 'payer' }, holiday: { source: 'custom', factor: 2.5 } });
        expect(normalizeLoanPay({ restDay: { source: 'custom', factor: 'abc' }, holiday: { source: 'payer' } })).toBeNull();
        expect(normalizeLoanPay({ restDay: { source: 'custom', factor: 1 } })).toEqual({ restDay: { source: 'custom', factor: 1 } });
    });

    test('the setting survives loading and saving the job', () => {
        const loanPay = { restDay: { source: 'custom', factor: 2.5 }, overtime: { source: 'custom', factor: 2 } };
        const position = new Position({ id: 'p', name: 'Ayudante', loanPay });
        expect(position.loanPay).toEqual(loanPay);
        expect(Position.fromJSON(position.toJSON()).loanPay).toEqual(loanPay);
        expect('loanPay' in new Position({ id: 'q', name: 'Otro' }).toJSON()).toBe(false);
    });
});

describe('rest day of a loan position', () => {
    test.each(paths)('without advanced settings it pays what the team leader pays, as before (%s)', (_name, pay) => {
        const state = world(); attend(state, SUNDAY);
        expect(paid(pay, state, SUNDAY)).toEqual({ Juan: 2400, Rosa: 2400, Pedro: 1200 });
    });

    test.each(paths)('"the leader who pays" uses the payer factor, only for the loan (%s)', (_name, pay) => {
        const state = world({ restDay: { source: 'payer' } }); attend(state, SUNDAY);
        expect(paid(pay, state, SUNDAY)).toEqual({ Juan: 1600, Rosa: 2400, Pedro: 1200 });
    });

    test.each(paths)('an own factor applies only to the loan (%s)', (_name, pay) => {
        const state = world({ restDay: { source: 'custom', factor: 2.5 } }); attend(state, SUNDAY);
        expect(paid(pay, state, SUNDAY)).toEqual({ Juan: 2000, Rosa: 2400, Pedro: 1200 });
    });

    test.each(paths)('a payer without his own factor falls back to the job and then the general one (%s)', (_name, pay) => {
        const state = world({ restDay: { source: 'payer' } });
        state.leaders[2].restDayFactor = null; attend(state, SUNDAY);
        expect(pay(state, 'loan', SUNDAY)).toBe(1200);
        state.positions[0].restDayFactor = 4;
        expect(pay(state, 'loan', SUNDAY)).toBe(3200);
    });
});

describe('holiday and overtime of a loan position', () => {
    test.each(paths)('own factors apply to the loan and nobody else (%s)', (_name, pay) => {
        const state = world({ holiday: { source: 'custom', factor: 3 }, overtime: { source: 'custom', factor: 2 } });
        attend(state, MONDAY, { isHoliday: true });
        expect(paid(pay, state, MONDAY)).toEqual({ Juan: 2400, Rosa: 1600, Pedro: 1600 });
        attend(state, '2026-11-10', { overtimeHours: 2 });
        expect(paid(pay, state, '2026-11-10')).toEqual({ Juan: 800 + 2 * 100 * 2, Rosa: 800 + 2 * 100 * 1.5, Pedro: 800 + 2 * 100 * 1.5 });
    });

    test.each(paths)('the setting follows the open period: changing it reaches days already recorded (%s)', (_name, pay) => {
        const state = world(); attend(state, MONDAY, { isHoliday: true });
        expect(pay(state, 'loan', MONDAY)).toBe(1600);
        state.positions[0].loanPay = { holiday: { source: 'custom', factor: 3 } };
        expect(pay(state, 'loan', MONDAY)).toBe(2400);
    });
});

test('the worked-days report values loan days exactly as payroll pays them', () => {
    const state = world({ restDay: { source: 'payer' }, holiday: { source: 'custom', factor: 3 } });
    attend(state, SUNDAY); attend(state, MONDAY, { isHoliday: true });
    for (const date of [SUNDAY, MONDAY]) {
        const report = buildEmployeeReportData({ employees: state.employees, positions: state.positions, attendance: state.attendance,
            days: [{ date: parseDate(date), isHoliday: false }], startDate: date, endDate: date, regularHours: 8,
            holidayFactor: state.settings.holidayFactor, leaders: state.leaders, settings: state.settings, restDayFactor: state.settings.restDayFactor });
        const reported = Object.fromEntries(report.positions.flatMap(group => group.employees.map(employee => [employee.name, employee.total])));
        expect(reported).toEqual(Object.fromEntries(Object.entries(paid(scoped, state, date)).map(([name, amount]) => [name, amount / 800])));
    }
});

test('one function gives the three factors, so payroll, report and attendance card cannot disagree', () => {
    const state = world({ restDay: { source: 'payer' }, overtime: { source: 'custom', factor: 2 } });
    const loanTerms = { workLeaderId: 'L1', payerLeaderId: 'L3', isLoanPosition: true };
    const base = { overtimeFactor: 1.5, holidayFactor: 2 };
    expect(resolveWorkPayFactors(state.positions[0], loanTerms, state.leaders, state.settings, base)).toEqual({ restDayFactor: 2, holidayFactor: 2, overtimeFactor: 2 });
    expect(resolveWorkPayFactors(state.positions[0], { ...loanTerms, isLoanPosition: false }, state.leaders, state.settings, base)).toEqual({ restDayFactor: 3, holidayFactor: 2, overtimeFactor: 1.5 });
    expect(resolveWorkPayFactors(state.positions[0], null, state.leaders, state.settings, base)).toEqual({ restDayFactor: 1.5, holidayFactor: 2, overtimeFactor: 1.5 });
});
