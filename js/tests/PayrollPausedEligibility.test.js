import { getPayrollEmployeesForPeriod, getPayrollEmployeesForPeriodWithContext } from 'actual/features/payroll/PayrollPeriod.js';
import { PayrollService, calculateEmployeePayrollWithContext } from 'actual/features/payroll/PayrollService.js';
import { createPayrollProjectContext } from 'actual/features/payroll/PayrollProjectContext.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';

const START = '2026-07-01', END = '2026-07-15';
const attendance = (id, date, extra = {}) => ({ employeeId: id, projectId: 'P', date, present: true, hoursWorked: 8, selectedPosition: 'p', ...extra });
function scenario() {
    return {
        employees: ['first', 'last', 'outside', 'absent', 'deleted', 'adjusted'].map((id, index) => ({
            id, number: String(index + 1), projectId: 'P', name: id, active: false, positions: ['p']
        })),
        positions: [{ id: 'p', projectId: 'P', name: 'Ayudante', leaderId: 'L1', hourlyRate: 100, workingDays: [0, 1, 2, 3, 4, 5, 6] }],
        leaders: [{ id: 'L1', projectId: 'P', name: 'Luis' }],
        settings: { regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [] },
        exportConfig: { leaderFilter: 'all', bonuses: [{ id: 'bonus', scope: 'employee', targetIds: ['adjusted'], type: 'fixed', value: 100 }], deductions: [] },
        attendance: {
            [`first-${START}`]: attendance('first', START, { hoursWorked: 4 }),
            [`last-${END}`]: attendance('last', END),
            'outside-2026-06-30': attendance('outside', '2026-06-30'),
            'outside-2026-07-16': attendance('outside', '2026-07-16'),
            'absent-2026-07-05': attendance('absent', '2026-07-05', { present: false }),
            'deleted-2026-07-05': attendance('deleted', '2026-07-05', { deletedAt: 123 })
        }
    };
}
const context = state => createPayrollProjectContext({ state, scope: { enabled: true, projectId: 'P', defaultProjectId: 'P' } });
beforeEach(() => setProjectsEnabled(false));
afterEach(() => setProjectsEnabled(false));

test.each(['legacy', 'scoped'])('%s includes paused staff at both period boundaries, preserves individual adjustments and ignores absent/deleted/outside work', mode => {
    const state = scenario(), before = JSON.stringify(state);
    setProjectsEnabled(mode === 'scoped');
    const selected = mode === 'scoped' ? getPayrollEmployeesForPeriodWithContext(context(state), START, END)
        : getPayrollEmployeesForPeriod(state, START, END);
    expect(selected.map(employee => employee.id)).toEqual(['first', 'last', 'adjusted']);
    expect(selected.every(employee => employee.active === false)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
});

test('scoped eligibility never borrows work or paused staff from another project', () => {
    const state = scenario(); setProjectsEnabled(true);
    state.employees.push({ id: 'foreign', number: '99', projectId: 'Q', active: false, positions: ['p'] });
    state.attendance['foreign-2026-07-02'] = attendance('foreign', '2026-07-02', { projectId: 'Q' });
    state.attendance['outside-2026-07-02'] = attendance('outside', '2026-07-02', { projectId: 'Q' });
    expect(getPayrollEmployeesForPeriodWithContext(context(state), START, END).map(employee => employee.id))
        .toEqual(['first', 'last', 'adjusted']);
});

test.each([['legacy', false], ['scoped', false], ['legacy', true], ['scoped', true]])('%s pays only valid work when an employee also has a deleted attendance record (active=%s)', (mode, active) => {
    const state = scenario(); setProjectsEnabled(mode === 'scoped');
    state.employees[0].active = active;
    state.attendance['first-2026-07-02'] = attendance('first', '2026-07-02', { deletedAt: 123 });
    const before = JSON.stringify(state);
    const payroll = mode === 'scoped'
        ? calculateEmployeePayrollWithContext(context(state), state.settings, 'first', START, END, [], [], [], [])
        : new PayrollService(state).calculateEmployeePayroll('first', START, END, [], [], [], []);
    expect(payroll.brutoOriginal).toBe(400);
    expect(payroll.neto).toBe(400);
    expect(payroll.breakdown[0].regularHours).toBe(4);
    expect(state.employees[0].active).toBe(active);
    expect(JSON.stringify(state)).toBe(before);
});
