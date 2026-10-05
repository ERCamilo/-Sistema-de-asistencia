import {
    createLoan, recordPayment, refinanceLoan, getBalance, getRefinanceCount, LOAN_STATUS
} from '../modules/features/loans/LoansService.js';
import { replayLoan } from '../modules/features/loans/LoanTimeline.js';
import {
    MOVEMENT_ORIGIN, CLOSE_REASON, REFINANCE_REASON, VOID_MODE, AGREEMENT_INTEREST,
    LoanMovementLockedError,
    getLoanNumbers, getAccountSummary, previewAccountPayment, recordAccountPayment, recordDirectPayment,
    refinanceAccount, voidAccountMovement, getLoanLock, getLoanDueDate, countMissedPayDates,
    activeClosureIdsFrom, editLoan, undoLoanEdit, closeLoanWithReason, undoLoanClosure,
    saveLoanAgreement, cancelLoanAgreement, getActiveLoanAgreement, suggestedAgreementMinimum,
    projectLoanAgreement, getAccountMovements
} from '../modules/features/loans/LoanAccount.js';
import mergeEmployees from '../modules/services/EmployeeMerge.js';

let clock = 1_000;
const tick = () => (clock += 1_000);

function loan(emp, principal, startDate, extra = {}) {
    const created = createLoan(emp, { principal, interestRate: 20, startDate });
    created.createdAt = tick();
    Object.assign(created, extra);
    return created;
}

/**
 * Cuenta del empleado 012 al 03/10 (datos de la maqueta): #4 y #5 refinanciados
 * el 12/09, abono de $6,600 al #4 en el cierre de la nómina 21/8–10/9, y #6–#8
 * nuevos. Debe $12,600 = $11,480 de capital + $1,120 de interés.
 */
