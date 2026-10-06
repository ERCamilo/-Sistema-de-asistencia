/**
 * 📒 LoanPortfolioView — pantalla principal de Préstamos (diseño de la maqueta).
 *
 *   - Línea del mes: cuánto cambió lo que deben en el mes.
 *   - «Avisos que necesitan una decisión»: repetidos, empleados en riesgo,
 *     inactivos con deuda, consolidaciones por deshacer, datos por completar
 *     y abonos por revisar; cada uno con su acción.
 *   - Resumen de cartera (panel derecho; arriba en teléfono): por cobrar con
 *     su desglose, quién debe más y qué hacer; interés ganado, cobrado y prestado.
 * Solo dibuja; las cifras salen de LoanPortfolio.js y LoanRisk.js.
 */

import { state } from '../../core/AppState.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { round2 } from './LoansService.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { computeAttendanceDetailEarnings } from '../attendance/AttendanceDetailEarnings.js';
import { buildPayPeriods } from './LoanPayPeriods.js';
import { prepareLoanEmployees, computePortfolioSummary, computeMonthChange, loanDataSignature } from './LoanPortfolio.js';
import { computeRiskList, RISK_LEVELS } from './LoanRisk.js';
import { findConsolidations } from './LoanConsolidationUndo.js';
import { planLoanBackfill, listPaymentsToReview } from './LoanDataBackfill.js';
import { findLoanRecordDuplicates } from './LoanRecordDuplicates.js';
import { renderLoanDuplicateReview } from './LoanDuplicateReview.js';
import { getAccountSummary } from './LoanAccount.js';
import { buildFlowBuckets, computeLoanFlows } from './LoanFlowChart.js';
import { ExportButton, ExportPanel } from './LoanExportPanel.js';
import { readLoanUiMemory } from './LoanUiMemory.js';

const M = (value, decimals = 2) => {
    const n = Number(value || 0);
    return decimals === 0 ? '$' + Math.round(n).toLocaleString('en-US') : formatCurrency(n);
};
const dmy = key => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '—');
const RISK_COLOR = { 3: '#ef4444', 2: '#f97316', 1: '#facc15' };

export function portfolioUi() {
    return state.loansLedger?.portfolio || {};
}

// ─── Datos (con caché: el cálculo de sueldos es pesado) ─────────────────────

const grossCache = new Map();
function grossOf(emp, start, end) {
    const key = `${emp.id}|${start}|${end}`;
    if (!grossCache.has(key)) grossCache.set(key, computeAttendanceDetailEarnings(state, emp.id, start, end).gross || 0);
    return grossCache.get(key);
}

let riskCache = { key: null, list: [] };
let lastAttendance = null;
let attendanceVersion = 0;

/** Todo lo que necesita la pantalla, a partir de los empleados de la obra. */
export function buildPortfolioModel(scopedEmployees = []) {
    const today = getDateKey(new Date());
    const payPeriod = getActivePayrollSettings(state).payPeriod;
    const prepared = prepareLoanEmployees(scopedEmployees, payPeriod);
    const employees = prepared.employees;
    // Si cambia la asistencia cambian los sueldos: se rehacen los cálculos.
    if (state.attendance !== lastAttendance) { grossCache.clear(); lastAttendance = state.attendance; attendanceVersion++; }
    const periods = buildPayPeriods(payPeriod, today, { before: 3, after: 1 });
    const riskKey = JSON.stringify([today, payPeriod, attendanceVersion, loanDataSignature(scopedEmployees)]);
    if (riskCache.key !== riskKey) {
        let list = [];
        try { list = computeRiskList(employees, { today, periods, grossOf, state }); } catch (_) { list = []; }
        riskCache = { key: riskKey, list };
    }
    const dup = findLoanRecordDuplicates(scopedEmployees);
    const inactive = employees.filter(emp => emp.active === false)
        .map(emp => ({ emp, balance: getAccountSummary(emp).balance })).filter(x => x.balance > 0.004);
    return {
        today,
        scoped: scopedEmployees,
        prepared,
        employees,
        summary: computePortfolioSummary(employees),
        month: computeMonthChange(employees, today),
        monthFlows: monthFlows(employees, today),
        risk: riskCache.list,
        duplicates: dup.counts,
        inactive,
        consolidations: scopedEmployees.flatMap(emp => findConsolidations(emp)).length,
        backfill: planLoanBackfill(scopedEmployees, payPeriod),
        review: listPaymentsToReview(scopedEmployees)
    };
}

