/**
 * 🧾 LoanAccountView — ficha de préstamos del empleado como «cuenta» (fase B).
 *
 * Diseño A de la maqueta: tarjeta principal (saldo, barra pagado/pendiente,
 * próxima nómina, sueldo, último abono), botones Abonar · Refinanciar ·
 * + Préstamo · Acuerdo, pestañas «Préstamos» y «Movimientos de la cuenta», y
 * ventanas para cada acción. Solo dibuja; las acciones viven en
 * LoanAccountController.js (window.la*), los cálculos en LoanAccount.js.
 */

import { state } from '../../core/AppState.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import {
    LOAN_STATUS, INSTALLMENT_MODE, getBalance, getEmployeePeriodSalary, getActiveLoanTerms, round2
} from './LoansService.js';
import { replayLoan } from './LoanTimeline.js';
import {
    CLOSE_REASON, REFINANCE_REASON, AGREEMENT_INTEREST, AGREEMENT_NEW_LOANS, MOVEMENT_ORIGIN,
    getAccountSummary, getLoanNumbers, getLoanPending, getLoanLock, getLoanDueDate, countMissedPayDates, VENCIDO_GRACE_DAYS,
    getAccountMovements, allocateAccountPayment, getActiveLoanAgreement, suggestedAgreementMinimum,
    projectLoanAgreement, getMovementLock
} from './LoanAccount.js';
import { buildPayPeriods, nextPayPeriod, followingPayPeriod } from './LoanPayPeriods.js';
import { renderLoanHistoryPanel, isLoanHistoryOpen } from './LoanHistoryPanel.js';
import { renderLoanDuplicateReview } from './LoanDuplicateReview.js';
import { findConsolidations, previewUndoConsolidation, CONSOLIDATION_REASON } from './LoanConsolidationUndo.js';
import { nextLoanNumber } from './LoanDataBackfill.js';

const M = (value, decimals = 2) => {
    const n = Number(value || 0);
    return decimals === 0 ? '$' + Math.round(n).toLocaleString('en-US') : formatCurrency(n);
};
const dm = key => (key ? `${String(key).slice(8, 10)}/${String(key).slice(5, 7)}` : '—');
const dmy = key => (key ? `${String(key).slice(8, 10)}/${String(key).slice(5, 7)}/${String(key).slice(2, 4)}` : '—');

export const REFINANCE_REASON_LABEL = Object.freeze({
    [REFINANCE_REASON.PAYROLL_SHORT]: 'No le alcanzó la nómina',
    [REFINANCE_REASON.NOT_WORKED]: 'No trabajó el periodo',
    [REFINANCE_REASON.AGREEMENT]: 'Acuerdo con el empleado',
    [REFINANCE_REASON.OTHER]: 'Otro motivo',
    [CONSOLIDATION_REASON]: 'Consolidación deshecha'
});
export const CLOSE_REASON_LABEL = Object.freeze({
    [CLOSE_REASON.ERROR]: 'Error de registro',
    [CLOSE_REASON.FORGIVEN]: 'Perdonado',
    [CLOSE_REASON.OTHER]: 'Otro motivo'
});
const CHANNEL_LABEL = { payroll: 'Nómina', cash: 'Efectivo', transfer: 'Transferencia' };

export function accountUi() {
    return state.loansLedger?.account || {};
}

/** Nóminas de la obra activa alrededor de hoy. */
export function getAccountPayPeriods(today = getDateKey(new Date())) {
    return buildPayPeriods(getActivePayrollSettings(state).payPeriod, today, { before: 4, after: 10 });
}

/** Nóminas (fin de periodo) que ya tienen un cierre con abonos registrados. */
export function closedPeriodEnds() {
    const ends = new Set();
    for (const emp of state.employees || []) {
        for (const loan of emp.loans || []) {
            for (const payment of loan.payments || []) {
                if (!payment.voided && payment.payrollClosureId && payment.payrollPeriodEnd) ends.add(payment.payrollPeriodEnd);
            }
        }
    }
    return ends;
}

/** Interés y capital ya pagados del préstamo (reproduciendo sus movimientos). */
export function loanPaidSplit(loan) {
    let interest = 0;
    let capital = 0;
    for (const step of replayLoan(loan).steps) {
        if (step.kind === 'payment' || step.kind === 'adjustment') {
            if (step.kind === 'adjustment' && step.delta.interest < 0 && step.delta.capital === 0) continue; // devuelve un refinanciamiento
            interest -= step.delta.interest;
            capital -= step.delta.capital;
        }
    }
    return { interest: round2(Math.max(0, interest)), capital: round2(Math.max(0, capital)) };
}

/** Fechas con movimientos (las mismas que recorre el historial del saldo). */
function replayAllDates(emp) {
    return (emp.loans || []).flatMap(loan => replayLoan(loan).steps.map(step => step.date));
}

function bar(parts, { big = false } = {}) {
    const total = parts.reduce((t, p) => t + p.value, 0) || 1;
    const paid = parts.filter(p => p.paid).reduce((t, p) => t + p.value, 0);
    const pct = Math.round(paid / total * 100);
    return `<div class="la-bar${big ? ' la-bar--big' : ''}" role="img" aria-label="Pagado ${pct} %">
        <div class="la-bar__track">${parts.filter(p => p.value > 0).map(p => `<i class="la-c-${p.tone}" style="width:${(p.value / total * 100).toFixed(3)}%" title="${escapeAttr(p.label)} ${M(p.value, 0)}"></i>`).join('')}</div>
        <div class="la-bar__legend">${parts.map(p => `<span><i class="la-c-${p.tone}"></i>${escapeHTML(p.label)} <b>${M(p.value, 0)}</b></span>`).join('')}<span class="la-bar__pct">${pct} % pagado</span></div>
    </div>`;
}

function splitBar(paid, pending, opts) {
    return bar([
        { tone: 'payint', label: 'pagado a interés', value: paid.interest, paid: true },
        { tone: 'pay', label: 'pagado a capital', value: paid.capital, paid: true },
        { tone: 'int', label: 'interés pendiente', value: pending.interest },
        { tone: 'cap', label: 'capital pendiente', value: pending.capital }
    ], opts);
}

