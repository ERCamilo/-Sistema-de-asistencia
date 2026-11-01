import { buildSplitXExport } from '../modules/features/payroll/PayrollSplitXExport.js';
import { toSplitXRows, buildPayrollLoanSelection, setPayrollLoanMode, setEmployeePayrollLoans, applyPayrollLoanDeductions } from '../modules/features/payroll/PayrollLoans.js';
import { applyPayrollPreviewInclusion } from '../modules/features/payroll/PayrollPreview.js';
import { applyRegistrationLoans } from '../modules/features/payroll/PayrollRegistration.js';
import { createLoan, recordPayment, getBalance } from '../modules/features/loans/LoansService.js';

const END = '2026-10-15';
const employee = () => ({ id: 'e1', number: '001', name: 'Empleado de ejemplo', positions: ['p1'], loans: [] });
const baseRow = () => ({ id: 1, nombre: 'Empleado de ejemplo (Ref #001)', _employeeId: 'e1', _employeeName: 'Empleado de ejemplo', _number: '001', monto: 10000, _brutoOriginal: 10000, _loans: 0 });
const options = emp => ({ period: { start: '2026-10-01', end: END }, regularHoursPerDay: 8, currency: 'DOP', employees: [emp], positions: [{ id: 'p1', name: 'Albañil', hourlyRate: 999 }], leaders: [] });
const exported = (rows, emp) => buildSplitXExport(rows, options(emp)).employees[0];

function withLoans() {
    const emp = employee();
    const a = createLoan(emp, { principal: 10000, interestRate: 20, startDate: '2026-08-25', concept: 'Préstamo antiguo' });
    recordPayment(emp, a.id, { amount: 6600, date: '2026-09-12', recordedAt: 10 });
    createLoan(emp, { principal: 3000, interestRate: 20, startDate: '2026-09-14', concept: 'Préstamo reciente' });
    return emp;
}

describe('SplitX: tarifa diaria aplicada por puesto', () => {
    test('usa la tarifa aplicada y la jornada, sin deducirla del neto ni del catálogo actual', () => {
        const emp = employee();
        const source = { ...baseRow(), _positionBreakdown: [{ positionId: 'p1', positionName: 'Puesto histórico', hourlyRate: 150, regularHours: 4 }] };
        const before = JSON.stringify({ source, emp });
        expect(exported([source], emp).positions[0]).toMatchObject({ name: 'Puesto histórico', dailyRate: 1200, workDays: { total: 0.5 } });
        expect(buildSplitXExport([source], { ...options(emp), regularHoursPerDay: 6 }).employees[0].positions[0].dailyRate).toBe(900);
        expect(JSON.stringify({ source, emp })).toBe(before);
    });

    test('dos medias jornadas conservan sus distintas tarifas individuales', () => {
        const source = { ...baseRow(), _positionBreakdown: [
            { positionId: 'p1', hourlyRate: 112.5, regularHours: 4 },
            { positionId: 'p2', positionName: 'Albañil', hourlyRate: 150, regularHours: 4 }
        ] };
        const result = exported([source], employee());
        expect(result.positions.map(p => [p.dailyRate, p.workDays.total])).toEqual([[900, 0.5], [1200, 0.5]]);
        expect(result.workDays.total).toBe(1);
    });

    test('sin tarifa aplicada no inventa una tarifa desde la asignación actual', () => {
        expect(exported([baseRow()], employee()).positions[0].dailyRate).toBeNull();
        const source = { ...baseRow(), _positionBreakdown: [{ positionId: 'p1', regularHours: 4 }] };
        expect(exported([source], employee()).positions[0].dailyRate).toBeNull();
        source._positionBreakdown = [{ positionId: 'p1', hourlyRate: 100 }, { positionId: 'p1', hourlyRate: 150 }];
        expect(exported([source], employee()).positions[0].dailyRate).toBeNull();
    });
});

