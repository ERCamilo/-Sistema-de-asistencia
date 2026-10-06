/**
 * 🧾 LoanAccountController — acciones de la ficha «cuenta de préstamos».
 *
 * Estado de la vista en state.loansLedger.account:
 *   { tab, open: {loanId: bool}, showVoid, ask, fixWhy, modal }
 * modal = { type: 'pay'|'refi'|'loan'|'edit'|'close'|'agree', ...borrador }
 *
 * Cada acción llama a LoanAccount.js, guarda con saveApplicationData() y
 * vuelve a dibujar. Los botones usan data-app-fn="la*" (window.la*).
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { captureEntityProjectScope } from '../projects/EntityProjectScope.js';
import { createLoan, LOAN_STATUS, INSTALLMENT_MODE, round2 } from './LoansService.js';
import { findSimilarExistingLoan } from './LoanDuplicateDetector.js';
import {
    VOID_MODE, REFINANCE_REASON, AGREEMENT_INTEREST, AGREEMENT_NEW_LOANS,
    getAccountSummary, getLoanDueDate, recordAccountPayment, recordDirectPayment, refinanceAccount,
    voidAccountMovement, editLoan, undoLoanEdit, closeLoanWithReason, undoLoanClosure,
    saveLoanAgreement, cancelLoanAgreement, getActiveLoanAgreement, suggestedAgreementMinimum
} from './LoanAccount.js';
import { getAccountPayPeriods, closedPeriodEnds } from './LoanAccountView.js';
import { undoConsolidation, restoreConsolidation, findConsolidations, consolidationUndoOrder } from './LoanConsolidationUndo.js';
import { nextLoanNumber, planLoanBackfill, applyLoanBackfill, resolvePaymentReview } from './LoanDataBackfill.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { nextPayPeriod, followingPayPeriod } from './LoanPayPeriods.js';
import { registerLoanExportGlobals } from './LoanExportPanel.js';
import { registerConsolidationReviewGlobals } from './LoanConsolidationReviewPanel.js';
import { readLoanUiMemory, saveLoanUiMemory } from './LoanUiMemory.js';

const CLASSIC_KEY = 'loans-account-view';

/** ¿Usar la ficha nueva? Se puede volver a la anterior por dispositivo. */
export function useAccountView() {
    try { return globalThis.localStorage?.getItem(CLASSIC_KEY) !== 'classic'; } catch (_) { return true; }
}

export function laUseClassicView(flag) {
    try {
        if (Number(flag) === 1 || flag === true) globalThis.localStorage?.setItem(CLASSIC_KEY, 'classic');
        else globalThis.localStorage?.removeItem(CLASSIC_KEY);
    } catch (_) { /* sin almacenamiento: queda la vista por defecto */ }
    render();
}

function ui() {
    if (!state.loansLedger) return {};
    if (!state.loansLedger.account) {
        stateManager.batchSetState(() => {
            state.loansLedger.account = { tab: 'loans', open: {}, showVoid: false, ask: null, fixWhy: '', modal: null };
        });
    }
    return state.loansLedger.account;
}

function update(fn, { redraw = true } = {}) {
    const view = ui();
    stateManager.batchSetState(() => fn(view));
    if (redraw) render();
}

function selectedEmployee() {
    const id = state.loansLedger?.selectedEmployeeId;
    if (!id) return null;
    const emp = (state.employees || []).find(e => String(e.id) === String(id));
    return emp && entityInScope(emp, peekEntityScope()) ? emp : null;
}

function alertMsg(msg) {
    if (typeof window !== 'undefined' && window.showAlert) window.showAlert(msg, 'error');
    else if (typeof window !== 'undefined' && window.showNotification) window.showNotification(msg, 'error');
}

function options(extra = {}) {
    return { projectScope: captureEntityProjectScope(), by: (typeof window !== 'undefined' && window.currentUser?.email) || null, ...extra };
}

function commit(announce) {
    saveApplicationData({ immediate: true, announce });
}