function originPill(origin) {
    if (origin === MOVEMENT_ORIGIN.ACCOUNT) return '<span class="la-pill la-pill--acc">desde la cuenta</span>';
    if (origin === MOVEMENT_ORIGIN.PAYROLL) return '<span class="la-pill la-pill--pay">nómina</span>';
    if (origin === MOVEMENT_ORIGIN.ADJUSTMENT) return '<span class="la-pill la-pill--warn">ajuste</span>';
    if (origin === 'conversion') return '<span class="la-pill la-pill--refi" title="Venía de una consolidación que se deshizo">conversión</span>';
    return '<span class="la-pill">directo</span>';
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

export function LoanAccountDetail(emp) {
    const ui = accountUi();
    const today = getDateKey(new Date());
    const periods = getAccountPayPeriods(today);
    const payDates = periods.map(p => p.payDate);
    const next = nextPayPeriod(periods, today);
    const summary = getAccountSummary(emp);
    const agreement = getActiveLoanAgreement(emp);
    const salary = getEmployeePeriodSalary(emp, null, state);
    const paid = summary.loans.reduce((acc, item) => {
        const split = loanPaidSplit(item.loan);
        return { interest: acc.interest + split.interest, capital: acc.capital + split.capital };
    }, { interest: 0, capital: 0 });
    const overdue = summary.loans.filter(item => countMissedPayDates(item.loan, payDates, today, { graceDays: VENCIDO_GRACE_DAYS }) > 0).length;
    const dueNext = next ? round2(summary.loans.filter(item => !item.dueDate || item.dueDate <= next.payDate).reduce((t, item) => t + item.balance, 0)) : summary.balance;
    const nextAmount = agreement ? Math.min(agreement.amount, summary.balance) : dueNext;
    const movements = getAccountMovements(emp);
    const lastPay = movements.find(m => m.kind === 'payment' && !m.voided);
    const chip = agreement
        ? `<span class="la-chip la-chip--agree"><i></i>Con acuerdo: ${M(agreement.amount, 0)} por nómina</span>`
        : overdue ? `<span class="la-chip la-chip--warn"><i></i>${overdue} préstamo${overdue === 1 ? '' : 's'} vencido${overdue === 1 ? '' : 's'}</span>` : '';
    const nameParts = String(emp.name || '').trim().split(/\s+/).filter(Boolean);
    // Historial del saldo y aviso de repetidos viven dentro de la tarjeta principal.
    const historyScope = String(emp.id);
    const historyDays = new Set(replayAllDates(emp)).size;
    const historyOpen = isLoanHistoryOpen(historyScope);
    const duplicates = renderLoanDuplicateReview({ scope: historyScope, employees: [emp], embedded: true });
    const consolidations = findConsolidations(emp);
    const numbersAll = getLoanNumbers(emp.loans || []);

    return `
    <div class="la" data-employee="${escapeAttr(emp.id)}">
        <div class="la-head">
            <button type="button" class="loans-detail-back" data-app-fn="clearLoansEmployee" aria-label="Volver a préstamos / adelantos">
                <svg class="loans-detail-back__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>
            </button>
            <div class="la-head__who"><b>${escapeHTML(nameParts.join(' ') || 'Sin nombre')}</b><small>#${escapeHTML(emp.number ?? '')}${emp.active === false ? ' · inactivo' : ''}</small></div>
            <button type="button" class="la-link" data-app-fn="laUseClassicView" data-arg="1" title="Volver a la ficha anterior (solo en este dispositivo)">Vista anterior</button>
        </div>

        <section class="la-hub" aria-label="Cuenta de préstamos">
            <div class="la-hub__top">
                <span class="la-hub__lab">Debe en total · ${summary.count} préstamo${summary.count === 1 ? '' : 's'} abierto${summary.count === 1 ? '' : 's'}</span>
                ${chip || '<span></span>'}
                <span class="la-hub__big">${M(summary.balance)}</span>
                <div class="la-hub__bar">${splitBar(paid, summary, { big: true })}</div>
                ${historyDays ? `<button type="button" class="la-link la-hub__hist" data-app-fn="toggleLoanHistory" data-arg="${escapeAttr(historyScope)}" aria-expanded="${historyOpen}">${historyOpen ? '▾ Ocultar historial' : `▸ Ver historial (${historyDays})`}</button>` : ''}
            </div>
            <div class="la-hub__facts">
                <div><span>Próxima nómina${next ? ' · pago ' + dm(next.payDate) : ''}</span><b>${M(nextAmount)}</b><small class="${!agreement && salary > 0 && nextAmount > salary * 0.6 ? 'la-t-bad' : ''}">${agreement ? 'según el acuerdo' : salary > 0 ? `${Math.round(nextAmount / salary * 100)} % de lo que gana` : 'sin sueldo calculado'}</small></div>
                <div><span>Gana por periodo</span><b>${salary > 0 ? '≈' + M(salary, 0) : '—'}</b><small>cálculo de Nómina</small></div>
                <div><span>Último abono</span><b>${lastPay ? M(lastPay.amount, 0) : '—'}</b><small>${lastPay ? `${dmy(lastPay.date)} · ${lastPay.origin === MOVEMENT_ORIGIN.ACCOUNT ? 'a la cuenta' : lastPay.parts.length === 1 ? 'préstamo #' + lastPay.parts[0].number : lastPay.parts.length + ' préstamos'}` : ''}</small></div>
            </div>
            ${historyOpen ? `<div class="la-hub__history">${renderLoanHistoryPanel({ scope: historyScope, mode: 'employee', employees: [emp], embedded: true })}</div>` : ''}
            ${duplicates ? `<div class="la-hub__dup">${duplicates}</div>` : ''}
            ${consolidations.map(c => `<div class="la-hub__cons"><span>🔗 <b>Consolidación por deshacer:</b> el préstamo #${numbersAll.get(c.loan.id)} reúne ${c.sources.map(s => '#' + numbersAll.get(s.id)).join(', ')}. Se vuelven préstamos separados.</span><button type="button" class="la-btn la-btn--sm la-btn--refi" data-app-fn="laOpen" data-arg="unconsolidate" data-arg2="${escapeAttr(c.loan.id)}">Revisar y deshacer</button></div>`).join('')}
        </section>

        <div class="la-actions">
            <button type="button" class="la-btn la-btn--pay" data-app-fn="laOpen" data-arg="pay" ${summary.count ? '' : 'disabled'} title="Abonar a la cuenta">Abonar</button>
            <button type="button" class="la-btn la-btn--refi" data-app-fn="laOpen" data-arg="refi" ${summary.count ? '' : 'disabled'} title="Refinanciar lo vencido">Refinanciar</button>
            <button type="button" class="la-btn la-btn--new" data-app-fn="laOpen" data-arg="loan" title="Nuevo préstamo o adelanto">+ Préstamo</button>
            <button type="button" class="la-btn" data-app-fn="laOpen" data-arg="agree" ${summary.count || agreement ? '' : 'disabled'} title="Acordar monto por nómina">Acuerdo</button>
        </div>

        <div class="la-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="${ui.tab !== 'mov'}" data-app-fn="laSetTab" data-arg="loans">Préstamos<em>${summary.count}</em></button>
            <button type="button" role="tab" aria-selected="${ui.tab === 'mov'}" data-app-fn="laSetTab" data-arg="mov">Movimientos de la cuenta<em>${movements.filter(m => !m.voided).length}</em></button>
        </div>
        ${ui.tab === 'mov' ? MovementsPanel(emp, movements) : LoansPanel(emp, periods, payDates, today)}

        ${ui.modal ? AccountModal(emp, ui.modal, { periods, today, summary, salary, agreement }) : ''}
    </div>`;
}

// ─── Pestaña Préstamos ───────────────────────────────────────────────────────

function LoansPanel(emp, periods, payDates, today) {
    const ui = accountUi();
    const numbers = getLoanNumbers(emp.loans || []);
    const loans = [...(emp.loans || [])].sort((a, b) => numbers.get(a.id) - numbers.get(b.id));
    const open = loans.filter(l => l.status === LOAN_STATUS.ACTIVE);
    const closed = loans.filter(l => l.status === LOAN_STATUS.PAID || (l.status === LOAN_STATUS.WRITTEN_OFF && l.closure && l.closure.reason !== CLOSE_REASON.ERROR));
    const voided = loans.filter(l => l.status === LOAN_STATUS.WRITTEN_OFF && !(l.closure && l.closure.reason !== CLOSE_REASON.ERROR));
    const row = loan => LoanRow(emp, loan, numbers, payDates, today, !!ui.open?.[loan.id]);
    if (!loans.length) return '<div class="la-empty">Este empleado no tiene préstamos. Usa «+ Préstamo» para crear el primero.</div>';
    return `
        <div class="la-list">${open.map(row).join('') || '<div class="la-empty la-empty--inline">No tiene préstamos abiertos.</div>'}</div>
        ${closed.length ? `<details class="la-more"><summary>Saldados y cerrados (${closed.length})</summary><div class="la-list">${closed.map(row).join('')}</div></details>` : ''}
        ${voided.length ? `<details class="la-more"><summary>Anulados (${voided.length})</summary><div class="la-list">${voided.map(row).join('')}</div></details>` : ''}`;
}

function LoanRow(emp, loan, numbers, payDates, today, isOpen) {
    const n = numbers.get(loan.id);
    const terms = getActiveLoanTerms(loan);
    const active = loan.status === LOAN_STATUS.ACTIVE;
    const pending = active ? getLoanPending(loan) : { capital: 0, interest: 0, balance: getBalance(loan) };
    const paid = loanPaidSplit(loan);
    const lock = getLoanLock(loan);
    const due = getLoanDueDate(loan);
    const miss = active ? countMissedPayDates(loan, payDates, today, { graceDays: VENCIDO_GRACE_DAYS }) : 0;
    const refis = (loan.refinancings || []).filter(r => !r.voided && !r.adjustment);
    const refiTotal = round2(refis.reduce((t, r) => t + Number(r.interestAmount || 0), 0));
    const initInterest = terms.interestIncluded ? 0 : round2(terms.principal * terms.interestRate / 100);
    const pills = [
        miss >= 2 ? `<span class="la-pill la-pill--bad">Vencido · ${miss} nóminas</span>` : miss === 1 ? `<span class="la-pill la-pill--warn">Vencido ${dm(due)}</span>`
            : active && due === today ? '<span class="la-pill la-pill--int">Se cobra hoy</span>'
            : active && due && due < today ? `<span class="la-pill la-pill--int" title="Los descuentos de la nómina se anotan hasta ${VENCIDO_GRACE_DAYS} días después del pago">En cobro · nómina del ${dm(due)}</span>` : '',
        lock ? '<span class="la-pill" title="Tiene movimientos en un cierre de nómina">🔒 con cierre</span>' : '',
        refis.length ? '<span class="la-pill la-pill--refi">Refinanciado</span>' : '',
        terms.installmentMode === INSTALLMENT_MODE.INSTALLMENTS ? `<span class="la-pill">${(terms.installments || []).length} cuotas</span>` : '',
        loan.consolidationUndone ? '<span class="la-pill la-pill--refi">Consolidación deshecha</span>'
            : loan.consolidatedIntoLoanId ? `<span class="la-pill la-pill--refi">Consolidado en #${numbers.get(loan.consolidatedIntoLoanId) ?? '?'}</span>`
            : loan.closure ? `<span class="la-pill ${loan.closure.reason === CLOSE_REASON.ERROR ? 'la-pill--bad' : 'la-pill--int'}">${escapeHTML(CLOSE_REASON_LABEL[loan.closure.reason] || '')}</span>`
            : loan.status === LOAN_STATUS.PAID ? '<span class="la-pill la-pill--pay">Saldado</span>'
            : loan.status === LOAN_STATUS.WRITTEN_OFF ? '<span class="la-pill la-pill--bad">Anulado</span>' : ''
    ].join('');
    const acts = getAccountMovements(emp).filter(m => (m.loanId === loan.id) || (m.parts || []).some(p => p.loanId === loan.id));
    const visibleActs = acts.filter(m => accountUi().showVoid || !m.voided);
    return `
    <div class="la-row${active ? '' : ' is-closed'}${isOpen ? ' is-open' : ''}">
        <div class="la-row__head" role="button" tabindex="0" data-app-fn="laToggleLoan" data-arg="${escapeAttr(loan.id)}" aria-expanded="${isOpen}">
            <span class="la-idx">#${n}</span>
            <div class="la-row__title"><b>${escapeHTML(loan.concept || 'Préstamo')} · ${dmy(terms.startDate)}</b>${pills}
                <small>${M(terms.principal, 0)} al ${terms.interestRate} % · total ${M(terms.principal + initInterest + refiTotal, 0)} · ${active ? (due ? `cobro nómina del ${dm(due)}` : 'sin nómina de cobro guardada') : `pagado ${M(paid.interest + paid.capital, 0)}`}</small></div>
            <div class="la-row__amt"><b>${M(active ? pending.balance : 0)}</b><small>${paid.interest + paid.capital > 0 ? `pagado ${M(paid.interest + paid.capital, 0)}` : 'sin abonos'}</small></div>
            <span class="la-chev" aria-hidden="true">${isOpen ? '▴' : '▾'}</span>
        </div>
        ${isOpen ? `
        <div class="la-row__body">
            <span class="la-own">Detalle del préstamo #${n}</span>
            ${splitBar(paid, pending)}
            <div class="la-kv">
                <div><span>Capital</span><b>${M(terms.principal, 0)}</b></div>
                <div><span>Interés</span><b>${M(initInterest, 0)}</b></div>
                <div><span>Refinanciado</span><b class="la-t-refi">${M(refiTotal, 0)}</b></div>
                <div><span>Pagado</span><b class="la-t-pay">${M(paid.interest + paid.capital, 0)}</b></div>
                <div><span>Capital pend.</span><b class="la-t-cap">${M(pending.capital, 0)}</b></div>
                <div><span>Saldo</span><b>${M(pending.balance, 0)}</b></div>
            </div>
            <span class="la-act-h">Actividad del préstamo #${n} · ${visibleActs.length} movimiento${visibleActs.length === 1 ? '' : 's'}</span>
            <div class="la-inner">${visibleActs.map(m => MovementRow(m, { loanId: loan.id })).join('') || '<div class="la-mv"><span></span><div class="la-mv__w"><small>Sin movimientos</small></div></div>'}</div>
            ${active ? `<div class="la-loan-acts">
                <button type="button" class="la-btn la-btn--pay" data-app-fn="laOpen" data-arg="pay" data-arg2="${escapeAttr(loan.id)}">Pagar préstamo #${n}</button>
                <button type="button" class="la-btn la-btn--refi" data-app-fn="laOpen" data-arg="refi" data-arg2="${escapeAttr(loan.id)}">Refinanciar #${n}</button>
                <button type="button" class="la-btn la-btn--edit" data-app-fn="laOpen" data-arg="edit" data-arg2="${escapeAttr(loan.id)}">Editar</button>
                <button type="button" class="la-btn la-btn--danger" data-app-fn="laOpen" data-arg="close" data-arg2="${escapeAttr(loan.id)}">Anular préstamo</button>
            </div>` : loan.consolidationUndone ? `<div class="la-loan-acts">
                <button type="button" class="la-btn" data-app-fn="laRestoreConsolidation" data-arg="${escapeAttr(loan.id)}" title="Deja los préstamos como estaban antes de deshacer">Volver a consolidar</button>
            </div>` : loan.status === LOAN_STATUS.WRITTEN_OFF && !loan.closure ? `<div class="la-loan-acts">
                <button type="button" class="la-btn" data-app-fn="reopenLoanHandler" data-arg="${escapeAttr(loan.id)}">Reactivar</button>
                <button type="button" class="la-btn la-btn--danger" data-app-fn="deleteLoanWithConfirm" data-arg="${escapeAttr(loan.id)}">Eliminar</button>
            </div>` : loan.closure ? `<div class="la-loan-acts"><button type="button" class="la-btn" data-app-fn="laUndoClosure" data-arg="${escapeAttr(loan.id)}">Deshacer cierre</button></div>` : ''}
        </div>` : ''}
    </div>`;
}

