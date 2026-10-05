import { state } from '../modules/core/AppState.js';
import { createLoan, recordPayment, refinanceLoan } from '../modules/features/loans/LoansService.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import { selectLoansEmployee } from '../modules/features/loans/LoansController.js';
import {
    laOpen, laField, laFieldQuiet, laSave, laSetTab, laAsk, laAdjust, laFix, laFixWhy, laVoid, laClose,
    laToggleLoan, laUseClassicView, useAccountView
} from '../modules/features/loans/LoanAccountController.js';
import { getAccountSummary, getAccountMovements, getActiveLoanAgreement } from '../modules/features/loans/LoanAccount.js';
import { movementKey } from '../modules/features/loans/LoanAccountView.js';
import { buildPayPeriods, nextPayPeriod } from '../modules/features/loans/LoanPayPeriods.js';

let clock = 1_000;
function loan(emp, principal, startDate, extra = {}) {
    const created = createLoan(emp, { principal, interestRate: 20, startDate });
    created.createdAt = (clock += 1_000);
    Object.assign(created, extra);
    return created;
}

function seed() {
    const emp = { id: 'e012', number: '012', name: 'Empleado Prueba', active: true, loans: [], updatedAt: 0 };
    const l4 = loan(emp, 10000, '2026-08-25', { dueDate: '2026-09-12' });
    const l5 = loan(emp, 500, '2026-08-27', { dueDate: '2026-09-12' });
    refinanceLoan(emp, l4.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    recordPayment(emp, l4.id, { amount: 6600, date: '2026-09-12', source: 'payroll', payrollClosureId: 'CL-0912', payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10', recordedAt: (clock += 1_000) });
    Object.assign(l4.refinancings[0], { interestAmount: 1080, baseAmount: 5400 });
    refinanceLoan(emp, l5.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    loan(emp, 3000, '2026-09-14', { dueDate: '2026-10-03' });
    loan(emp, 1000, '2026-09-19', { dueDate: '2026-10-03' });
    loan(emp, 500, '2026-09-22', { dueDate: '2026-10-03' });
    state.employees = [emp];
    state.settings = { ...(state.settings || {}), payPeriod: { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' } };
    selectLoansEmployee('e012');
    // El estado guarda su propia copia: se trabaja sobre la del estado.
    const live = state.employees[0];
    return { emp: live, l4: live.loans.find(l => l.id === l4.id) };
}

const html = () => { document.body.innerHTML = LoansLedger(); return document.body; };
const text = () => html().textContent.replace(/\s+/g, ' ');

beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-03T12:00:00'), doNotFake: ['requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'nextTick', 'queueMicrotask'] });
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
    localStorage.removeItem('loans-account-view');
    state.loansLedger = undefined;
    window.showAlert = jest.fn();
});

describe('LoanPayPeriods', () => {
    test('proyecta las nóminas con el mismo día de pago que la configuración', () => {
        // El 03/10 ya corre el periodo 02/10–22/10, pero ese día se paga el anterior.
        const periods = buildPayPeriods({ periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' }, '2026-10-03', { before: 1, after: 1 });
        expect(periods.map(p => p.label)).toEqual(['11/09 – 01/10 · pago 03/10', '02/10 – 22/10 · pago 24/10', '23/10 – 12/11 · pago 14/11']);
        expect(nextPayPeriod(periods, '2026-10-03').payDate).toBe('2026-10-03');
        expect(buildPayPeriods(null, '2026-10-03')).toEqual([]);
    });
});

describe('Ficha cuenta de préstamos', () => {
    test('muestra la tarjeta principal, botones, pestañas y préstamos numerados', () => {
        seed();
        expect(useAccountView()).toBe(true);
        const t = text();
        expect(t).toContain('Debe en total · 5 préstamos abiertos');
        expect(t).toContain('$12,600.00');
        expect(t).toContain('Próxima nómina · pago 03/10');
        for (const label of ['Abonar', 'Refinanciar', '+ Préstamo', 'Acuerdo', 'Movimientos de la cuenta']) expect(t).toContain(label);
        expect(document.querySelectorAll('.la-row .la-idx')[0].textContent).toBe('#1');
        expect(t).toContain('🔒 con cierre');
        expect(t).toContain('Se cobra hoy');
    });

    test('abonar a la cuenta reparte, guarda y aparece en movimientos', () => {
        const { emp } = seed();
        laOpen('pay');
        laField('amount', '3000');
        expect(text()).toContain('Reparto · interés de todos, luego capital del más viejo');
        laSave();
        expect(getAccountSummary(emp).balance).toBe(9600);
        expect(state.loansLedger.account.modal).toBeNull();
        laSetTab('mov');
        expect(text()).toContain('Abono a la cuenta');
        const pays = emp.loans.flatMap(l => l.payments).filter(p => p.origin === 'account');
        expect(pays).toHaveLength(5);
        expect(pays[0]).toMatchObject({ channel: 'payroll', payrollPeriodEnd: '2026-10-01' });
    });

    test('un abono de una nómina cerrada ofrece ajuste o corregir el cierre', () => {
        const { emp } = seed();
        laSetTab('mov');
        const mv = getAccountMovements(emp).find(m => m.kind === 'payment');
        const key = movementKey(mv);
        laAsk(key, 'acc');
        const t = text();
        expect(t).toContain('Ajuste en la nómina abierta');
        expect(t).toContain('Corregir el cierre (fue un error)');
        laFix(key); // sin motivo
        expect(window.showAlert).toHaveBeenCalled();
        laAdjust(key, '2026-10-03');
        expect(getAccountSummary(emp).balance).toBe(19200);
        expect(text()).toContain('Ajuste: se anula un abono de una nómina cerrada');
    });

    test('corregir el cierre guarda el motivo y el antes y después', () => {
        const { emp } = seed();
        const key = movementKey(getAccountMovements(emp).find(m => m.kind === 'payment'));
        laAsk(key, 'acc');
        laFixWhy('se registró dos veces');
        laFix(key);
        const pay = emp.loans[0].payments[0];
        expect(pay.closureFix).toMatchObject({ reason: 'se registró dos veces', before: { accountBalance: 12600 }, after: { accountBalance: 19200 } });
    });

    test('refinanciar exige motivo y mueve la nómina de cobro', () => {
        const { emp } = seed();
        laOpen('refi');
        laSave();
        expect(window.showAlert).toHaveBeenCalled();
        laField('reason', 'payroll-short');
        laSave();
        expect(getAccountSummary(emp).balance).toBe(15120);
        expect(emp.loans[2].refinancings[0]).toMatchObject({ reason: 'payroll-short', nextDueDate: '2026-10-24', origin: 'account' });
    });

    test('editar un préstamo con cierre pide motivo; nuevo préstamo guarda su nómina', () => {
        const { emp, l4 } = seed();
        laOpen('edit', l4.id);
        laField('amount', '9000');
        laSave();
        expect(window.showAlert).toHaveBeenCalled();
        laFieldQuiet('reason', 'eran 9,000');
        laSave();
        expect(l4.principal).toBe(9000);
        expect(l4.edits[0]).toMatchObject({ closureEdit: true });

        laOpen('loan');
        laField('amount', '2000');
        laSave();
        const created = emp.loans.at(-1);
        expect(created).toMatchObject({ principal: 2000, dueDate: '2026-10-03' });
    });

    test('acuerdo de pago y anular préstamo con motivo', () => {
        const { emp } = seed();
        laOpen('agree');
        laField('amount', '3000');
        laSave();
        expect(getActiveLoanAgreement(emp).amount).toBe(3000);
        expect(text()).toContain('Con acuerdo: $3,000 por nómina');

        const last = emp.loans.at(-1);
        laOpen('close', last.id);
        laField('reason', 'forgiven');
        laSave();
        expect(last.closure.reason).toBe('forgiven');
        laToggleLoan(last.id);
        laVoid(`close|${last.id}`);
        expect(last.status).toBe('active');
        laClose();
    });

    test('se puede volver a la vista anterior y regresar', () => {
        seed();
        laUseClassicView(1);
        expect(text()).toContain('Estás en la ficha anterior');
        laUseClassicView(0);
        expect(text()).toContain('Debe en total');
    });
});
