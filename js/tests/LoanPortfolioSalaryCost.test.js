import { state, stateManager } from '../modules/core/AppState.js';
import * as earnings from '../modules/features/attendance/AttendanceDetailEarnings.js';
import { buildPortfolioModel } from '../modules/features/loans/LoanPortfolioView.js';
import { buildPayPeriods } from '../modules/features/loans/LoanPayPeriods.js';
import { getActivePayrollSettings, setActivePayrollConfig, resetActivePayrollSettingsForTests } from '../modules/features/payroll/ActivePayrollSettings.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';

const today = '2026-10-22';
const period = { periodStart: '2026-10-02', periodLength: 21, payDay: '2026-10-24' };
const attendance = (employeeId, date, extra = {}) => ({ employeeId, date, present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p', projectId: 'A', ...extra });
let previous;
beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(today + 'T12:00:00'));
    previous = Object.fromEntries(['employees', 'positions', 'leaders', 'settings', 'attendance'].map(key => [key, stateManager.getState()[key]]));
    setProjectsEnabled(false); resetActivePayrollSettingsForTests();
    stateManager.setState({
        employees: [{ id: 'salary-e', name: 'Ana', active: true, projectId: 'A', positions: ['p'],
            loans: [{ id: 'salary-l', number: 1, principal: 50000, interestRate: 0, startDate: '2026-08-01', dueDate: '2026-09-01', status: 'active', payments: [], refinancings: [] }] },
            { id: 'other', name: 'Otra obra', projectId: 'B', loans: [], positions: ['p'] }],
        positions: [{ id: 'p', name: 'Albañil', hourlyRate: 100, workingDays: [0, 1, 2, 3, 4, 5, 6], projectId: 'A' }], leaders: [],
        attendance: { 'salary-e-2026-10-22': attendance('salary-e', today, { overtimeHours: 2 }),
            'salary-e-2026-09-20': attendance('salary-e', '2026-09-20'),
            'salary-e-2026-08-30': attendance('salary-e', '2026-08-30'),
            'salary-e-2024-01-01': attendance('salary-e', '2024-01-01'),
            'salary-e-2026-10-23': attendance('salary-e', '2026-10-23'),
            'other-2026-10-22': attendance('other', today, { projectId: 'B' }) },
        settings: { ...previous.settings, payPeriod: period, regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [] }
    }, { silent: true });
});
afterEach(() => {
    jest.restoreAllMocks(); jest.useRealTimers();
    stateManager.setState(previous, { silent: true }); setProjectsEnabled(false); resetEntityScope(); resetActivePayrollSettingsForTests();
});
const scoped = () => stateManager.getState().employees.filter(emp => emp.projectId === 'A');
const model = () => buildPortfolioModel(scoped());
function expectedRecent() {
    const config = getActivePayrollSettings(state);
    const periods = buildPayPeriods(config.payPeriod, today, { before: 3, after: 1 });
    const current = periods.findIndex(p => p.start <= today && today <= p.end);
    return [0, 1, 2].map(offset => {
        const p = periods[current - offset];
        return earnings.computeAttendanceDetailEarnings(state, 'salary-e', p.start, offset ? p.end : today).gross;
    });
}
test.each([false, true])('riesgo conserva los importes de Nómina (obras activas: %s) y sólo copia el empleado y sus fechas', enabled => {
    stateManager.getState().positions.push({ id: 'p2', name: 'Ayudante', hourlyRate: 50, workingDays: [1], leaderId: 'leader', projectId: 'A' });
    stateManager.getState().leaders = [{ id: 'leader', restDayFactor: 1.75, projectId: 'A' }];
    stateManager.getState().employees[0].positionSalaries = { p2: 125 };
    stateManager.getState().attendance['salary-e-2026-10-22'].positionHours = [
        { positionId: 'p', hours: 4, overtimeHours: 2 }, { positionId: 'p2', hours: 4, overtimeHours: 1 }
    ];
    stateManager.getState().settings.holidays = ['2026-09-20'];
    setProjectsEnabled(enabled); replaceEntityScope({ enabled, projectId: 'A', defaultProjectId: 'A' });
    if (enabled) setActivePayrollConfig({ ...stateManager.getState().settings, projectId: 'A' }, { render: false });
    const expected = expectedRecent();
    const spy = jest.spyOn(earnings, 'computeAttendanceDetailEarnings');
    const risk = model().risk[0];
    expect([risk.gCur, risk.g1, risk.g2]).toEqual(expected);
    expect(spy).toHaveBeenCalledTimes(3);
    for (const [input, employeeId, start, end] of spy.mock.calls) {
        expect(input.employees.map(emp => emp.id)).toEqual(['salary-e']);
        expect(Object.keys(input.attendance).every(key => key.startsWith(employeeId + '-') && key.slice(-10) >= start && key.slice(-10) <= end)).toBe(true);
        expect(input.attendance['salary-e-2024-01-01']).toBeUndefined();
        expect(input.attendance['other-2026-10-22']).toBeUndefined();
    }
});
test('una edición de asistencia en el mismo objeto actualiza riesgo y sueldo, sin necesitar un préstamo nuevo', () => {
    const before = model();
    stateManager.getState().attendance['salary-e-2026-10-22'].hoursWorked = 4;
    const after = model();
    expect(after).not.toBe(before);
    expect(after.risk[0].gCur).toBe(700);
    expect(after.risk[0].gCur).not.toBe(before.risk[0].gCur);
});
test('actualiza los sueldos al editar tarifas y factores o cambiar la configuración de la obra', () => {
    model();
    stateManager.getState().positions[0].hourlyRate = 200;
    expect(model().risk[0].gCur).toBe(2200);
    stateManager.getState().settings.overtimeFactor = 2;
    expect(model().risk[0].gCur).toBe(2400);
    setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
    setActivePayrollConfig({ ...stateManager.getState().settings, projectId: 'A', holidays: [today] }, { render: false });
    expect(model().risk[0].gCur).toBe(expectedRecent()[0]);
});
test('reutiliza el modelo si sólo cambia asistencia histórica o de otro empleado', () => {
    const before = model();
    stateManager.getState().attendance['salary-e-2024-01-01'].hoursWorked = 4;
    stateManager.getState().attendance['other-2026-10-22'].hoursWorked = 4;
    expect(model()).toBe(before);
    delete stateManager.getState().attendance['salary-e-2026-10-22'];
    expect(model().risk[0].gCur).toBe(0);
});

test('cambiar de obra o el origen de una asistencia no reutiliza el sueldo de otra obra', () => {
    setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
    setActivePayrollConfig({ ...stateManager.getState().settings, projectId: 'A' }, { render: false });
    expect(model().risk[0].gCur).toBe(1100);
    stateManager.getState().attendance['salary-e-2026-10-22'].projectId = 'B';
    expect(model().risk[0].gCur).toBe(0);
    replaceEntityScope({ enabled: true, projectId: 'B', defaultProjectId: 'A' });
    setActivePayrollConfig({ ...stateManager.getState().settings, projectId: 'B' }, { render: false });
    expect(model().risk[0].gCur).toBe(0);
});