// ─── Línea del mes ───────────────────────────────────────────────────────────

/** Qué movió el saldo este mes y el anterior (préstamos nuevos, refinanciamientos, abonos, cerrados). */
function monthFlows(employees, today) {
    const prevStart = (() => {
        const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
        return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
    })();
    const buckets = buildFlowBuckets('month', { from: prevStart, to: today });
    const flows = computeLoanFlows(employees.flatMap(emp => emp.loans || []), buckets);
    const pick = bucket => {
        const o = bucket && flows.get(bucket.key);
        if (!o) return null;
        return {
            label: bucket.long.split(' ')[0], nNew: o.nNew, lent: o.newCap + o.newInt, refi: o.refiInt,
            paid: o.payOld + o.paySame, closed: o.gift + o.adjustDown - o.adjustUp,
            change: o.newCap + o.newInt + o.refiInt + o.adjustUp - o.payOld - o.paySame - o.gift - o.adjustDown
        };
    };
    return { current: pick(buckets.at(-1)), previous: buckets.length > 1 ? pick(buckets[0]) : null };
}

const verbOf = change => (change > 0.004 ? 'subió' : change < -0.004 ? 'bajó' : 'no cambió');

export function PortfolioMonthLine(model) {
    const { month, today } = model;
    const ui = portfolioUi();
    const cap = month.month.charAt(0).toUpperCase() + month.month.slice(1);
    const f = model.monthFlows?.current;
    const prev = model.monthFlows?.previous;
    const open = ui.tip === 'month';
    const tip = `<span class="lp-tip">
        <button type="button" data-app-fn="lpTip" data-arg="month" aria-expanded="${open}" aria-label="Cómo cambió en ${escapeAttr(month.month)}">i</button>
        ${open ? `<span class="lp-pop" role="dialog"><strong>Cómo cambió en ${escapeHTML(month.month)}</strong><ul>
            ${f ? `<li>+ ${M(f.lent)} en ${f.nNew} préstamo${f.nNew === 1 ? '' : 's'} nuevo${f.nNew === 1 ? '' : 's'} con su interés</li>
            <li>+ ${M(f.refi)} de refinanciamientos</li>
            <li>− ${M(f.paid)} en abonos</li>
            ${Math.abs(f.closed) > 0.004 ? `<li>− ${M(f.closed)} en préstamos cerrados o ajustes</li>` : ''}` : ''}
            ${prev ? `<li>En ${escapeHTML(prev.label)} ${verbOf(prev.change)}${Math.abs(prev.change) > 0.004 ? ' ' + M(Math.abs(prev.change)) : ''}.</li>` : ''}
            <li>Si sube 2 o 3 meses seguidos: frena préstamos nuevos o descuenta más en nómina.</li></ul>
            ${model.prepared.virtual ? '<small>Leído como si ya se hubieran deshecho las consolidaciones y completado los datos.</small>' : ''}
            <button type="button" class="lp-link" data-app-fn="laUseClassicView" data-arg="1" title="Solo en este dispositivo">Usar la vista anterior</button>
        </span>` : ''}
    </span>`;
    return `<div class="lp-month">
        <span>${escapeHTML(cap)}: lo que deben <b>${verbOf(month.change)}${Math.abs(month.change) > 0.004 ? ' ' + M(Math.abs(month.change)) : ''}</b></span>
        <small>de ${M(month.from)} a ${M(month.to)} · datos al ${dmy(today)}</small>
        ${tip}
        ${ExportButton()}
    </div>
    ${ExportPanel(model)}`;
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

function countText(counts) {
    return [
        counts.payments ? `${counts.payments} abono${counts.payments === 1 ? '' : 's'}` : '',
        counts.refinancings ? `${counts.refinancings} interés${counts.refinancings === 1 ? '' : 'es'}` : '',
        counts.loans ? `${counts.loans} préstamo${counts.loans === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(', ');
}

export function PortfolioAlerts(model) {
    const ui = portfolioUi();
    const items = [];
    const riskBy = l => model.risk.filter(r => r.lvl === l).length;
    if (model.duplicates.total) items.push({ key: 'dup', dot: '#ef4444', title: `${model.duplicates.total} posibles registros repetidos`, sub: countText(model.duplicates), hint: 'Toca «Revisar», deja marcadas las copias y toca «Anular».', label: 'Revisar' });
    if (model.risk.length) items.push({ key: 'risk', dot: '#ef4444', title: `${model.risk.length} empleado${model.risk.length === 1 ? '' : 's'} en riesgo`, sub: `${riskBy(3)} muy alto · ${riskBy(2)} alto · ${riskBy(1)} moderado`, hint: 'Toca «Ver» para saber por qué y qué conviene hacer con cada uno.', label: 'Ver' });
    if (model.inactive.length) items.push({ key: 'inactive', dot: '#94a3b8', title: `${model.inactive.length} empleado${model.inactive.length === 1 ? '' : 's'} inactivo${model.inactive.length === 1 ? '' : 's'} deben ${M(model.inactive.reduce((t, x) => t + x.balance, 0), 0)}`, sub: 'No pasan por nómina', hint: 'Cobra a mano y registra el abono; si no se cobrará, anula el préstamo como «Perdonado» o con una nota.', label: 'Ver quiénes' });
    if (model.consolidations) items.push({ key: 'cons', dot: '#a855f7', title: `${model.consolidations} consolidación${model.consolidations === 1 ? '' : 'es'} por deshacer`, sub: 'Juntaban préstamos y convertían el interés en capital', hint: 'Los préstamos vuelven a ser separados; lo que deben no cambia.', label: 'Deshacer todas', fn: 'laUndoAllConsolidations' });
    if (model.backfill.total) items.push({ key: 'fill', dot: '#1fb6ff', title: 'Datos de préstamos por completar', sub: [model.backfill.numbers ? `${model.backfill.numbers} sin número` : '', model.backfill.dueDates ? `${model.backfill.dueDates} sin nómina de cobro` : '', model.backfill.payrollPayments + model.backfill.directPayments + model.backfill.reviewPayments ? `${model.backfill.payrollPayments + model.backfill.directPayments + model.backfill.reviewPayments} abonos sin origen` : ''].filter(Boolean).join(' · '), hint: 'Solo rellena lo que falta; no cambia montos. Mientras tanto, esta pantalla ya los lee completados.', label: 'Completar', fn: 'laApplyBackfill' });
    if (model.review.length) items.push({ key: 'review', dot: '#fb923c', title: `${model.review.length} abono${model.review.length === 1 ? '' : 's'} por revisar`, sub: 'Cayeron fuera de los días de pago', hint: '¿Fueron descuento de nómina o directos? Márcalo en cada uno.', label: 'Revisar' });
    if (!items.length) return `<div class="lp-alerts lp-alerts--empty">✓ Sin avisos pendientes</div>`;
    // Plegado por defecto; si el usuario lo dejó abierto, se recuerda en este dispositivo.
    const open = ui.alertsOpen ?? readLoanUiMemory().alertsOpen ?? false;
    const panel = ui.alertPanel;
    return `<section class="lp-alerts${open ? ' is-open' : ''}" aria-label="Avisos">
        <button type="button" class="lp-alerts__head" data-app-fn="lpToggleAlerts" aria-expanded="${open}"><span class="lp-badge">${items.length}</span><b>Avisos que necesitan una decisión</b><span class="lp-alerts__toggle">${open ? 'Ocultar' : 'Ver'}</span></button>
        ${open ? items.map(it => `
            <div class="lp-alert"><span class="lp-dot" style="background:${it.dot}"></span>
                <div class="lp-alert__txt"><b>${escapeHTML(it.title)}</b><small>${escapeHTML(it.sub || '')}</small><small class="lp-hint">→ ${escapeHTML(it.hint)}</small></div>
                <button type="button" class="la-btn la-btn--sm" data-app-fn="${it.fn || 'lpAlertPanel'}" ${it.fn ? '' : `data-arg="${it.key}"`} aria-expanded="${panel === it.key}">${panel === it.key ? 'Ocultar' : escapeHTML(it.label)}</button>
            </div>
            ${panel === it.key ? `<div class="lp-alert__panel">${AlertPanel(it.key, model)}</div>` : ''}`).join('') : ''}
    </section>`;
}

function AlertPanel(key, model) {
    // Las acciones de repetidos cambian los datos reales: se usan los empleados de la obra, no la copia.
    if (key === 'dup') return renderLoanDuplicateReview({ scope: 'general', employees: model.scoped, embedded: true, open: true });
    if (key === 'risk') return RiskPanel(model);
    if (key === 'inactive') return `<div class="lp-list">${model.inactive.sort((a, b) => b.balance - a.balance).map(x => `<div class="lp-list__row"><span><b>${escapeHTML(x.emp.name || '')}</b> #${escapeHTML(x.emp.number ?? '')}</span><span>${M(x.balance)}</span><button type="button" class="la-btn la-btn--sm" data-app-fn="selectLoansEmployee" data-arg="${escapeAttr(x.emp.id)}">Ver préstamos</button></div>`).join('')}</div>`;
    if (key === 'review') return `<div class="lp-list">${model.review.map(({ emp, loan, payment }) => {
        const ref = escapeAttr(`${emp.id}|${loan.id}|${payment.id}`);
        return `<div class="lp-list__row"><span><b>${escapeHTML(emp.name || '')}</b> #${escapeHTML(emp.number ?? '')} · ${dmy(payment.date)} · <b>${M(payment.amount)}</b>${payment.note ? ` · ${escapeHTML(payment.note)}` : ''}</span><span class="lp-list__acts"><button type="button" class="la-btn la-btn--sm" data-app-fn="laReviewPayment" data-arg="${ref}" data-arg2="payroll">Nómina</button><button type="button" class="la-btn la-btn--sm" data-app-fn="laReviewPayment" data-arg="${ref}" data-arg2="direct">Directo</button></span></div>`;
    }).join('')}</div>`;
    return '';
}

function RiskPanel(model) {
    const ui = portfolioUi();
    const level = Number(ui.riskLevel) || 0;
    const list = model.risk.filter(r => !level || r.lvl === level);
    const count = l => model.risk.filter(r => r.lvl === l).length;
    return `<div class="lp-risk">
        <div class="lp-chips" role="group" aria-label="Nivel de riesgo">
            <button type="button" data-app-fn="lpRiskLevel" data-arg="0" aria-pressed="${!level}">Todos ${model.risk.length}</button>
            ${[3, 2, 1].map(l => `<button type="button" data-app-fn="lpRiskLevel" data-arg="${l}" aria-pressed="${level === l}"><i style="background:${RISK_COLOR[l]}"></i>${RISK_LEVELS[l]} ${count(l)}</button>`).join('')}
        </div>
        <details class="lp-how"><summary>Cómo se clasifica</summary><ul>
            <li>Se compara lo que debe con lo que gana en un periodo (la nómina de donde se descuenta).</li>
            <li><b>Muy alto:</b> inactivo con deuda, debe un sueldo o más, o le falta de nóminas anteriores la mitad de su sueldo o más.</li>
            <li><b>Alto:</b> debe 60 % de su sueldo o más, le falta de antes 25 % o más, o no pagó nada y lo atrasado no bajó.</li>
            <li><b>Moderado:</b> debe 35 % o más, o le queda algo de nóminas anteriores.</li>
            <li>Baja un nivel si viene pagando y lo atrasado baja. Los refinanciamientos y los préstamos pequeños no suben el nivel por sí solos.</li></ul></details>
        ${list.map(r => `<article class="lp-rk" style="--c:${RISK_COLOR[r.lvl]}">
            <div class="lp-rk__h"><span class="lp-rk__lvl">${RISK_LEVELS[r.lvl]}</span><b>${escapeHTML(r.emp.name || '')} #${escapeHTML(r.emp.number ?? '')}</b>${r.active ? '' : '<span class="la-pill">inactivo</span>'}<span class="lp-rk__bal">${M(r.bal)}</span></div>
            <ul>${r.why.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>
            ${r.ctx.length ? `<ul class="lp-rk__ctx">${r.ctx.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>` : ''}
            <div class="lp-rk__adv"><b>Qué hacer</b><ul>${r.advice.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul></div>
            <div class="lp-rk__acts"><button type="button" class="la-btn la-btn--sm" data-app-fn="selectLoansEmployee" data-arg="${escapeAttr(r.emp.id)}">Ver préstamos</button>${r.salary ? `<small>Sueldo de referencia ≈${M(r.salary.value, 0)} (${escapeHTML(r.salary.source)})</small>` : '<small>Sin sueldo para comparar</small>'}</div>
        </article>`).join('')}
        <p class="lp-note">Datos al ${dmy(model.today)}. Sueldo con el mismo cálculo que Nómina: lo que gana en este periodo proyectado si ya lleva 7 días o más; si no, el promedio de los 2 periodos anteriores. «Le faltan de nóminas anteriores» cuenta los préstamos cuya nómina de cobro original pasó hace más de 3 días.</p>
    </div>`;
}

// ─── Resumen de cartera ──────────────────────────────────────────────────────

function stackedBar(parts) {
    const total = parts.reduce((t, p) => t + p.value, 0) || 1;
    return `<span class="lp-bar">${parts.filter(p => p.value > 0).map(p => `<i style="width:${(p.value / total * 100).toFixed(2)}%;background:${p.color}" title="${escapeAttr(p.label)} ${M(p.value, 0)}"></i>`).join('')}</span>`;
}

/** Panel derecho: una cifra abierta a la vez (por defecto «Por cobrar»). */
function card(key, title, big, sub, body, open) {
    return `<div class="lp-card${open ? ' is-open' : ''}" data-card="${key}"><button type="button" class="lp-card__s" data-app-fn="lpCard" data-arg="${key}" data-arg2="aside" aria-expanded="${open}"><span class="lp-card__t">${escapeHTML(title)}</span><span class="lp-card__big">${big}</span><small>${sub}</small><span class="lp-card__chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>${open ? `<div class="lp-card__b">${body}</div>` : ''}</div>`;
}

/** Teléfono: 4 cifras en 2×2; al tocar una, su detalle se abre debajo a todo el ancho. */
function compactCards(cards) {
    const openKey = portfolioUi().card || null;
    const opened = cards.find(c => c.key === openKey);
    return `<div class="lp-cards">${cards.map(c => `<button type="button" class="lp-mcard" data-app-fn="lpCard" data-arg="${c.key}" aria-expanded="${c.key === openKey}"><span class="lp-card__t">${escapeHTML(c.title)}</span><span class="lp-card__big">${c.big}</span><small>${c.sub}</small></button>`).join('')}</div>
        ${opened ? `<div class="lp-mdetail"><b>${escapeHTML(opened.title)}</b>${opened.body}</div>` : ''}`;
}

const row = (color, label, value, extra = '', sub = '') => `<div class="lp-r${extra}">${color ? `<i style="background:${color}"></i>` : '<i></i>'}<span>${label}${sub ? `<em>${sub}</em>` : ''}</span><b>${value}</b></div>`;
const STRIPE = 'repeating-linear-gradient(135deg,#10d98a 0 2.5px,rgba(16,217,138,.16) 2.5px 6px)';
const C = { cap: '#1fb6ff', int: '#ffc61a', refi: '#a855f7', pay: '#10d98a', payInt: '#0a8f5b' };
const todo = items => `<div class="lp-todo"><b>Qué hacer</b><ul>${items.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
const pl = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

/** Botón (i) con una explicación corta (se abre con lpTip). */
function info(key, title, items) {
    const open = portfolioUi().tip === key;
    return `<span class="lp-tip is-inline"><button type="button" data-app-fn="lpTip" data-arg="${key}" aria-expanded="${open}" aria-label="${escapeAttr(title)}">i</button>${open ? `<span class="lp-pop" role="note"><strong>${escapeHTML(title)}</strong><ul>${items.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul></span>` : ''}</span>`;
}

export function PortfolioSummary(model, { compact = false } = {}) {
    const s = model.summary;
    const max = Math.max(1, ...s.quienDebeMas.map(r => r.balance));
    const pc = s.porCobrar;
    const porCobrar = `
        ${stackedBar([{ value: pc.capital, color: C.cap, label: 'capital' }, { value: pc.interestInitial, color: C.int, label: 'interés inicial' }, { value: pc.interestRefi, color: C.refi, label: 'refinanciamientos' }])}
        ${row(C.cap, 'Capital por devolver', M(pc.capital))}
        ${row(C.int, 'Interés por cobrar', M(pc.interest))}
        ${row(C.int, `del interés inicial ${info('t-est', 'Cómo se reparte', ['La app no guarda a qué interés fue cada abono.', 'Se asume que primero se cobra el interés inicial y después el de los refinanciamientos; por eso este reparto es un estimado. El total sí es exacto.'])}`, M(pc.interestInitial), ' is-sub', 'estimado')}
        ${row(C.refi, 'de refinanciamientos', M(pc.interestRefi), ' is-sub', 'estimado')}
        ${row('', `Total por cobrar ${info('t-recv', 'También conviene saber', [
            pc.inactive > 0.004 ? `${M(pc.inactive)} es de ${pl(pc.inactivePeople, 'empleado inactivo', 'empleados inactivos')}: no pasan por nómina y se cobra aparte.` : 'Ningún empleado inactivo debe.',
            'Lo perdonado y los préstamos anulados por error no entran aquí.'])}`, M(pc.total), ' is-tot')}
        ${`<h5>Quién debe más</h5>
        ${s.quienDebeMas.map(r => `<button type="button" class="lp-who" data-app-fn="selectLoansEmployee" data-arg="${escapeAttr(r.emp.id)}"><span>#${escapeHTML(r.emp.number ?? '')}${r.active ? '' : ' <em>inactivo</em>'}</span><span class="lp-who__bar" style="width:${(r.balance / max * 100).toFixed(1)}%">${stackedBar([{ value: r.capital, color: C.cap, label: 'capital' }, { value: r.interest, color: C.int, label: 'interés' }, { value: r.refi, color: C.refi, label: 'refinanciamiento' }])}</span><b>${M(r.balance, 0)}</b></button>`).join('')}
        <div class="lp-legend"><span><i style="background:${C.cap}"></i>Capital</span><span><i style="background:${C.int}"></i>Interés</span><span><i style="background:${C.refi}"></i>Refinanciamiento</span></div>`}
        ${todo(['Antes de prestar, mira cuánto debe ya el empleado y el medidor de carga del préstamo nuevo.', 'Si no le alcanza la nómina, usa «Acuerdo» con un monto fijo en vez de refinanciar cada vez.', 'A los inactivos, registra el abono a mano en su ficha.'])}`;
    const ig = s.interesGanado;
    const ganado = `<p class="lp-ex">Interés que ya entró. Cada abono paga primero el interés y después el capital.</p>
        ${stackedBar([{ value: ig.collectedInit, color: C.pay, label: 'ganado del interés inicial' }, { value: ig.collectedRefi, color: C.payInt, label: 'ganado de refinanciamientos' }, { value: pc.interestInitial, color: C.int, label: 'por cobrar del inicial' }, { value: pc.interestRefi, color: C.refi, label: 'por cobrar de refinanciamientos' }])}
        ${row(C.pay, 'Ganado del interés inicial', M(ig.collectedInit))}
        ${row(C.payInt, 'Ganado de refinanciamientos', M(ig.collectedRefi))}
        ${row('', 'Interés ganado', M(ig.collected), ' is-tot')}
        ${row(C.int, 'Por cobrar todavía', M(pc.interest), '', `en préstamos activos · ${M(pc.interestRefi)} de refinanciamientos`)}
        ${row('', `Interés total (ganado + por cobrar) ${info('t-int', 'Qué no se cuenta', [
            ig.forgiven > 0.004 ? `${M(ig.forgiven)} de interés de préstamos cerrados sin cobrarlo (perdonado o cubierto con saldo a favor).` : 'No hay interés perdonado.',
            `Los ${pl(s.prestado.voided, 'préstamo anulado', 'préstamos anulados')} por error no cuentan.`,
            `Solo desde el primer abono registrado en la app${s.cobrado.since ? ` (${dmy(s.cobrado.since)})` : ''}.`])}`, M(ig.total), ' is-tot')}
        ${todo(['Si «Por cobrar todavía» crece, prioriza descontar esos préstamos en nómina.'])}`;
    const cb = s.cobrado;
    const other = round2(cb.total - cb.payroll - cb.direct);
    const cobrado = `<p class="lp-ex">Todo lo que los empleados han pagado, separado en capital e interés.</p>
        ${stackedBar([{ value: cb.capital, color: C.pay, label: 'capital' }, { value: cb.interest, color: C.payInt, label: 'interés' }, { value: cb.excess, color: STRIPE, label: 'pagado de más' }])}
        ${row(C.pay, 'Capital devuelto', M(cb.capital))}
        ${row(C.payInt, 'Interés', M(cb.interest))}
        ${row(STRIPE, `Pagado de más ${info('t-ex', 'Pagado de más', ['Rayado = posible error. Suele venir de abonos anotados dos veces: al anular las copias marcadas en el aviso de registros repetidos, queda en $0.', 'Si fue un pago adelantado de verdad, queda como saldo a favor del empleado.'])}`, M(cb.excess))}
        ${row('', 'Total cobrado', M(cb.total), ' is-tot')}
        <h5>Cómo entró</h5>
        ${row('', 'Descontado en nómina', M(cb.payroll), ' is-plain', 'se rebajó del pago al cerrar la nómina')}
        ${row('', 'Abonado directamente', M(cb.direct), ' is-plain', 'efectivo o transferencia registrada a mano en Préstamos')}
        ${Math.abs(other) > 0.004 ? row('', 'Ajustes de nóminas cerradas', M(other), ' is-plain', 'correcciones de abonos ya cerrados') : ''}
        ${todo(['Si «Pagado de más» no es cero, abre Avisos → registros repetidos y anula las copias.'])}`;
    const pr = s.prestado;
    const prestado = `<p class="lp-ex">Capital entregado, sin interés ni préstamos anulados.</p>
        ${stackedBar([{ value: pr.returned, color: C.pay, label: 'ya devuelto' }, { value: pc.capital, color: C.cap, label: 'por devolver' }, { value: pr.forgiven, color: '#6f7a84', label: 'perdonado' }])}
        ${row(C.pay, 'Ya devuelto', M(pr.returned))}
        ${row(C.cap, 'Por devolver', M(pc.capital))}
        ${pr.forgiven > 0.004 ? row('#6f7a84', 'Perdonado o cerrado con saldo', M(pr.forgiven)) : ''}
        ${row('', `Total prestado ${info('t-lent', 'Qué no se cuenta', [
            `${pl(pr.voided, 'préstamo anulado', 'préstamos anulados')} por error al registrarlos (${M(pr.voidedAmount)}).`,
            pr.forgiven > 0.004 ? `${M(pr.forgiven)} se perdonaron o se cerraron con saldo.` : 'No hay saldo perdonado.'])}`, M(pr.total), ' is-tot', pl(pr.loans, 'préstamo'))}
        ${todo(['Si el porcentaje devuelto baja mes a mes, se presta más rápido de lo que vuelve: frena préstamos nuevos o sube los descuentos.'])}`;
    const cards = [
        { key: 'cobrar', title: 'Por cobrar', big: M(s.porCobrar.total), sub: `${s.porCobrar.people} empleado${s.porCobrar.people === 1 ? '' : 's'} · ${s.porCobrar.loans} préstamo${s.porCobrar.loans === 1 ? '' : 's'}`, body: porCobrar },
        { key: 'ganado', title: 'Interés ganado', big: M(s.interesGanado.collected, 0), sub: `de ${M(s.interesGanado.total, 0)} en total`, body: ganado },
        { key: 'cobrado', title: 'Cobrado', big: M(s.cobrado.total, 0), sub: s.cobrado.since ? `abonos desde el ${dmy(s.cobrado.since)}` : 'sin abonos', body: cobrado },
        { key: 'prestado', title: 'Prestado', big: M(s.prestado.total, 0), sub: `${(s.prestado.pctReturned * 100).toFixed(1)} % ya devuelto`, body: prestado }
    ];
    if (compact) return `<div class="lp-summary is-compact">${compactCards(cards)}</div>`;
    const ui = portfolioUi();
    const asideOpen = ui.asideCard === undefined ? (readLoanUiMemory().asideCard ?? null) : ui.asideCard;
    return `<div class="lp-summary">
        <div class="lp-summary__h"><b>Resumen de cartera</b><small>sin anulados</small></div>
        ${cards.map(c => card(c.key, c.title, c.big, c.sub, c.body, c.key === asideOpen)).join('')}
    </div>`;
}
