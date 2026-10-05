import { createLoan, recordPayment, refinanceLoan, LOAN_STATUS } from '../modules/features/loans/LoansService.js';
import { getLoanNumbers, getLoanDueDate, countMissedPayDates } from '../modules/features/loans/LoanAccount.js';
import {
    planLoanBackfill, applyLoanBackfill, nextLoanNumber, listPaymentsToReview, resolvePaymentReview
} from '../modules/features/loans/LoanDataBackfill.js';
import mergeEmployees from '../modules/services/EmployeeMerge.js';

// Nómina de Johan: periodos de 21 días desde el 21/08, pago 2 días después del fin.
const PAY = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };

function legacy() {
    const emp = { id: 'e1', name: 'Ana', number: '012', loans: [], updatedAt: 1 };
    const mk = (principal, startDate, at) => { const l = createLoan(emp, { principal, interestRate: 20, startDate }); l.createdAt = at; delete l.seq; return l; };
    const l1 = mk(2000, '2026-07-28', 1); // periodo 10/7–30/7 → pago 01/08
    const l2 = mk(10000, '2026-08-25', 2); // periodo 21/8–10/9 → pago 12/09
    refinanceLoan(emp, l2.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' }); // pasa a 03/10
    recordPayment(emp, l1.id, { amount: 2400, date: '2026-08-01' }); // día de pago
    recordPayment(emp, l2.id, { amount: 1000, date: '2026-09-25' }); // fuera de los días de pago
    return { emp, l1, l2 };
}

describe('Completar datos de préstamos (fase D)', () => {
    test('planea número, nómina de cobro y origen sin tocar nada', () => {
        const { emp } = legacy();
        const before = JSON.stringify(emp);
        const plan = planLoanBackfill([emp], PAY);
        expect(JSON.stringify(emp)).toBe(before);
        expect(plan).toMatchObject({ numbers: 2, dueDates: 2, refinancings: 1, payrollPayments: 1, reviewPayments: 1 });
    });

    test('aplica: número fijo, nómina de cobro, refinanciamiento a la nómina siguiente y origen', () => {
        const { emp, l1, l2 } = legacy();
        const balances = emp.loans.map(l => JSON.stringify(l.payments.map(p => p.amount)));
        applyLoanBackfill([emp], PAY, { at: 50 });
        expect([l1.number, l2.number]).toEqual([1, 2]);
        expect(l1.dueDate).toBe('2026-08-01');
        expect(l2.dueDate).toBe('2026-09-12');
        expect(l2.refinancings[0].nextDueDate).toBe('2026-10-03');
        expect(getLoanDueDate(l2)).toBe('2026-10-03');
        expect(countMissedPayDates(l2, ['2026-09-12', '2026-10-03', '2026-10-24'], '2026-10-05')).toBe(1);
        expect(l1.payments[0]).toMatchObject({ origin: 'payroll', channel: 'payroll', payrollPeriodStart: '2026-07-10', payrollPeriodEnd: '2026-07-30', originInferred: true });
        expect(l2.payments[0]).toMatchObject({ origin: 'direct', needsReview: true });
        expect(emp.loans.map(l => JSON.stringify(l.payments.map(p => p.amount)))).toEqual(balances);
        expect(getLoanNumbers(emp.loans).get(l2.id)).toBe(2);
    });

    test('se puede aplicar dos veces y en dos dispositivos llega a lo mismo', () => {
        const { emp } = legacy();
        const a = JSON.parse(JSON.stringify(emp));
        const b = JSON.parse(JSON.stringify(emp));
        applyLoanBackfill([a], PAY, { at: 50 });
        applyLoanBackfill([b], PAY, { at: 60 });
        // updatedAt cambia por dispositivo; la fusión agrega listas vacías: no son datos distintos.
        const strip = x => JSON.stringify(x, (k, v) => (k === 'updatedAt' || (Array.isArray(v) && !v.length) ? undefined : v));
        expect(strip(a)).toBe(strip(b));
        expect(planLoanBackfill([a], PAY).total).toBe(0);
        expect(strip(mergeEmployees(a, b).loans)).toBe(strip(b.loans));
    });

    test('préstamos nuevos siguen la numeración fija', () => {
        const { emp } = legacy();
        expect(nextLoanNumber(emp.loans)).toBeNull();
        applyLoanBackfill([emp], PAY);
        expect(nextLoanNumber(emp.loans)).toBe(3);
    });

    test('los abonos fuera de los días de pago se revisan uno por uno', () => {
        const { emp, l2 } = legacy();
        applyLoanBackfill([emp], PAY);
        const list = listPaymentsToReview([emp]);
        expect(list).toHaveLength(1);
        resolvePaymentReview(emp, l2.id, list[0].payment.id, 'payroll', PAY);
        expect(l2.payments[0]).toMatchObject({ origin: 'payroll', needsReview: false, payrollPeriodEnd: '2026-09-10' });
        expect(listPaymentsToReview([emp])).toHaveLength(0);
    });

    test('sin configuración de nómina solo pone números', () => {
        const { emp } = legacy();
        const plan = planLoanBackfill([emp], null);
        expect(plan).toMatchObject({ numbers: 2, dueDates: 0, payrollPayments: 0, reviewPayments: 0 });
        expect(emp.loans.every(l => l.status === LOAN_STATUS.ACTIVE || l.status === LOAN_STATUS.PAID)).toBe(true);
    });
});