describe('SplitX: abonos, deuda y proyección sin registrar pagos', () => {
    test('un abono de 500 sobre deuda de 3000 deja 2500 proyectados y conserva la deuda no seleccionada aparte', () => {
        const emp = employee();
        const loan = createLoan(emp, { principal: 3000, interestRate: 0, startDate: '2026-10-01', concept: 'Adelanto de ejemplo' });
        createLoan(emp, { principal: 2000, interestRate: 0, startDate: '2026-10-01', concept: 'Otro préstamo no marcado' });
        const selected = setEmployeePayrollLoans([], emp.id, [{ loanId: loan.id, chargeCount: 1 }]);
        const selection = setPayrollLoanMode(selected, emp.id, 'custom', 500);
        const rows = applyPayrollLoanDeductions([baseRow()], [emp], selection, END);
        const before = JSON.stringify({ emp, rows });
        const result = exported(rows, emp);
        expect(result).toMatchObject(toSplitXRows(rows)[0]);
        expect(result.monto).toBe(9500);
        expect(result.loanBreakdown).toEqual([expect.objectContaining({ loanId: loan.id, concept: 'Adelanto de ejemplo', status: 'proposed', balanceBefore: 3000, deductionAmount: 500, principalAmount: 500, interestAmount: 0, projectedBalanceAfter: 2500 })]);
        expect(result.loanSummary).toMatchObject({ scope: 'selected-loans', balanceBefore: 3000, deductionAmount: 500, projectedBalanceAfter: 2500, totalOutstandingBalance: 5000, projectedTotalOutstandingBalance: 4500, projectionAvailable: true });
        expect(result.loanBreakdown).toHaveLength(1);
        expect(getBalance(emp.loans[0])).toBe(3000);
        expect(JSON.stringify({ emp, rows })).toBe(before);
    });

    test.each([
        ['all', null, 9000, 8400, 600, 0],
        ['interest', null, 600, 0, 600, 8400],
        ['custom', 4000, 4000, 3400, 600, 5000],
        ['custom', 0, 0, 0, 0, 9000],
        ['custom', 50000, 9000, 8400, 600, 0]
    ])('refleja el reparto real del paso 4: %s / %s', (mode, amount, deduction, principal, interest, after) => {
        const emp = withLoans();
        const selection = setPayrollLoanMode(buildPayrollLoanSelection([emp], END), emp.id, mode, amount);
        const rows = applyPayrollLoanDeductions([baseRow()], [emp], selection, END);
        const result = exported(rows, emp);
        expect(result.loanSummary).toMatchObject({ balanceBefore: 9000, deductionAmount: deduction, principalAmount: principal, interestAmount: interest, projectedBalanceAfter: after, projectionAvailable: true });
        expect(result.prestamos).toBe(deduction);
        expect(result.monto).toBe(10000 - deduction);
        expect(result.loanBreakdown.reduce((sum, item) => sum + item.deductionAmount, 0)).toBe(deduction);
        expect(result.loanBreakdown.every(item => item.projectedBalanceAfter >= 0)).toBe(true);
        expect(result.loanBreakdown[0].balanceBefore).toBe(5400); // incluye el abono anterior de 6.600
    });

    test('una cuota seleccionada no se confunde con la deuda total del préstamo', () => {
        const emp = employee();
        createLoan(emp, { principal: 1200, interestRate: 0, startDate: '2026-10-01', concept: 'Equipo', installmentMode: 'installments', installmentCount: 4, installmentFrequencyWeeks: 2 });
        const rows = applyPayrollLoanDeductions([baseRow()], [emp], buildPayrollLoanSelection([emp], END), END);
        expect(exported(rows, emp).loanSummary).toMatchObject({ balanceBefore: 1200, deductionAmount: 300, projectedBalanceAfter: 900 });
    });

    test('al desmarcar préstamos desaparece el abono, pero la deuda informativa sigue vigente', () => {
        const emp = withLoans();
        const rows = applyPayrollLoanDeductions([baseRow()], [emp], buildPayrollLoanSelection([emp], END), END);
        const result = exported(applyPayrollPreviewInclusion(rows, { loans: false }), emp);
        expect(result.loanBreakdown).toEqual([]);
        expect(result.loanSummary).toMatchObject({ balanceBefore: 0, deductionAmount: 0, projectedBalanceAfter: 0, totalOutstandingBalance: 9000, projectedTotalOutstandingBalance: 9000 });
        expect(result.monto).toBe(10000);
    });

    test('un abono ya registrado no se vuelve a restar del saldo actual', () => {
        const emp = employee();
        const loan = createLoan(emp, { principal: 3000, interestRate: 0, startDate: '2026-10-01', concept: 'Adelanto' });
        recordPayment(emp, loan.id, { amount: 500, date: '2026-10-10' });
        const paymentId = loan.payments.at(-1).id;
        const rows = applyRegistrationLoans([baseRow()], [{ employeeId: emp.id, loanId: loan.id, paymentId, amount: 500, date: '2026-10-10' }]);
        const result = exported(rows, emp);
        expect(result.loanBreakdown[0]).toMatchObject({ status: 'recorded', paymentId, deductionAmount: 500, balanceBefore: null, projectedBalanceAfter: null, currentBalance: 2500, principalAmount: null, interestAmount: null });
        expect(result.loanSummary).toMatchObject({ deductionAmount: 500, balanceBefore: null, projectedBalanceAfter: null, totalOutstandingBalance: 2500, projectedTotalOutstandingBalance: null, projectionAvailable: false });
        expect(loan.payments).toHaveLength(1);
    });

    test('sin un desglose disponible conserva el neto pero no inventa deuda, capital o interés', () => {
        const result = exported([{ ...baseRow(), _loans: 500, monto: 9500 }], employee());
        expect(result.loanBreakdown).toEqual([]);
        expect(result.loanSummary).toMatchObject({ deductionAmount: 500, balanceBefore: null, projectedBalanceAfter: null, principalAmount: null, interestAmount: null, projectionAvailable: false });
    });

    test.each([
        [300, 500, 500],
        [3000, 500, 400]
    ])('rechaza un desglose incoherente antes de producir el JSON: deuda %s, abono %s, agregado %s', (balance, amount, aggregate) => {
        const source = { ...baseRow(), _loans: aggregate, _loanDetails: [{ loanId: 'loan', balance, selectedAmount: amount }] };
        expect(() => exported([source], employee())).toThrow(/préstamo/i);
    });
});