// ─── Pestaña Movimientos ─────────────────────────────────────────────────────

function MovementsPanel(emp, movements) {
    const ui = accountUi();
    const list = movements.filter(m => ui.showVoid || !m.voided);
    return `
        <div class="la-toolbar"><span>Del más reciente al más viejo. La ✕ anula el movimiento; lo que está en un cierre de nómina (🔒) se corrige con un ajuste.</span>
            <label><input type="checkbox" ${ui.showVoid ? 'checked' : ''} onchange="laToggleShowVoid()"> Mostrar anulados</label></div>
        <div class="la-list">${list.map(m => MovementRow(m)).join('') || '<div class="la-empty la-empty--inline">Sin movimientos.</div>'}</div>`;
}

/** Clave estable de un movimiento para anular/ajustar desde la UI. */
export function movementKey(m) {
    if (m.kind === 'payment' || m.kind === 'refinancing' || m.kind === 'adjustment') {
        if (m.accountTxId) return `tx|${m.accountTxId}`;
        const part = m.parts[0];
        return `${part.adjustment?.ofKind === 'refinancing' || m.kind === 'refinancing' ? 'refi' : 'pay'}|${part.loanId}|${part.itemId}`;
    }
    if (m.kind === 'edit') return `edit|${m.loanId}|${m.id}`;
    if (m.kind === 'close') return `close|${m.loanId}`;
    if (m.kind === 'agreement') return `agr|${m.id}`;
    return `loan|${m.loanId}`;
}

