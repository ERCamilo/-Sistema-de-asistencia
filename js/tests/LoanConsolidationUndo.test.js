import { createLoan, consolidateLoans, recordPayment, refinanceLoan, getBalance, getPayrollDeductionOptions, LOAN_STATUS } from '../modules/features/loans/LoansService.js';
import { getAccountSummary } from '../modules/features/loans/LoanAccount.js';
import { findConsolidations, undoConsolidation, previewUndoConsolidation, restoreConsolidation } from '../modules/features/loans/LoanConsolidationUndo.js';
import { buildFlowBuckets, computeLoanFlows } from '../modules/features/loans/LoanFlowChart.js';
import { buildPayrollLoanSettlementBatch, applyPayrollLoanSettlementBatch, undoPayrollLoanSettlementBatch } from '../modules/features/payroll/PayrollLoanSettlement.js';

/** A: $1,000 al 10 % · B: $500 al 0 % → consolidados el 10/08 en C de $1,600 al 5 % (total $1,680). */
function consolidated() {
    const emp = { id: 'emp-7', number: '7', name: 'Ana', loans: [], updatedAt: 1 };
    const a = createLoan(emp, { principal: 1000, interestRate: 10, startDate: '2026-08-02' }); a.createdAt = 1;
    const b = createLoan(emp, { principal: 500, interestRate: 0, startDate: '2026-08-05' }); b.createdAt = 2;
    const { consolidatedLoan: c } = consolidateLoans(emp, { loanIds: [a.id, b.id], installmentCount: 1, interestRate: 5, startDate: '2026-08-10' });
    return { emp, a, b, c };
}

describe('Deshacer consolidaciones', () => {
    test('encuentra la consolidación y la vista previa no toca los datos', () => {
        const { emp, c } = consolidated();
        expect(findConsolidations(emp).map(x => x.loan.id)).toEqual([c.id]);
        const before = JSON.stringify(emp);
        const pv = previewUndoConsolidation(emp, c.id);
        expect(JSON.stringify(emp)).toBe(before);
        expect(pv).toMatchObject({ before: 1680, after: 1680, movedInterest: 80 });
        expect(pv.sources.map(s => [s.number, s.balance, s.interest])).toEqual([[1, 1155, 155], [2, 525, 25]]);
    });

    test('reabre los préstamos, reparte abonos e interés y el saldo de la cuenta no cambia', () => {
        const { emp, a, b, c } = consolidated();
        recordPayment(emp, c.id, { amount: 300, date: '2026-08-20', source: 'payroll', payrollClosureId: 'CL-1', payrollPeriodEnd: '2026-08-20', recordedAt: 10 });
        refinanceLoan(emp, c.id, { interestRate: 10, basis: 'balance', date: '2026-08-22' });
        const before = getAccountSummary(emp).balance;
        const res = undoConsolidation(emp, c.id, { by: 'johan' });
        expect(res.after).toBe(before);
        expect(c.status).toBe(LOAN_STATUS.WRITTEN_OFF);
        expect(c.consolidationUndone.sourceIds).toEqual([a.id, b.id]);
        expect([a.status, b.status]).toEqual([LOAN_STATUS.ACTIVE, LOAN_STATUS.ACTIVE]);
        expect(a.concept).not.toMatch(/Consolidado/);
        // El abono de 300 (cierre CL-1) va primero al interés de ambos: 155 de A, 25 de B y 120 al capital de A.
        const parts = [...a.payments, ...b.payments].filter(p => p.origin === 'conversion');
        expect(parts.map(p => p.amount).reduce((t, v) => t + v, 0)).toBe(300);
        expect(parts.every(p => p.payrollClosureId === 'CL-1' && p.convertedFrom.loanId === c.id)).toBe(true);
        expect(a.payments.find(p => p.origin === 'conversion').allocation).toEqual({ interest: 155, capital: 120 });
        expect(c.payments[0]).toMatchObject({ voided: true, voidReason: 'consolidation-undone' });
        // El refinanciamiento del 22/08 (10 % de 1,380 = 138) pasa a A y B en proporción.
        const refis = [...a.refinancings, ...b.refinancings].filter(r => r.reason === 'consolidation' && r.date === '2026-08-22');
        expect(refis.reduce((t, r) => t + r.interestAmount, 0)).toBe(138);
        expect(findConsolidations(emp)).toEqual([]);
    });

    test('en la gráfica ya no hay «perdonado» ni capital nuevo falso', () => {
        const { emp, c } = consolidated();
        // Los préstamos de origen se cerraron el día en que se consolidó (hoy en la prueba).
        const today = new Date().toISOString().slice(0, 10);
        const buckets = buildFlowBuckets('month', { from: '2026-08-01', to: today });
        const total = (flows, key) => [...flows.values()].reduce((t, o) => t + o[key], 0);
        const beforeUndo = computeLoanFlows(emp.loans, buckets);
        expect(total(beforeUndo, 'gift')).toBe(1600); // así se veía: A y B «saldados» con saldo
        expect(total(beforeUndo, 'newCap')).toBe(3100); // y el consolidado como capital nuevo
        undoConsolidation(emp, c.id);
        const after = computeLoanFlows(emp.loans, buckets);
        expect(total(after, 'gift')).toBe(0);
        expect(total(after, 'newCap')).toBe(1500);
        expect(after.get('2026-08')).toMatchObject({ newInt: 100, refiInt: 80, end: 1680 });
    });

    test('se puede revertir sin borrar nada', () => {
        const { emp, a, c } = consolidated();
        recordPayment(emp, c.id, { amount: 300, date: '2026-08-20', recordedAt: 10 });
        undoConsolidation(emp, c.id);
        restoreConsolidation(emp, c.id);
        expect(c.status).toBe(LOAN_STATUS.ACTIVE);
        expect(c.payments[0].voided).toBe(false);
        expect(a.status).toBe(LOAN_STATUS.PAID);
        expect(a.payments.every(p => p.voided)).toBe(true);
        expect(getBalance(c)).toBe(1380);
        expect(findConsolidations(emp).map(x => x.loan.id)).toEqual([c.id]);
    });

    test('deshacer el cierre de nómina anula también las partes convertidas', () => {
        const { emp, a, b, c } = consolidated();
        const selectedCharges = getPayrollDeductionOptions(c, '2026-08-23').slice(0, 1);
        const amount = selectedCharges.reduce((t, x) => t + x.amount, 0);
        const batch = buildPayrollLoanSettlementBatch({
            employees: [emp], periodStart: '2026-08-01', periodEnd: '2026-08-23', createdAt: 100_000, recordedBy: 'op',
            rows: [{ id: 7, nombre: 'Ana (Ref #7)', monto: 5000 - amount, _brutoOriginal: 5000, _bonuses: 0, _deductions: 0, _loans: amount,
                _employeeId: emp.id, _employeeName: 'Ana', _number: '7', _invalidLoanNet: false,
                _loanDetails: [{ loanId: c.id, concept: c.concept, balance: getBalance(c), selectedAmount: amount, selectedCharges }] }]
        });
        applyPayrollLoanSettlementBatch([emp], batch, { now: 100_100 });
        expect(getBalance(c)).toBe(0);
        undoConsolidation(emp, c.id);
        expect(getAccountSummary(emp).balance).toBe(0);
        undoPayrollLoanSettlementBatch([emp], batch.id, { now: 100_200 });
        expect([...a.payments, ...b.payments].filter(p => p.origin === 'conversion').every(p => p.voided)).toBe(true);
        expect(getAccountSummary(emp).balance).toBe(1680);
    });
});
