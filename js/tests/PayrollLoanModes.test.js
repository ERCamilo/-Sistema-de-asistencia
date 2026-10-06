import { createLoan, recordPayment, getBalance } from '../modules/features/loans/LoansService.js';
import {
    PAYROLL_LOAN_MODE,
    buildPayrollLoanSelection,
    setPayrollLoanMode,
    setEmployeePayrollLoans,
    getPayrollLoanMode,
    resolvePayrollLoanSelection,
    applyPayrollLoanDeductions,
    summarizePayrollLoans
} from '../modules/features/payroll/PayrollLoans.js';
import { buildPayrollLoanSettlementBatch, applyPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';

const PERIOD_END = '2026-10-01';

/** #1 $10,000 al 20 % con un abono de $6,600 (queda 5,400 de capital) y #2 $3,000 al 20 %. */
function employee() {
    const emp = { id: 'e12', number: '012', name: 'Empleado 012', loans: [], updatedAt: 1 };
    const a = createLoan(emp, { principal: 10000, interestRate: 20, startDate: '2026-08-25', concept: 'A' });
    recordPayment(emp, a.id, { amount: 6600, date: '2026-09-12', recordedAt: 10 });
    createLoan(emp, { principal: 3000, interestRate: 20, startDate: '2026-09-14', concept: 'B' });
    return emp;
}

const resolved = (emp, selection) => resolvePayrollLoanSelection([emp], selection, PERIOD_END)[0];
const parts = item => item.loans.map(l => [l.concept, l.interestPart, l.capitalPart, l.selectedAmount]);

describe('Nómina paso 4 — cuánto descontar de préstamos', () => {
    test('«Todo» descuenta lo seleccionado completo, con interés primero en el desglose', () => {
        const emp = employee();
        const selection = buildPayrollLoanSelection([emp], PERIOD_END);
        expect(getPayrollLoanMode(selection, emp.id)).toEqual({ mode: 'all', amount: null });
        const item = resolved(emp, selection);
        expect(item.total).toBe(9000); // 5,400 + 3,600
        expect(parts(item)).toEqual([['A', 0, 5400, 5400], ['B', 600, 3000, 3600]]);
    });

    test('«Solo interés» descuenta el interés pendiente de los préstamos marcados', () => {
        const emp = employee();
        const selection = setPayrollLoanMode(buildPayrollLoanSelection([emp], PERIOD_END), emp.id, PAYROLL_LOAN_MODE.INTEREST);
        const item = resolved(emp, selection);
        expect(item).toMatchObject({ mode: 'interest', total: 600, interestTotal: 600, fullTotal: 9000 });
        expect(parts(item)).toEqual([['A', 0, 0, 0], ['B', 600, 0, 600]]);
    });

    test('«Otro monto» paga primero todo el interés y luego el capital del más viejo; no pasa de lo seleccionado', () => {
        const emp = employee();
        let selection = setPayrollLoanMode(buildPayrollLoanSelection([emp], PERIOD_END), emp.id, PAYROLL_LOAN_MODE.CUSTOM, 4000);
        expect(parts(resolved(emp, selection))).toEqual([['A', 0, 3400, 3400], ['B', 600, 0, 600]]);
        selection = setPayrollLoanMode(selection, emp.id, PAYROLL_LOAN_MODE.CUSTOM, 50000);
        expect(resolved(emp, selection).total).toBe(9000);
        // Quitar un préstamo conserva el modo; el monto se reparte entre los que quedan.
        const onlyB = setEmployeePayrollLoans(selection, emp.id, [{ loanId: emp.loans[1].id, chargeCount: 1 }]);
        expect(resolved(emp, onlyB)).toMatchObject({ mode: 'custom', total: 3600 });
    });

    test('la nómina descuenta lo repartido y el resumen cuenta solo lo que se cobra', () => {
        const emp = employee();
        const selection = setPayrollLoanMode(buildPayrollLoanSelection([emp], PERIOD_END), emp.id, PAYROLL_LOAN_MODE.CUSTOM, 4000);
        const [row] = applyPayrollLoanDeductions([{ _employeeId: emp.id, monto: 16200 }], [emp], selection, PERIOD_END);
        expect(row).toMatchObject({ _loans: 4000, monto: 12200 });
        const summary = summarizePayrollLoans([emp], selection, PERIOD_END);
        expect(summary).toMatchObject({ selectedBalance: 4000, chargedInterest: 600, selectedCount: 2 });
    });

    test('al cerrar la nómina se registra exactamente lo repartido en cada préstamo', () => {
        const emp = employee();
        const [a, b] = emp.loans;
        const selection = setPayrollLoanMode(buildPayrollLoanSelection([emp], PERIOD_END), emp.id, PAYROLL_LOAN_MODE.CUSTOM, 4000);
        const [row] = applyPayrollLoanDeductions([{ _employeeId: emp.id, _employeeName: emp.name, monto: 16200 }], [emp], selection, PERIOD_END);
        const batch = buildPayrollLoanSettlementBatch({ employees: [emp], rows: [row], periodStart: '2026-09-11', periodEnd: PERIOD_END, createdAt: 1000 });
        expect(batch.items.map(i => [i.loanId, i.amount])).toEqual([[a.id, 3400], [b.id, 600]]);
        const result = applyPayrollLoanSettlementBatch([emp], batch, { now: 2000 });
        const [after] = result.employees || [emp];
        const loans = after.loans || emp.loans;
        expect(getBalance(loans[0])).toBe(2000);
        expect(getBalance(loans[1])).toBe(3000);
    });
});