function movementText(m, loanId) {
    const part = loanId ? (m.parts || []).find(p => p.loanId === loanId) : null;
    const splitTxt = p => `${p.interest ? M(p.interest, 0) + ' interés' : ''}${p.interest && p.capital ? ' · ' : ''}${p.capital ? M(p.capital, 0) + ' capital' : ''}`;
    switch (m.kind) {
    case 'loan':
        return { title: `Préstamo #${m.number}`, sub: '', amount: '+' + M(m.amount), tone: 'cap' };
    case 'payment': {
        const parts = m.parts.filter(p => m.voided || !p.voided);
        const title = part && m.origin === MOVEMENT_ORIGIN.ACCOUNT ? 'Parte del abono a la cuenta' : m.origin === MOVEMENT_ORIGIN.ACCOUNT ? 'Abono a la cuenta' : `Abono al préstamo #${parts[0]?.number ?? ''}`;
        const sub = part ? (m.origin === MOVEMENT_ORIGIN.ACCOUNT ? `abono total ${M(m.amount)} en ${parts.length} préstamos` : splitTxt(part))
            : parts.map(p => `#${p.number} ${M(p.amount, 0)}`).join(' · ');
        return { title, sub, amount: '−' + M(part ? part.amount : m.amount), tone: 'pay', detail: part && m.origin === MOVEMENT_ORIGIN.ACCOUNT ? splitTxt(part) : '' };
    }
    case 'refinancing': {
        const parts = m.parts.filter(p => m.voided || !p.voided);
        const title = part && m.origin === MOVEMENT_ORIGIN.ACCOUNT ? 'Parte del refinanciamiento de la cuenta' : m.origin === MOVEMENT_ORIGIN.ACCOUNT ? 'Refinanciamiento de la cuenta' : `Refinanciamiento del préstamo #${parts[0]?.number ?? ''}`;
        const why = m.reason ? REFINANCE_REASON_LABEL[m.reason] || m.reason : '';
        const sub = [why, part ? '' : parts.map(p => `#${p.number} +${M(p.amount, 0)}`).join(' · '), m.nextDueDate ? `pasa a la nómina del ${dm(m.nextDueDate)}` : ''].filter(Boolean).join(' · ');
        return { title, sub, amount: '+' + M(part ? part.amount : m.amount), tone: 'refi' };
    }
    case 'adjustment': {
        const isRefi = m.parts[0]?.adjustment?.ofKind === 'refinancing';
        const total = part ? part.amount : m.amount;
        return {
            title: `Ajuste: se anula ${isRefi ? 'un refinanciamiento' : 'un abono'} de una nómina cerrada`,
            sub: `el cierre no cambia · ${m.parts.map(p => `#${p.number} ${isRefi ? '−' : '+'}${M(Math.abs(p.amount), 0)}`).join(' · ')}`,
            amount: (isRefi ? '−' : '+') + M(Math.abs(total)), tone: 'warn'
        };
    }
    case 'edit':
        return {
            title: m.closureEdit ? `Préstamo #${m.number} corregido · cierre editado` : `Préstamo #${m.number} corregido`,
            sub: Object.keys(m.after || {}).map(k => `${EDIT_LABEL[k] || k}: ${fmtField(k, m.before[k])} → ${fmtField(k, m.after[k])}`).join(' · ') + (m.reason ? ` · ${m.reason}` : '') + ` · saldo ${M(m.balanceBefore, 0)} → ${M(m.balanceAfter, 0)}`,
            amount: m.balanceAfter === m.balanceBefore ? 'sin cambio de monto' : (m.balanceAfter > m.balanceBefore ? '+' : '−') + M(Math.abs(m.balanceAfter - m.balanceBefore)), tone: 'cap'
        };
    case 'close':
        return {
            title: `Préstamo #${m.number} ${m.reason === CLOSE_REASON.ERROR ? 'anulado' : m.reason === CLOSE_REASON.FORGIVEN ? 'perdonado' : 'cerrado'}`,
            sub: [CLOSE_REASON_LABEL[m.reason], m.note, m.forgiven ? `${M(m.forgiven.capital, 0)} capital y ${M(m.forgiven.interest, 0)} interés` : ''].filter(Boolean).join(' · '),
            amount: m.forgiven ? '−' + M(m.forgiven.capital + m.forgiven.interest) : 'fuera de la cuenta', tone: 'bad'
        };
    case 'agreement': {
        const a = m.agreement;
        return {
            title: a.replaces ? 'Acuerdo de pago cambiado' : 'Acuerdo de pago',
            sub: `desde la nómina del ${dm(a.startPayDate)} · ${a.interestMode === AGREEMENT_INTEREST.RATE ? a.rate + ' % sobre lo pendiente' : 'sin interés mientras cumpla'} · préstamos nuevos: ${a.onNewLoan === AGREEMENT_NEW_LOANS.REVIEW ? 'avisar' : 'se suman'}${a.note ? ' · ' + a.note : ''}`,
            amount: M(a.amount, 0) + ' / nómina', tone: 'int'
        };
    }
    default:
        return { title: m.kind, sub: '', amount: '', tone: 'cap' };
    }
}

const EDIT_LABEL = { principal: 'Monto', interestRate: 'Interés', startDate: 'Entrega', dueDate: 'Nómina de cobro', concept: 'Concepto' };
function fmtField(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (key === 'principal') return M(value);
    if (key === 'interestRate') return value + ' %';
    if (key === 'startDate' || key === 'dueDate') return dmy(value);
    return String(value);
}

function MovementRow(m, { loanId = null } = {}) {
    const ui = accountUi();
    const key = movementKey(m);
    const where = loanId ? `L${loanId}` : 'acc';
    const t = movementText(m, loanId);
    const isPayRefi = m.kind === 'payment' || m.kind === 'refinancing' || m.kind === 'adjustment';
    const canVoid = !m.voided && !m.adjustedBy && m.kind !== 'loan';
    const asking = ui.ask === `${key}#${where}`;
    return `
    <div class="la-mv${m.voided ? ' is-void' : ''}">
        <span class="la-dot la-c-${t.tone}"></span>
        <div class="la-mv__w"><b>${escapeHTML(t.title)}</b>${isPayRefi ? originPill(m.origin) : ''}${m.lock ? `<span class="la-pill" title="Está en un cierre de nómina">🔒 cierre</span>` : ''}${m.adjustedBy ? '<span class="la-pill la-pill--warn">ajustado</span>' : ''}${m.closureFix ? '<span class="la-pill la-pill--warn">quitado del cierre</span>' : ''}${(m.parts || []).some(p => p.needsReview) ? '<span class="la-pill la-pill--warn" title="Fuera de los días de pago: revísalo en la pantalla principal de Préstamos">revisar</span>' : ''}${m.voided ? '<span class="la-pill la-pill--bad">anulado</span>' : ''}
            <small>${dmy(m.date)}${t.sub ? ' · ' + escapeHTML(t.sub) : ''}${m.closureFix ? ` · motivo: ${escapeHTML(m.closureFix.reason)} · saldo ${M(m.closureFix.before.accountBalance, 0)} → ${M(m.closureFix.after.accountBalance, 0)}` : ''}${m.note && isPayRefi ? ' · ' + escapeHTML(m.note) : ''}</small></div>
        <div class="la-mv__a la-t-${t.tone}">${escapeHTML(t.amount)}${t.detail ? `<small>${escapeHTML(t.detail)}</small>` : ''}</div>
        ${canVoid ? `<button type="button" class="la-x" data-app-fn="laAsk" data-arg="${escapeAttr(key)}" data-arg2="${escapeAttr(where)}" aria-label="Anular este movimiento" title="Anular">✕</button>` : '<span></span>'}
        ${asking ? ConfirmBox(m, key) : ''}
    </div>`;
}

