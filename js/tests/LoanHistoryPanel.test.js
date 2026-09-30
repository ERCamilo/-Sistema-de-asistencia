/**
 * Historial del saldo en Préstamos y las tres opciones del refinanciamiento.
 */
import { refinanceLoan, refinanceBaseAmount, getBalance } from '../modules/features/loans/LoansService.js';
import {
    renderLoanHistoryPanel, resetLoanHistoryPanels, toggleLoanHistory, selectLoanHistoryDate,
    stepLoanHistory, setLoanHistoryRange
} from '../modules/features/loans/LoanHistoryPanel.js';

const pay = (id, date, amount, source) => ({ id, date, amount, voided: false, recordedAt: Date.parse(date), source });
const makeEmp = (id, name, loans) => ({ id, name, loans });
const loanA = () => ({
    id: 'A', principal: 10000, interestRate: 10, interestIncluded: false, startDate: '2026-09-01',
    createdAt: Date.parse('2026-09-01'), status: 'active', refinancings: [],
    payments: [pay('p1', '2026-09-10', 1500, 'payroll')]
});
const scope = { enabled: false };

describe('refinanciamiento: capital restante, saldo o dejar pendiente', () => {
    test('la base «capital» es el capital que queda después de pagar primero el interés', () => {
        const loan = loanA(); // interés 1000, abono 1500 → capital restante 9500
        expect(refinanceBaseAmount(loan, 'capital')).toBe(9500);
        expect(refinanceBaseAmount(loan, 'balance')).toBe(9500);
        loan.payments = [pay('p1', '2026-09-10', 500)]; // solo interés
        expect(refinanceBaseAmount(loan, 'capital')).toBe(10000);
        expect(refinanceBaseAmount(loan, 'balance')).toBe(10500);
        expect(refinanceBaseAmount(loan, 'principal')).toBe(10000);
    });

    test('refinanciar sobre capital suma la tasa del capital restante', () => {
        const emp = makeEmp('e1', 'Ana', [{ ...loanA(), payments: [pay('p1', '2026-09-10', 500)] }]);
        const event = refinanceLoan(emp, 'A', { basis: 'capital', interestRate: 10 }, { projectScope: scope });
        expect(event).toMatchObject({ basis: 'capital', baseAmount: 10000, interestAmount: 1000 });
        expect(getBalance(emp.loans[0])).toBe(11500);
    });

    test('«dejar pendiente» solo crea un plan de cuotas nuevo, sin interés', () => {
        const emp = makeEmp('e1', 'Ana', [loanA()]);
        expect(() => refinanceLoan(emp, 'A', { basis: 'pending', interestRate: 0 }, { projectScope: scope }))
            .toThrow(/nuevo plan de cuotas/);
        const before = getBalance(emp.loans[0]);
        const event = refinanceLoan(emp, 'A', { basis: 'pending', interestRate: 0, installmentCount: 3, installmentFrequencyWeeks: 2 }, { projectScope: scope });
        expect(event).toMatchObject({ basis: 'pending', interestAmount: 0, kind: 'replacement' });
        expect(getBalance(emp.loans[0])).toBe(before);
    });
});

describe('renderLoanHistoryPanel', () => {
    beforeEach(() => resetLoanHistoryPanels());
    const employees = () => [
        makeEmp('e1', 'Ana Uno', [loanA()]),
        makeEmp('e2', 'Beto Dos', [{ ...loanA(), id: 'B', principal: 2000, startDate: '2026-09-10', createdAt: Date.parse('2026-09-10'), payments: [] }])
    ];

    test('cerrado muestra el saldo y cuánto es capital e interés', () => {
        const html = renderLoanHistoryPanel({ scope: 'general', employees: employees() });
        expect(html).toContain('Saldo total de la obra');
        expect(html).toContain('$11,700.00'); // 9500 + 2200
        expect(html).toContain('Capital <b>$11,500.00</b>');
        expect(html).toContain('Interés <b>$200.00</b>');
        expect(html).toContain('Ver historial (2)');
        expect(html).not.toContain('loan-history__snapshot');
    });

    test('abierto muestra la última fecha con antes, cambios agrupados y después', () => {
        toggleLoanHistory('general');
        const html = renderLoanHistoryPanel({ scope: 'general', employees: employees() });
        expect(html).toContain('Movimientos del día');
        expect(html).toContain('$11,000.00'); // antes
        expect(html).toMatch(/1 abono · 1 por nómina · Ana Uno/);
        expect(html).toMatch(/1 nuevo préstamo · Beto Dos/);
        expect(html).toContain('interés $1,000.00 + capital $500.00');
    });

    test('se navega entre fechas y por rango', () => {
        toggleLoanHistory('e1');
        const emp = [employees()[0]];
        expect(renderLoanHistoryPanel({ scope: 'e1', mode: 'employee', employees: emp })).toContain('2 de 2');
        stepLoanHistory('e1', -1);
        const first = renderLoanHistoryPanel({ scope: 'e1', mode: 'employee', employees: emp });
        expect(first).toContain('1 de 2');
        expect(first).toContain('Sin saldo previo');
        expect(first).toContain('Nuevo préstamo');
        selectLoanHistoryDate('e1', '2026-09-10');
        expect(renderLoanHistoryPanel({ scope: 'e1', mode: 'employee', employees: emp })).toContain('Descuento de nómina');
        setLoanHistoryRange('e1', '3M');
        expect(renderLoanHistoryPanel({ scope: 'e1', mode: 'employee', employees: emp })).toContain('aria-pressed="true">3M');
    });

    test('sin préstamos no se muestra', () => {
        expect(renderLoanHistoryPanel({ scope: 'x', employees: [makeEmp('e3', 'Sin', [])] })).toBe('');
    });
});
