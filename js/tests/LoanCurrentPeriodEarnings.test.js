import { state, stateManager } from '../modules/core/AppState.js';
import { LoanAccountDetail } from '../modules/features/loans/LoanAccountView.js';
import { PayrollService, calculateEmployeePayrollWithContext } from '../modules/features/payroll/PayrollService.js';
import { createPayrollProjectContext } from '../modules/features/payroll/PayrollProjectContext.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setActivePayrollConfig, resetActivePayrollSettingsForTests } from '../modules/features/payroll/ActivePayrollSettings.js';

const today = '2026-10-03';
const period = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
const record = (date, hours = 8, position = 'p1', extra = {}) => ({
    employeeId: 'e1', date, present: true, hoursWorked: hours, overtimeHours: 0,
    selectedPosition: position, ...extra
});
let previous;
beforeEach(() => {
    jest.useFakeTimers({ now: new Date(today+'T12:00:00'), doNotFake: ['setTimeout','clearTimeout','setInterval','clearInterval','nextTick','queueMicrotask'] });
    const raw = stateManager.getState();
    previous = Object.fromEntries(['employees','positions','attendance','settings','loansLedger'].map(key => [key,raw[key]]));
    setProjectsEnabled(false); resetActivePayrollSettingsForTests();
    stateManager.setState({
        employees: [{ id: 'e1', number: '1', name: 'Ana', active: true, positions: ['p1','p2'],
            positionSalaries: { p2: 250 }, loans: [], bonuses: [], deductions: [] }],
        positions: [{ id: 'p1', name: 'Ayudante', hourlyRate: 100, workingDays: [0,1,2,3,4,5,6] },
            { id: 'p2', name: 'Albañil', hourlyRate: 50, workingDays: [0,1,2,3,4,5,6] }],
        attendance: {
            'e1-2026-10-01': record('2026-10-01', 24),
            'e1-2026-10-02': record('2026-10-02'),
            'e1-2026-10-03': record('2026-10-03', 4, 'p2'),
            'e1-2026-10-04': record('2026-10-04', 24),
            'other-2026-10-03': { ...record('2026-10-03', 24), employeeId: 'other' }
        },
        settings: { ...previous.settings, regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2,
            restDayFactor: 1, holidays: [], defaultDeductionPercentage: 3, payPeriod: period },
        loansLedger: null
    });
});
afterEach(() => {
    jest.restoreAllMocks(); jest.useRealTimers();
    stateManager.setState(previous); resetEntityScope(); setProjectsEnabled(false); resetActivePayrollSettingsForTests();
    document.body.replaceChildren();
});
function draw() {
    document.body.innerHTML = LoanAccountDetail(state.employees[0]);
    return document.querySelector('[data-loan-earnings]');
}
function amount() { return document.querySelector('[data-loan-current-earned]').textContent; }

test('shows actual gross through today beside the full-period estimate, using the working period rather than the pending payday', () => {
    const expected = new PayrollService(state).calculateEmployeePayroll('e1','2026-10-02',today,[],[],[]);
    const card = draw();
    expect(card.textContent).toContain('Gana por periodo');
    expect(card.textContent).toContain('Ganado en el período actual');
    expect(card.textContent).toContain('02/10 – 22/10 · hasta 03/10');
    expect(card.textContent).toContain('Bruto por asistencia');
    expect(expected.brutoOriginal).toBe(1800); // 8h × 100 + half a day × 2000
    expect(amount()).toBe('$1,800.00');
    expect(document.querySelector('.la-hub__facts').textContent).toContain('pago 03/10');
});

test('includes overtime and holidays using Payroll, before deductions and bonuses', () => {
    stateManager.batchSetState(raw => {
        raw.attendance['e1-2026-10-02'].overtimeHours = 2;
        raw.settings.holidays = ['2026-10-02'];
        raw.employees[0].bonuses = [{ amount: 9999 }];
        raw.employees[0].deductions = [{ amount: 500 }];
    });
    const expected = new PayrollService(state).calculateEmployeePayroll('e1','2026-10-02',today,[],[],[]);
    draw();
    expect(amount()).toBe('$'+expected.brutoOriginal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
    expect(expected.brutoOriginal).toBeGreaterThan(1800);
});

test('inactive employees retain the earnings for attendance they already recorded', () => {
    stateManager.batchSetState(raw => { raw.employees[0].active = false; });
    draw(); expect(amount()).toBe('$1,800.00');
});

test('a period with no attendance shows zero, and a later attendance edit is reflected on redraw', () => {
    stateManager.setState({ attendance: {} });
    draw(); expect(amount()).toBe('$0.00');
    stateManager.batchSetState(raw => { raw.attendance['e1-2026-10-03'] = record(today); });
    draw(); expect(amount()).toBe('$800.00');
});

test('missing calendar and calculation errors are distinct from zero earnings', () => {
    stateManager.batchSetState(raw => { raw.settings.payPeriod = {}; });
    expect(draw().textContent).toContain('Configura el período en Ajustes');
    expect(amount()).toBe('—');
    stateManager.batchSetState(raw => { raw.settings.payPeriod = period; });
    jest.spyOn(PayrollService.prototype,'calculateEmployeePayroll').mockImplementationOnce(() => { throw new Error('Unavailable'); });
    expect(draw().textContent).toContain('Cálculo no disponible'); expect(amount()).toBe('—');
});

test('uses the active project calendar and attendance, excluding records from another project', () => {
    setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
    const config = { projectId: 'A', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [],
        payPeriod: { periodStart: '2026-10-03', periodLength: 7, payDay: '2026-10-10' } };
    setActivePayrollConfig(config,{render:false});
    stateManager.batchSetState(raw => {
        raw.employees[0].projectId = 'A'; raw.positions.forEach(p => { p.projectId = 'A'; });
        raw.attendance['e1-2026-10-02'].projectId = 'A';
        raw.attendance['e1-2026-10-03'].projectId = 'B';
    });
    draw(); expect(amount()).toBe('$0.00');
    stateManager.batchSetState(raw => { raw.attendance['e1-2026-10-03'].projectId = 'A'; });
    const ctx = createPayrollProjectContext({state});
    const expected = calculateEmployeePayrollWithContext(ctx,config,'e1',today,today,[],[],[],[]);
    const card = draw();
    expect(card.textContent).toContain('03/10 – 09/10 · hasta 03/10');
    expect(amount()).toBe('$1,000.00'); expect(expected.brutoOriginal).toBe(1000);
});


test('the accrued amount starts again when the next working period begins', () => {
    jest.setSystemTime(new Date('2026-10-23T12:00:00'));
    const card = draw();
    expect(card.textContent).toContain('23/10 – 12/11 · hasta 23/10');
    expect(amount()).toBe('$0.00');
});

test('deleted attendance does not count, and rendering does not change financial data', () => {
    stateManager.batchSetState(raw => { raw.attendance['e1-2026-10-03'].deletedAt = 123; });
    const before = JSON.stringify({ employees: state.employees, attendance: state.attendance });
    draw(); expect(amount()).toBe('$800.00');
    expect(JSON.stringify({ employees: state.employees, attendance: state.attendance })).toBe(before);
});
