import { buildSplitXExport } from '../modules/features/payroll/PayrollSplitXExport.js';
import { renderPayrollReviewTable } from '../modules/features/payroll/PayrollReviewTable.js';
import { payrollExportMoney } from '../modules/features/payroll/PayrollExportMoney.js';
import { formatCurrency } from '../modules/utils/Formatters.js';

const options = { period: { start: '2026-11-01', end: '2026-11-15' }, regularHoursPerDay: 8, employees: [] };
function row(value, id = 'e') {
    return { id: 1, nombre: id, _employeeId: id, _employeeName: id, monto: value, _brutoOriginal: value,
        _bonuses: 0, _deductions: 0, _loans: 0, _positionBreakdown: [], _loanDetails: [] };
}

test.each([[577.125, 577.13], [1051.875, 1051.88], [0.123456789, 0.12], [1.005, 1], [0, 0]])('exports %s as %s cents-compatible money and retains the exact original', (original, expected) => {
    const source = row(original), before = JSON.stringify(source);
    const result = buildSplitXExport([source], options);
    expect(result.employees[0]).toMatchObject({ monto: expected, bruto: expected });
    expect(result.context.totals.net).toBe(expected);
    expect(formatCurrency(result.employees[0].monto)).toBe(formatCurrency(original));
    if (expected !== original) {
        expect(result.employees[0].originalAmounts).toMatchObject({ monto: original, bruto: original });
        expect(result.context.monetaryPrecision).toMatchObject({ decimals: 2, policy: 'same-as-sa-display', affectedEmployees: 1, originalTotals: { net: original } });
    } else expect(result.employees[0].originalAmounts).toBeUndefined();
    expect(JSON.stringify(source)).toBe(before);
});

test('totals add payable cents per employee and expose a difference from rounding the raw aggregate', () => {
    const rows = [row(577.125, 'one'), row(577.125, 'two')];
    const result = buildSplitXExport(rows, options);
    expect(result.employees.map(employee => employee.monto)).toEqual([577.13, 577.13]);
    expect(result.context.totals.net).toBe(1154.26);
    expect(result.context.monetaryPrecision.originalTotals.net).toBe(1154.25);
    const host = document.createElement('div'); host.innerHTML = renderPayrollReviewTable({ rows });
    expect(host.querySelector('[data-payroll-cash-rounding]').textContent).toContain('Total para SplitX: $1,154.26');
    expect(host.querySelector('[data-payroll-cash-rounding]').textContent).toContain('$0.01');
    host.innerHTML = renderPayrollReviewTable({ rows: [rows[0]], displayRows: rows, excludedIds: ['two'] });
    expect(host.querySelector('[data-payroll-cash-rounding]')).toBeNull();
});

test('all compatibility monetary fields and nested loan details use cents, without changing source payroll', () => {
    const source = { ...row(597.375), _brutoOriginal: 577.125, _bonuses: 20.375, _deductions: 0.125, _loans: 0 };
    const before = JSON.stringify(source), exported = buildSplitXExport([source], options).employees[0];
    for (const key of ['monto', 'bruto', 'bonificaciones', 'descuentos', 'prestamos', 'prestamoCapital', 'prestamoInteres', 'saldoPendiente']) {
        expect(Math.abs(exported[key] * 100 - Math.round(exported[key] * 100))).toBeLessThan(1e-6);
    }
    expect(Object.values(exported.loanDetails).every(value => Number.isFinite(value))).toBe(true);
    expect(exported.originalAmounts).toMatchObject({ bruto: 577.125, bonificaciones: 20.375, descuentos: 0.125 });
    expect(JSON.stringify(source)).toBe(before);
});

test.each([NaN, Infinity, 'importe ambiguo'])('rejects invalid source amount %s before it can turn into a fake zero', value => {
    expect(() => buildSplitXExport([row(value)], options)).toThrow(/importe|cantidad/i);
});

test('a negative payment is rejected before rounding could hide it as zero', () => {
    expect(() => buildSplitXExport([row(-0.001)], options)).toThrow(/negativo/);
    expect(() => payrollExportMoney(Number.MAX_VALUE)).toThrow(/precisión/);
});
