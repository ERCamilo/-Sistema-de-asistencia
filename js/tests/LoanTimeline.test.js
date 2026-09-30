/**
 * LoanTimeline: la historia de préstamos reproducida día por día, con la regla
 * "primero se paga el interés y luego el capital".
 */
import { replayLoan, buildTimeline, buildGeneralTimeline, getRemainingCapital } from '../modules/features/loans/LoanTimeline.js';
import { getBalance } from '../modules/features/loans/LoansService.js';

const loan = (overrides = {}) => ({
    id: 'L1', principal: 10000, interestRate: 10, interestIncluded: false, interestType: 'simple',
    startDate: '2026-09-01', createdAt: Date.parse('2026-09-01'), status: 'active',
    payments: [], refinancings: [], ...overrides
});
const pay = (id, date, amount, extra = {}) => ({ id, date, amount, voided: false, recordedAt: Date.parse(date), ...extra });

describe('replayLoan', () => {
    test('el abono paga primero el interés y luego el capital', () => {
        const r = replayLoan(loan({ payments: [pay('P1', '2026-09-10', 1500)] }));
        expect(r.steps[1].delta).toEqual({ capital: -500, interest: -1000 });
        expect(r).toMatchObject({ capital: 9500, interest: 0, balance: 9500 });
    });

    test('un refinanciamiento suma interés y los anulados no cuentan', () => {
        const l = loan({
            payments: [pay('P1', '2026-09-10', 1000), pay('P2', '2026-09-11', 999, { voided: true })],
            refinancings: [
                { id: 'R1', date: '2026-09-20', basis: 'balance', interestAmount: 1000, createdAt: 2 },
                { id: 'R2', date: '2026-09-21', basis: 'balance', interestAmount: 500, voided: true, createdAt: 3 }
            ]
        });
        const r = replayLoan(l);
        expect(r).toMatchObject({ capital: 10000, interest: 1000, balance: getBalance(l) });
        expect(r.steps.map(s => s.kind)).toEqual(['loan', 'payment', 'refinancing']);
    });

    test('un abono repetido queda como excedente y cubre cargos posteriores', () => {
        const l = loan({
            principal: 1000,
            payments: [pay('P1', '2026-09-10', 1100), pay('P2', '2026-09-10', 1100)],
            refinancings: [{ id: 'R1', date: '2026-09-20', basis: 'principal', interestAmount: 100, createdAt: Date.parse('2026-09-20') }],
            status: 'paid', closedAt: Date.parse('2026-09-21')
        });
        const r = replayLoan(l);
        expect(r.steps[2]).toMatchObject({ excess: 1100, delta: { capital: -0, interest: -0 } });
        expect(r.steps[3]).toMatchObject({ kind: 'refinancing', creditUsed: 100, delta: { capital: 0, interest: 0 } });
        expect(r.balance).toBe(0);
    });

    test('un préstamo anulado con saldo sale del total en su fecha de cierre', () => {
        const r = replayLoan(loan({ status: 'written-off', closedAt: Date.parse('2026-09-15T12:00:00Z') }));
        expect(r.steps.at(-1)).toMatchObject({ kind: 'writeoff', date: '2026-09-15', delta: { capital: -10000, interest: -1000 } });
        expect(r.balance).toBe(0);
    });

    test('el capital restante en una fecha sigue la regla de interés primero', () => {
        const l = loan({ payments: [pay('P1', '2026-09-10', 3000), pay('P2', '2026-09-20', 3000)] });
        expect(getRemainingCapital(l, '2026-09-05')).toBe(10000);
        expect(getRemainingCapital(l, '2026-09-10')).toBe(8000);
        expect(getRemainingCapital(l)).toBe(5000);
    });
});

describe('buildTimeline', () => {
    test('agrupa por día: saldo anterior, movimientos y resultado capital/interés', () => {
        const a = loan({ id: 'A', payments: [pay('P1', '2026-09-10', 1500)] });
        const b = loan({ id: 'B', principal: 5000, interestRate: 20, startDate: '2026-09-10', createdAt: Date.parse('2026-09-10') });
        const { days, totals } = buildTimeline([{ employeeId: 'e1', loan: a }, { employeeId: 'e2', loan: b }]);
        expect(days.map(d => d.date)).toEqual(['2026-09-01', '2026-09-10']);
        expect(days[1]).toMatchObject({
            previous: 11000, payments: -1500, newLoans: 6000, refinancings: 0,
            result: 15500, capital: 14500, interest: 1000
        });
        expect(days[1].tags.sort()).toEqual(['loan', 'payment']);
        expect(totals.balance).toBe(15500);
    });

    test('el total general coincide con la suma de saldos de préstamos activos', () => {
        const employees = [
            { id: 'e1', loans: [loan({ id: 'A', payments: [pay('P1', '2026-09-03', 2000, { source: 'payroll' })] })] },
            { id: 'e2', loans: [loan({ id: 'B', status: 'written-off', closedAt: Date.parse('2026-09-05') })] }
        ];
        const { days, totals } = buildGeneralTimeline(employees);
        expect(totals.balance).toBe(getBalance(employees[0].loans[0]));
        expect(days.find(d => d.date === '2026-09-03').tags).toContain('payroll');
        expect(days.find(d => d.date === '2026-09-05').writeOffs).toBe(-11000);
    });
});
