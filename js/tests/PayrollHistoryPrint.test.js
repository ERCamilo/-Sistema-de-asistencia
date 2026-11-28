import { buildPayrollHistoryPrintDocument, printPayrollHistoryClosure } from '../modules/features/payroll/PayrollHistoryPrint.js';
import { renderPayrollHistoryDetail } from '../modules/features/payroll/PayrollHistoryUI.js';

const closure = () => ({
    id: 'cierre-prueba', status: 'closed', periodStart: '2026-11-01', periodEnd: '2026-11-15',
    closedAt: 1794787200000, closedBy: 'Operador de prueba',
    rows: [
        { employeeId: 'e2', employeeNumber: '010', employeeName: 'Leo Ejemplo', employeePosition: 'Ayudante',
            leaderRefs: [{ id: 'B', name: 'Marcos' }], gross: 500, bonuses: 0, deductions: 0, loans: 0, net: 500 },
        { employeeId: 'e1', employeeNumber: '002', employeeName: 'Ada Ejemplo', employeePosition: 'Electricista histórica',
            leaderRefs: [{ id: 'A', name: 'Luis' }], gross: 1000, bonuses: 50, deductions: 40, loans: 100, net: 901 }
    ]
});
const parse = html => new DOMParser().parseFromString(html, 'text/html');

afterEach(() => jest.restoreAllMocks());

test('prints historical rows in number order and preserves the recorded net instead of recalculating it', () => {
    const record = closure(), before = JSON.stringify(record);
    const doc = parse(buildPayrollHistoryPrintDocument(record));
    expect([...doc.querySelectorAll('tbody th')].map(node => node.textContent.replace(/\s+/g, ' ').trim())).toEqual(['#002 Ada Ejemplo', '#010 Leo Ejemplo']);
    expect([...doc.querySelectorAll('tbody .is-net')].map(node => node.textContent)).toEqual(['$901.00', '$500.00']);
    expect(doc.querySelector('.payroll-history-detail__totals .is-net strong').textContent).toBe('$1,401.00');
    expect(doc.body.textContent).toContain('Electricista histórica');
    expect(doc.querySelector('[data-payroll-action], select, fieldset')).toBeNull();
    expect(doc.body.textContent).not.toContain('Neto simulado');
    expect(JSON.stringify(record)).toBe(before);
});

test('respects the historical leader filter and never applies net simulations to the report', () => {
    const doc = parse(buildPayrollHistoryPrintDocument(closure(), { leaderId: 'A', includeLoans: false }));
    expect(doc.body.textContent).toContain('Líder histórico: Luis · 1 empleado');
    expect(doc.body.textContent).toContain('Ada Ejemplo');
    expect(doc.body.textContent).not.toContain('Leo Ejemplo');
    expect(doc.querySelector('tbody .is-net').textContent).toBe('$901.00');
    expect(doc.querySelector('tbody .is-loan').textContent).toBe('$100.00');
});

test('opens loan-position debits and prints negative leader balances separately from employee salaries', () => {
    const record = closure();
    record.leaderAdjustments = [{ key: 'debit-B', leaderId: 'B', leaderName: 'Marcos', enabled: true,
        subtotal: 500, amount: 900, balance: -400, entries: [{ employeeId: 'e1', employeeName: 'Ada Ejemplo',
            employeeNumber: '002', positionName: 'Electricista', payerLeaderName: 'Luis', regularHours: 8,
            hourlyRate: 112.5, regularAmount: 900, amount: 900 }] }];
    const doc = parse(buildPayrollHistoryPrintDocument(record, { leaderId: 'B' }));
    expect(doc.querySelector('.payroll-leader-adjustment details').open).toBe(true);
    expect(doc.querySelector('.payroll-leader-adjustment article').textContent).toContain('Ada Ejemplo');
    expect(doc.querySelector('.payroll-leader-adjustment__balance').textContent).toContain('−$400.00');
    expect(doc.querySelector('tbody .is-net').textContent).toBe('$500.00');
});

test('keeps annulments visible, escapes historical text and handles an empty leader selection', () => {
    const record = { ...closure(), status: 'voided', voidedAt: 1794787201000,
        closedBy: '<img src=x onerror=alert(1)>', id: '</p><script>alert(1)</script>' };
    record.rows[0].employeeName = '<svg onload=alert(1)>';
    const doc = parse(buildPayrollHistoryPrintDocument(record));
    expect(doc.querySelector('script, img, svg[onload]')).toBeNull();
    expect(doc.querySelector('.payroll-history-card__status').textContent).toBe('Anulada');
    expect(doc.body.textContent).toContain('<svg onload=alert(1)>');
    const empty = parse(buildPayrollHistoryPrintDocument(record, { leaderId: 'missing' }));
    expect(empty.querySelector('tbody td').colSpan).toBe(empty.querySelectorAll('thead th').length);
});

test('makes printing available in read-only history without enabling an undo action', () => {
    const doc = parse(renderPayrollHistoryDetail(closure(), { readOnly: true }));
    expect(doc.querySelector('[data-payroll-action="print-payroll-history-detail"]')).not.toBeNull();
    expect(doc.querySelector('[data-payroll-action="undo-payroll-closure"]')).toBeNull();
});

test('a blocked popup or missing detail fails without writing records', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    const record = closure(), before = JSON.stringify(record);
    expect(() => printPayrollHistoryClosure(null)).toThrow('cierre completo');
    expect(open).not.toHaveBeenCalled();
    expect(() => printPayrollHistoryClosure(record)).toThrow('navegador bloqueó');
    expect(JSON.stringify(record)).toBe(before);
});

test('prepares an independent printable document and leaves a retry button when automatic printing fails', () => {
    const doc = document.implementation.createHTMLDocument(''), frames = [];
    const report = { document: doc, opener: window, closed: false, focus: jest.fn(),
        print: jest.fn(), close: jest.fn(), requestAnimationFrame: callback => frames.push(callback) };
    jest.spyOn(window, 'open').mockReturnValue(report);
    const record = closure();
    expect(printPayrollHistoryClosure(record)).toBe(report);
    record.rows[0].employeeName = 'Nombre cambiado después';
    expect(report.opener).toBeNull();
    expect(doc.body.textContent).not.toContain('Nombre cambiado después');
    frames.shift()(); frames.shift()();
    expect(report.print).toHaveBeenCalledTimes(1);
    report.print.mockImplementationOnce(() => { throw new Error('unsupported'); });
    doc.querySelector('[data-print-history]').click();
    expect(doc.querySelector('.print-controls span').textContent).toContain('No se abrió la impresión automática');
    expect(report.close).not.toHaveBeenCalled();
});
