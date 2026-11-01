/**
 * 🕰️ LoanTimeline — reconstruye la historia de los préstamos día por día.
 *
 * Los abonos solo guardan el monto; la parte de capital e interés se deriva
 * reproduciendo los eventos en orden con la regla de la empresa: cada abono
 * paga primero todo el interés pendiente y después el capital.
 *
 * Eventos por préstamo (los anulados no cuentan):
 *   - loan        → + capital, + interés del préstamo
 *   - refinancing → + interés del refinanciamiento (un reemplazo de cuotas
 *                   conserva el saldo y suma su interés)
 *   - payment     → − interés primero, luego − capital
 *   - writeoff    → el saldo que quedaba sale del total (préstamo anulado)
 *   - settled     → préstamo marcado saldado que aún tenía saldo: se cierra
 *   - adjustment  → ajuste que devuelve lo que tocó un movimiento de una
 *                   nómina cerrada (+ capital, + interés, o − interés si
 *                   devuelve un refinanciamiento)
 *
 * Un abono mayor al saldo de ese momento deja un excedente (p. ej. el mismo
 * abono registrado dos veces). El excedente no cuenta como abono en la línea
 * de tiempo; queda a favor y cubre cargos posteriores del mismo préstamo,
 * igual que getBalance(), que no depende del orden.
 *
 * El saldo final de cada préstamo coincide con getBalance() (el total no
 * depende del orden; el orden solo decide el reparto capital/interés).
 * Funciones puras: no leen ni escriben estado global.
 */

import { readLoanChronology } from './LoanChronology.js';
import { isFinancialLoan, isPayrollLoanPayment } from './LoanReadPolicy.js';
import { LOAN_STATUS, round2, getActiveLoanTerms } from './LoansService.js';

export const TIMELINE_KINDS = Object.freeze({
    LOAN: 'loan',
    PAYMENT: 'payment',
    REFINANCING: 'refinancing',
    WRITEOFF: 'writeoff',
    SETTLED: 'settled',
    ADJUSTMENT: 'adjustment'
});

const KIND_ORDER = { loan: 0, refinancing: 1, payment: 2, adjustment: 3, settled: 4, writeoff: 5 };

function isoDate(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return new Date(n).toISOString().slice(0, 10);
    return null;
}

