import { createLoan, recordPayment, refinanceLoan, writeOffLoan } from '../modules/features/loans/LoansService.js';
import { buildFlowBuckets, computeLoanFlows, renderFlowChart, renderFlowPanel } from '../modules/features/loans/LoanFlowChart.js';

const PAY = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
let clock = 1_000;
const tick = () => (clock += 1_000);

/** Préstamos del 012 (ver LoanAccount.test.js): #4 y #5 en agosto, refinanciados y abonados el 12/09; #6–#8 en septiembre. */
function loans012() {
    const emp = { id: 'e', loans: [] };
    const mk = (principal, startDate) => { const l = createLoan(emp, { principal, interestRate: 20, startDate }); l.createdAt = tick(); return l; };
    const l4 = mk(10000, '2026-08-25');
    const l5 = mk(500, '2026-08-27');
    refinanceLoan(emp, l4.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    Object.assign(l4.refinancings[0], { interestAmount: 1080 });
    recordPayment(emp, l4.id, { amount: 6600, date: '2026-09-12', recordedAt: tick() });
    refinanceLoan(emp, l5.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    mk(3000, '2026-09-14'); mk(1000, '2026-09-19'); mk(500, '2026-09-22');
    return emp;
}

const balanced = o => Math.round((o.open + o.newCap + o.newInt + o.refiInt + o.adjustUp - o.adjustDown - o.payOld - o.paySame - o.gift - o.end) * 100) / 100;

describe('LoanFlowChart — por periodo', () => {
    test('arma las nóminas y separa lo que venía, lo refinanciado, lo cobrado y lo que faltó', () => {
        const emp = loans012();
        const buckets = buildFlowBuckets('period', { from: '2026-08-25', to: '2026-10-03', payPeriod: PAY });
        expect(buckets.map(b => b.label)).toEqual(['21/8–10/9', '11/9–1/10', '2/10–22/10']);
        const flows = computeLoanFlows(emp.loans, buckets);
        const aug = flows.get('2026-08-21|2026-09-10');
        expect(aug).toMatchObject({ open: 0, newCap: 10500, newInt: 2100, nNew: 2, end: 12600, missing: 0 });
        const sep = flows.get('2026-09-11|2026-10-01');
        expect(sep).toMatchObject({
            open: 12600, refiInt: 1200, refiIntOld: 1200, refiCapOld: 10500, nRefiOld: 2,
            payOld: 6600, payInt: 3080, payCap: 3520, newCap: 4500, newInt: 900, end: 12600, missing: 7200
        });
        expect(sep.refiFrom).toEqual({ '2026-08-21|2026-09-10': 10500 });
        expect(sep.payFrom).toEqual({ '2026-08-21|2026-09-10': 6600 });
        for (const o of flows.values()) expect(balanced(o)).toBe(0);
    });

    test('pagado de más va aparte y los anulados no entran', () => {
        const emp = loans012();
        const l4 = emp.loans[0];
        l4.payments.push({ ...l4.payments[0], id: 'dup', recordedAt: tick() });
        const voided = createLoan(emp, { principal: 9999, interestRate: 0, startDate: '2026-09-20' });
        writeOffLoan(emp, voided.id);
        const buckets = buildFlowBuckets('month', { from: '2026-08-01', to: '2026-10-03' });
        expect(buckets.map(b => b.key)).toEqual(['2026-08', '2026-09', '2026-10']);
        const sep = computeLoanFlows(emp.loans, buckets).get('2026-09');
        // El abono repetido de 6,600 salda los 6,480 que quedaban del #4; los 120 restantes son pagado de más.
        expect(sep.excess).toBe(120);
        expect(sep.payOld).toBe(13080);
        expect(sep.newCap).toBe(4500);
    });
});

describe('LoanFlowChart — dibujo', () => {
    test('las barras y el detalle se dibujan con datos', () => {
        const emp = loans012();
        const buckets = buildFlowBuckets('period', { from: '2026-08-25', to: '2026-10-03', payPeriod: PAY });
        const flows = computeLoanFlows(emp.loans, buckets);
        const svg = renderFlowChart({ scope: 'e', buckets, flows, selected: buckets[1].key, detailed: true, today: '2026-10-03' });
        expect(svg).toContain('venía de antes: capital refinanciado $10,500');
        expect(svg).toContain('faltó por cobrar de lo que venía $7,200');
        const panel = renderFlowPanel({ kind: 'period', bucket: buckets[1], flow: flows.get(buckets[1].key), buckets, today: '2026-10-03' });
        expect(panel).toContain('Faltó por cobrar de lo que venía');
        expect(panel).toContain('de eso, refinanciado (2)');
    });
});
