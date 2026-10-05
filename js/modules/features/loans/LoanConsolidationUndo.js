/**
 * 🔓 LoanConsolidationUndo — deshace consolidaciones (decisión 2026-10-05).
 *
 * Antes, «Consolidar» cerraba los préstamos de origen como saldados (aunque
 * debían) y creaba uno nuevo cuyo capital era la suma de los saldos. Eso
 * convertía interés en capital, inflaba «Prestado» y hacía ver como perdonado
 * lo que solo se trasladó. La cuenta de préstamos ya cubre lo que se buscaba,
 * así que cada consolidación se deshace y los préstamos vuelven a ser separados:
 *
 *   1. Los préstamos de origen se reabren con su capital e interés reales.
 *   2. El interés propio del préstamo consolidado y sus refinanciamientos pasan
 *      a los de origen como refinanciamientos (motivo «consolidation»),
 *      repartidos según lo que debía cada uno en ese momento.
 *   3. Cada abono del consolidado se reparte con la regla de la cuenta
 *      (interés de todos, luego capital del más viejo), en el mismo orden y con
 *      la misma fecha, nómina y cierre. Origen «conversion»; el abono original
 *      queda anulado con voidReason 'consolidation-undone' y las partes nuevas
 *      lo enlazan con convertedFrom (deshacer el cierre de nómina las anula también).
 *   4. El consolidado queda anulado con consolidationUndone (no se borra) y
 *      guarda una copia de los préstamos de antes para poder revertirlo.
 *
 * El total cobrado en cada nómina no cambia: solo a qué préstamo se aplicó.
 */

import { LOAN_STATUS, REFINANCE_BASES, round2, getBalance, assertLoanEmployeeInScope } from './LoansService.js';
import { getAccountSummary, allocateAccountPayment, getLoanPending, getLoanNumbers, MOVEMENT_ORIGIN } from './LoanAccount.js';

export const CONSOLIDATION_REASON = 'consolidation';
const AUDIT_RE = /\s*\[Consolidado en [^\]]*\]/g;