function employee012() {
    const emp = { id: 'e012', projectId: 'obra-1', loans: [], updatedAt: 0 };
    const l4 = loan(emp, 10000, '2026-08-25', { dueDate: '2026-09-12' });
    const l5 = loan(emp, 500, '2026-08-27', { dueDate: '2026-09-12' });
    refinanceLoan(emp, l4.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    // saldo del #4 tras el pago: (12,000 − 6,600) → refinanciamiento de 1,080 sobre 5,400
    recordPayment(emp, l4.id, { amount: 6600, date: '2026-09-12', source: 'payroll', payrollClosureId: 'CL-0912', recordedAt: tick() });
    l4.refinancings[0].interestAmount = 1080;
    l4.refinancings[0].baseAmount = 5400;
    l4.refinancings[0].payrollClosureId = 'CL-0912';
    refinanceLoan(emp, l5.id, { interestRate: 20, basis: 'balance', date: '2026-09-12', nextDueDate: '2026-10-03' });
    const l6 = loan(emp, 3000, '2026-09-14', { dueDate: '2026-10-03' });
    const l7 = loan(emp, 1000, '2026-09-19', { dueDate: '2026-10-03' });
    const l8 = loan(emp, 500, '2026-09-22', { dueDate: '2026-10-03' });
    return { emp, l4, l5, l6, l7, l8 };
}

const closures = activeClosureIdsFrom([{ id: 'CL-0912', status: 'closed' }, { id: 'CL-OLD', status: 'voided' }]);

describe('LoanAccount — resumen y número de préstamo', () => {
    test('suma la cuenta del 012 y numera por orden de creación', () => {
        const { emp, l4, l8 } = employee012();
        const s = getAccountSummary(emp, { activeClosureIds: closures });
        expect(s.balance).toBe(12600);
        expect(s.capital).toBe(11480);
        expect(s.interest).toBe(1120);
        expect(s.loans.map(x => x.number)).toEqual([1, 2, 3, 4, 5]);
        expect(getLoanNumbers(emp.loans).get(l4.id)).toBe(1);
        expect(getLoanNumbers(emp.loans).get(l8.id)).toBe(5);
        // #4 está en el cierre de la nómina 21/8–10/9; #6 no.
        expect(s.loans[0].lock).toBe('CL-0912');
        expect(s.loans[2].lock).toBeNull();
    });

    test('un cierre deshecho no bloquea', () => {
        const { l4 } = employee012();
        expect(getLoanLock(l4, { activeClosureIds: activeClosureIdsFrom([]) })).toBeNull();
        expect(getLoanLock(l4)).toBe('CL-0912'); // sin lista: lo seguro es bloquear
    });

    test('refinanciar pasa el cobro a la nómina siguiente', () => {
        const { l4, l6 } = employee012();
        expect(getLoanDueDate(l4)).toBe('2026-10-03');
        const payDates = ['2026-09-12', '2026-10-03', '2026-10-24', '2026-11-14'];
        expect(countMissedPayDates(l4, payDates, '2026-10-03')).toBe(0);
        expect(countMissedPayDates(l6, payDates, '2026-10-25')).toBe(2);
    });
});

describe('LoanAccount — abono a la cuenta', () => {
    test('reparte primero el interés de todos y luego el capital del más viejo', () => {
        const { emp, l4, l5, l6 } = employee012();
        const preview = previewAccountPayment(emp, 3000);
        expect(preview.excess).toBe(0);
        const byLoan = Object.fromEntries(preview.parts.map(p => [p.loanId, p]));
        expect(byLoan[l4.id]).toMatchObject({ interest: 0, capital: 1880 });
        expect(byLoan[l5.id]).toMatchObject({ interest: 220, capital: 0 });
        expect(byLoan[l6.id]).toMatchObject({ interest: 600, capital: 0 });
        expect(preview.parts.reduce((t, p) => t + p.interest, 0)).toBe(1120);

        const res = recordAccountPayment(emp, { amount: 3000, date: '2026-10-03' });
        expect(res.payments).toHaveLength(5);
        expect(new Set(res.payments.map(p => p.accountTxId)).size).toBe(1);
        expect(res.payments.every(p => p.origin === MOVEMENT_ORIGIN.ACCOUNT)).toBe(true);
        expect(getAccountSummary(emp).balance).toBe(9600);
        // El reparto guardado coincide con lo que reproduce la línea de tiempo.
        const step = replayLoan(l5).steps.find(s => s.kind === 'payment');
        expect(-step.delta.interest).toBe(220);
    });

    test('no acepta más de lo que debe y no deja abonos a medias', () => {
        const { emp } = employee012();
        const before = JSON.stringify(emp.loans);
        expect(() => recordAccountPayment(emp, { amount: 13000, date: '2026-10-03' })).toThrow(/pasa de lo que debe/);
        expect(JSON.stringify(emp.loans)).toBe(before);
    });

    test('abono directo guarda origen y reparto', () => {
        const { emp, l6 } = employee012();
        const p = recordDirectPayment(emp, l6.id, { amount: 1000, date: '2026-10-03' });
        expect(p).toMatchObject({ origin: MOVEMENT_ORIGIN.DIRECT, allocation: { interest: 600, capital: 400 } });
    });
});

describe('LoanAccount — refinanciamiento de la cuenta', () => {
    test('exige motivo y reparte el cargo entre lo vencido', () => {
        const { emp, l4, l6 } = employee012();
        expect(() => refinanceAccount(emp, { interestRate: 20, date: '2026-10-03' })).toThrow(/motivo/);
        expect(() => refinanceAccount(emp, { interestRate: 20, date: '2026-10-03', reason: REFINANCE_REASON.OTHER })).toThrow(/nota/);
        const res = refinanceAccount(emp, {
            interestRate: 20, date: '2026-10-03', reason: REFINANCE_REASON.PAYROLL_SHORT, nextDueDate: '2026-10-24',
            payrollPeriodStart: '2026-09-11', payrollPeriodEnd: '2026-10-01'
        });
        expect(res.events).toHaveLength(5);
        expect(res.total).toBe(2520); // 20 % de 12,600
        expect(getLoanDueDate(l4)).toBe('2026-10-24');
        expect(l6.refinancings[0]).toMatchObject({ reason: 'payroll-short', origin: 'account', payrollPeriodEnd: '2026-10-01' });
    });
});

describe('LoanAccount — anular con y sin cierre', () => {
    test('un movimiento en un cierre no se anula directo', () => {
        const { emp, l4 } = employee012();
        const pay = l4.payments[0];
        expect(() => voidAccountMovement(emp, { loanId: l4.id, paymentId: pay.id }, { activeClosureIds: closures }))
            .toThrow(LoanMovementLockedError);
    });

    test('ajuste: devuelve exactamente lo que tocó y el cierre no cambia', () => {
        const { emp, l4 } = employee012();
        const pay = l4.payments[0];
        const res = voidAccountMovement(emp, { loanId: l4.id, paymentId: pay.id }, {
            mode: VOID_MODE.ADJUST, date: '2026-10-03', reason: 'registrado dos veces', activeClosureIds: closures
        });
        expect(pay.voided).toBe(false);
        expect(pay.adjustedBy).toBe(res.adjustmentTxId);
        const adj = l4.payments.at(-1);
        expect(adj.adjustment).toMatchObject({ ofId: pay.id, interest: 3080, capital: 3520, lockedClosureId: 'CL-0912' });
        expect(getBalance(l4)).toBe(13080);
        expect(getAccountSummary(emp).balance).toBe(19200);
        expect(replayLoan(l4).balance).toBe(13080);
        expect(() => voidAccountMovement(emp, { loanId: l4.id, paymentId: pay.id }, { mode: VOID_MODE.ADJUST, date: '2026-10-03' }))
            .toThrow(/ya tiene un ajuste/);
    });

    test('ajuste de un refinanciamiento cerrado no cuenta como refinanciamiento', () => {
        const { emp, l4 } = employee012();
        voidAccountMovement(emp, { loanId: l4.id, refinancingId: l4.refinancings[0].id }, {
            mode: VOID_MODE.ADJUST, date: '2026-10-03', activeClosureIds: closures
        });
        expect(getBalance(l4)).toBe(5400);
        expect(getRefinanceCount(l4)).toBe(1);
        expect(replayLoan(l4).balance).toBe(5400);
    });

    test('corregir el cierre pide motivo y guarda el antes y el resultado', () => {
        const { emp, l4 } = employee012();
        const pay = l4.payments[0];
        const ref = { loanId: l4.id, paymentId: pay.id };
        expect(() => voidAccountMovement(emp, ref, { mode: VOID_MODE.FIX_CLOSURE, activeClosureIds: closures })).toThrow(/motivo/);
        const res = voidAccountMovement(emp, ref, { mode: VOID_MODE.FIX_CLOSURE, reason: 'se registró dos veces', by: 'johan', activeClosureIds: closures });
        expect(pay.voided).toBe(true);
        expect(pay.closureFix).toMatchObject({ reason: 'se registró dos veces', by: 'johan', closureIds: ['CL-0912'], before: { accountBalance: 12600 }, after: { accountBalance: 19200 } });
        expect(res.after).toBe(19200);
    });

    test('anular algo abierto vuelve a repartir los abonos a la cuenta posteriores', () => {
        const { emp, l4, l5, l6 } = employee012();
        const direct = recordDirectPayment(emp, l6.id, { amount: 600, date: '2026-10-01', recordedAt: tick() });
        const acc = recordAccountPayment(emp, { amount: 3000, date: '2026-10-03', recordedAt: tick() });
        // Con el #6 sin interés, los 3,000 iban 520 a interés (#5, #7, #8) y 2,480 a capital del #4.
        expect(acc.parts.find(p => p.loanId === l4.id).capital).toBe(2480);

        const res = voidAccountMovement(emp, { loanId: l6.id, paymentId: direct.id }, { activeClosureIds: closures });
        expect(direct.voided).toBe(true);
        expect(res.reallocated).toHaveLength(1);
        const live = emp.loans.flatMap(l => l.payments.filter(p => p.accountTxId === acc.accountTxId && !p.voided).map(p => ({ l, p })));
        expect(live.find(x => x.l === l6).p.allocation).toEqual({ interest: 600, capital: 0 });
        expect(live.find(x => x.l === l4).p.allocation).toEqual({ interest: 0, capital: 1880 });
        expect(live.find(x => x.l === l5).p.reallocatedFrom.length).toBeGreaterThan(0);
        expect(getAccountSummary(emp).balance).toBe(9600);
    });

    test('anular un abono de la cuenta lo anula en todos los préstamos', () => {
        const { emp } = employee012();
        const acc = recordAccountPayment(emp, { amount: 3000, date: '2026-10-03' });
        voidAccountMovement(emp, { accountTxId: acc.accountTxId }, { activeClosureIds: closures });
        expect(acc.payments.every(p => p.voided)).toBe(true);
        expect(getAccountSummary(emp).balance).toBe(12600);
    });
});

describe('LoanAccount — editar préstamo', () => {
    test('libre sin cierre; guarda antes, después y saldos; se deshace', () => {
        const { emp, l6 } = employee012();
        const edit = editLoan(emp, l6.id, { principal: 2500, concept: 'Botas' }, { reason: 'se anotó mal' });
        expect(edit.before).toEqual({ principal: 3000, concept: 'Préstamo' });
        expect(edit.after).toEqual({ principal: 2500, concept: 'Botas' });
        expect(edit).toMatchObject({ balanceBefore: 3600, balanceAfter: 3000, closureEdit: false });
        expect(() => undoLoanEdit(emp, l6.id, 'otro')).toThrow(/última/);
        undoLoanEdit(emp, l6.id, edit.id);
        expect(l6.principal).toBe(3000);
        expect(l6.edits[0].voided).toBe(true);
    });

    test('con cierre exige motivo y queda marcado como corrección de cierre', () => {
        const { emp, l4 } = employee012();
        expect(() => editLoan(emp, l4.id, { principal: 9000 }, { activeClosureIds: closures })).toThrow(LoanMovementLockedError);
        const edit = editLoan(emp, l4.id, { principal: 9000 }, { activeClosureIds: closures, reason: 'eran 9,000' });
        expect(edit).toMatchObject({ closureEdit: true, closureIds: ['CL-0912'], balanceBefore: 6480, balanceAfter: 5280 });
    });

    test('cambiar la nómina de cobro gana sobre un refinanciamiento anterior', () => {
        const { emp, l4 } = employee012();
        editLoan(emp, l4.id, { dueDate: '2026-10-24' }, { reason: 'acordado', activeClosureIds: closures, at: Date.now() + 10 });
        expect(getLoanDueDate(l4)).toBe('2026-10-24');
    });
});

describe('LoanAccount — cerrar préstamo con motivo', () => {
    test('error solo sin abonos; perdonado guarda capital e interés; se deshace', () => {
        const { emp, l4, l7 } = employee012();
        expect(() => closeLoanWithReason(emp, l7.id, {})).toThrow(/Elige/);
        expect(() => closeLoanWithReason(emp, l4.id, { reason: CLOSE_REASON.ERROR })).toThrow(/abonos/);
        expect(() => closeLoanWithReason(emp, l7.id, { reason: CLOSE_REASON.OTHER })).toThrow(/nota/);

        closeLoanWithReason(emp, l7.id, { reason: CLOSE_REASON.FORGIVEN, by: 'johan' });
        expect(l7.status).toBe(LOAN_STATUS.PAID);
        expect(l7.closure.forgiven).toEqual({ capital: 1000, interest: 200 });
        expect(getAccountSummary(emp).balance).toBe(11400);

        undoLoanClosure(emp, l7.id);
        expect(l7.status).toBe(LOAN_STATUS.ACTIVE);
        expect(l7.closureHistory).toHaveLength(1);

        closeLoanWithReason(emp, l7.id, { reason: CLOSE_REASON.ERROR });
        expect(l7.status).toBe(LOAN_STATUS.WRITTEN_OFF);
        expect(l7.closure.reason).toBe('error');
    });
});

describe('LoanAccount — acuerdo de pago', () => {
    test('mínimo sugerido, proyección, cambio y cancelación', () => {
        const { emp } = employee012();
        expect(suggestedAgreementMinimum(emp)).toBe(1200);
        const a1 = saveLoanAgreement(emp, { amount: 1000, startPayDate: '2026-10-24' });
        expect(a1.belowInterest).toBe(true);
        const a2 = saveLoanAgreement(emp, { amount: 3000, startPayDate: '2026-10-24', interestMode: AGREEMENT_INTEREST.RATE, rate: 5 });
        expect(a1).toMatchObject({ voided: true, replacedBy: a2.id });
        expect(getActiveLoanAgreement(emp).id).toBe(a2.id);

        const dates = ['2026-10-24', '2026-11-14', '2026-12-05', '2026-12-26', '2027-01-16', '2027-02-06'];
        const plain = projectLoanAgreement(12600, { amount: 3000, interestMode: 'none' }, dates);
        expect(plain.rows).toHaveLength(5);
        expect(plain.done).toBe(true);
        const withRate = projectLoanAgreement(12600, { amount: 3000, interestMode: 'rate', rate: 5 }, dates);
        expect(withRate.rows).toHaveLength(5);
        expect(withRate.extraTotal).toBe(1138.49);

        cancelLoanAgreement(emp, a2.id);
        expect(getActiveLoanAgreement(emp)).toBeNull();
    });
});

describe('LoanAccount — movimientos y sincronización', () => {
    test('agrupa el abono de la cuenta, marca cierre, ajuste y origen', () => {
        const { emp, l4 } = employee012();
        recordAccountPayment(emp, { amount: 3000, date: '2026-10-03' });
        voidAccountMovement(emp, { loanId: l4.id, paymentId: l4.payments[0].id }, { mode: VOID_MODE.ADJUST, date: '2026-10-03', activeClosureIds: closures });
        const mv = getAccountMovements(emp, { activeClosureIds: closures });
        const acc = mv.find(m => m.kind === 'payment' && m.origin === 'account');
        expect(acc.parts).toHaveLength(5);
        expect(acc.amount).toBe(3000);
        const payroll = mv.find(m => m.kind === 'payment' && m.origin === 'payroll');
        expect(payroll).toMatchObject({ lock: 'CL-0912', amount: 6600 });
        expect(payroll.adjustedBy).toBeTruthy();
        expect(mv.find(m => m.kind === 'adjustment').amount).toBe(-6600);
        expect(mv.filter(m => m.kind === 'loan')).toHaveLength(5);
    });

    test('la fusión entre dispositivos conserva ediciones y acuerdos de ambos lados', () => {
        const { emp, l6 } = employee012();
        const server = JSON.parse(JSON.stringify(emp));
        const local = JSON.parse(JSON.stringify(emp));
        editLoan(server, l6.id, { concept: 'Botas' }, { reason: 'x', at: 5 });
        saveLoanAgreement(local, { amount: 2000, startPayDate: '2026-10-24', at: 6 });
        local.updatedAt = 7;
        const merged = mergeEmployees(server, local);
        const loan6 = merged.loans.find(l => l.id === l6.id);
        expect(loan6.edits).toHaveLength(1);
        expect(merged.loanAgreements).toHaveLength(1);
    });
});

describe('LoanAccount — anulados conservan su reparto', () => {
    test('un abono anulado sigue mostrando su interés, capital y monto', () => {
        const { emp, l4 } = employee012();
        const pay = l4.payments[0];
        delete pay.allocation;
        voidAccountMovement(emp, { loanId: l4.id, paymentId: pay.id }, { mode: VOID_MODE.FIX_CLOSURE, reason: 'duplicado', activeClosureIds: closures });
        expect(pay.allocation).toEqual({ interest: 3080, capital: 3520 });
        const mv = getAccountMovements(emp, { activeClosureIds: closures }).find(m => m.kind === 'payment' && m.voided);
        expect(mv.amount).toBe(6600);
        expect(mv.parts[0]).toMatchObject({ interest: 3080, capital: 3520 });
    });
});
