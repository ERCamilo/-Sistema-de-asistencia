/**
 * 📒 LoanPortfolio — cifras de la pantalla principal de Préstamos.
 *
 * Todo sale de reproducir cada préstamo (LoanTimeline: interés primero).
 * Los préstamos anulados son errores de registro y no entran en ninguna cifra.
 *
 *   Por cobrar     saldo de los préstamos abiertos (capital + interés; el
 *                  interés pendiente se reparte en inicial / refinanciamientos
 *                  de forma estimada: los abonos cubren primero el más viejo).
 *   Interés ganado interés cobrado, de un total = cobrado + interés por cobrar.
 *   Cobrado        todo lo abonado (capital + interés + pagado de más).
 *   Prestado       capital entregado; % que ya se devolvió.
 *
 * prepareLoanEmployees() lee los datos como si ya se hubieran deshecho las
 * consolidaciones y completado los datos viejos (sobre una copia), para que la
 * pantalla no muestre «Prestado» inflado ni préstamos sin nómina de cobro
 * mientras alguien no aplique esos pasos de verdad.
 */

import { LOAN_STATUS, round2, getActiveLoanTerms } from './LoansService.js';
import { replayLoan, buildTimeline } from './LoanTimeline.js';
import { getAccountSummary } from './LoanAccount.js';
import { findConsolidations, undoConsolidation } from './LoanConsolidationUndo.js';
import { planLoanBackfill, applyLoanBackfill } from './LoanDataBackfill.js';

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const counts = loan => loan && loan.status !== LOAN_STATUS.WRITTEN_OFF;

let _cache = { key: null, value: null };

/** Firma de los datos de préstamos: cualquier abono, refinanciamiento o cambio la cambia (para cachés). */
export function loanDataSignature(employees = []) {
    return employees.map(emp => [emp.id, emp.updatedAt, emp.active, (emp.loans || []).map(loan => [
        loan.id, loan.updatedAt, loan.status, loan.principal, loan.dueDate,
        (loan.payments || []).map(p => [p.id, p.amount, p.voided]), (loan.refinancings || []).map(r => [r.id, r.interestAmount, r.voided])
    ])]);
}

/** Copia de los empleados con consolidaciones deshechas y datos completados (solo para mostrar). */
export function prepareLoanEmployees(employees = [], payPeriod = null) {
    const needsUndo = employees.some(emp => findConsolidations(emp).length);
    const needsFill = planLoanBackfill(employees, payPeriod).total > 0;
    if (!needsUndo && !needsFill) return { employees, virtual: false };
    const key = JSON.stringify([payPeriod, loanDataSignature(employees)]);
    if (_cache.key === key) return _cache.value;
    const copy = JSON.parse(JSON.stringify(employees));
    for (const emp of copy) for (const c of findConsolidations(emp)) undoConsolidation(emp, c.loan.id, { at: 0, projectScope: { enabled: false } });
    applyLoanBackfill(copy, payPeriod, { at: 0 });
    const value = { employees: copy, virtual: true, undone: needsUndo, filled: needsFill };
    _cache = { key, value };
    return value;
}

function initialInterest(loan) {
    const terms = getActiveLoanTerms({ ...loan, refinancings: [] });
    return terms.interestIncluded ? 0 : round2(terms.principal * terms.interestRate / 100);
}

/**
 * Resumen de cartera.
 * @returns {{ porCobrar, quienDebeMas, interesGanado, cobrado, prestado }}
 */
export function computePortfolioSummary(employees = []) {
    let capital = 0, interest = 0, refiPending = 0, loansOpen = 0, people = 0;
    let lent = 0, capitalBack = 0, interestBack = 0, interestTotal = 0, refiTotal = 0, paidAll = 0, excess = 0, forgiven = 0;
    let firstPayment = null;
    const ranking = [];
    for (const emp of employees) {
        const summary = getAccountSummary(emp);
        if (summary.balance > 0.004) {
            people++;
            loansOpen += summary.count;
            capital += summary.capital;
            interest += summary.interest;
            let empRefi = 0;
            for (const item of summary.loans) {
                const refi = (item.loan.refinancings || []).filter(r => !r.voided).reduce((t, r) => t + Number(r.interestAmount || 0), 0);
                const pend = Math.min(item.interest, Math.max(0, refi));
                refiPending += pend;
                empRefi += pend;
            }
            ranking.push({ emp, balance: summary.balance, capital: summary.capital, interest: round2(summary.interest - empRefi), refi: round2(empRefi), active: emp.active !== false });
        }
        for (const loan of emp.loans || []) {
            if (!counts(loan)) continue;
            lent += Number(getActiveLoanTerms({ ...loan, refinancings: [] }).principal || 0);
            interestTotal += initialInterest(loan);
            for (const r of loan.refinancings || []) if (!r.voided) { interestTotal += Number(r.interestAmount || 0); refiTotal += Number(r.interestAmount || 0); }
            for (const step of replayLoan(loan).steps) {
                if (step.kind === 'payment') {
                    capitalBack += -step.delta.capital;
                    interestBack += -step.delta.interest;
                    excess += step.excess || 0;
                    paidAll += -(step.delta.capital + step.delta.interest) + (step.excess || 0);
                    if (!firstPayment || step.date < firstPayment) firstPayment = step.date;
                } else if (step.kind === 'adjustment') {
                    capitalBack -= step.delta.capital;
                    interestBack -= Math.max(0, step.delta.interest);
                    paidAll -= step.delta.capital + Math.max(0, step.delta.interest);
                } else if (step.kind === 'settled') {
                    forgiven += -(step.delta.capital + step.delta.interest);
                }
            }
        }
    }
    ranking.sort((a, b) => b.balance - a.balance);
    const balance = round2(capital + interest);
    return {
        porCobrar: {
            total: balance, capital: round2(capital), interest: round2(interest),
            interestInitial: round2(interest - refiPending), interestRefi: round2(refiPending),
            people, loans: loansOpen
        },
        quienDebeMas: ranking.slice(0, 5),
        // «de $X en total» = cobrado + por cobrar (lo perdonado y lo cubierto con pagos de más no entra).
        interesGanado: { collected: round2(interestBack), total: round2(interestBack + interest), generated: round2(interestTotal), fromRefi: round2(refiTotal) },
        cobrado: { total: round2(paidAll), capital: round2(capitalBack), interest: round2(interestBack), excess: round2(excess), since: firstPayment },
        prestado: { total: round2(lent), returned: round2(capitalBack), pctReturned: lent > 0 ? capitalBack / lent : 0, forgiven: round2(forgiven) }
    };
}

/** Cambio de lo que deben en el mes de `today` (saldo hoy − saldo al empezar el mes). */
export function computeMonthChange(employees = [], today) {
    const timeline = buildTimeline(employees.flatMap(emp => (emp.loans || []).filter(counts).map(loan => ({ employeeId: emp.id, loan }))));
    const monthStart = `${today.slice(0, 7)}-01`;
    const before = timeline.days.filter(d => d.date < monthStart).at(-1)?.result || 0;
    const now = timeline.days.filter(d => d.date <= today).at(-1)?.result || 0;
    return { month: MONTHS_LONG[Number(today.slice(5, 7)) - 1], from: round2(before), to: round2(now), change: round2(now - before) };
}