let _seq = 0;
const genId = prefix => `${prefix}-${Date.now().toString(36)}-${(++_seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const order = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.recordedAt ?? a.createdAt) || 0) - (Number(b.recordedAt ?? b.createdAt) || 0);

/** Consolidaciones del empleado que todavía se pueden deshacer. */
export function findConsolidations(emp) {
    const loans = emp?.loans || [];
    return loans
        .filter(loan => Array.isArray(loan.consolidatedFromLoanIds) && loan.consolidatedFromLoanIds.length && !loan.consolidationUndone)
        .map(loan => ({ loan, sources: loan.consolidatedFromLoanIds.map(id => loans.find(l => String(l.id) === String(id))).filter(Boolean) }))
        .filter(item => item.sources.length);
}

/** Interés propio del consolidado (el % que se le puso al consolidar). */
function ownInterest(loan) {
    return loan.interestIncluded ? 0 : round2(Number(loan.principal || 0) * Number(loan.interestRate || 0) / 100);
}

/** Reparte un monto en proporción a lo que debe cada préstamo (el último absorbe el redondeo). */
function proportional(loans, amount) {
    const bal = loans.map(l => getBalance(l));
    const total = bal.reduce((t, v) => t + v, 0);
    if (!(total > 0)) return loans.map((l, i) => (i === loans.length - 1 ? round2(amount) : 0));
    let left = round2(amount);
    return loans.map((l, i) => {
        if (i === loans.length - 1) return left;
        const v = round2(amount * bal[i] / total);
        left = round2(left - v);
        return v;
    });
}

/**
 * Deshace una consolidación. Muta emp.loans.
 * @returns {{ consolidated, sources, movedPayments, movedInterest }}
 */
export function undoConsolidation(emp, consolidatedLoanId, { by = null, at = Date.now(), projectScope = null } = {}) {
    assertLoanEmployeeInScope(emp, projectScope, 'LoanConsolidationUndo.undoConsolidation');
    const item = findConsolidations(emp).find(c => String(c.loan.id) === String(consolidatedLoanId));
    if (!item) throw new Error('No es una consolidación que se pueda deshacer');
    const { loan: cons, sources } = item;
    const snapshot = clone([cons, ...sources]);
    const before = getAccountSummary(emp).balance;

    // 1. Reabrir los préstamos de origen
    for (const src of sources) {
        src.concept = String(src.concept || '').replace(AUDIT_RE, '').trim() || 'Préstamo';
        src.consolidationUndone = { from: cons.id, at, by };
        delete src.consolidatedIntoLoanId;
        src.status = LOAN_STATUS.ACTIVE;
        src.closedAt = null;
        src.closedBy = null;
        src.updatedAt = at;
    }
    const open = () => sources.filter(s => s.status === LOAN_STATUS.ACTIVE && getBalance(s) > 0.004);
    const addCharge = (amount, date, note, extra = {}) => {
        if (!(amount > 0.004)) return 0;
        const targets = open().length ? open() : sources;
        proportional(targets, amount).forEach((value, i) => {
            if (!(value > 0)) return;
            const target = targets[i];
            if (!Array.isArray(target.refinancings)) target.refinancings = [];
            target.refinancings.push({
                id: genId('REFIN'), date, basis: REFINANCE_BASES.PENDING, baseAmount: 0, interestRate: 0, interestAmount: value,
                note, reason: CONSOLIDATION_REASON, origin: MOVEMENT_ORIGIN.ACCOUNT, accountTxId: extra.txId || null,
                convertedFrom: extra.convertedFrom || null, createdBy: by, createdAt: at, updatedAt: at, voided: false, voidedAt: null
            });
            if (target.status !== LOAN_STATUS.ACTIVE && getBalance(target) > 0.01) { target.status = LOAN_STATUS.ACTIVE; target.closedAt = null; }
        });
        return amount;
    };

    // 2. Interés propio del consolidado
    let movedInterest = addCharge(ownInterest(cons), cons.startDate, `Interés de la consolidación (${cons.interestRate} %)`, { txId: genId('CONV'), convertedFrom: { loanId: cons.id, kind: 'interest' } });

    // 3. Refinanciamientos y abonos del consolidado, en orden
    const events = [
        ...(cons.refinancings || []).filter(r => !r.voided).map(r => ({ kind: 'refi', item: r, date: r.date, createdAt: r.createdAt })),
        ...(cons.payments || []).filter(p => !p.voided).map(p => ({ kind: 'pay', item: p, date: p.date, recordedAt: p.recordedAt }))
    ].sort(order);
    let movedPayments = 0;
    for (const event of events) {
        const original = event.item;
        if (event.kind === 'refi') {
            movedInterest += addCharge(Number(original.interestAmount || 0), original.date, original.note || 'Refinanciamiento de la consolidación', { txId: genId('CONV'), convertedFrom: { loanId: cons.id, refinancingId: original.id } });
            original.voided = true; original.voidedAt = at; original.voidedBy = by; original.voidReason = 'consolidation-undone'; original.updatedAt = at;
            continue;
        }
        const pool = [...sources].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
            .map(loan => ({ loan, number: 0, ...getLoanPending({ ...loan, status: LOAN_STATUS.ACTIVE }) })).filter(x => x.balance > 0.004);
        const { parts, excess } = allocateAccountPayment(pool, Number(original.amount || 0));
        const txId = genId('CONV');
        const pieces = parts.map(p => ({ loan: sources.find(s => s.id === p.loanId), amount: p.amount, allocation: { interest: p.interest, capital: p.capital } }));
        if (excess > 0.004) pieces.push({ loan: sources[sources.length - 1], amount: excess, allocation: { interest: 0, capital: 0 }, excess: true });
        for (const piece of pieces) {
            const payment = {
                id: genId('PAY'), date: original.date, amount: round2(piece.amount), note: original.note || '',
                recordedBy: original.recordedBy || null, recordedAt: Number(original.recordedAt) || at, updatedAt: at,
                voided: false, voidedAt: null, origin: 'conversion', accountTxId: txId, allocation: piece.allocation,
                convertedFrom: { loanId: cons.id, paymentId: original.id }
            };
            for (const field of ['source', 'channel', 'payrollClosureId', 'payrollPeriodStart', 'payrollPeriodEnd']) {
                if (original[field] != null) payment[field] = original[field];
            }
            piece.loan.payments.push(payment);
            piece.loan.updatedAt = at;
        }
        original.voided = true; original.voidedAt = at; original.voidedBy = by; original.voidReason = 'consolidation-undone'; original.updatedAt = at;
        movedPayments += Number(original.amount || 0);
        for (const src of sources) {
            if (src.status === LOAN_STATUS.ACTIVE && getBalance(src) <= 0.01) { src.status = LOAN_STATUS.PAID; src.closedAt = at; src.closedBy = by; }
        }
    }

    // 4. Anular el consolidado (sin borrarlo) y guardar la copia para revertir
    cons.status = LOAN_STATUS.WRITTEN_OFF;
    cons.closedAt = at;
    cons.closedBy = by;
    cons.consolidationUndone = { at, by, sourceIds: sources.map(s => s.id), snapshot };
    cons.updatedAt = at;
    emp.updatedAt = at;
    const after = getAccountSummary(emp).balance;
    return { consolidated: cons, sources, movedPayments: round2(movedPayments), movedInterest: round2(movedInterest), before, after };
}

/** Vista previa sin tocar los datos: cómo queda cada préstamo y la cuenta. */
export function previewUndoConsolidation(emp, consolidatedLoanId) {
    const copy = clone(emp);
    const numbers = getLoanNumbers(emp.loans || []);
    const result = undoConsolidation(copy, consolidatedLoanId, { at: Date.now(), projectScope: { enabled: false } });
    return {
        before: result.before,
        after: result.after,
        movedPayments: result.movedPayments,
        movedInterest: result.movedInterest,
        consolidatedNumber: numbers.get(consolidatedLoanId),
        sources: result.sources.map(src => ({ id: src.id, number: numbers.get(src.id), startDate: src.startDate, principal: src.principal, status: src.status, ...getLoanPending(src) }))
    };
}

/**
 * Revierte una consolidación deshecha: anula las partes convertidas (no las
 * borra, para que la sincronización no las resucite), reactiva los movimientos
 * originales del consolidado y devuelve estados y conceptos de antes.
 */
export function restoreConsolidation(emp, consolidatedLoanId, { by = null, at = Date.now(), projectScope = null } = {}) {
    assertLoanEmployeeInScope(emp, projectScope, 'LoanConsolidationUndo.restoreConsolidation');
    const cons = (emp.loans || []).find(l => String(l.id) === String(consolidatedLoanId));
    const undone = cons?.consolidationUndone;
    if (!undone?.snapshot) throw new Error('Esta consolidación no está deshecha');
    const saved = new Map(undone.snapshot.map(l => [String(l.id), l]));
    for (const loan of emp.loans || []) {
        const old = saved.get(String(loan.id));
        if (!old) continue;
        for (const item of [...(loan.payments || []), ...(loan.refinancings || [])]) {
            if (item.convertedFrom?.loanId === cons.id && !item.voided) {
                item.voided = true; item.voidedAt = at; item.voidedBy = by; item.voidReason = 'consolidation-restored'; item.updatedAt = at;
            }
            if (loan.id === cons.id && item.voidReason === 'consolidation-undone') {
                item.voided = false; item.voidedAt = null; item.voidedBy = null; item.voidReason = null; item.updatedAt = at;
            }
        }
        for (const key of ['status', 'closedAt', 'closedBy', 'concept', 'consolidatedIntoLoanId']) {
            if (old[key] === undefined) delete loan[key]; else loan[key] = old[key];
        }
        loan.consolidationUndone = null;
        loan.updatedAt = at;
    }
    emp.updatedAt = at;
    return cons;
}
