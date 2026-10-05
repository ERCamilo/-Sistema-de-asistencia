/**
 * 🧩 LoanDataBackfill — completa los datos viejos de préstamos (fase D).
 *
 * Solo RELLENA lo que falta; no cambia montos, saldos ni abonos:
 *   1. Número fijo de préstamo (loan.number): #1, #2… por orden de creación.
 *   2. Nómina de cobro (loan.dueDate) de los préstamos de pago único: el día
 *      de pago de la nómina en que se entregó (decisión: pago único en la
 *      próxima nómina). Los refinanciamientos sin nueva nómina de cobro
 *      reciben la nómina siguiente a su fecha (refinanciar pasa el cobro).
 *   3. Origen de los abonos sin origen: los que caen entre el último día del
 *      periodo y tres días después del día de pago son descuentos de nómina
 *      (origin 'payroll', con su periodo); los demás quedan como directos y
 *      marcados para revisar uno por uno (needsReview).
 *
 * Determinista: dos dispositivos que lo apliquen llegan a lo mismo. Se puede
 * correr varias veces (lo ya completado no se toca).
 */

import { LOAN_STATUS, INSTALLMENT_MODE } from './LoansService.js';
import { buildPayPeriods } from './LoanPayPeriods.js';

const DAY = 86_400_000;
const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const addDays = (key, n) => new Date(toTime(key) + n * DAY).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const PAYROLL_WINDOW_DAYS = 3;

/** Nóminas que cubren de `from` a `to` (más una de margen). */
export function payPeriodsBetween(payPeriod, from, to) {
    const length = Number(payPeriod?.periodLength);
    if (!ISO.test(String(from || '')) || !ISO.test(String(to || '')) || !(length > 0)) return [];
    const before = Math.ceil((toTime(to) - toTime(from)) / (length * DAY)) + 2;
    return buildPayPeriods(payPeriod, to, { before, after: 2 }).filter(p => p.payDate >= from || p.end >= from);
}

const createdOrder = loan => Number(loan?.createdAt) || Date.parse(loan?.startDate || '') || 0;
const byCreation = (a, b) => createdOrder(a) - createdOrder(b) || String(a.startDate || '').localeCompare(String(b.startDate || '')) || String(a.id).localeCompare(String(b.id));

/** Siguiente número para un préstamo nuevo, o null si el empleado aún no tiene números fijos. */
export function nextLoanNumber(loans = []) {
    const list = loans || [];
    if (!list.length) return 1;
    if (!list.every(l => Number.isInteger(l.number))) return null;
    return Math.max(...list.map(l => l.number)) + 1;
}

function periodOfLoan(periods, date) {
    return periods.find(p => p.start <= date && date <= p.end) || null;
}

function payrollPeriodOfPayment(periods, date) {
    // Desde el último día del periodo hasta 3 días después del día de pago.
    return periods.find(p => p.end <= date && date <= addDays(p.payDate, PAYROLL_WINDOW_DAYS)) || null;
}

/**
 * Qué se completaría, sin tocar nada.
 * @returns {{ numbers, dueDates, refinancings, payrollPayments, reviewPayments, items }}
 */
export function planLoanBackfill(employees = [], payPeriod = null) {
    const items = { numbers: [], dueDates: [], refinancings: [], payments: [] };
    const allDates = employees.flatMap(emp => (emp.loans || []).flatMap(loan => [loan.startDate, ...(loan.payments || []).map(p => p.date), ...(loan.refinancings || []).map(r => r.date)])).filter(d => ISO.test(String(d || ''))).sort();
    const periods = allDates.length ? payPeriodsBetween(payPeriod, allDates[0], allDates.at(-1)) : [];
    for (const emp of employees) {
        const loans = emp.loans || [];
        // 1. Números
        if (loans.length && !loans.every(l => Number.isInteger(l.number))) {
            const taken = new Set(loans.filter(l => Number.isInteger(l.number)).map(l => l.number));
            const allMissing = taken.size === 0;
            let next = allMissing ? 1 : Math.max(...taken) + 1;
            for (const loan of [...loans].sort(byCreation)) {
                if (Number.isInteger(loan.number)) continue;
                items.numbers.push({ emp, loan, number: next++ });
            }
        }
        for (const loan of loans) {
            if (!periods.length) continue;
            // 2. Nómina de cobro (pago único) y refinanciamientos
            if (!loan.dueDate && loan.installmentMode !== INSTALLMENT_MODE.INSTALLMENTS && ISO.test(String(loan.startDate || ''))) {
                const p = periodOfLoan(periods, loan.startDate);
                if (p) items.dueDates.push({ emp, loan, dueDate: p.payDate });
            }
            for (const refi of loan.refinancings || []) {
                if (refi.voided || refi.adjustment || refi.nextDueDate || !ISO.test(String(refi.date || ''))) continue;
                const next = periods.find(p => p.payDate > refi.date);
                if (next) items.refinancings.push({ emp, loan, refi, nextDueDate: next.payDate });
            }
            // 3. Origen de abonos
            for (const payment of loan.payments || []) {
                if (payment.origin || payment.adjustment || !ISO.test(String(payment.date || ''))) continue;
                if (payment.source === 'payroll') { items.payments.push({ emp, loan, payment, origin: 'payroll', period: null }); continue; }
                const p = payrollPeriodOfPayment(periods, payment.date);
                // Anulados o de préstamos anulados por error: no hace falta revisarlos.
                const reviewable = !payment.voided && !(loan.status === LOAN_STATUS.WRITTEN_OFF && !loan.closure);
                items.payments.push(p
                    ? { emp, loan, payment, origin: 'payroll', period: p }
                    : { emp, loan, payment, origin: 'direct', period: null, review: reviewable });
            }
        }
    }
    const review = items.payments.filter(x => x.review);
    return {
        numbers: items.numbers.length,
        dueDates: items.dueDates.length,
        refinancings: items.refinancings.length,
        payrollPayments: items.payments.filter(x => x.origin === 'payroll').length,
        directPayments: items.payments.filter(x => x.origin === 'direct' && !x.review).length,
        reviewPayments: review.length,
        total: items.numbers.length + items.dueDates.length + items.refinancings.length + items.payments.length,
        items
    };
}

