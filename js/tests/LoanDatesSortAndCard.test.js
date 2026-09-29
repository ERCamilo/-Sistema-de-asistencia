/**
 * Préstamos: además de la última actualización, se puede ordenar por la fecha
 * del último préstamo/refinanciamiento y por el último pago; la tarjeta
 * muestra las tres fechas.
 */
import {
    getLoanAssignedDate,
    getLoanLastPaymentDate,
    summarizeLoanDates,
    sortEmployeeLoans,
    getEmployeesWithDebt,
    getIndividualLoanRecords,
    LOAN_STATUS
} from '../modules/features/loans/LoansService.js';

const loan = (extra = {}) => ({ id: 'L', status: LOAN_STATUS.ACTIVE, principal: 1000, interestRate: 0, startDate: '2026-07-01', payments: [], refinancings: [], ...extra });

test('fecha del préstamo: inicio o último refinanciamiento vigente', () => {
    expect(getLoanAssignedDate(loan())).toBe('2026-07-01');
    expect(getLoanAssignedDate(loan({ refinancings: [{ date: '2026-08-15' }, { date: '2026-09-20', voided: true }] }))).toBe('2026-08-15');
    // La edición (updatedAt) no cuenta como fecha del préstamo.
    expect(getLoanAssignedDate(loan({ updatedAt: Date.parse('2026-09-29') }))).toBe('2026-07-01');
});

test('último pago: el abono vigente más reciente', () => {
    expect(getLoanLastPaymentDate(loan())).toBeNull();
    expect(getLoanLastPaymentDate(loan({ payments: [
        { id: 'a', amount: 10, date: '2026-07-10' },
        { id: 'b', amount: 10, date: '2026-09-01', voided: true },
        { id: 'c', amount: 10, date: '2026-08-05' }
    ] }))).toBe('2026-08-05');
});

test('los resúmenes por empleado y por préstamo traen las tres fechas', () => {
    const state = { employees: [{ id: 'e1', name: 'Ana', number: '1', loans: [
        loan({ id: 'L1', startDate: '2026-06-01', payments: [{ id: 'p', amount: 100, date: '2026-09-02' }] }),
        loan({ id: 'L2', startDate: '2026-08-10' })
    ] }] };
    expect(getEmployeesWithDebt(state)[0]).toMatchObject({ lastAssignedDate: '2026-08-10', lastPaymentDate: '2026-09-02' });
    const records = getIndividualLoanRecords(state, 'active');
    expect(records.find(r => r.loanId === 'L2')).toMatchObject({ lastAssignedDate: '2026-08-10', lastPaymentDate: null });
    expect(summarizeLoanDates([]).lastPaymentDate).toBeNull();
});

test('ordena por préstamo y por pago; sin fecha siempre al final', () => {
    const rows = [
        { employeeId: 'a', lastAssignedDate: '2026-05-01', lastPaymentDate: null, lastLoanDate: '2026-09-29' },
        { employeeId: 'b', lastAssignedDate: '2026-09-01', lastPaymentDate: '2026-06-01', lastLoanDate: '2026-09-01' },
        { employeeId: 'c', lastAssignedDate: '2026-07-01', lastPaymentDate: '2026-09-15', lastLoanDate: '2026-09-15' }
    ];
    expect(sortEmployeeLoans(rows, 'assigned', 'desc').map(r => r.employeeId)).toEqual(['b', 'c', 'a']);
    expect(sortEmployeeLoans(rows, 'assigned', 'asc').map(r => r.employeeId)).toEqual(['a', 'c', 'b']);
    expect(sortEmployeeLoans(rows, 'payment', 'desc').map(r => r.employeeId)).toEqual(['c', 'b', 'a']);
    expect(sortEmployeeLoans(rows, 'payment', 'asc').map(r => r.employeeId)).toEqual(['b', 'c', 'a']);
    expect(sortEmployeeLoans(rows, 'date', 'desc').map(r => r.employeeId)).toEqual(['a', 'c', 'b']);
});

test('la tarjeta y la barra de orden muestran préstamo, pago y actualizado', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../modules/features/loans/LoansLedger.js'), 'utf8');
    expect(src).toMatch(/key: 'assigned'[\s\S]*key: 'payment'[\s\S]*key: 'date'/);
    expect(src).toMatch(/LOAN_DATE_SORTS\.map\(option =>[\s\S]*setLoansSortBy/);
    expect((src.match(/\$\{loanDates\}/g) || []).length).toBe(2);
});
