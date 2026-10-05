/**
 * 🧾 LoanAccount — la «cuenta de préstamos» de un empleado en una obra.
 *
 * Junta todos los préstamos abiertos del empleado y trabaja sobre ellos como
 * un solo saldo:
 *   - Abono a la cuenta: primero el interés de todos los préstamos, después el
 *     capital empezando por el más viejo. Se guarda como un abono por préstamo
 *     con el mismo accountTxId y el reparto del momento (allocation).
 *   - Refinanciamiento de la cuenta: interés sobre lo vencido, repartido entre
 *     los préstamos, con motivo obligatorio. Pasa el cobro a la nómina siguiente.
 *   - Cada movimiento dice su origen: desde la cuenta, directo en el préstamo o
 *     descuento de nómina.
 *
 * Cierres de nómina (decisiones del 2026-10-05):
 *   - Un movimiento ligado a un cierre vigente (payrollClosureId) no se toca.
 *     Para corregirlo hay dos caminos: un AJUSTE en la nómina abierta que
 *     devuelve exactamente lo que el movimiento tocó, o CORREGIR EL CIERRE
 *     (solo por error, con motivo, guardando el antes y el resultado).
 *   - Un préstamo es libre de editar mientras ninguno de sus movimientos esté
 *     en un cierre. Al anular un movimiento abierto, los abonos a la cuenta
 *     posteriores (también abiertos) se vuelven a repartir.
 *
 * También: número de préstamo (#1, #2…), edición con historial, cierre con
 * motivo (error, perdonado u otro) y acuerdo de pago por nómina.
 *
 * Funciones puras sobre `emp` (mutan emp.loans / emp.loanAgreements y nada
 * más). Si una operación de varios préstamos falla a medias, se restaura el
 * estado anterior. El llamador guarda con saveApplicationData().
 */

import {
    LOAN_STATUS,
    INSTALLMENT_MODE,
    REFINANCE_BASES,
    round2,
    getBalance,
    recordPayment,
    refinanceLoan,
    voidPayment,
    voidRefinancing,
    writeOffLoan,
    validateLoanInput,
    generateInstallmentSchedule,
    assertLoanEmployeeInScope
} from './LoansService.js';
import { replayLoan } from './LoanTimeline.js';

// ─── Constantes ──────────────────────────────────────────────────────────────

export const MOVEMENT_ORIGIN = Object.freeze({
    ACCOUNT: 'account',     // desde la tarjeta principal (se reparte)
    DIRECT: 'direct',       // hecho en un préstamo
    PAYROLL: 'payroll',     // descuento de nómina registrado por el cierre
    ADJUSTMENT: 'adjustment' // ajuste que corrige un movimiento de una nómina cerrada
});

export const CLOSE_REASON = Object.freeze({
    ERROR: 'error',         // el préstamo no debió existir: sale de todo
    FORGIVEN: 'forgiven',   // se le perdona lo que falta
    OTHER: 'other'          // otro motivo, con nota obligatoria
});

export const REFINANCE_REASON = Object.freeze({
    PAYROLL_SHORT: 'payroll-short', // no le alcanzó la nómina
    NOT_WORKED: 'not-worked',       // no trabajó el periodo
    AGREEMENT: 'agreement',         // acuerdo con el empleado
    OTHER: 'other'
});

export const AGREEMENT_INTEREST = Object.freeze({ NONE: 'none', RATE: 'rate' });
export const AGREEMENT_NEW_LOANS = Object.freeze({ INCLUDE: 'include', REVIEW: 'review' });

