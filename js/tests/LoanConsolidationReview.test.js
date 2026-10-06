import { createLoan, recordPayment, consolidateLoans } from '../modules/features/loans/LoansService.js';
import { getAccountSummary } from '../modules/features/loans/LoanAccount.js';
import {
    undoConsolidation,
    restoreConsolidation,
    consolidationUndoOrder,
    consolidationRestoreBlock,
    isDamagedConsolidation
} from '../modules/features/loans/LoanConsolidationUndo.js';
import {
    REVIEW_STATUS,
    reviewConsolidations,
    reviewEmployeeConsolidations,
    repairEmployeeConsolidations
} from '../modules/features/loans/LoanConsolidationReview.js';
import { state } from '../modules/core/AppState.js';
import { ConsolidationReviewButton, ConsolidationReviewPanel, lcToggle, lcExpand, lcRepair } from '../modules/features/loans/LoanConsolidationReviewPanel.js';
import { LoanAccountDetail } from '../modules/features/loans/LoanAccountView.js';

const scope = { enabled: false };
const balance = emp => getAccountSummary(emp).balance;
const paid = emp => emp.loans.flatMap(l => l.payments || []).filter(p => !p.voided).reduce((t, p) => t + p.amount, 0);

/** Cadena de `levels` consolidaciones, cada una dentro de la siguiente, con un abono en cada una. */
function chain(levels) {
    const emp = { id: 'e', number: '003', loans: [] };
    let prev = createLoan(emp, { principal: 1000, interestRate: 20, startDate: '2026-01-01' });
    const cons = [];
    for (let i = 1; i <= levels; i++) {
        const extra = createLoan(emp, { principal: 500 * i, interestRate: 20, startDate: `2026-0${i + 1}-01` });
        const { consolidatedLoan } = consolidateLoans(emp, { loanIds: [prev.id, extra.id], installmentCount: 1, interestRate: 10, startDate: `2026-0${i + 1}-15` });
        recordPayment(emp, consolidatedLoan.id, { amount: 200, date: `2026-0${i + 1}-20`, recordedAt: i });
        cons.push(consolidatedLoan);
        prev = consolidatedLoan;
    }
    return { emp, cons };
}

/**
 * Lo que hacía la versión anterior con «Deshacer todas»: de adentro hacia afuera,
 * y al reabrir una consolidación como préstamo de origen le borraba su copia.
 */
function damagedChain(levels) {
    const { emp, cons } = chain(levels);
    const correct = balance(emp);
    let at = 10;
    for (const [i, loan] of cons.entries()) {
        const outer = cons[i + 1];
        const saved = outer ? outer.consolidatedFromLoanIds : null;
        if (outer) outer.consolidatedFromLoanIds = [];
        undoConsolidation(emp, loan.id, { projectScope: scope, at });
        if (outer) outer.consolidatedFromLoanIds = saved;
        at++;
    }
    for (let i = 1; i < cons.length; i++) cons[i - 1].consolidationUndone = { from: cons[i].id, at: 10 + i, by: null };
    return { emp, cons, correct };
}

