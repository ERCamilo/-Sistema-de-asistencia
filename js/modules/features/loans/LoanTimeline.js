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
                capital: round2(Number(payment.adjustment.capital || 0)),
                interest: round2(Number(payment.adjustment.interest || 0))
            });
            continue;
        }
        events.push({
            kind: TIMELINE_KINDS.PAYMENT, date, at: stamp(payment.recordedAt), loanId: loan.id,
            id: payment.id, amount: round2(Number(payment.amount || 0)),
            source: payment.source === 'payroll' ? 'payroll' : 'manual'
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

/**
 * Reproduce un préstamo. Devuelve los pasos con el saldo capital/interés
 * después de cada uno, más el saldo final.
 */
export function replayLoan(loan = {}) {
    let capital = 0;
    let interest = 0;
    let credit = 0;
    let overpaid = 0;
    const steps = [];
    const push = (event, delta, extra = {}) => {
        steps.push({ ...event, ...extra, delta, capitalAfter: round2(capital), interestAfter: round2(interest) });
    };
    // Un cargo nuevo se cubre primero con el excedente a favor.
    const absorb = amount => {
        const used = Math.min(credit, amount);
        credit -= used;
        return { net: amount - used, used: round2(used) };
    };

    for (const event of collectLoanEvents(loan)) {
        if (event.kind === TIMELINE_KINDS.LOAN) {
            const c = absorb(event.capital);
            const i = absorb(event.interest);
            capital += c.net;
            interest += i.net;
            push(event, { capital: round2(c.net), interest: round2(i.net) }, { creditUsed: round2(c.used + i.used) });
        } else if (event.kind === TIMELINE_KINDS.REFINANCING) {
            const i = absorb(event.interest);
            interest += i.net;
            push(event, { capital: 0, interest: round2(i.net) }, { creditUsed: i.used });
        } else if (event.kind === TIMELINE_KINDS.ADJUSTMENT) {
            // Devuelve exactamente lo que tocó el movimiento original; no usa el saldo a favor.
            capital += event.capital;
            interest += event.interest;
            push(event, { capital: event.capital, interest: event.interest });
        } else {
            const toInterest = Math.min(event.amount, Math.max(0, interest));
            const toCapital = Math.min(event.amount - toInterest, Math.max(0, capital));
            const excess = round2(event.amount - toInterest - toCapital);
            interest -= toInterest;
            capital -= toCapital;
            credit += excess;
            overpaid += excess;
            push(event, { capital: -round2(toCapital), interest: -round2(toInterest) }, { excess });
        }
    }

    const remaining = round2(capital + interest);
    const closedDate = isoDate(loan.closedAt);
    const closes = loan.status === LOAN_STATUS.WRITTEN_OFF ? TIMELINE_KINDS.WRITEOFF
        : loan.status === LOAN_STATUS.PAID ? TIMELINE_KINDS.SETTLED : null;
    if (remaining > 0.01 && closedDate && closes) {
        const delta = { capital: -round2(capital), interest: -round2(interest) };
        capital = 0; interest = 0;
        push({ kind: closes, date: closedDate, at: stamp(loan.closedAt), loanId: loan.id }, delta);
    }

    return {
        loanId: loan.id,
        steps,
        capital: round2(capital),
        interest: round2(interest),
        balance: round2(capital + interest),
        overpaid: round2(overpaid),
        credit: round2(credit)
    };
}

/** Capital pendiente de un préstamo en una fecha (incluida), con interés primero. */
export function getRemainingCapital(loan, asOfDate = null) {
    const replay = replayLoan(loan);
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
export function buildTimeline(entries = []) {
    const byDate = new Map();
    for (const { employeeId = null, loan } of entries) {
        if (!loan) continue;
        for (const step of replayLoan(loan).steps) {
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
    return { days, totals: { capital: round2(capital), interest: round2(interest), balance: round2(capital + interest) } };
}

/** Atajo: línea de tiempo de un empleado. */
export function buildEmployeeTimeline(emp = {}) {
    return buildTimeline((emp.loans || []).map(loan => ({ employeeId: emp.id, loan })));
}

/** Atajo: línea de tiempo general de una lista de empleados (ya filtrada por obra). */
export function buildGeneralTimeline(employees = []) {
    return buildTimeline(employees.flatMap(emp => (emp.loans || []).map(loan => ({ employeeId: emp.id, loan }))));
}