function ConfirmBox(m, key) {
    const ui = accountUi();
    const today = getDateKey(new Date());
    if ((m.kind === 'payment' || m.kind === 'refinancing') && m.lock) {
        const open = nextPayPeriod(getAccountPayPeriods(today).filter(p => !closedPeriodEnds().has(p.end)), today);
        const what = m.kind === 'payment' ? 'abono' : 'refinanciamiento';
        return `<div class="la-confirm la-confirm--lock">
            <span>🔒 Este ${what} está en un <b>cierre de nómina</b>. El cierre no se toca; elige cómo corregirlo:</span>
            <div class="la-fix"><b>1 · Ajuste en la nómina abierta${open ? ` (${escapeHTML(open.short)})` : ''}</b>
                <small>Se registra un movimiento nuevo que devuelve exactamente lo que este ${what} tocó. Lo posterior no se vuelve a repartir.</small>
                <div class="la-fix__row"><button type="button" class="la-btn la-btn--sm" data-app-fn="laAdjust" data-arg="${escapeAttr(key)}" data-arg2="${escapeAttr(open ? open.payDate : today)}">Crear ajuste</button></div></div>
            <div class="la-fix"><b>2 · Corregir el cierre (fue un error)</b>
                <small>Se quita como si no hubiera existido y lo posterior se vuelve a repartir. Queda marcado «quitado del cierre» con el motivo, el saldo antes y el resultado.</small>
                <div class="la-fix__row"><input type="text" class="la-input" placeholder="Motivo (obligatorio): ej. se registró dos veces" value="${escapeAttr(ui.fixWhy || '')}" oninput="laFixWhy(this.value)" aria-label="Motivo de la corrección">
                <button type="button" class="la-btn la-btn--sm la-btn--danger" data-app-fn="laFix" data-arg="${escapeAttr(key)}">Corregir el cierre</button></div></div>
            <div class="la-fix__row"><button type="button" class="la-btn la-btn--sm la-btn--ghost" data-app-fn="laCancelAsk">Cancelar</button></div>
        </div>`;
    }
    const later = m.kind === 'payment' || m.kind === 'refinancing' || m.kind === 'adjustment';
    const msg = m.kind === 'agreement' ? 'Se cancela el acuerdo: Nómina vuelve a cobrar lo que vence.'
        : m.kind === 'edit' ? 'Se deshace la corrección y vuelven los datos anteriores del préstamo (solo la última corrección).'
        : m.kind === 'close' ? `El préstamo #${m.number} vuelve a quedar abierto con su saldo.`
        : m.kind === 'adjustment' ? 'Se quita el ajuste: el movimiento original vuelve a contar.'
        : m.origin === MOVEMENT_ORIGIN.ACCOUNT ? `Vino de la cuenta y tocó ${m.parts.filter(p => !p.voided).length} préstamos: se anula en todos.`
        : 'Se anula solo en este préstamo.';
    const label = m.kind === 'agreement' ? 'Cancelar acuerdo' : m.kind === 'edit' || m.kind === 'close' ? 'Deshacer' : m.kind === 'adjustment' ? 'Quitar ajuste' : 'Anular';
    return `<div class="la-confirm"><span>${escapeHTML(msg)}${later ? ' No está en un cierre: los abonos a la cuenta posteriores se vuelven a repartir.' : ''}</span>
        <div class="la-fix__row"><button type="button" class="la-btn la-btn--sm la-btn--danger" data-app-fn="laVoid" data-arg="${escapeAttr(key)}">${label}</button><button type="button" class="la-btn la-btn--sm la-btn--ghost" data-app-fn="laCancelAsk">Cancelar</button></div></div>`;
}

// ─── Ventanas ────────────────────────────────────────────────────────────────

function AccountModal(emp, modal, ctx) {
    const body = modal.type === 'pay' ? PayModal(emp, modal, ctx)
        : modal.type === 'refi' ? RefiModal(emp, modal, ctx)
        : modal.type === 'loan' ? NewLoanModal(emp, modal, ctx)
        : modal.type === 'edit' ? EditModal(emp, modal, ctx)
        : modal.type === 'close' ? CloseModal(emp, modal)
        : modal.type === 'agree' ? AgreeModal(emp, modal, ctx)
        : modal.type === 'unconsolidate' ? UnconsolidateModal(emp, modal) : '';
    return `<div class="la-ov" data-app-close-on-self="laClose"><div class="la-md" role="dialog" aria-modal="true">${body}</div></div>`;
}

const head = (tone, title, sub) => `<div class="la-md__h"><h2><span class="la-tag la-c-${tone}"></span>${escapeHTML(title)}${sub ? `<small>${escapeHTML(sub)}</small>` : ''}</h2><button type="button" class="la-closex" data-app-fn="laClose" aria-label="Cerrar">✕</button></div>`;
const numInput = (field, value, { big = false, label = '', id = '' } = {}) => `<label class="la-fl" for="la-${id || field}">${label}<input id="la-${id || field}" class="la-input${big ? ' la-input--big' : ''}" type="text" inputmode="decimal" autocomplete="off" value="${escapeAttr(value ?? '')}" oninput="laField('${field}', this.value)"></label>`;
const textInput = (field, value, label, placeholder = '') => `<label class="la-fl" for="la-${field}">${label}<input id="la-${field}" class="la-input" type="text" value="${escapeAttr(value ?? '')}" placeholder="${escapeAttr(placeholder)}" oninput="laFieldQuiet('${field}', this.value)"></label>`;
const dateInput = (field, value, label) => `<label class="la-fl" for="la-${field}">${label}<input id="la-${field}" class="la-input" type="date" value="${escapeAttr(value || '')}" onchange="laField('${field}', this.value)"></label>`;
const select = (field, value, label, options) => `<label class="la-fl" for="la-${field}">${label}<select id="la-${field}" class="la-input" onchange="laField('${field}', this.value)">${options.map(o => `<option value="${escapeAttr(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></label>`;
const seg = (field, value, options) => `<span class="la-seg">${options.map(o => `<button type="button" aria-pressed="${String(o.value) === String(value)}" data-app-fn="laField" data-arg="${escapeAttr(field)}" data-arg2="${escapeAttr(o.value)}">${escapeHTML(o.label)}</button>`).join('')}</span>`;
const footer = (left, okLabel, okTone, enabled) => `<div class="la-md__f"><span class="la-md__tot">${left}</span><div class="la-md__acts"><button type="button" class="la-btn la-btn--ghost" data-app-fn="laClose">Cancelar</button><button type="button" class="la-btn la-btn--${okTone}" data-app-fn="laSave" ${enabled ? '' : 'disabled'}>${escapeHTML(okLabel)}</button></div></div>`;

function periodOptions(periods, { from = null, to = null, closed = null } = {}) {
    return periods.filter(p => (!from || p.payDate >= from) && (!to || p.payDate <= to))
        .map(p => ({ value: p.payDate, label: p.label + (closed && closed.has(p.end) ? ' · cerrada' : ''), disabled: !!(closed && closed.has(p.end)) }));
}

