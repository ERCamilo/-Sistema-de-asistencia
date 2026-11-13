import { filterPayrollRowsByLeader, normalizeLeaderHoursScope } from '../modules/features/payroll/PayrollPreview.js';
import { payrollWorkedDays } from '../modules/features/payroll/PayrollWorkDays.js';
import { buildSplitXExport } from '../modules/features/payroll/PayrollSplitXExport.js';
import { renderPayrollReviewTable } from '../modules/features/payroll/PayrollReviewTable.js';
import { getPayrollReviewExclusions, payrollReviewExclusionKey, filterPayrollReviewEmployees } from '../modules/features/payroll/PayrollReviewEmployees.js';

const positions = [{ id: 'p1', leaderId: 'A' }, { id: 'p2', leaderId: 'B' }];
const employees = [{ id: 'e', positions: ['p1', 'p2'] }];
const options = { positions, employees };
const part = (positionId, hours, subtotal, extra = {}) => ({ positionId, positionName: positionId, regularHours: hours, overtimeHours: 0, holidayHours: 0, restDayHours: 0, hourlyRate: 100, subtotal, ...extra });
const row = parts => ({ _employeeId: 'e', _employeeName: 'Juan', _number: '113', _brutoOriginal: 1200, _bruto: 1200, monto: 1200, _loans: 0, _bonuses: 0, _deductions: 0, _positionBreakdown: parts });

test('En nómina is the default and partitions legacy salaries instead of including the full employee twice', () => {
    const rows = [row([part('p1', 8, 800), part('p2', 4, 400)])];
    const before = JSON.stringify(rows);
    const a = filterPayrollRowsByLeader(rows, { ...options, leaderId: 'A' });
    const b = filterPayrollRowsByLeader(rows, { ...options, leaderId: 'B' });
    expect(normalizeLeaderHoursScope()).toBe('payroll');
    expect(normalizeLeaderHoursScope('unknown')).toBe('payroll');
    expect(a[0]).toMatchObject({ monto: 800, _totalHours: 8 });
    expect(b[0]).toMatchObject({ monto: 400, _totalHours: 4 });
    expect(a[0].monto + b[0].monto).toBe(rows[0].monto);
    expect(JSON.stringify(rows)).toBe(before);
});

test('captured payer wins over the catalogue and the current assignment', () => {
    const rows = [row([part('p2', 12, 1200, { assignmentSchemaVersion: 1, isLoanPosition: true, workLeaderId: 'B', payerLeaderId: 'A' })])];
    const changed = [{ ...employees[0], positionAssignments: { p2: { workLeaderId: 'B', payerLeaderId: 'B', isLoanPosition: false } } }];
    expect(filterPayrollRowsByLeader(rows, { ...options, employees: changed, leaderId: 'A' })[0].monto).toBe(1200);
    expect(filterPayrollRowsByLeader(rows, { ...options, employees: changed, leaderId: 'B' })).toEqual([]);
});

test('a fixed-only payment without worked parts goes to one payer', () => {
    const rows = [{ ...row([]), _personalAdjustmentPayerId: 'B' }];
    expect(filterPayrollRowsByLeader(rows, { ...options, leaderId: 'A' })).toEqual([]);
    expect(filterPayrollRowsByLeader(rows, { ...options, leaderId: 'B' })).toEqual(rows);
    delete rows[0]._personalAdjustmentPayerId;
    expect(filterPayrollRowsByLeader(rows, { ...options, leaderId: 'A' })).toEqual(rows);
    expect(filterPayrollRowsByLeader(rows, { ...options, leaderId: 'B' })).toEqual([]);
});

test('worked days preserve fractions and exclude overtime and holiday payment multipliers', () => {
    const source = row([part('p1', 4, 400, { overtimeHours: 2, holidayHours: 8, restDayHours: 4 })]);
    expect(payrollWorkedDays(source, 8)).toBe(2);
    expect(payrollWorkedDays(source, 4)).toBe(4);
    expect(payrollWorkedDays({ _totalHours: 6, _overtimeHours: 2 }, 8)).toBe(0.5);
    expect(() => payrollWorkedDays(source, 0)).toThrow();
    const result = buildSplitXExport([source], { period: { start: '2026-03-01', end: '2026-03-15' }, regularHoursPerDay: 8, ...options });
    expect(result.employees[0].workDays).toMatchObject({ worked: 2, overtime: 0.25, total: 2.25 });
});

test('manual exclusions never cross projects, periods or leaders', () => {
    const scope = { projectId: 'P', leaderId: 'A', period: { periodStart: '2026-03-01', periodEnd: '2026-03-15' }, employees };
    const config = { [payrollReviewExclusionKey(scope)]: ['e', 'e', 'foreign'] };
    expect(getPayrollReviewExclusions(config, scope)).toEqual(['e']);
    expect(getPayrollReviewExclusions(config, { ...scope, leaderId: 'B' })).toEqual([]);
    expect(getPayrollReviewExclusions(config, { ...scope, projectId: 'OTHER' })).toEqual([]);
    expect(getPayrollReviewExclusions(config, { ...scope, period: { ...scope.period, periodEnd: '2026-03-16' } })).toEqual([]);
    expect(filterPayrollReviewEmployees([row([])], { enabled: false, ids: [], excludedIds: ['e'] })).toEqual([]);
});

test('excluded staff remain available to restore while totals use included staff only', () => {
    const source = row([part('p1', 4, 400)]);
    const host = document.createElement('div');
    host.innerHTML = renderPayrollReviewTable({ rows: [], displayRows: [source], sourceRows: [source], allowEmployeeExclusion: true, excludedIds: ['e'] });
    expect(host.querySelector('[data-payroll-action="toggle-payroll-review-employee"]').checked).toBe(false);
    expect(host.querySelector('.is-payroll-excluded').textContent).toContain('Excluido de esta nómina');
    expect(host.querySelector('[data-payroll-total-days]').textContent).toBe('0');
    expect(host.querySelector('tfoot').textContent).toContain('0 empleados');
    expect(host.querySelector('tfoot .is-net').textContent).toBe('$0.00');
    expect(host.querySelector('[data-payroll-worked-days]').textContent).toBe('0.5');
});
