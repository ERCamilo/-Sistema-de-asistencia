import { renderPayrollReviewTable } from '../modules/features/payroll/PayrollReviewTable.js';

const row = { _employeeId: 'e', _number: '001', _employeeName: 'Felipe Herrera', _brutoOriginal: 1000,
    _bonuses: 100, _deductions: 30, _loans: 200, monto: 870,
    _positionBreakdown: [{ positionId: 'p', positionName: 'Albañil', regularHours: 8, hourlyRate: 125, regularAmount: 1000, subtotal: 1000 }],
    _bonusDetails: [{ name: 'Bono', amount: 100 }], _deductionDetails: [{ name: 'Seguro', amount: 30 }],
    _loanDetails: [{ concept: 'Préstamo', selectedAmount: 200 }] };
const render = options => { const host = document.createElement('div'); host.innerHTML = renderPayrollReviewTable({ rows: [row], sourceRows: [row], ...options }); return host; };

test('net toggle replaces the breakdown column and keeps the row initials and amount distinct', () => {
    const host = render();
    expect([...host.querySelectorAll('thead th')].map(cell => cell.textContent)).not.toContain('DESGLOSE');
    const button = host.querySelector('[data-value="e|calculation"]');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('.payroll-review-net-value').textContent).toBe('$870.00');
    expect(host.querySelector('.payroll-review-table__initials').textContent).toBe('FH');
    expect(host.querySelector('[data-payroll-calculation-row]')).toBeNull();
});

test('calculation and loan cards can coexist and reconcile the displayed row without altering the source', () => {
    const before = JSON.stringify(row), host = render({ expanded: new Set(['e|calculation', 'e|loans']) });
    const detail = host.querySelector('[data-payroll-calculation-row="e"]');
    expect(detail.textContent).toContain('Ordinarios: 1 día ($1,000.00)');
    expect([...detail.querySelectorAll('.payroll-review-net-summary dd')].map(cell => cell.textContent))
        .toEqual(['$1,000.00', '+$100.00', '−$30.00', '−$200.00', '$870.00']);
    expect(host.querySelector('.payroll-review-detail__group.is-loan').textContent).toContain('Préstamo');
    expect(detail.querySelector('td').colSpan).toBe(host.querySelectorAll('thead th').length);
    expect(JSON.stringify(row)).toBe(before);
});

test('fixed payments without worked parts still expose their composition with aligned columns', () => {
    const fixed = { ...row, _positionBreakdown: [], _brutoOriginal: 0, _bonuses: 250, _deductions: 0, _loans: 0, monto: 250 };
    const host = render({ rows: [fixed], sourceRows: [fixed], expanded: new Set(['e|calculation']) });
    expect(host.querySelector('.payroll-review-net-summary').textContent).toContain('+$250.00');
    expect(host.querySelector('[data-payroll-calculation-row] td').colSpan).toBe(host.querySelectorAll('thead th').length);
    expect(host.querySelector('.payroll-review-net-value').textContent).toBe('$250.00');
});

test('names and job labels remain text inside the calculation and initials', () => {
    const untrusted = { ...row, _employeeName: '<img src=x onerror=alert(1)>', _positionBreakdown: [{ ...row._positionBreakdown[0], positionName: '<svg onload=alert(1)>' }] };
    const host = render({ rows: [untrusted], sourceRows: [untrusted], expanded: new Set(['e|calculation']) });
    expect(host.querySelector('img, svg[onload]')).toBeNull();
    expect(host.querySelector('.payroll-breakdown-details__item strong').textContent).toBe('<svg onload=alert(1)>');
});