/** Aplica lo planeado. Devuelve los conteos. */
export function applyLoanBackfill(employees = [], payPeriod = null, { at = Date.now() } = {}) {
    const plan = planLoanBackfill(employees, payPeriod);
    const touched = new Set();
    const touch = (emp, loan) => { loan.updatedAt = at; touched.add(emp); };
    for (const { emp, loan, number } of plan.items.numbers) { loan.number = number; touch(emp, loan); }
    for (const { emp, loan, dueDate } of plan.items.dueDates) { loan.dueDate = dueDate; loan.dueDateSetAt = 0; loan.dueDateInferred = true; touch(emp, loan); }
    for (const { emp, loan, refi, nextDueDate } of plan.items.refinancings) { refi.nextDueDate = nextDueDate; refi.nextDueDateInferred = true; refi.updatedAt = at; touch(emp, loan); }
    for (const { emp, loan, payment, origin, period, review } of plan.items.payments) {
        payment.origin = origin;
        payment.originInferred = true;
        if (origin === 'payroll') payment.channel = payment.channel || 'payroll';
        if (period && !payment.payrollPeriodEnd) { payment.payrollPeriodStart = period.start; payment.payrollPeriodEnd = period.end; }
        if (review) payment.needsReview = true;
        payment.updatedAt = at;
        touch(emp, loan);
    }
    for (const emp of touched) emp.updatedAt = at;
    const { items, ...counts } = plan;
    return counts;
}

/** Abonos marcados para revisar (fuera de los días de pago). */
export function listPaymentsToReview(employees = []) {
    const out = [];
    for (const emp of employees) {
        for (const loan of emp.loans || []) {
            if (loan.status === LOAN_STATUS.WRITTEN_OFF && !loan.closure) continue;
            for (const payment of loan.payments || []) {
                if (payment.needsReview && !payment.voided) out.push({ emp, loan, payment });
            }
        }
    }
    return out.sort((a, b) => String(b.payment.date).localeCompare(String(a.payment.date)));
}

/** Resuelve un abono revisado: 'payroll' (con la nómina anterior más cercana) o 'direct'. */
export function resolvePaymentReview(emp, loanId, paymentId, kind, payPeriod = null, { at = Date.now() } = {}) {
    const loan = (emp?.loans || []).find(l => String(l.id) === String(loanId));
    const payment = (loan?.payments || []).find(p => String(p.id) === String(paymentId));
    if (!payment) throw new Error('Abono no encontrado');
    if (kind === 'payroll') {
        const periods = payPeriodsBetween(payPeriod, addDays(payment.date, -60), payment.date);
        const p = [...periods].reverse().find(x => x.end < payment.date) || null;
        payment.origin = 'payroll';
        payment.channel = 'payroll';
        if (p) { payment.payrollPeriodStart = p.start; payment.payrollPeriodEnd = p.end; }
    } else {
        payment.origin = 'direct';
        if (payment.originInferred && !payment.payrollClosureId) { delete payment.payrollPeriodStart; delete payment.payrollPeriodEnd; }
    }
    payment.needsReview = false;
    payment.reviewedAt = at;
    payment.updatedAt = at;
    loan.updatedAt = at;
    emp.updatedAt = at;
    return payment;
}