function stamp(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function originalInterest(loan) {
    const original = getActiveLoanTerms({ ...loan, refinancings: [] });
    return original.interestIncluded ? 0 : round2(original.principal * original.interestRate / 100);
}

/** Eventos fechados de un préstamo, en el orden en que se reproducen. */
export function collectLoanEvents(loan = {}) {
    const start = isoDate(loan.startDate) || isoDate(loan.createdAt);
    const events = [];
    if (start) {
        events.push({
            kind: TIMELINE_KINDS.LOAN, date: start, at: stamp(loan.createdAt), loanId: loan.id,
            capital: round2(Number(loan.principal || 0)), interest: originalInterest(loan)
        });
    }
    for (const event of loan.refinancings || []) {
        if (event?.voided) continue;
        const date = isoDate(event.date) || isoDate(event.effectiveAt ?? event.createdAt);
        if (!date) continue;
        if (event.adjustment) {
            events.push({
                kind: TIMELINE_KINDS.ADJUSTMENT, date, at: stamp(event.createdAt), loanId: loan.id, id: event.id,
                capital: 0, interest: round2(Number(event.interestAmount || 0))
            });
            continue;
        }
        events.push({
            kind: TIMELINE_KINDS.REFINANCING, date, at: stamp(event.effectiveAt ?? event.createdAt), loanId: loan.id,
            id: event.id, basis: event.basis || 'balance', replacement: !!event.replacementTerms,
            interest: round2(Number(event.interestAmount || 0))
        });
    }
    for (const payment of loan.payments || []) {
        if (payment?.voided) continue;
        const date = isoDate(payment.date) || isoDate(payment.recordedAt);
        if (!date) continue;
        if (payment.adjustment) {
            events.push({
                kind: TIMELINE_KINDS.ADJUSTMENT, date, at: stamp(payment.recordedAt), loanId: loan.id, id: payment.id,
                ofId: payment.adjustment.ofId, ofKind: payment.adjustment.ofKind || 'payment',
                capital: round2(Number(payment.adjustment.capital || 0)),
                interest: round2(Number(payment.adjustment.interest || 0))
            });
            continue;
        }
        events.push({
            kind: TIMELINE_KINDS.PAYMENT, date, at: stamp(payment.recordedAt), loanId: loan.id,
            id: payment.id, amount: round2(Number(payment.amount || 0)),
            source: isPayrollLoanPayment(payment) ? 'payroll' : 'manual'
        });
    }
    // Mismo día: un abono y un refinanciamiento van en el orden en que se registraron
    // (normalmente se cobra en nómina y se refinancia lo que quedó). Sin hora, el
    // refinanciamiento va primero, como antes.
    const group = e => (e.kind === TIMELINE_KINDS.REFINANCING || e.kind === TIMELINE_KINDS.PAYMENT ? 1 : KIND_ORDER[e.kind]);
    const when = e => (e.at > 0 ? e.at : (e.kind === TIMELINE_KINDS.REFINANCING ? -Infinity : Infinity));
    return events.sort((a, b) => a.date.localeCompare(b.date)
        || group(a) - group(b)
        || (group(a) === 1 ? (when(a) - when(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) : 0)
        || a.at - b.at);
}

// Caché de reproducciones válido SOLO durante un cálculo síncrono (un render):
// en uno de Préstamos el mismo préstamo se reproducía 8–10 veces (riesgo por
// periodo, saldo por cuenta, línea de tiempo). Fuera de withReplayCache no hay
// caché, así que nunca se devuelve una reproducción vieja.
let replayMemo = null;

/** Ejecuta `fn` compartiendo las reproducciones de cada préstamo; las descarta al terminar. */
export function withReplayCache(fn) {
    if (replayMemo) return fn();
    replayMemo = new WeakMap();
    try {
        return fn();
    } finally {
        replayMemo = null;
    }
}

/**
 * Reproduce un préstamo. Devuelve los pasos con el saldo capital/interés
 * después de cada uno, más el saldo final. Dentro de withReplayCache el
 * resultado es compartido: tratarlo como solo lectura.
 */
export function replayLoan(loan = {}) {
    if (!replayMemo || !loan || typeof loan !== 'object') return computeReplay(loan);
    let replay = replayMemo.get(loan);
    if (!replay) {
        replay = computeReplay(loan);
        replayMemo.set(loan, replay);
    }
    return replay;
}

function computeReplay(loan = {}) {
    let capital = 0, interest = 0, credit = 0, overpaid = 0;
    let reversedCapital = 0, reversedInterest = 0;
    const steps = [], applications = new Map(), creditQueue = [];
    const push = (event, delta, extra = {}) => steps.push({ ...event, ...extra, delta,
        capitalAfter: round2(capital), interestAfter: round2(interest) });
    const absorb = (amount, kind) => {
        const used = Math.min(credit, Math.max(0, amount)); credit -= used;
        let left = used;
        for (const entry of creditQueue) {
            const take = Math.min(left, entry.remaining); entry.remaining -= take; left -= take;
            entry.application[kind] = round2(entry.application[kind] + take);
            entry.application.credit = round2(entry.application.credit - take);
            if (left < .004) break;
        }
        return { net: amount - used, used: round2(used) };
    };
    for (const event of collectLoanEvents(loan)) {
        if (event.kind === TIMELINE_KINDS.LOAN) {
            const c = absorb(event.capital, 'capital'), i = absorb(event.interest, 'interest');
            capital += c.net; interest += i.net;
            push(event, { capital: round2(c.net), interest: round2(i.net) }, { creditUsed: round2(c.used+i.used) });
        } else if (event.kind === TIMELINE_KINDS.REFINANCING) {
            const i = absorb(event.interest, 'interest'); interest += i.net;
            push(event, { capital: 0, interest: round2(i.net) }, { creditUsed: i.used });
        } else if (event.kind === TIMELINE_KINDS.ADJUSTMENT) {
            let c = event.capital, i = event.interest;
            let creditCreated = 0, creditReturned = 0, creditUsed = 0;
            if (event.ofKind === 'payment' && c >= 0 && i >= 0) {
                const application = applications.get(String(event.ofId));
                const applied = application && round2(application.capital + application.interest + application.credit);
                // A full reversal cancels this payment's current application.
                // Its saved allocation may predate a later charge correction.
                if (application && Math.abs(round2(c + i) - applied) < .005) {
                    c = application.capital;
                    i = application.interest;
                    creditReturned = application.credit;
                    credit -= creditReturned;
                    application.credit = 0;
                    for (const entry of creditQueue) if (entry.application === application) entry.remaining = 0;
                }
                reversedCapital += c;
                reversedInterest += i;
                // Any other available credit still offsets the restored debt.
                const toInterest = absorb(i, 'interest');
                const toCapital = absorb(c, 'capital');
                c = toCapital.net;
                i = toInterest.net;
                creditUsed = round2(toInterest.used + toCapital.used);
            }
            // A reversed charge first removes pending interest. The already-paid
            // portion becomes a credit applied to capital, never negative interest.
            if (i < 0 && interest + i < 0) {
                const refund = -(interest+i), toCapital = Math.min(capital, refund);
                i = -interest; c -= toCapital;
                let left = refund;
                for (const application of [...applications.values()].reverse()) {
                    const take = Math.min(left, application.interest); application.interest -= take;
                    const applied = Math.min(take, toCapital - (refund-left));
                    application.capital += Math.max(0, applied);
                    const remaining = take-Math.max(0, applied);
                    if (remaining > 0) { application.credit += remaining; creditQueue.push({application,remaining}); }
                    left -= take; if (left < .004) break;
                }
                creditCreated = round2(refund - toCapital);
                credit += creditCreated;
            }
            capital += c; interest += i;
            push(event, { capital: round2(c), interest: round2(i) }, { creditCreated, creditReturned, creditUsed });
        } else {
            const toInterest = Math.min(event.amount, Math.max(0, interest));
            const toCapital = Math.min(event.amount-toInterest, Math.max(0, capital));
            const excess = round2(event.amount-toInterest-toCapital);
            interest -= toInterest; capital -= toCapital; credit += excess; overpaid += excess;
            const application = { capital: round2(toCapital), interest: round2(toInterest), credit: excess };
            applications.set(String(event.id), application);
            if (excess > 0) creditQueue.push({application,remaining:excess});
            push(event, { capital: -round2(toCapital), interest: -round2(toInterest) }, { excess });
        }
    }
    const remaining = round2(capital+interest), closedDate = isoDate(loan.closedAt);
    const closes = loan.status === LOAN_STATUS.WRITTEN_OFF ? TIMELINE_KINDS.WRITEOFF
        : loan.status === LOAN_STATUS.PAID ? TIMELINE_KINDS.SETTLED : null;
    const closure = closes && remaining > .01 ? { capital: round2(capital), interest: round2(interest), undated: !closedDate } : null;
    if (closure) {
        const delta = {capital:-round2(capital),interest:-round2(interest)}; capital=0; interest=0;
        if (closedDate) push({kind:closes,date:closedDate,at:stamp(loan.closedAt),loanId:loan.id},delta);
    }
    const sums = [...applications.values()].reduce((sum,p)=>({capital:sum.capital+p.capital,interest:sum.interest+p.interest}),{capital:0,interest:0});
    return { loanId:loan.id, steps, capital:round2(capital), interest:round2(interest), balance:round2(capital+interest),
        overpaid:round2(overpaid), credit:round2(credit), closure, applications:Object.fromEntries(applications),
        collected:{capital:round2(sums.capital-reversedCapital),interest:round2(sums.interest-reversedInterest)} };
}

/** Capital pendiente de un préstamo en una fecha (incluida), con interés primero. */
export function getRemainingCapital(loan, asOfDate = null) {
    const replay = replayLoan(loan);
    if (!asOfDate) return replay.capital;
    const steps = asOfDate ? replay.steps.filter(step => step.date <= asOfDate) : replay.steps;
    return steps.length ? steps.at(-1).capitalAfter : 0;
}

/**
 * Línea de tiempo por día para un conjunto de préstamos.
 * @param {Array<{employeeId?:string, loan:object}>} entries
 * @returns {{days:Array, totals:{capital:number, interest:number, balance:number}}}
 *   days[i] = { date, previous, payments, newLoans, refinancings, writeOffs,
 *               result, capital, interest, tags[], items[] }
 */
export function buildTimeline(entries = [], { financialOnly = false } = {}) {
    const byDate = new Map();
    const validEntries = entries.filter(entry => entry.loan);
    const normalized = readLoanChronology(validEntries.map(entry=>entry.loan));
    const undatedClosures = [];
    for (const [index, { employeeId = null }] of validEntries.entries()) {
        const loan = normalized[index];
        // Recover original timestamps before excluding audit-only source loans.
        if (financialOnly && !isFinancialLoan(loan)) continue;
        const replay = replayLoan(loan);
        if (replay.closure?.undated) { undatedClosures.push({employeeId,loanId:loan.id,...replay.closure}); continue; }
        for (const step of replay.steps) {
            if (!byDate.has(step.date)) byDate.set(step.date, []);
            byDate.get(step.date).push({ ...step, employeeId });
        }
    }

    let capital = 0;
    let interest = 0;
    const days = [];
    for (const date of [...byDate.keys()].sort()) {
        const items = byDate.get(date);
        const previous = round2(capital + interest);
        const sum = kind => round2(items.filter(item => item.kind === kind)
            .reduce((total, item) => total + item.delta.capital + item.delta.interest, 0));
        for (const item of items) {
            capital += item.delta.capital;
            interest += item.delta.interest;
        }
        const tags = new Set();
        for (const item of items) {
            if (item.kind === TIMELINE_KINDS.PAYMENT) tags.add(item.source === 'payroll' ? 'payroll' : 'payment');
            else if (item.kind === TIMELINE_KINDS.REFINANCING && item.replacement) tags.add('replacement');
            else tags.add(item.kind);
            if (item.excess > 0.01) tags.add('excess');
        }
        days.push({
            date,
            previous,
            payments: sum(TIMELINE_KINDS.PAYMENT),
            newLoans: sum(TIMELINE_KINDS.LOAN),
            refinancings: sum(TIMELINE_KINDS.REFINANCING),
            writeOffs: round2(sum(TIMELINE_KINDS.WRITEOFF) + sum(TIMELINE_KINDS.SETTLED)),
            adjustments: sum(TIMELINE_KINDS.ADJUSTMENT),
            excess: round2(items.reduce((total, item) => total + (item.excess || 0), 0)),
            result: round2(capital + interest),
            capital: round2(capital),
            interest: round2(interest),
            tags: [...tags],
            items
        });
    }
    return { days, undatedClosures, totals: { capital: round2(capital), interest: round2(interest), balance: round2(capital + interest) } };
}

/** Atajo: línea de tiempo de un empleado. */
export function buildEmployeeTimeline(emp = {}) {
    return buildTimeline((emp.loans || []).map(loan => ({ employeeId: emp.id, loan })));
}

/** Atajo: línea de tiempo general de una lista de empleados (ya filtrada por obra). */
export function buildGeneralTimeline(employees = []) {
    return buildTimeline(employees.flatMap(emp => (emp.loans || []).map(loan => ({ employeeId: emp.id, loan }))));
}
