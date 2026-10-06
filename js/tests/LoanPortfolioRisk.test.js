import { createLoan, recordPayment, refinanceLoan, consolidateLoans, writeOffLoan } from '../modules/features/loans/LoansService.js';
import { prepareLoanEmployees, computePortfolioSummary, computeMonthChange } from '../modules/features/loans/LoanPortfolio.js';
import { referenceSalary, classifyRisk, buildRiskInput, computeRiskList } from '../modules/features/loans/LoanRisk.js';
import { countMissedPayDates } from '../modules/features/loans/LoanAccount.js';
import { buildPayPeriods } from '../modules/features/loans/LoanPayPeriods.js';

const PAY = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
let clock = 1_000;

/** #4 $10,000 y #5 $500 (refinanciados y abonados el 12/09) + #6 $3,000; uno anulado por error. */
function obra() {
    const emp = { id: 'e1', number: '012', name: 'Ana', active: true, loans: [], updatedAt: 1 };
    const mk = (principal, startDate) => { const l = createLoan(emp, { principal, interestRate: 20, startDate }); l.createdAt = (clock += 1_000); return l; };
    const l4 = mk(10000, '2026-08-25');
    const l5 = mk(500, '2026-08-27');
    refinanceLoan(emp, l4.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    Object.assign(l4.refinancings[0], { interestAmount: 1080 });
    recordPayment(emp, l4.id, { amount: 6600, date: '2026-09-12', recordedAt: (clock += 1_000) });
    // Orden real: se cobró en nómina y después se refinanció lo que quedó.
    l4.refinancings[0].createdAt = (clock += 1_000);
    refinanceLoan(emp, l5.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    l5.refinancings[0].createdAt = (clock += 1_000);
    mk(3000, '2026-09-14');
    const bad = mk(9999, '2026-09-20');
    writeOffLoan(emp, bad.id);
    return emp;
}

describe('Resumen de cartera', () => {
    test('por cobrar, interés ganado, cobrado y prestado sin anulados', () => {
        const emp = obra();
        const s = computePortfolioSummary([emp]);
        expect(s.porCobrar).toMatchObject({ total: 10800, capital: 8900, interest: 1900, interestRefi: 1200, interestInitial: 700, people: 1, loans: 3 });
        expect(s.interesGanado).toMatchObject({ collected: 2000, total: 3900 });
        // El abono de 6,600 fue antes del refinanciamiento: cubre los 2,000 de interés inicial y 4,600 de capital.
        expect(s.cobrado).toMatchObject({ total: 6600, capital: 4600, interest: 2000, since: '2026-09-12' });
        expect(s.prestado.total).toBe(13500);
        expect(s.quienDebeMas[0].balance).toBe(10800);
    });

    test('detalle de la maqueta: interés ganado por origen, cómo entró lo cobrado y anulados', () => {
        const emp = obra();
        emp.loans[0].payments[0].origin = 'payroll';
        const s = computePortfolioSummary([emp]);
        // #4: el abono de 6,600 fue antes del refinanciamiento: solo cubre los 2,000 de interés inicial.
        expect(s.interesGanado).toMatchObject({ collectedInit: 2000, collectedRefi: 0, forgiven: 0 });
        expect(s.cobrado).toMatchObject({ payroll: 6600, direct: 0 });
        expect(s.prestado).toMatchObject({ loans: 3, voided: 1, voidedAmount: 9999 });
        expect(s.porCobrar).toMatchObject({ inactive: 0, inactivePeople: 0 });
    });

    test('la línea del mes usa el saldo al empezar el mes', () => {
        const emp = obra();
        const m = computeMonthChange([emp], '2026-09-29');
        expect(m).toMatchObject({ month: 'septiembre', from: 12600, to: 10800, change: -1800 });
    });

    test('lee las consolidaciones deshechas y los datos completos sin tocar los reales', () => {
        const emp = obra();
        const [a, b] = emp.loans;
        consolidateLoans(emp, { loanIds: [a.id, b.id], installmentCount: 1, interestRate: 0, startDate: '2026-09-20' });
        const before = JSON.stringify(emp);
        const prepared = prepareLoanEmployees([emp], PAY);
        expect(prepared.virtual).toBe(true);
        expect(JSON.stringify(emp)).toBe(before);
        const s = computePortfolioSummary(prepared.employees);
        expect(s.prestado.total).toBe(13500); // sin el consolidado como préstamo nuevo
        expect(prepared.employees[0].loans.every(l => Number.isInteger(l.number))).toBe(true);
        expect(s.prestado.voided).toBe(1); // el consolidado deshecho no cuenta como anulado por error
    });
});

describe('Vencido con margen de 3 días', () => {
    test('no está vencido hasta 3 días después del día de pago', () => {
        const loan = { status: 'active', dueDate: '2026-10-03' };
        const pays = ['2026-10-03', '2026-10-24'];
        expect(countMissedPayDates(loan, pays, '2026-10-06', { graceDays: 3 })).toBe(0);
        expect(countMissedPayDates(loan, pays, '2026-10-07', { graceDays: 3 })).toBe(1);
        expect(countMissedPayDates(loan, pays, '2026-10-07')).toBe(1);
    });
});

describe('Empleados en riesgo', () => {
    test('sueldo de referencia: proyectado, promedio o configurado', () => {
        expect(referenceSalary({ gCur: 10000, curDays: 10, length: 21, g1: 1, g2: 1 }).value).toBe(21000);
        expect(referenceSalary({ gCur: 3000, curDays: 3, g1: 18000, g2: 16000 })).toMatchObject({ value: 17000, source: 'promedio de los 2 periodos anteriores' });
        expect(referenceSalary({ configured: 15000 }).value).toBe(15000);
        expect(referenceSalary({})).toBeNull();
    });

    const base = { emp: { number: '1' }, active: true, nOpen: 1, oldDebt: 0, balStartCur: 0, paidCur: 0, totRefi: 0, refiInt: 0, oldest: '2026-09-01', oldestDays: 30, g1: 10000, g2: 10000, gCur: 0, curDays: 0, length: 21, configured: 0 };
    test('niveles por carga y atraso', () => {
        expect(classifyRisk({ ...base, bal: 2000 })).toBeNull();
        expect(classifyRisk({ ...base, bal: 4000 }).lvl).toBe(1);
        expect(classifyRisk({ ...base, bal: 6500 }).lvl).toBe(2);
        expect(classifyRisk({ ...base, bal: 10500 }).lvl).toBe(3);
        expect(classifyRisk({ ...base, bal: 3000, oldDebt: 3000, balStartCur: 3000 }).lvl).toBe(2); // no pagó y no bajó
        expect(classifyRisk({ ...base, bal: 6000, oldDebt: 6000, balStartCur: 6000 }).lvl).toBe(3); // atraso ≥ 50 %
        expect(classifyRisk({ ...base, active: false, bal: 500 }).lvl).toBe(3);
    });

    test('baja un nivel si viene pagando y lo atrasado baja', () => {
        const r = classifyRisk({ ...base, bal: 6500, oldDebt: 2000, balStartCur: 5000, paidCur: 3000 });
        expect(r.lvl).toBe(1);
        expect(r.ctx.some(t => t.startsWith('Baja un nivel'))).toBe(true);
    });

    test('con datos: el atraso usa la nómina de cobro original aunque se haya refinanciado', () => {
        const emp = obra();
        const [prepared] = prepareLoanEmployees([emp], PAY).employees;
        const periods = buildPayPeriods(PAY, '2026-09-29', { before: 3, after: 1 });
        const input = buildRiskInput(prepared, { today: '2026-09-29', periods, grossOf: () => 10000 });
        // El abono del 12/09 cae en el periodo actual (11/9–1/10).
        expect(input).toMatchObject({ oldDebt: 7200, balStartCur: 12600, paidCur: 6600, nOpen: 3 });
        const list = computeRiskList([prepared], { today: '2026-09-29', periods, grossOf: () => 10000 });
        // Atraso 65 % del sueldo (≈$11,052 proyectado) = muy alto, pero viene pagando y lo atrasado bajó: queda en alto.
        expect(list[0].lvl).toBe(2);
        expect(list[0].ctx.some(t => t.startsWith('Baja un nivel'))).toBe(true);
        expect(list[0].advice.length).toBeGreaterThan(0);
    });
});