export const VOID_MODE = Object.freeze({
    VOID: 'void',               // anular (solo movimientos sin cierre)
    ADJUST: 'adjust',           // ajuste en la nómina abierta; el cierre no cambia
    FIX_CLOSURE: 'fix-closure'  // corregir el cierre por error: motivo + antes/después
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON = 3;
const hasText = (text, min = MIN_REASON) => String(text || '').trim().length >= min;

export class LoanMovementLockedError extends Error {
    constructor(closureIds = [], message = null) {
        super(message || 'Este movimiento está en un cierre de nómina: corrígelo con un ajuste o corrigiendo el cierre');
        this.name = 'LoanMovementLockedError';
        this.code = 'LOAN_MOVEMENT_LOCKED';
        this.closureIds = closureIds;
    }
}

let _seq = 0;
function genId(prefix) {
    _seq++;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}-${rand}`;
}

function scopeOf(options = {}) {
    return options?.projectScope ?? options?.scope ?? null;
}

function findLoan(emp, loanId) {
    const loan = (emp?.loans || []).find(l => String(l.id) === String(loanId));
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    return loan;
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Ejecuta una operación de varios préstamos; si falla, deja emp como estaba. */
function withRollback(emp, fn) {
    const loans = clone(emp.loans);
    const agreements = clone(emp.loanAgreements);
    const updatedAt = emp.updatedAt;
    try {
        return fn();
    } catch (error) {
        emp.loans = loans;
        if (agreements === undefined) delete emp.loanAgreements; else emp.loanAgreements = agreements;
        emp.updatedAt = updatedAt;
        throw error;
    }
}

function touch(emp, loan, now = Date.now()) {
    if (loan) loan.updatedAt = now;
    emp.updatedAt = now;
}

/** Vuelve a calcular el estado activo/saldado después de un cambio de montos. */
function refreshStatus(loan, by = null, now = Date.now()) {
    if (loan.status === LOAN_STATUS.WRITTEN_OFF) return;
    const balance = getBalance(loan);
    if (loan.status === LOAN_STATUS.ACTIVE && balance <= 0.01) {
        loan.status = LOAN_STATUS.PAID;
        loan.closedAt = now;
        loan.closedBy = by;
    } else if (loan.status === LOAN_STATUS.PAID && balance > 0.01 && !loan.closure) {
        loan.status = LOAN_STATUS.ACTIVE;
        loan.closedAt = null;
        loan.closedBy = null;
    }
}

const itemStamp = item => Number(item?.recordedAt ?? item?.createdAt) || 0;
const itemOrder = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || itemStamp(a) - itemStamp(b);

// ─── Cierres de nómina ───────────────────────────────────────────────────────

/** Ids de los cierres vigentes (status 'closed'); los deshechos no bloquean. */
export function activeClosureIdsFrom(closures = []) {
    return new Set((closures || [])
        .filter(closure => closure && closure.status === 'closed' && closure.id != null)
        .map(closure => String(closure.id)));
}

/**
 * Cierre que bloquea un abono o refinanciamiento, o null. Sin la lista de
 * cierres vigentes se asume que todo payrollClosureId bloquea (lo seguro).
 */
export function getMovementLock(item, { activeClosureIds = null } = {}) {
    if (!item || item.voided || !item.payrollClosureId) return null;
    const id = String(item.payrollClosureId);
    if (activeClosureIds && !activeClosureIds.has(id)) return null;
    return id;
}

/** Primer cierre que bloquea el préstamo (decisión 2: basta un movimiento). */
export function getLoanLock(loan, options = {}) {
    for (const item of [...(loan?.payments || []), ...(loan?.refinancings || [])]) {
        const lock = getMovementLock(item, options);
        if (lock) return lock;
    }
    return null;
}

// ─── Número, saldos y vencimiento ────────────────────────────────────────────

const createdOrder = loan => Number(loan?.createdAt) || Date.parse(loan?.startDate || '') || 0;

/** Número de cada préstamo del empleado (#1, #2…) por orden de creación. */
export function getLoanNumbers(loans = []) {
    // Número fijo guardado (fase D): se usa si todos lo tienen y no se repite.
    const list = loans || [];
    if (list.length && list.every(l => Number.isInteger(l.number)) && new Set(list.map(l => l.number)).size === list.length) {
        return new Map(list.map(l => [l.id, l.number]));
    }
    const sorted = [...(loans || [])].sort((a, b) => createdOrder(a) - createdOrder(b)
        || String(a.startDate || '').localeCompare(String(b.startDate || ''))
        || String(a.id).localeCompare(String(b.id)));
    return new Map(sorted.map((loan, index) => [loan.id, index + 1]));
}

/** Pendiente de un préstamo partido en interés y capital (interés primero). */
export function getLoanPending(loan) {
    if (!loan || loan.status !== LOAN_STATUS.ACTIVE) return { capital: 0, interest: 0, balance: 0 };
    const balance = getBalance(loan);
    const replay = replayLoan(loan);
    const interest = round2(Math.max(0, Math.min(replay.interest, balance)));
    return { capital: round2(balance - interest), interest, balance };
}

/**
 * Nómina (día de pago) en que se cobra el préstamo: la que puso el último
 * refinanciamiento, salvo que una edición posterior la haya cambiado.
 */
export function getLoanDueDate(loan) {
    const setAt = Number(loan?.dueDateSetAt) || 0;
    const refi = (loan?.refinancings || [])
        .filter(event => !event.voided && !event.adjustment && event.nextDueDate && (Number(event.createdAt) || 0) > setAt)
        .sort((a, b) => itemOrder(a, b))
        .at(-1);
    return refi?.nextDueDate || loan?.dueDate || null;
}

/** Cuántos días de pago pasaron sin cobrar el préstamo (0 = al día). */
export function countMissedPayDates(loan, payDates = [], today) {
    const due = getLoanDueDate(loan);
    if (!due || !today || loan?.status !== LOAN_STATUS.ACTIVE) return 0;
    return [...new Set(payDates)].filter(day => day >= due && day < today).length;
}

/** Obra de la cuenta a la que pertenece un préstamo. */
export function accountProjectId(emp, loan) {
    return loan?.projectId ?? emp?.projectId ?? null;
}

function accountLoans(emp, options = {}) {
    const hasProject = Object.prototype.hasOwnProperty.call(options, 'projectId');
    return (emp?.loans || []).filter(loan => !hasProject || accountProjectId(emp, loan) === options.projectId);
}

/**
 * Resumen de la cuenta: préstamos abiertos del más viejo al más nuevo, con su
 * número, interés y capital pendientes, y la nómina en que se cobran.
 */
export function getAccountSummary(emp, options = {}) {
    const all = accountLoans(emp, options);
    const numbers = getLoanNumbers(emp?.loans || []);
    const loans = all
        .filter(loan => loan.status === LOAN_STATUS.ACTIVE)
        .map(loan => ({ loan, number: numbers.get(loan.id), dueDate: getLoanDueDate(loan), lock: getLoanLock(loan, options), ...getLoanPending(loan) }))
        .filter(item => item.balance > 0.004)
        .sort((a, b) => String(a.loan.startDate || '').localeCompare(String(b.loan.startDate || '')) || a.number - b.number);
    const sum = key => round2(loans.reduce((total, item) => total + item[key], 0));
    return { loans, count: loans.length, capital: sum('capital'), interest: sum('interest'), balance: sum('balance') };
}

// ─── Abonos ──────────────────────────────────────────────────────────────────

/** Reparte un monto: interés de todos, luego capital del más viejo. */
export function allocateAccountPayment(summaryLoans = [], amount = 0) {
    let left = round2(Math.max(0, Number(amount) || 0));
    const parts = summaryLoans.map(item => ({ loanId: item.loan.id, number: item.number, interest: 0, capital: 0 }));
    summaryLoans.forEach((item, index) => {
        const value = round2(Math.min(left, item.interest));
        parts[index].interest = value;
        left = round2(left - value);
    });
    summaryLoans.forEach((item, index) => {
        const value = round2(Math.min(left, item.capital));
        parts[index].capital = value;
        left = round2(left - value);
    });
    return {
        parts: parts.filter(part => part.interest > 0 || part.capital > 0)
            .map(part => ({ ...part, amount: round2(part.interest + part.capital) })),
        excess: left
    };
}

export function previewAccountPayment(emp, amount, options = {}) {
    return allocateAccountPayment(getAccountSummary(emp, options).loans, amount);
}

function paymentParams(params, part, txId, origin) {
    const out = {
        amount: part.amount,
        date: params.date,
        note: params.note || '',
        recordedBy: params.recordedBy || null,
        origin,
        accountTxId: txId,
        allocation: { interest: part.interest, capital: part.capital }
    };
    for (const field of ['recordedAt', 'source', 'channel', 'payrollPeriodStart', 'payrollPeriodEnd', 'payrollClosureId']) {
        if (params[field] != null) out[field] = params[field];
    }
    return out;
}

/**
 * Abono a la cuenta. Crea un abono por préstamo tocado, todos con el mismo
 * accountTxId. No acepta más de lo que debe (el saldo a favor llega después).
 */
export function recordAccountPayment(emp, params = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.recordAccountPayment');
    const amount = round2(Number(params.amount));
    if (!(amount > 0)) throw new Error('El abono debe ser mayor a 0');
    if (!ISO_DAY.test(String(params.date || ''))) throw new Error('La fecha del abono es obligatoria');
    const { parts, excess } = previewAccountPayment(emp, amount, options);
    if (!parts.length) throw new Error('La cuenta no tiene saldo pendiente');
    if (excess > 0.01) throw new Error(`El abono pasa de lo que debe por ${excess.toFixed(2)}`);
    const txId = params.accountTxId || genId('ACCT');
    const payments = withRollback(emp, () => parts.map(part =>
        recordPayment(emp, part.loanId, paymentParams(params, part, txId, MOVEMENT_ORIGIN.ACCOUNT), options)));
    return { accountTxId: txId, payments, parts };
}

/** Abono hecho en un solo préstamo: guarda su reparto y el origen «directo». */
export function recordDirectPayment(emp, loanId, params = {}, options = {}) {
    const loan = findLoan(emp, loanId);
    const pending = getLoanPending(loan);
    const amount = round2(Number(params.amount));
    const interest = round2(Math.min(amount, pending.interest));
    const part = { loanId: loan.id, amount, interest, capital: round2(Math.max(0, amount - interest)) };
    const origin = params.source === 'payroll' ? MOVEMENT_ORIGIN.PAYROLL : MOVEMENT_ORIGIN.DIRECT;
    return recordPayment(emp, loan.id, paymentParams(params, part, null, origin), options);
}

// ─── Refinanciamiento ────────────────────────────────────────────────────────

/**
 * Refinancia lo vencido de la cuenta (o los préstamos elegidos). Motivo
 * obligatorio; con «otro» también la nota. Cada préstamo pasa a cobrarse en
 * nextDueDate.
 */
export function refinanceAccount(emp, params = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.refinanceAccount');
    if (!Object.values(REFINANCE_REASON).includes(params.reason)) throw new Error('Elige el motivo del refinanciamiento');
    if (params.reason === REFINANCE_REASON.OTHER && !hasText(params.note)) throw new Error('Con «otro motivo» la nota es obligatoria');
    if (!ISO_DAY.test(String(params.date || ''))) throw new Error('Indica la nómina que no alcanzó (día de pago)');
    if (params.nextDueDate && !ISO_DAY.test(String(params.nextDueDate))) throw new Error('La nueva nómina de cobro debe ser una fecha');
    const basis = params.basis === 'capital' ? REFINANCE_BASES.CAPITAL : REFINANCE_BASES.BALANCE;
    const summary = getAccountSummary(emp, options);
    const ids = Array.isArray(params.loanIds) ? new Set(params.loanIds.map(String)) : null;
    const targets = summary.loans.filter(item => ids
        ? ids.has(String(item.loan.id))
        : (!item.dueDate || item.dueDate <= params.date));
    if (!targets.length) throw new Error('No hay préstamos vencidos con saldo para refinanciar');
    const origin = params.origin || (ids && ids.size === 1 ? MOVEMENT_ORIGIN.DIRECT : MOVEMENT_ORIGIN.ACCOUNT);
    const txId = genId('ACCT');
    const events = withRollback(emp, () => targets.map(item => refinanceLoan(emp, item.loan.id, {
        interestRate: Number(params.interestRate),
        basis,
        date: params.date,
        note: params.note || '',
        createdBy: params.createdBy || null,
        origin,
        accountTxId: txId,
        reason: params.reason,
        payrollPeriodStart: params.payrollPeriodStart,
        payrollPeriodEnd: params.payrollPeriodEnd,
        nextDueDate: params.nextDueDate
    }, options)));
    return { accountTxId: txId, events, total: round2(events.reduce((t, e) => t + Number(e.interestAmount || 0), 0)) };
}

// ─── Anular, ajustar o corregir un cierre ────────────────────────────────────

/** Partes (abonos/refinanciamientos por préstamo) de un movimiento. */
export function getMovementParts(emp, ref = {}) {
    const parts = [];
    for (const loan of emp?.loans || []) {
        for (const payment of loan.payments || []) {
            const hit = ref.accountTxId ? payment.accountTxId === ref.accountTxId
                : ref.paymentId != null && String(payment.id) === String(ref.paymentId) && (!ref.loanId || String(loan.id) === String(ref.loanId));
            if (hit) parts.push({ loan, item: payment, kind: 'payment' });
        }
        for (const event of loan.refinancings || []) {
            const hit = ref.accountTxId ? event.accountTxId === ref.accountTxId
                : ref.refinancingId != null && String(event.id) === String(ref.refinancingId) && (!ref.loanId || String(loan.id) === String(ref.loanId));
            if (hit) parts.push({ loan, item: event, kind: 'refinancing' });
        }
    }
    return parts;
}

/** Interés y capital que tocó un abono (lo guardado, o reproduciendo el préstamo). */
export function getPaymentSplit(loan, payment) {
    if (payment?.allocation) return { interest: round2(payment.allocation.interest), capital: round2(payment.allocation.capital) };
    const step = replayLoan(loan).steps.find(s => s.kind === 'payment' && String(s.id) === String(payment?.id));
    if (!step) return { interest: 0, capital: round2(Number(payment?.amount || 0)) };
    return { interest: round2(-step.delta.interest), capital: round2(-step.delta.capital) };
}

function accountBalance(emp, options) {
    return getAccountSummary(emp, options).balance;
}

/**
 * Vuelve a repartir los abonos a la cuenta posteriores a `after` que no están
 * en un cierre. Anula sus partes y las registra de nuevo con el mismo
 * accountTxId (reallocatedFrom guarda los ids anteriores).
 */
function reallocateLaterAccountPayments(emp, after, skipTxId, options) {
    const groups = new Map();
    for (const loan of emp.loans || []) {
        for (const payment of loan.payments || []) {
            if (payment.voided || !payment.accountTxId || payment.accountTxId === skipTxId || payment.adjustment) continue;
            if (itemOrder(payment, after) <= 0) continue;
            if (!groups.has(payment.accountTxId)) groups.set(payment.accountTxId, []);
            groups.get(payment.accountTxId).push({ loan, payment });
        }
    }
    const txs = [...groups.entries()]
        .filter(([, parts]) => !parts.some(part => getMovementLock(part.payment, options)))
        .map(([txId, parts]) => ({ txId, parts, first: parts.map(p => p.payment).sort(itemOrder)[0] }))
        .sort((a, b) => itemOrder(a.first, b.first));
    if (!txs.length) return [];
    const by = options.by || null;
    for (const tx of txs) {
        for (const { loan, payment } of tx.parts) {
            if (!payment.allocation) payment.allocation = getPaymentSplit(loan, payment);
            voidPayment(emp, loan.id, payment.id, by, options);
            payment.voidReason = 'reallocated';
        }
    }
    const result = [];
    for (const tx of txs) {
        const first = tx.first;
        const amount = round2(tx.parts.reduce((t, p) => t + Number(p.payment.amount || 0), 0));
        const { parts, excess } = previewAccountPayment(emp, amount, options);
        if (excess > 0.01) throw new Error(`No se puede volver a repartir el abono del ${first.date}: pasaría de lo que debe`);
        const params = { ...first, amount, recordedAt: first.recordedAt, reallocatedFrom: tx.parts.map(p => p.payment.id) };
        const payments = parts.map(part => recordPayment(emp, part.loanId, {
            ...paymentParams(params, part, tx.txId, MOVEMENT_ORIGIN.ACCOUNT),
            reallocatedFrom: params.reallocatedFrom
        }, options));
        result.push({ accountTxId: tx.txId, payments });
    }
    return result;
}

/**
 * Anula un movimiento (abono o refinanciamiento, de la cuenta o directo).
 *
 * @param {object} ref  { accountTxId } o { loanId, paymentId } o { loanId, refinancingId }
 * @param {object} options
 *   mode: 'void' (por defecto) | 'adjust' | 'fix-closure'
 *   reason: obligatorio para 'fix-closure'
 *   by, activeClosureIds, date (fecha del ajuste), payrollPeriodStart/End
 * @returns {{mode, parts, reallocated?, adjustmentTxId?, before?, after?}}
 */
export function voidAccountMovement(emp, ref = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.voidAccountMovement');
    const mode = options.mode || VOID_MODE.VOID;
    const parts = getMovementParts(emp, ref).filter(part => !part.item.voided);
    if (!parts.length) throw new Error('Movimiento no encontrado o ya anulado');
    if (parts.some(part => part.item.adjustedBy)) throw new Error('Este movimiento ya tiene un ajuste');
    const locks = [...new Set(parts.map(part => getMovementLock(part.item, options)).filter(Boolean))];
    const by = options.by || null;
    const now = Number(options.at) || Date.now();

    if (mode === VOID_MODE.VOID && locks.length) throw new LoanMovementLockedError(locks);
    if (mode === VOID_MODE.FIX_CLOSURE && !hasText(options.reason)) throw new Error('Escribe el motivo para corregir el cierre');
    if (mode === VOID_MODE.ADJUST && !ISO_DAY.test(String(options.date || ''))) throw new Error('Indica la fecha del ajuste (nómina abierta)');

    return withRollback(emp, () => {
        if (mode === VOID_MODE.ADJUST) {
            const txId = genId('ADJ');
            for (const { loan, item, kind } of parts) {
                if (kind === 'payment') {
                    const split = getPaymentSplit(loan, item);
                    loan.payments.push({
                        id: genId('PAY'), date: options.date, amount: -round2(split.interest + split.capital),
                        note: String(options.reason || '').trim(), recordedBy: by, recordedAt: now, updatedAt: now,
                        voided: false, voidedAt: null, origin: MOVEMENT_ORIGIN.ADJUSTMENT, accountTxId: txId,
                        payrollPeriodStart: options.payrollPeriodStart || undefined, payrollPeriodEnd: options.payrollPeriodEnd || undefined,
                        adjustment: { ofId: item.id, ofKind: kind, interest: split.interest, capital: split.capital, lockedClosureId: getMovementLock(item, options) }
                    });
                } else {
                    if (!Array.isArray(loan.refinancings)) loan.refinancings = [];
                    loan.refinancings.push({
                        id: genId('REFIN'), date: options.date, basis: REFINANCE_BASES.PENDING, baseAmount: 0, interestRate: 0,
                        interestAmount: -round2(Number(item.interestAmount || 0)), note: String(options.reason || '').trim(),
                        createdBy: by, createdAt: now, updatedAt: now, voided: false, voidedAt: null,
                        origin: MOVEMENT_ORIGIN.ADJUSTMENT, accountTxId: txId,
                        adjustment: { ofId: item.id, ofKind: kind, lockedClosureId: getMovementLock(item, options) }
                    });
                }
                item.adjustedBy = txId;
                item.updatedAt = now;
                refreshStatus(loan, by, now);
                touch(emp, loan, now);
            }
            return { mode, parts, adjustmentTxId: txId };
        }

        const before = accountBalance(emp, options);
        for (const { loan, item, kind } of parts) {
            // El reparto se congela antes de anular: anulado ya no sale en la línea de tiempo.
            if (kind === 'payment' && !item.allocation) item.allocation = getPaymentSplit(loan, item);
            if (kind === 'payment') voidPayment(emp, loan.id, item.id, by, options);
            else voidRefinancing(emp, loan.id, item.id, by, options);
            if (mode === VOID_MODE.FIX_CLOSURE && locks.length) item.voidReason = 'closure-fix';
        }
        const first = parts.map(part => part.item).sort(itemOrder)[0];
        const reallocated = reallocateLaterAccountPayments(emp, first, parts[0].item.accountTxId || null, { ...options, by });
        const after = accountBalance(emp, options);
        if (mode === VOID_MODE.FIX_CLOSURE && locks.length) {
            const fix = { reason: String(options.reason).trim(), by, at: now, closureIds: locks, before: { accountBalance: before }, after: { accountBalance: after } };
            for (const { item } of parts) { item.closureFix = fix; item.updatedAt = now; }
        }
        return { mode, parts, reallocated, before, after };
    });
}

// ─── Editar préstamo ─────────────────────────────────────────────────────────

const EDITABLE = ['principal', 'interestRate', 'startDate', 'dueDate', 'concept'];

function normalizeField(key, value) {
    if (key === 'principal') return round2(Number(value));
    if (key === 'interestRate') return Number(value);
    if (key === 'concept') return String(value || '').trim() || 'Préstamo';
    return value || null;
}

/**
 * Corrige monto, interés, fecha, nómina de cobro o concepto. Guarda el antes,
 * el después, el motivo y el saldo antes/después en loan.edits[]. Si el
 * préstamo está en un cierre, el motivo es obligatorio y queda marcado como
 * corrección de cierre.
 */
export function editLoan(emp, loanId, changes = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.editLoan');
    const loan = findLoan(emp, loanId);
    if (loan.status === LOAN_STATUS.WRITTEN_OFF) throw new Error('No se puede editar un préstamo anulado');
    const lock = getLoanLock(loan, options);
    if (lock && !hasText(options.reason)) {
        throw new LoanMovementLockedError([lock], 'Este préstamo está en un cierre de nómina: escribe el motivo de la corrección');
    }
    const before = {};
    const after = {};
    for (const key of EDITABLE) {
        if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
        const next = normalizeField(key, changes[key]);
        const prev = key === 'dueDate' ? (loan.dueDate ?? null) : loan[key];
        if (next === prev) continue;
        before[key] = prev ?? null;
        after[key] = next;
    }
    if (!Object.keys(after).length) throw new Error('No hay cambios para guardar');
    const merged = { ...loan, ...after, installmentMode: INSTALLMENT_MODE.LUMP };
    const { valid, errors } = validateLoanInput(merged);
    if (!valid) throw new Error(errors.join('. '));
    if (after.dueDate && !ISO_DAY.test(after.dueDate)) throw new Error('La nómina de cobro debe ser una fecha');
    const moneyChanged = 'principal' in after || 'interestRate' in after;
    const hasPayments = (loan.payments || []).some(p => !p.voided);
    if (loan.installmentMode === INSTALLMENT_MODE.INSTALLMENTS && moneyChanged && hasPayments) {
        throw new Error('Préstamo en cuotas con abonos: corrige el monto anulando los abonos o refinanciando');
    }

    const now = Number(options.at) || Date.now();
    const balanceBefore = getBalance(loan);
    Object.assign(loan, after);
    if ('dueDate' in after) loan.dueDateSetAt = now;
    if (loan.installmentMode === INSTALLMENT_MODE.INSTALLMENTS && (moneyChanged || 'startDate' in after)) {
        loan.installments = generateInstallmentSchedule({
            principal: loan.principal, interestRate: loan.interestRate, interestIncluded: !!loan.interestIncluded,
            startDate: loan.startDate, count: (loan.installments || []).length || 2,
            frequencyWeeks: Number(loan.installmentFrequencyWeeks || 2)
        });
    }
    refreshStatus(loan, options.by || null, now);
    const edit = {
        id: genId('EDIT'), at: now, by: options.by || null, reason: String(options.reason || '').trim(),
        before, after, closureIds: lock ? [lock] : [], closureEdit: !!lock,
        balanceBefore, balanceAfter: getBalance(loan), updatedAt: now, voided: false, voidedAt: null
    };
    if (!Array.isArray(loan.edits)) loan.edits = [];
    loan.edits.push(edit);
    touch(emp, loan, now);
    return edit;
}

/** Deshace la última edición vigente del préstamo (vuelven los datos de antes). */
export function undoLoanEdit(emp, loanId, editId, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.undoLoanEdit');
    const loan = findLoan(emp, loanId);
    const live = (loan.edits || []).filter(edit => !edit.voided);
    const edit = live.at(-1);
    if (!edit || String(edit.id) !== String(editId)) throw new Error('Solo se puede deshacer la última corrección del préstamo');
    const now = Number(options.at) || Date.now();
    Object.assign(loan, edit.before);
    if ('dueDate' in edit.before) loan.dueDateSetAt = now;
    edit.voided = true;
    edit.voidedAt = now;
    edit.voidedBy = options.by || null;
    edit.updatedAt = now;
    refreshStatus(loan, options.by || null, now);
    touch(emp, loan, now);
    return edit;
}

// ─── Cerrar préstamo con motivo ──────────────────────────────────────────────

/**
 * Cierra un préstamo con motivo obligatorio:
 *   - error: no debió existir; solo sin abonos ni refinanciamientos. Sale de todo.
 *   - forgiven: se perdona lo que falta (guarda capital e interés perdonados).
 *   - other: se da por cerrado con nota obligatoria.
 */
export function closeLoanWithReason(emp, loanId, params = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.closeLoanWithReason');
    const loan = findLoan(emp, loanId);
    const reason = params.reason;
    if (!Object.values(CLOSE_REASON).includes(reason)) throw new Error('Elige por qué se cierra el préstamo');
    if (loan.status !== LOAN_STATUS.ACTIVE) throw new Error('Solo se pueden cerrar préstamos abiertos');
    if (reason === CLOSE_REASON.OTHER && !hasText(params.note)) throw new Error('Con «otro motivo» la nota es obligatoria');
    const now = Number(params.at) || Date.now();
    const by = params.by || null;
    const note = String(params.note || '').trim();
    if (reason === CLOSE_REASON.ERROR) {
        const touched = (loan.payments || []).some(p => !p.voided) || (loan.refinancings || []).some(r => !r.voided);
        if (touched) throw new Error('Tiene abonos o refinanciamientos: anúlalos primero o usa otro motivo');
        writeOffLoan(emp, loan.id, by, options);
        loan.closure = { reason, note, at: now, by, updatedAt: now };
        return loan.closure;
    }
    const pending = getLoanPending(loan);
    loan.status = LOAN_STATUS.PAID;
    loan.closedAt = now;
    loan.closedBy = by;
    loan.closure = { reason, note, at: now, by, forgiven: { capital: pending.capital, interest: pending.interest }, updatedAt: now };
    touch(emp, loan, now);
    return loan.closure;
}

/** Deshace el cierre con motivo: el préstamo vuelve a quedar abierto con su saldo. */
export function undoLoanClosure(emp, loanId, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.undoLoanClosure');
    const loan = findLoan(emp, loanId);
    if (!loan.closure) throw new Error('El préstamo no tiene un cierre con motivo');
    const now = Number(options.at) || Date.now();
    loan.closureHistory = [...(loan.closureHistory || []), { ...loan.closure, undoneAt: now, undoneBy: options.by || null }];
    delete loan.closure;
    const balance = getBalance(loan);
    loan.status = balance > 0.01 ? LOAN_STATUS.ACTIVE : LOAN_STATUS.PAID;
    loan.closedAt = loan.status === LOAN_STATUS.PAID ? now : null;
    loan.closedBy = loan.status === LOAN_STATUS.PAID ? (options.by || null) : null;
    touch(emp, loan, now);
    return loan;
}

// ─── Acuerdo de pago ─────────────────────────────────────────────────────────

const agreementsOf = emp => (Array.isArray(emp?.loanAgreements) ? emp.loanAgreements : []);

export function getActiveLoanAgreement(emp, options = {}) {
    const hasProject = Object.prototype.hasOwnProperty.call(options, 'projectId');
    return agreementsOf(emp)
        .filter(a => !a.voided && (!hasProject || (a.projectId ?? emp?.projectId ?? null) === options.projectId))
        .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
        .at(-1) || null;
}

/** Monto mínimo sugerido: cubre todo el interés pendiente (solo sugerencia). */
export function suggestedAgreementMinimum(emp, options = {}) {
    return Math.ceil(getAccountSummary(emp, options).interest / 100) * 100;
}

/** Guarda (o cambia) el acuerdo de pago. El anterior queda anulado y enlazado. */
export function saveLoanAgreement(emp, params = {}, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.saveLoanAgreement');
    const amount = round2(Number(params.amount));
    if (!(amount > 0)) throw new Error('El monto por nómina debe ser mayor a 0');
    if (!ISO_DAY.test(String(params.startPayDate || ''))) throw new Error('Indica desde qué nómina (día de pago)');
    const interestMode = params.interestMode === AGREEMENT_INTEREST.RATE ? AGREEMENT_INTEREST.RATE : AGREEMENT_INTEREST.NONE;
    const rate = interestMode === AGREEMENT_INTEREST.RATE ? Number(params.rate) : 0;
    if (interestMode === AGREEMENT_INTEREST.RATE && !(rate > 0 && rate <= 100)) throw new Error('El % de interés debe estar entre 0 y 100');
    const now = Number(params.at) || Date.now();
    const projectId = params.projectId ?? emp?.projectId ?? null;
    const previous = getActiveLoanAgreement(emp, { projectId });
    const agreement = {
        id: genId('AGR'), projectId, amount, startPayDate: params.startPayDate,
        interestMode, rate,
        onNewLoan: params.onNewLoan === AGREEMENT_NEW_LOANS.REVIEW ? AGREEMENT_NEW_LOANS.REVIEW : AGREEMENT_NEW_LOANS.INCLUDE,
        note: String(params.note || '').trim(),
        belowInterest: amount < getAccountSummary(emp, options).interest,
        replaces: previous ? previous.id : null,
        createdAt: now, createdBy: params.by || null, updatedAt: now, voided: false, voidedAt: null
    };
    if (previous) {
        previous.voided = true;
        previous.voidedAt = now;
        previous.replacedBy = agreement.id;
        previous.updatedAt = now;
    }
    emp.loanAgreements = [...agreementsOf(emp), agreement];
    emp.updatedAt = now;
    return agreement;
}

export function cancelLoanAgreement(emp, agreementId, options = {}) {
    assertLoanEmployeeInScope(emp, scopeOf(options), 'LoanAccount.cancelLoanAgreement');
    const agreement = agreementsOf(emp).find(a => String(a.id) === String(agreementId));
    if (!agreement) throw new Error('Acuerdo no encontrado');
    if (agreement.voided) return agreement;
    const now = Number(options.at) || Date.now();
    agreement.voided = true;
    agreement.voidedAt = now;
    agreement.voidedBy = options.by || null;
    agreement.updatedAt = now;
    emp.updatedAt = now;
    return agreement;
}

/** Proyección nómina por nómina de un acuerdo (máximo payDates.length filas). */
export function projectLoanAgreement(balance, agreement = {}, payDates = []) {
    let left = round2(balance);
    const rows = [];
    let grows = false;
    for (const payDate of payDates) {
        if (left <= 0.004) break;
        const charge = round2(Math.min(agreement.amount, left));
        left = round2(left - charge);
        const extra = agreement.interestMode === AGREEMENT_INTEREST.RATE && left > 0.004 ? round2(left * agreement.rate / 100) : 0;
        left = round2(left + extra);
        if (rows.length && left >= rows.at(-1).left) grows = true;
        rows.push({ payDate, charge, extra, left });
    }
    return { rows, done: left <= 0.004, grows, extraTotal: round2(rows.reduce((t, r) => t + r.extra, 0)) };
}

// ─── Movimientos de la cuenta ────────────────────────────────────────────────

function originOf(item) {
    if (item.origin) return item.origin;
    return item.source === 'payroll' ? MOVEMENT_ORIGIN.PAYROLL : MOVEMENT_ORIGIN.DIRECT;
}

/**
 * Lista única de movimientos (más reciente primero): préstamos, abonos y
 * refinanciamientos (agrupados por accountTxId), ajustes, ediciones, cierres
 * con motivo y acuerdos. Incluye los anulados (voided: true).
 */
export function getAccountMovements(emp, options = {}) {
    const numbers = getLoanNumbers(emp?.loans || []);
    const out = [];
    const groups = new Map();
    const group = (key, base) => {
        if (!groups.has(key)) { groups.set(key, { ...base, parts: [] }); out.push(groups.get(key)); }
        return groups.get(key);
    };
    for (const loan of accountLoans(emp, options)) {
        const number = numbers.get(loan.id);
        out.push({ kind: 'loan', id: `loan:${loan.id}`, date: loan.startDate, at: Number(loan.createdAt) || 0, loanId: loan.id, number, amount: getBalanceBase(loan), voided: loan.status === LOAN_STATUS.WRITTEN_OFF && loan.closure?.reason === CLOSE_REASON.ERROR });
        for (const payment of loan.payments || []) {
            const isAdj = !!payment.adjustment;
            const g = group(payment.accountTxId || `pay:${payment.id}`, {
                kind: isAdj ? 'adjustment' : 'payment', id: payment.accountTxId || payment.id, date: payment.date,
                at: Number(payment.recordedAt) || 0, origin: originOf(payment), note: payment.note || '',
                accountTxId: payment.accountTxId || null
            });
            const split = isAdj ? { interest: payment.adjustment.interest, capital: payment.adjustment.capital } : getPaymentSplit(loan, payment);
            g.parts.push({ loanId: loan.id, number, itemId: payment.id, amount: Number(payment.amount || 0), ...split, voided: !!payment.voided, needsReview: !!payment.needsReview, voidReason: payment.voidReason || null, lock: getMovementLock(payment, options), adjustedBy: payment.adjustedBy || null, closureFix: payment.closureFix || null, adjustment: payment.adjustment || null });
        }
        for (const event of loan.refinancings || []) {
            const isAdj = !!event.adjustment;
            const g = group(event.accountTxId || `refi:${event.id}`, {
                kind: isAdj ? 'adjustment' : 'refinancing', id: event.accountTxId || event.id, date: event.date,
                at: Number(event.createdAt) || 0, origin: originOf(event), note: event.note || '', reason: event.reason || null,
                accountTxId: event.accountTxId || null, nextDueDate: event.nextDueDate || null
            });
            g.parts.push({ loanId: loan.id, number, itemId: event.id, amount: Number(event.interestAmount || 0), interest: Number(event.interestAmount || 0), capital: 0, voided: !!event.voided, lock: getMovementLock(event, options), adjustedBy: event.adjustedBy || null, closureFix: event.closureFix || null, adjustment: event.adjustment || null });
        }
        for (const edit of loan.edits || []) {
            out.push({ kind: 'edit', id: edit.id, date: new Date(edit.at).toISOString().slice(0, 10), at: edit.at, loanId: loan.id, number, before: edit.before, after: edit.after, reason: edit.reason, closureEdit: !!edit.closureEdit, balanceBefore: edit.balanceBefore, balanceAfter: edit.balanceAfter, voided: !!edit.voided });
        }
        for (const closure of [...(loan.closureHistory || []), ...(loan.closure ? [loan.closure] : [])]) {
            out.push({ kind: 'close', id: `close:${loan.id}:${closure.at}`, date: new Date(closure.at).toISOString().slice(0, 10), at: closure.at, loanId: loan.id, number, reason: closure.reason, note: closure.note, forgiven: closure.forgiven || null, voided: !!closure.undoneAt });
        }
    }
    for (const agreement of agreementsOf(emp)) {
        out.push({ kind: 'agreement', id: agreement.id, date: new Date(agreement.createdAt).toISOString().slice(0, 10), at: agreement.createdAt, amount: agreement.amount, agreement, voided: !!agreement.voided });
    }
    for (const g of groups.values()) {
        g.voided = g.parts.every(p => p.voided);
        g.amount = round2(g.parts.filter(p => g.voided || !p.voided).reduce((t, p) => t + p.amount, 0));
        g.lock = g.parts.map(p => p.lock).find(Boolean) || null;
        g.adjustedBy = g.parts.map(p => p.adjustedBy).find(Boolean) || null;
        g.closureFix = g.parts.map(p => p.closureFix).find(Boolean) || null;
    }
    return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.at || 0) - (a.at || 0));
}

function getBalanceBase(loan) {
    const rate = Number(loan.interestRate || 0);
    const principal = Number(loan.principal || 0);
    return round2(principal + (loan.interestIncluded ? 0 : principal * rate / 100));
}