/** Ejecuta una acción sobre el empleado elegido; si falla, muestra el error. */
function act(fn, announce, after = view => { view.modal = null; view.ask = null; view.fixWhy = ''; }) {
    const emp = selectedEmployee();
    if (!emp) { alertMsg('Empleado no disponible en el proyecto activo'); return null; }
    try {
        const result = fn(emp);
        commit(typeof announce === 'function' ? announce(result) : announce);
        update(after);
        return result;
    } catch (error) {
        alertMsg(`❌ ${error.message}`);
        return null;
    }
}

// ─── Navegación ──────────────────────────────────────────────────────────────

export function laSetTab(tab) { update(view => { view.tab = tab === 'mov' ? 'mov' : 'loans'; view.ask = null; }); }
export function laToggleLoan(loanId) { update(view => { view.open = { ...(view.open || {}), [loanId]: !view.open?.[loanId] }; }); }
export function laToggleShowVoid() { update(view => { view.showVoid = !view.showVoid; }); }
export function laAsk(key, where) { update(view => { const id = `${key}#${where}`; view.ask = view.ask === id ? null : id; view.fixWhy = ''; }); }
export function laCancelAsk() { update(view => { view.ask = null; view.fixWhy = ''; }); }
export function laFixWhy(value) { update(view => { view.fixWhy = String(value || ''); }, { redraw: false }); }
export function laClose() { update(view => { view.modal = null; }); }

// ─── Ventanas ────────────────────────────────────────────────────────────────

export function laOpen(type, loanId = null) {
    const emp = selectedEmployee();
    if (!emp) return;
    const today = getDateKey(new Date());
    const periods = getAccountPayPeriods(today);
    const next = nextPayPeriod(periods, today);
    const summary = getAccountSummary(emp);
    const agreement = getActiveLoanAgreement(emp);
    const loan = loanId ? (emp.loans || []).find(l => String(l.id) === String(loanId)) : null;
    let modal = null;
    if (type === 'pay') {
        const owed = loan ? (summary.loans.find(x => x.loan.id === loan.id)?.balance || 0) : summary.balance;
        const closed = closedPeriodEnds();
        // Por defecto, la última nómina ya pagada (los abonos se anotan 1–3 días después del cierre del periodo).
        const lastOpen = [...periods].reverse().find(p => p.payDate <= today && !closed.has(p.end))
            || periods.find(p => p.payDate >= today && !closed.has(p.end));
        modal = { type, target: loan ? loan.id : 'account', amount: loan ? owed : Math.min(agreement?.amount || owed, owed), date: today, channel: 'payroll', period: lastOpen?.payDate || '', note: '' };
    } else if (type === 'refi') {
        // La nómina que no alcanzó ya se pagó: la última con día de pago hasta hoy.
        const recent = periods.filter(p => p.payDate <= today);
        const period = recent.at(-1)?.payDate || today;
        const sel = {};
        for (const item of summary.loans) sel[item.loan.id] = loan ? item.loan.id === loan.id : (!item.dueDate || item.dueDate <= period);
        const rate = Number((loan || summary.loans[0]?.loan)?.interestRate) || 20;
        modal = { type, only: loan ? loan.id : null, period, sel, rate, basis: 'balance', reason: '', note: '' };
    } else if (type === 'loan') {
        const lastRate = Number([...(emp.loans || [])].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0]?.interestRate);
        modal = { type, amount: '', date: today, rate: Number.isFinite(lastRate) ? lastRate : 20, plan: 'lump', period: next?.payDate || '', count: 4, freq: 2, concept: '' };
    } else if (type === 'edit' && loan) {
        modal = { type, loanId: loan.id, amount: loan.principal, rate: loan.interestRate, date: loan.startDate, dueDate: loan.dueDate || getLoanDueDate(loan) || '', concept: loan.concept || '', reason: '' };
    } else if (type === 'close' && loan) {
        modal = { type, loanId: loan.id, reason: '', note: '' };
    } else if (type === 'unconsolidate' && loan) {
        modal = { type, loanId: loan.id };
    } else if (type === 'agree') {
        const future = periods.filter(p => p.payDate >= today);
        modal = agreement
            ? { type, amount: agreement.amount, startPayDate: agreement.startPayDate, interestMode: agreement.interestMode, rate: agreement.rate || 5, onNewLoan: agreement.onNewLoan, note: agreement.note || '' }
            : { type, amount: Math.max(suggestedAgreementMinimum(emp), 100), startPayDate: future[1]?.payDate || future[0]?.payDate || '', interestMode: AGREEMENT_INTEREST.NONE, rate: 5, onNewLoan: AGREEMENT_NEW_LOANS.INCLUDE, note: '' };
    }
    if (modal) update(view => { view.modal = modal; view.ask = null; });
}