describe('Revisar consolidaciones', () => {
    test('cuentas deshechas en el orden correcto: correctas y el monto real es igual al saldo', () => {
        const { emp } = chain(2);
        const before = balance(emp);
        expect(reviewEmployeeConsolidations(emp)).toMatchObject({ status: REVIEW_STATUS.PENDING, real: before, today: before, levels: 2 });
        for (const c of consolidationUndoOrder(emp)) undoConsolidation(emp, c.loan.id, { projectScope: scope, at: 10 });
        const review = reviewEmployeeConsolidations(emp);
        expect(review).toMatchObject({ status: REVIEW_STATUS.OK, real: before, today: before, diff: 0, canRepair: false });
        expect(reviewEmployeeConsolidations({ id: 'x', loans: [] })).toBeNull();
    });

    test.each([2, 3, 4, 6])('%i niveles dañados por la versión anterior: detecta, repara y bloquea', levels => {
        const { emp, cons, correct } = damagedChain(levels);
        const totalPaid = paid(emp);
        expect(balance(emp)).toBeGreaterThan(correct + 1);
        const review = reviewEmployeeConsolidations(emp);
        expect(review).toMatchObject({ status: REVIEW_STATUS.DAMAGED, real: correct, canRepair: true, afterRepair: correct });
        expect(review.diff).toBeCloseTo(balance(emp) - correct, 2);
        expect(review.doubled.length).toBe(levels - 1);
        // «Volver a consolidar» queda bloqueado mientras esté dañada.
        expect(consolidationRestoreBlock(emp, cons.at(-1).id)).toMatch(/repárala primero/);

        const result = repairEmployeeConsolidations(emp, { at: 100, projectScope: scope });
        expect(result).toMatchObject({ before: review.today, after: correct, real: correct });
        expect(balance(emp)).toBe(correct);
        expect(paid(emp)).toBeCloseTo(totalPaid, 2);
        expect(emp.loans.some(l => isDamagedConsolidation(emp, l))).toBe(false);

        const after = reviewEmployeeConsolidations(emp);
        expect(after).toMatchObject({ status: REVIEW_STATUS.REPAIRED, real: correct, today: correct, diff: 0 });
        // Las reparadas y las que las contenían ya no se vuelven a consolidar.
        for (const c of cons) {
            expect(consolidationRestoreBlock(emp, c.id)).toMatch(/se reparó/);
            expect(() => restoreConsolidation(emp, c.id, { at: 200 })).toThrow(/se reparó/);
        }
        expect(balance(emp)).toBe(correct);
    });

    test('«Deshacer» directo sobre la dañada también la marca como reparada', () => {
        const { emp, cons, correct } = damagedChain(2);
        undoConsolidation(emp, cons[0].id, { projectScope: scope, at: 50 });
        expect(balance(emp)).toBe(correct);
        expect(reviewEmployeeConsolidations(emp).status).toBe(REVIEW_STATUS.REPAIRED);
        expect(() => restoreConsolidation(emp, cons[1].id, { at: 60 })).toThrow(/se reparó/);
    });

    test('reparar una cuenta sin daño no cambia nada', () => {
        const { emp } = chain(1);
        const copy = JSON.stringify(emp);
        expect(() => repairEmployeeConsolidations(emp, { projectScope: scope })).toThrow(/no tiene consolidaciones dañadas/);
        expect(JSON.stringify(emp)).toBe(copy);
    });

    test('la revisión de todos cuenta los estados y no modifica los datos', () => {
        const damaged = damagedChain(2).emp;
        const ok = chain(1).emp;
        for (const c of consolidationUndoOrder(ok)) undoConsolidation(ok, c.loan.id, { projectScope: scope, at: 10 });
        const employees = [damaged, ok, { id: 'z', loans: [] }];
        const copy = JSON.stringify(employees);
        const { items, stats } = reviewConsolidations(employees);
        expect(items).toHaveLength(2);
        expect(stats).toMatchObject({ employees: 2, ok: 1, damaged: 1, repaired: 0, pending: 0, mismatch: 0 });
        expect(JSON.stringify(employees)).toBe(copy);
    });

    test('una consolidación sin anidar se sigue pudiendo volver a consolidar', () => {
        const { emp, cons } = chain(1);
        const before = balance(emp);
        undoConsolidation(emp, cons[0].id, { projectScope: scope, at: 10 });
        expect(consolidationRestoreBlock(emp, cons[0].id)).toBeNull();
        restoreConsolidation(emp, cons[0].id, { at: 11 });
        expect(balance(emp)).toBe(before);
    });
});

describe('Pantalla «Consolidaciones»', () => {
    afterEach(() => { if (state.loansLedger?.portfolio) delete state.loansLedger.portfolio.consReview; });

    test('el botón avisa del error, el panel compara y «Reparar» deja el saldo igual al monto real', () => {
        const { emp, cons, correct } = damagedChain(2);
        state.employees = [emp];
        const model = () => ({ scoped: state.employees });
        expect(ConsolidationReviewButton(model())).toContain('1 con error');
        expect(ConsolidationReviewPanel(model())).toBe('');
        lcToggle();
        lcExpand(emp.id);
        const html = ConsolidationReviewPanel(model());
        expect(html).toContain('Deuda contada dos veces');
        expect(html).toContain('Monto real');
        expect(html).toContain('data-app-fn="lcRepair"');
        expect(html).toContain('abierto otra vez');
        lcRepair(emp.id);
        expect(balance(state.employees[0])).toBe(correct);
        const after = ConsolidationReviewPanel(model());
        expect(after).toContain('🔒 Reparada');
        expect(after).not.toContain('data-app-fn="lcRepair"');
        expect(ConsolidationReviewButton(model())).not.toContain('con error');
        // En la cuenta del empleado, «Volver a consolidar» queda deshabilitado con el motivo.
        state.loansLedger.account = { ...(state.loansLedger.account || {}), open: { [cons[1].id]: true } };
        const account = LoanAccountDetail(state.employees[0]);
        expect(account).not.toContain('data-app-fn="laRestoreConsolidation"');
        expect(account).toContain('se reparó');
    });

    test('sin consolidaciones no aparece el botón', () => {
        expect(ConsolidationReviewButton({ scoped: [{ id: 'x', loans: [] }] })).toBe('');
    });
});