function PayModal(emp, m, { periods, today, summary, salary, agreement }) {
    const target = m.target && m.target !== 'account' ? (emp.loans || []).find(l => String(l.id) === String(m.target)) : null;
    const numbers = getLoanNumbers(emp.loans || []);
    const pool = target ? summary.loans.filter(x => x.loan.id === target.id) : summary.loans;
    const owed = round2(pool.reduce((t, x) => t + x.balance, 0));
    const intOwed = round2(pool.reduce((t, x) => t + x.interest, 0));
    const amount = Number(m.amount) || 0;
    const plan = allocateAccountPayment(pool, amount);
    const byLoan = new Map(plan.parts.map(p => [p.loanId, p]));
    const tInt = round2(plan.parts.reduce((t, p) => t + p.interest, 0));
    const tCap = round2(plan.parts.reduce((t, p) => t + p.capital, 0));
    const closed = closedPeriodEnds();
    const recent = periods.filter(p => p.payDate <= (nextPayPeriod(periods, today)?.payDate || today)).slice(-3);
    if (m.period && !recent.some(p => p.payDate === m.period)) recent.push(...periods.filter(p => p.payDate === m.period));
    const thirty = Math.round(salary * 0.3 / 100) * 100;
    return `${head('pay', target ? `Pagar el préstamo #${numbers.get(target.id)}` : 'Abonar a la cuenta', `debe ${M(owed)}${target ? '' : ` · ${pool.length} préstamos`}`)}
    <div class="la-md__b">
        <div class="la-row3">${numInput('amount', m.amount, { big: true, label: 'Monto' })}${dateInput('date', m.date, 'Fecha')}${select('channel', m.channel, 'Forma de pago', Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })))}</div>
        <div class="la-row2b"><div class="la-chips"><button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${owed}">Todo ${M(owed, 0)}</button>${intOwed > 0 ? `<button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${intOwed}" title="Paga solo el interés pendiente; el capital queda igual">Solo interés ${M(intOwed, 0)}</button>` : ''}${!target && agreement ? `<button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${Math.min(agreement.amount, owed)}">Acordado ${M(agreement.amount, 0)}</button>` : ''}${!target && thirty > 0 ? `<button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${Math.min(thirty, owed)}">30 % sueldo ${M(thirty, 0)}</button>` : ''}</div>
            ${m.channel === 'payroll' && recent.length ? `<label class="la-inl" for="la-period">Nómina<select id="la-period" class="la-input" onchange="laField('period', this.value)">${periodOptions(recent, { closed }).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === m.period ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${escapeHTML(o.label)}</option>`).join('')}</select></label>` : ''}</div>
        <div class="la-tbl"><table><thead><tr><th>${target ? 'Primero su interés, luego su capital' : 'Reparto · interés de todos, luego capital del más viejo'}</th><th>Debe</th><th>Interés</th><th>Capital</th><th>Queda</th></tr></thead><tbody>
            ${pool.map(x => { const p = byLoan.get(x.loan.id) || { interest: 0, capital: 0 }; const q = round2(x.balance - p.interest - p.capital);
                return `<tr><td><b>#${x.number}</b> ${dm(x.loan.startDate)}</td><td><b>${M(x.balance, 0)}</b><small class="la-split"><span class="la-t-int">${M(x.interest, 0)} int.</span> · <span class="la-t-cap">${M(x.capital, 0)} cap.</span></small></td><td class="la-t-payint">${p.interest ? M(p.interest, 0) : '—'}</td><td class="la-t-pay">${p.capital ? M(p.capital, 0) : '—'}</td><td>${q <= 0.004 ? '<span class="la-pill la-pill--pay">Saldado</span>' : M(q, 0)}</td></tr>`; }).join('')}
            <tr class="la-tot"><td>Total</td><td>${M(owed, 0)}<small class="la-split"><span class="la-t-int">${M(intOwed, 0)} int.</span> · <span class="la-t-cap">${M(owed - intOwed, 0)} cap.</span></small></td><td class="la-t-payint">${M(tInt, 0)}</td><td class="la-t-pay">${M(tCap, 0)}</td><td>${M(Math.max(0, owed - tInt - tCap), 0)}</td></tr>
        </tbody></table></div>
        ${plan.excess > 0.01 ? `<div class="la-warnbox">Pasa de lo que debe por <b>${M(plan.excess)}</b>. Corrige el monto (todavía no se puede dejar saldo a favor).</div>` : ''}
        ${textInput('note', m.note, 'Nota (opcional)', 'Ej.: abono acordado en la obra')}
    </div>
    ${footer(`Queda debiendo <b>${M(Math.max(0, summary.balance - Math.min(amount, owed)))}</b>`, 'Guardar abono', 'pay', amount > 0 && plan.excess <= 0.01)}`;
}

function RefiModal(emp, m, { periods, today, summary }) {
    const numbers = getLoanNumbers(emp.loans || []);
    const next = followingPayPeriod(periods, m.period);
    const rows = summary.loans.map(x => {
        const on = !!m.sel?.[x.loan.id];
        const base = m.basis === 'capital' ? x.capital : x.balance;
        return { x, on, base, charge: on ? round2(base * (Number(m.rate) || 0) / 100) : 0 };
    });
    const total = round2(rows.reduce((t, r) => t + r.charge, 0));
    const count = rows.filter(r => r.on).length;
    const recent = periods.filter(p => p.payDate <= today).slice(-3);
    const ok = m.reason && count > 0 && Number(m.rate) > 0 && (m.reason !== REFINANCE_REASON.OTHER || String(m.note || '').trim().length >= 3);
    return `${head('refi', m.only ? `Refinanciar el préstamo #${numbers.get(m.only)}` : 'Refinanciar lo vencido', 'interés sobre lo que no se cobró')}
    <div class="la-md__b">
        <div class="la-row4">${recent.length ? select('period', m.period, 'Nómina que no alcanzó', periodOptions(recent)) : dateInput('period', m.period, 'Nómina que no alcanzó (día de pago)')}
            ${select('reason', m.reason, 'Motivo *', [{ value: '', label: 'Elige…' }, ...Object.entries(REFINANCE_REASON_LABEL).map(([value, label]) => ({ value, label }))])}
            ${numInput('rate', m.rate, { label: 'Interés %' })}
            ${select('basis', m.basis, 'Sobre', [{ value: 'balance', label: 'Saldo' }, { value: 'capital', label: 'Solo capital' }])}</div>
        <div class="la-tbl"><table><thead><tr><th>${m.only ? 'Solo este préstamo' : 'Incluidos · todo lo vencido'}</th><th>Cobro</th><th>${m.basis === 'capital' ? 'Capital' : 'Saldo'}</th><th>Cargo</th><th>Interés pend.</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td><label class="la-check"><input type="checkbox" ${r.on ? 'checked' : ''} ${m.only ? 'disabled' : ''} onchange="laToggleSel('${escapeAttr(r.x.loan.id)}')"><b>#${r.x.number}</b> ${dm(r.x.loan.startDate)}</label></td><td>${r.x.dueDate ? dm(r.x.dueDate) : '—'}</td><td>${M(r.base, 0)}</td><td class="la-t-refi">${r.on ? '+' + M(r.charge, 0) : '—'}</td><td>${r.on ? `<span class="la-t-faint">${M(r.x.interest, 0)}</span> → <b class="la-t-int">${M(r.x.interest + r.charge, 0)}</b>` : `<span class="la-t-faint">${M(r.x.interest, 0)}</span>`}</td></tr>`).join('')}
            <tr class="la-tot"><td>${count} préstamo${count === 1 ? '' : 's'}</td><td></td><td>${M(rows.filter(r => r.on).reduce((t, r) => t + r.base, 0), 0)}</td><td class="la-t-refi">+${M(total)}</td><td></td></tr>
        </tbody></table></div>
        <div class="la-line">Pasan a cobrarse en la nómina ${next ? `del <b>${dm(next.payDate)}</b> (${escapeHTML(next.short)})` : 'siguiente'}.</div>
        ${textInput('note', m.note, m.reason === REFINANCE_REASON.OTHER ? 'Nota (obligatoria con «otro motivo»)' : 'Nota (opcional)', 'Ej.: se descontó la mitad por días no trabajados')}
    </div>
    ${footer(`Cargo <b class="la-t-refi">${M(total)}</b> · queda <b>${M(summary.balance + total)}</b>`, 'Generar cargo', 'refi', ok)}`;
}

function NewLoanModal(emp, m, { periods, today, summary, salary }) {
    const numbers = getLoanNumbers(emp.loans || []);
    const nextNumber = nextLoanNumber(emp.loans) || Math.max(0, ...getLoanNumbers(emp.loans || []).values()) + 1;
    const amount = Number(m.amount) || 0;
    const rate = Number(m.rate) || 0;
    const interest = round2(amount * rate / 100);
    const total = round2(amount + interest);
    const count = Math.max(2, Number(m.count) || 2);
    const after = round2(summary.balance + total);
    const pct = salary > 0 ? Math.round(after / salary * 100) : null;
    const future = periods.filter(p => p.payDate >= today).slice(0, 4);
    void numbers;
    return `${head('int', `Nuevo préstamo #${nextNumber}`, `hoy debe ${M(summary.balance)} · ${summary.count} préstamos`)}
    <div class="la-md__b">
        <div class="la-row3">${numInput('amount', m.amount, { big: true, label: 'Monto entregado' })}${dateInput('date', m.date, 'Entrega')}${numInput('rate', m.rate, { label: 'Interés %' })}</div>
        <div class="la-line">Interés <b>${M(interest)}</b> · total a devolver <b>${M(total)}</b></div>
        <div class="la-row3"><div class="la-fl"><span>Cómo se cobra</span>${seg('plan', m.plan, [{ value: 'lump', label: 'Pago único' }, { value: 'installments', label: 'Cuotas' }])}</div>
            ${m.plan === 'lump' ? (future.length ? select('period', m.period, 'En la nómina', periodOptions(future)) : dateInput('period', m.period, 'Se cobra el')) : numInput('count', m.count, { label: 'Cuotas' })}
            ${m.plan === 'installments' ? select('freq', m.freq, 'Cada', [1, 2, 3, 4].map(w => ({ value: w, label: `${w} semana${w === 1 ? '' : 's'}` }))) : '<span></span>'}</div>
        ${m.plan === 'installments' ? `<div class="la-line">${count} cuotas de <b>${M(total / count)}</b></div>` : ''}
        ${pct !== null ? `<div class="la-meter"><div class="la-meter__t"><span>Debería <b>${M(after, 0)}</b> · gana <b>≈${M(salary, 0)}</b></span><b class="${pct > 60 ? 'la-t-bad' : pct > 35 ? 'la-t-int' : 'la-t-pay'}">${pct} %</b></div>
            <div class="la-meter__sc"><span style="left:min(calc(${Math.min(pct, 100)}% - 1px), calc(100% - 3px))"></span></div>
            ${pct > 60 ? '<span class="la-t-bad">Pasa del 60 % de lo que gana: solo es un aviso.</span>' : ''}</div>` : ''}
        ${textInput('concept', m.concept, 'Concepto', 'Préstamo')}
    </div>
    ${footer(m.plan === 'lump' ? `Se cobra <b>${M(total)}</b>${m.period ? ` el ${dm(m.period)}` : ''}` : `${count} cuotas de <b>${M(total / count)}</b>`, `Crear préstamo #${nextNumber}`, 'new', amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(m.date || '')))}`;
}

function EditModal(emp, m, { periods, today }) {
    const loan = (emp.loans || []).find(l => String(l.id) === String(m.loanId));
    if (!loan) return head('cap', 'Préstamo no encontrado', '') + footer('', 'Guardar', 'cap', false);
    const n = getLoanNumbers(emp.loans || []).get(loan.id);
    const lock = getLoanLock(loan);
    const changes = [];
    if (Number(m.amount) !== Number(loan.principal)) changes.push(['Monto entregado', M(loan.principal), M(Number(m.amount) || 0)]);
    if (Number(m.rate) !== Number(loan.interestRate)) changes.push(['Interés', loan.interestRate + ' %', (Number(m.rate) || 0) + ' %']);
    if (m.date !== loan.startDate) changes.push(['Entrega', dmy(loan.startDate), dmy(m.date)]);
    if ((m.dueDate || null) !== (loan.dueDate || null)) changes.push(['Nómina de cobro', loan.dueDate ? dmy(loan.dueDate) : '—', m.dueDate ? dmy(m.dueDate) : '—']);
    if (String(m.concept || '').trim() !== String(loan.concept || '')) changes.push(['Concepto', loan.concept || '—', m.concept || '—']);
    const balance = getBalance(loan);
    const oldTotal = round2(loan.principal * (1 + loan.interestRate / 100));
    const newTotal = round2((Number(m.amount) || 0) * (1 + (Number(m.rate) || 0) / 100));
    const newBalance = round2(balance + newTotal - oldTotal);
    const ok = changes.length > 0 && (!lock || String(m.reason || '').trim().length >= 3);
    const dues = periods.filter(p => p.payDate >= (loan.startDate || today)).slice(0, 6);
    return `${head('cap', `Editar préstamo #${n}`, `saldo ${M(balance)}`)}
    <div class="la-md__b">
        <div class="la-row3">${numInput('amount', m.amount, { big: true, label: 'Monto entregado' })}${dateInput('date', m.date, 'Entrega')}${numInput('rate', m.rate, { label: 'Interés %' })}</div>
        <div class="la-row2b">${dues.length ? select('dueDate', m.dueDate || '', 'Se cobra en la nómina', [{ value: '', label: '— sin definir —' }, ...periodOptions(dues)]) : dateInput('dueDate', m.dueDate, 'Se cobra el')}${textInput('concept', m.concept, 'Concepto', 'Préstamo')}</div>
        <div class="la-tbl"><table><thead><tr><th>Cambios</th><th>Antes</th><th>Después</th></tr></thead><tbody>
            ${changes.length ? changes.map(([k, a, b]) => `<tr><td>${escapeHTML(k)}</td><td class="la-strike">${escapeHTML(a)}</td><td><b>${escapeHTML(b)}</b></td></tr>`).join('') : '<tr><td colspan="3" class="la-t-faint">Todavía no cambiaste nada.</td></tr>'}
            ${newTotal !== oldTotal ? `<tr class="la-tot"><td>Saldo del préstamo</td><td>${M(balance)}</td><td>${M(Math.max(0, newBalance))}</td></tr>` : ''}
        </tbody></table></div>
        ${lock ? '<div class="la-warnbox la-warnbox--lock">🔒 Este préstamo tiene movimientos en un cierre de nómina. Corregirlo edita ese cierre: el motivo es obligatorio y queda marcado «cierre editado» con el antes y el resultado.</div>' : ''}
        <label class="la-fl" for="la-reason">${lock ? 'Por qué se corrige (obligatorio)' : 'Por qué se corrige'}<input id="la-reason" class="la-input" type="text" value="${escapeAttr(m.reason || '')}" placeholder="Ej.: se anotó $3,000 y fueron $2,000" oninput="laField('reason', this.value)"></label>
    </div>
    ${footer(changes.length ? `${changes.length} cambio${changes.length === 1 ? '' : 's'}${newTotal !== oldTotal ? ` · saldo <b>${M(Math.max(0, newBalance))}</b>` : ''}` : 'Sin cambios', 'Guardar cambios', 'cap', ok)}`;
}

function CloseModal(emp, m) {
    const loan = (emp.loans || []).find(l => String(l.id) === String(m.loanId));
    if (!loan) return head('bad', 'Préstamo no encontrado', '') + footer('', 'Cerrar', 'danger', false);
    const n = getLoanNumbers(emp.loans || []).get(loan.id);
    const pending = getLoanPending(loan);
    const touched = (loan.payments || []).some(p => !p.voided) || (loan.refinancings || []).some(r => !r.voided);
    const opt = (value, title, text, disabled) => `<label class="la-opt${m.reason === value ? ' is-on' : ''}${disabled ? ' is-dis' : ''}"><input type="radio" name="la-close" ${m.reason === value ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="laField('reason', '${value}')"><span>${escapeHTML(title)}</span><small>${escapeHTML(text)}</small></label>`;
    const ok = m.reason && !(m.reason === CLOSE_REASON.ERROR && touched) && (m.reason !== CLOSE_REASON.OTHER || String(m.note || '').trim().length >= 3);
    return `${head('bad', `Anular préstamo #${n}`, `${dmy(loan.startDate)} · ${M(loan.principal, 0)} al ${loan.interestRate} %`)}
    <div class="la-md__b">
        <div class="la-kv la-kv--4"><div><span>Saldo</span><b>${M(pending.balance)}</b></div><div><span>Capital pend.</span><b class="la-t-cap">${M(pending.capital)}</b></div><div><span>Interés pend.</span><b class="la-t-int">${M(pending.interest)}</b></div><div><span>Pagado</span><b class="la-t-pay">${M(loanPaidSplit(loan).interest + loanPaidSplit(loan).capital)}</b></div></div>
        <span class="la-lbl">¿Por qué se cierra? (obligatorio)</span>
        ${opt(CLOSE_REASON.ERROR, 'Error de registro', touched ? 'No disponible: tiene abonos o refinanciamientos. Anúlalos primero o usa otro motivo.' : 'El préstamo no debió existir. Sale de todas las cifras; queda en «Anulados».', touched)}
        ${opt(CLOSE_REASON.FORGIVEN, 'Perdonado', `Se le regala lo que falta: ${M(pending.capital)} de capital y ${M(pending.interest)} de interés. Sigue contando como prestado.`)}
        ${opt(CLOSE_REASON.OTHER, 'Otro motivo', 'El saldo se da por cerrado con la nota que escribas.')}
        ${textInput('note', m.note, m.reason === CLOSE_REASON.OTHER ? 'Nota (obligatoria)' : 'Nota (opcional)', 'Ej.: se fue de la obra y acordó pagar aparte')}
        <p class="la-hint">Se puede deshacer desde los movimientos con la ✕.</p>
    </div>
    ${footer(m.reason === CLOSE_REASON.ERROR ? `Sale de la cuenta: <b>${M(pending.balance)}</b>` : m.reason ? `La cuenta baja <b>${M(pending.balance)}</b>` : 'Saldo ' + M(pending.balance), m.reason === CLOSE_REASON.ERROR ? 'Anular préstamo' : m.reason === CLOSE_REASON.FORGIVEN ? `Perdonar ${M(pending.balance)}` : m.reason ? 'Cerrar préstamo' : 'Elige un motivo', 'danger', ok)}`;
}

function UnconsolidateModal(emp, m) {
    let pv;
    try { pv = previewUndoConsolidation(emp, m.loanId); } catch (error) { return head('refi', 'Deshacer consolidación', '') + `<div class="la-md__b"><div class="la-warnbox">${escapeHTML(error.message)}</div></div>` + footer('', 'Deshacer', 'refi', false); }
    return `${head('refi', `Deshacer la consolidación #${pv.consolidatedNumber}`, 'los préstamos vuelven a ser separados')}
    <div class="la-md__b">
        <p class="la-line">El préstamo #${pv.consolidatedNumber} juntó ${pv.sources.length} préstamos como si fueran uno nuevo: su interés pasó a ser capital y los de origen quedaron «saldados» aunque debían. Al deshacerlo:</p>
        <div class="la-tbl"><table><thead><tr><th>Préstamo</th><th>Capital</th><th>Interés pend.</th><th>Capital pend.</th><th>Queda</th></tr></thead><tbody>
            ${pv.sources.map(s => `<tr><td><b>#${s.number}</b> ${dmy(s.startDate)}</td><td>${M(s.principal, 0)}</td><td class="la-t-int">${M(s.interest, 0)}</td><td class="la-t-cap">${M(s.capital, 0)}</td><td>${s.balance <= 0.004 ? '<span class="la-pill la-pill--pay">Saldado</span>' : `<b>${M(s.balance)}</b>`}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="la-line">· Abonos del #${pv.consolidatedNumber} que se reparten (interés de todos, luego capital del más viejo): <b>${M(pv.movedPayments)}</b></div>
        <div class="la-line">· Interés de la consolidación y sus refinanciamientos, repartido según lo que debía cada uno: <b class="la-t-refi">${M(pv.movedInterest)}</b></div>
        <div class="la-line">· Lo que debe en total no cambia: <b>${M(pv.before)}</b> → <b>${M(pv.after)}</b></div>
        <p class="la-hint">Si algún abono se cobró en una nómina con cierre, el total de esa nómina no cambia: solo a qué préstamo se aplicó. Queda como «conversión» y se puede revertir con «Volver a consolidar».</p>
    </div>
    ${footer(`El #${pv.consolidatedNumber} queda anulado como «consolidación deshecha»`, 'Deshacer consolidación', 'refi', true)}`;
}

function AgreeModal(emp, m, { periods, today, summary, salary, agreement }) {
    const amount = Number(m.amount) || 0;
    const future = periods.filter(p => p.payDate >= today);
    const dates = future.filter(p => p.payDate >= (m.startPayDate || today)).slice(0, 12).map(p => p.payDate);
    const plan = projectLoanAgreement(summary.balance, { amount, interestMode: m.interestMode, rate: Number(m.rate) || 0 }, dates);
    const minimum = suggestedAgreementMinimum(emp);
    const pct = salary > 0 ? Math.round(amount / salary * 100) : null;
    const text = `${emp.name || 'Empleado'}: debes ${M(summary.balance)} en ${summary.count} préstamos (${M(summary.capital)} de capital y ${M(summary.interest)} de interés).\nAcordamos descontarte ${M(amount, 0)} en cada nómina desde la del ${dm(m.startPayDate)}.\n${plan.done ? `Con ese monto terminas en ${plan.rows.length} nóminas` : 'Con ese monto la deuda no termina en 12 nóminas'}${m.interestMode === AGREEMENT_INTEREST.RATE ? `, con ${Number(m.rate) || 0} % de interés sobre lo que quede pendiente en cada nómina` : ', sin interés extra mientras cumplas'}.`;
    return `${head('int', agreement ? 'Cambiar acuerdo de pago' : 'Acuerdo de pago', `debe ${M(summary.balance)}${salary > 0 ? ` · gana ≈${M(salary, 0)}` : ''}`)}
    <div class="la-md__b">
        <div class="la-row3">${numInput('amount', m.amount, { big: true, label: 'Monto por nómina' })}
            ${future.length ? select('startPayDate', m.startPayDate, 'Desde la nómina', periodOptions(future.slice(0, 4))) : dateInput('startPayDate', m.startPayDate, 'Desde (día de pago)')}
            <div class="la-fl"><span>Del sueldo</span><span class="la-line">${pct !== null ? `<b class="${pct > 60 ? 'la-t-bad' : pct > 35 ? 'la-t-int' : 'la-t-pay'}">${pct} %</b> de su pago` : '—'}</span></div></div>
        <div class="la-chips"><button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${minimum}" title="Cubre todo el interés pendiente">Mínimo sugerido ${M(minimum, 0)}</button>${salary > 0 ? `<button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${Math.round(salary * 0.3 / 100) * 100}">30 % sueldo ${M(Math.round(salary * 0.3 / 100) * 100, 0)}</button>` : ''}<button type="button" data-app-fn="laField" data-arg="amount" data-arg2="${Math.ceil(summary.balance / 4 / 100) * 100}">En 4 nóminas ${M(Math.ceil(summary.balance / 4 / 100) * 100, 0)}</button></div>
        ${amount > 0 && amount < summary.interest ? `<div class="la-warnbox">Sugerencia: el monto no cubre el interés pendiente (${M(summary.interest)}). Se puede guardar igual.</div>` : ''}
        <div class="la-row2b">
            <div class="la-fl"><span>Interés sobre lo que quede pendiente</span>${seg('interestMode', m.interestMode, [{ value: AGREEMENT_INTEREST.NONE, label: 'Sin interés mientras cumpla' }, { value: AGREEMENT_INTEREST.RATE, label: 'Cobrar %' }])}
                ${m.interestMode === AGREEMENT_INTEREST.RATE ? numInput('rate', m.rate, { label: '% por nómina' }) : ''}</div>
            <div class="la-fl"><span>Si pide otro préstamo</span>${seg('onNewLoan', m.onNewLoan, [{ value: AGREEMENT_NEW_LOANS.INCLUDE, label: 'Se suma: misma cuota' }, { value: AGREEMENT_NEW_LOANS.REVIEW, label: 'Avisar para revisar' }])}</div>
        </div>
        <div class="la-tbl"><table><thead><tr><th>Nómina</th><th>Se cobra</th>${m.interestMode === AGREEMENT_INTEREST.RATE ? '<th>Interés</th>' : ''}<th>Queda</th></tr></thead><tbody>
            ${plan.rows.map(r => `<tr><td>${escapeHTML(periods.find(p => p.payDate === r.payDate)?.label || dmy(r.payDate))}</td><td class="la-t-pay">${M(r.charge, 0)}</td>${m.interestMode === AGREEMENT_INTEREST.RATE ? `<td class="la-t-refi">${r.extra ? '+' + M(r.extra, 0) : '—'}</td>` : ''}<td>${r.left <= 0.004 ? '<span class="la-pill la-pill--pay">Saldado</span>' : M(r.left, 0)}</td></tr>`).join('')}
        </tbody></table></div>
        ${plan.grows ? '<div class="la-warnbox">Con este interés la deuda no baja: sube el monto o quita el interés.</div>' : !plan.done && amount > 0 ? '<div class="la-warnbox">Con este monto no termina en 12 nóminas.</div>' : ''}
        <div class="la-fl"><span>Resumen para el trabajador</span><div class="la-wsum" id="la-wsum">${escapeHTML(text).replace(/\n/g, '<br>')}</div></div>
        ${textInput('note', m.note, 'Nota (opcional)', 'Ej.: acordado con el empleado en la obra')}
    </div>
    <div class="la-md__f"><span class="la-md__tot">${plan.done ? `Termina en <b>${plan.rows.length} nóminas</b>` : 'No termina en 12 nóminas'}${plan.extraTotal ? ` · interés extra <b class="la-t-refi">${M(plan.extraTotal, 0)}</b>` : ''}</span>
        <div class="la-md__acts">${agreement ? `<button type="button" class="la-btn la-btn--danger" data-app-fn="laCancelAgreement" data-arg="${escapeAttr(agreement.id)}">Cancelar acuerdo</button>` : ''}<button type="button" class="la-btn la-btn--ghost" data-app-fn="laCopySummary">Copiar resumen</button><button type="button" class="la-btn la-btn--new" data-app-fn="laSave" ${amount > 0 && m.startPayDate ? '' : 'disabled'}>${agreement ? 'Guardar cambios' : 'Guardar acuerdo'}</button></div></div>`;
}

export { getMovementLock };