const NUMERIC = new Set(['amount', 'rate', 'count', 'freq']);

/** Cambia un campo de la ventana y vuelve a calcular. */
export function laField(field, value) {
    update(view => {
        if (!view.modal) return;
        let next = value;
        if (NUMERIC.has(field)) next = String(value ?? '').replace(/[^0-9.]/g, '');
        view.modal = { ...view.modal, [field]: next };
        if (view.modal.type === 'refi' && field === 'period' && !view.modal.only) {
            const emp = selectedEmployee();
            const sel = {};
            for (const item of getAccountSummary(emp).loans) sel[item.loan.id] = !item.dueDate || item.dueDate <= next;
            view.modal.sel = sel;
        }
    });
}

/** Campos de texto libre: se guardan sin redibujar para no mover el cursor. */
export function laFieldQuiet(field, value) {
    update(view => { if (view.modal) view.modal[field] = String(value ?? ''); }, { redraw: false });
}

export function laToggleSel(loanId) {
    update(view => { if (view.modal?.sel) view.modal = { ...view.modal, sel: { ...view.modal.sel, [loanId]: !view.modal.sel[loanId] } }; });
}

export function laCopySummary() {
    const text = typeof document !== 'undefined' ? document.getElementById('la-wsum')?.innerText : '';
    if (!text) return;
    const done = () => window.showNotification?.('Resumen copiado', 'success');
    try { navigator.clipboard.writeText(text).then(done, () => alertMsg('Selecciona y copia el texto del resumen')); } catch (_) { alertMsg('Selecciona y copia el texto del resumen'); }
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

export function laSave() {
    const m = ui().modal;
    if (!m) return;
    const today = getDateKey(new Date());
    const periods = getAccountPayPeriods(today);
    const money = v => round2(Number(v) || 0);
    if (m.type === 'pay') {
        const period = m.channel === 'payroll' ? periods.find(p => p.payDate === m.period) : null;
        const params = {
            amount: money(m.amount), date: m.date, note: m.note, recordedBy: options().by, channel: m.channel,
            payrollPeriodStart: period?.start, payrollPeriodEnd: period?.end
        };
        act(emp => m.target === 'account' ? recordAccountPayment(emp, params, options()) : recordDirectPayment(emp, m.target, params, options()),
            r => `Abono registrado: ${money(m.amount).toFixed(2)}${r?.payments ? ` en ${r.payments.length} préstamo(s)` : ''}`);
    } else if (m.type === 'refi') {
        const failed = periods.find(p => p.payDate === m.period);
        const next = followingPayPeriod(periods, m.period);
        const loanIds = Object.entries(m.sel || {}).filter(([, on]) => on).map(([id]) => id);
        act(emp => refinanceAccount(emp, {
            loanIds, interestRate: m.charge === 'no' ? 0 : money(m.rate), noInterest: m.charge === 'no', basis: m.basis, reason: m.reason, note: m.note, date: m.period,
            payrollPeriodStart: failed?.start, payrollPeriodEnd: failed?.end, nextDueDate: next?.payDate,
            origin: m.only ? 'direct' : 'account', createdBy: options().by
        }, options()), r => (m.charge === 'no' ? `${r.events.length} préstamo(s) pasan a la nómina siguiente sin interés` : `Cargo de ${r.total.toFixed(2)} en ${r.events.length} préstamo(s)`));
    } else if (m.type === 'loan') {
        const emp = selectedEmployee();
        if (!emp) return;
        const draft = {
            principal: money(m.amount), interestRate: money(m.rate), startDate: m.date, concept: m.concept,
            installmentMode: m.plan === 'installments' ? INSTALLMENT_MODE.INSTALLMENTS : INSTALLMENT_MODE.LUMP,
            installmentCount: Math.max(2, Math.round(Number(m.count) || 2)), installmentFrequencyWeeks: Number(m.freq) || 2
        };
        const create = () => act(e => {
            const number = nextLoanNumber(e.loans);
            const created = createLoan(e, draft, { projectScope: captureEntityProjectScope() });
            // El estado guarda su propia copia del préstamo: la nómina de cobro se pone en esa.
            const loan = (e.loans || []).find(l => l.id === created.id) || created;
            if (number) loan.number = number;
            if (m.plan === 'lump' && /^\d{4}-\d{2}-\d{2}$/.test(String(m.period || ''))) { loan.dueDate = m.period; loan.dueDateSetAt = Date.now(); }
            return loan;
        }, loan => `Préstamo registrado: ${escapeHTML(loan.concept)}`, view => { view.modal = null; view.tab = 'loans'; });
        const similar = findSimilarExistingLoan(emp, draft);
        if (similar && typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
            window.showConfirm({
                title: 'Préstamo parecido ya registrado',
                message: `Este empleado ya tiene un préstamo por el MISMO monto con fecha cercana ("${escapeHTML(similar.concept || 'Préstamo')}", ${escapeHTML(similar.startDate)}). Puede que ya esté anotado, quizá desde otro dispositivo.<br><br>¿Registrar este préstamo de todas formas?`,
                confirmText: 'Sí, registrar igual', cancelText: 'Cancelar', type: 'warning', onConfirm: create
            });
            return;
        }
        create();
    } else if (m.type === 'edit') {
        const changes = { principal: money(m.amount), interestRate: money(m.rate), startDate: m.date, concept: m.concept };
        if (m.dueDate) changes.dueDate = m.dueDate;
        act(emp => editLoan(emp, m.loanId, changes, options({ reason: m.reason })), r => `Préstamo corregido: saldo ${r.balanceBefore.toFixed(2)} → ${r.balanceAfter.toFixed(2)}`);
    } else if (m.type === 'close') {
        act(emp => closeLoanWithReason(emp, m.loanId, { reason: m.reason, note: m.note, by: options().by }, options()), 'Préstamo cerrado');
    } else if (m.type === 'unconsolidate') {
        act(emp => undoConsolidation(emp, m.loanId, { by: options().by }),
            r => `Consolidación deshecha: ${r.sources.length} préstamos separados; se repartieron ${r.movedPayments.toFixed(2)} en abonos`, view => { view.modal = null; view.tab = 'loans'; });
    } else if (m.type === 'agree') {
        act(emp => saveLoanAgreement(emp, {
            amount: money(m.amount), startPayDate: m.startPayDate, interestMode: m.interestMode, rate: money(m.rate),
            onNewLoan: m.onNewLoan, note: m.note, by: options().by
        }, options()), a => `Acuerdo guardado: ${a.amount.toFixed(2)} por nómina`);
    }
}

// ─── Anular, ajustar, corregir cierre ────────────────────────────────────────

function refFromKey(key) {
    const [kind, a, b] = String(key).split('|');
    if (kind === 'tx') return { accountTxId: a };
    if (kind === 'pay') return { loanId: a, paymentId: b };
    if (kind === 'refi') return { loanId: a, refinancingId: b };
    return null;
}

export function laVoid(key) {
    const [kind, a, b] = String(key).split('|');
    if (kind === 'edit') return act(emp => undoLoanEdit(emp, a, b, options()), 'Corrección deshecha');
    if (kind === 'close') return act(emp => undoLoanClosure(emp, a, options()), 'Cierre deshecho: el préstamo volvió a abrirse');
    if (kind === 'agr') return act(emp => cancelLoanAgreement(emp, a, options()), 'Acuerdo cancelado');
    const ref = refFromKey(key);
    if (!ref) return null;
    return act(emp => voidAccountMovement(emp, ref, options()),
        r => `Movimiento anulado${r.reallocated?.length ? `; se volvieron a repartir ${r.reallocated.length} abono(s) posteriores` : ''}`);
}

export function laAdjust(key, date) {
    const ref = refFromKey(key);
    if (!ref) return null;
    const today = getDateKey(new Date());
    const period = getAccountPayPeriods(today).find(p => p.payDate === date);
    return act(emp => voidAccountMovement(emp, ref, options({
        mode: VOID_MODE.ADJUST, date: date || today, reason: ui().fixWhy || '',
        payrollPeriodStart: period?.start, payrollPeriodEnd: period?.end
    })), 'Ajuste creado; el cierre no cambió');
}

export function laFix(key) {
    const ref = refFromKey(key);
    if (!ref) return null;
    const reason = String(ui().fixWhy || '').trim();
    if (reason.length < 3) { alertMsg('Escribe el motivo para corregir el cierre'); return null; }
    return act(emp => voidAccountMovement(emp, ref, options({ mode: VOID_MODE.FIX_CLOSURE, reason })),
        r => `Cierre corregido: saldo ${Number(r.before).toFixed(2)} → ${Number(r.after).toFixed(2)}`);
}

export function laRestoreConsolidation(loanId) {
    return act(emp => restoreConsolidation(emp, loanId, { by: options().by }), 'La consolidación volvió a quedar como antes');
}

/** Deshace todas las consolidaciones de la obra activa, después de confirmar con el total antes/después. */
export function laUndoAllConsolidations() {
    const employees = (state.employees || []).filter(emp => entityInScope(emp, peekEntityScope()));
    // De afuera hacia adentro: una consolidación de una consolidación se deshace en orden.
    const work = employees.flatMap(emp => consolidationUndoOrder(emp).map(c => ({ emp, id: c.loan.id })));
    if (!work.length) return;
    const total = list => round2(list.reduce((t, emp) => t + getAccountSummary(emp).balance, 0));
    const run = () => {
        const before = total(employees);
        const errors = [];
        let done = 0;
        for (const { emp, id } of work) {
            try { undoConsolidation(emp, id, { by: options().by, projectScope: captureEntityProjectScope() }); done++; } catch (error) { errors.push(error.message); }
        }
        const after = total(employees);
        commit(`Consolidaciones deshechas: ${done} de ${work.length}. Por cobrar ${before.toFixed(2)} → ${after.toFixed(2)}`);
        if (errors.length) alertMsg(`No se pudieron deshacer ${errors.length}: ${errors.join(' · ')}`);
        render();
    };
    if (typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
        window.showConfirm({
            title: 'Deshacer consolidaciones',
            message: `Se deshacen ${work.length} consolidación(es): los préstamos de origen se reabren con su capital e interés reales y los abonos del consolidado se reparten entre ellos. Lo que deben en total no cambia (${total(employees).toFixed(2)}). Cada una se puede revertir desde la ficha con «Volver a consolidar».`,
            confirmText: 'Sí, deshacer todas', cancelText: 'Cancelar', type: 'warning', onConfirm: run
        });
        return;
    }
    run();
}

function scopedEmployees() {
    return (state.employees || []).filter(emp => entityInScope(emp, peekEntityScope()));
}

/** Completa los datos viejos (número fijo, nómina de cobro, origen de abonos) de la obra activa. */
export function laApplyBackfill() {
    const employees = scopedEmployees();
    const payPeriod = getActivePayrollSettings(state).payPeriod;
    const plan = planLoanBackfill(employees, payPeriod);
    if (!plan.total) return;
    const run = () => {
        const counts = applyLoanBackfill(employees, payPeriod);
        commit(`Datos completados: ${counts.numbers} números, ${counts.dueDates} nóminas de cobro, ${counts.payrollPayments + counts.directPayments + counts.reviewPayments} orígenes (${counts.reviewPayments} por revisar)`);
        render();
    };
    if (typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
        window.showConfirm({
            title: 'Completar datos de préstamos',
            message: `Solo se rellenan datos que faltan; no cambian montos ni saldos.<br>· ${plan.numbers} préstamos reciben su número fijo<br>· ${plan.dueDates} préstamos reciben su nómina de cobro (la del periodo en que se entregaron) y ${plan.refinancings} refinanciamientos la nómina siguiente<br>· ${plan.payrollPayments} abonos quedan como descuento de nómina (caen junto al día de pago)${plan.directPayments ? `<br>· ${plan.directPayments} abonos anulados quedan como directos` : ''}<br>· ${plan.reviewPayments} abonos fuera de los días de pago quedan para revisar uno por uno`,
            confirmText: 'Completar', cancelText: 'Cancelar', type: 'info', onConfirm: run
        });
        return;
    }
    run();
}

/** Abono revisado: arg = "empId|loanId|paymentId", kind = 'payroll' | 'direct'. */
export function laReviewPayment(ref, kind) {
    const [empId, loanId, paymentId] = String(ref).split('|');
    const emp = scopedEmployees().find(e => String(e.id) === empId);
    if (!emp) return;
    try {
        resolvePaymentReview(emp, loanId, paymentId, kind === 'payroll' ? 'payroll' : 'direct', getActivePayrollSettings(state).payPeriod);
        commit(kind === 'payroll' ? 'Abono marcado como descuento de nómina' : 'Abono marcado como directo');
        render();
    } catch (error) { alertMsg(`❌ ${error.message}`); }
}

// ─── Pantalla principal: avisos y riesgo ──────────────────────────────────────

function portfolioState(fn) {
    stateManager.batchSetState(() => {
        // Al abrir la pantalla sin haber tocado nada todavía no existe loansLedger.
        if (!state.loansLedger) state.loansLedger = {};
        if (!state.loansLedger.portfolio) state.loansLedger.portfolio = { alertPanel: null, riskLevel: 0 };
        fn(state.loansLedger.portfolio);
    });
    render();
}
export function lpToggleAlerts() {
    portfolioState(p => {
        const open = !(p.alertsOpen ?? readLoanUiMemory().alertsOpen ?? false);
        p.alertsOpen = open;
        saveLoanUiMemory({ alertsOpen: open });
    });
}
export function lpAlertPanel(key) {
    if (key === 'inactive-filter') return;
    portfolioState(p => { p.alertPanel = p.alertPanel === key ? null : String(key); p.alertsOpen = true; });
}
export function lpRiskLevel(level) { portfolioState(p => { p.riskLevel = Number(level) || 0; }); }
export function lpTip(key) { portfolioState(p => { p.tip = p.tip === key ? null : String(key); }); }
export function lpCard(key, where) {
    portfolioState(p => {
        if (where === 'aside') {
            const current = p.asideCard === undefined ? (readLoanUiMemory().asideCard ?? null) : p.asideCard;
            p.asideCard = current === key ? null : String(key);
            saveLoanUiMemory({ asideCard: p.asideCard });
        } else {
            p.card = p.card === key ? null : String(key);
        }
    });
}

export function laUndoClosure(loanId) { return act(emp => undoLoanClosure(emp, loanId, options()), 'Cierre deshecho'); }
export function laCancelAgreement(id) { return act(emp => cancelLoanAgreement(emp, id, options()), 'Acuerdo cancelado'); }

export function registerLoanAccountGlobals() {
    if (typeof window === 'undefined') return;
    registerLoanExportGlobals();
    registerConsolidationReviewGlobals();
    Object.assign(window, {
        laUseClassicView, laSetTab, laToggleLoan, laToggleShowVoid, laAsk, laCancelAsk, laFixWhy, laClose,
        laOpen, laField, laFieldQuiet, laToggleSel, laCopySummary, laSave, laVoid, laAdjust, laFix,
        laUndoClosure, laCancelAgreement, laRestoreConsolidation, laUndoAllConsolidations, laApplyBackfill, laReviewPayment,
        lpToggleAlerts, lpAlertPanel, lpRiskLevel, lpTip, lpCard
    });
}

// LOAN_STATUS y REFINANCE_REASON se reexportan para pruebas de la vista.
export { LOAN_STATUS, REFINANCE_REASON };
