/**
 * 🔎 LoanConsolidationReviewPanel — botón «Consolidaciones» y panel de
 * revisión en la pantalla principal de Préstamos (maqueta del 06/10).
 *
 * Por empleado: monto real (consolidaciones armadas otra vez con sus copias),
 * saldo de hoy, diferencia y estado. Las dañadas se pueden reparar; la
 * reparación solo se guarda si el saldo queda igual al monto real.
 * Los cálculos están en LoanConsolidationReview.js.
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { captureEntityProjectScope } from '../projects/EntityProjectScope.js';
import { loanDataKey } from './LoanDataKey.js';
import { REVIEW_STATUS, reviewConsolidations, repairEmployeeConsolidations } from './LoanConsolidationReview.js';

const STATUS_PILL = {
    [REVIEW_STATUS.OK]: ['ok', 'Correcta'],
    [REVIEW_STATUS.DAMAGED]: ['bad', 'Deuda contada dos veces'],
    [REVIEW_STATUS.MISMATCH]: ['bad', 'No cuadra'],
    [REVIEW_STATUS.REPAIRED]: ['lock', '🔒 Reparada'],
    [REVIEW_STATUS.PENDING]: ['pend', 'Sin deshacer']
};
const ORDER = [REVIEW_STATUS.DAMAGED, REVIEW_STATUS.MISMATCH, REVIEW_STATUS.PENDING, REVIEW_STATUS.REPAIRED, REVIEW_STATUS.OK];
const M = value => formatCurrency(value);
const dm = date => (date ? String(date).slice(5, 10).split('-').reverse().join('/') : '');

let cache = { key: null, value: null };

/** Revisión de los empleados de la obra (se recalcula solo si cambian los préstamos). */
function reviewOf(scoped) {
    // Clave de texto: la firma anterior era un arreglo nuevo en cada llamada,
    // así que `cache.key !== key` nunca coincidía y se recalculaba en cada render.
    const key = loanDataKey(scoped);
    if (cache.key !== key) cache = { key, value: reviewConsolidations(scoped) };
    return cache.value;
}

export function consolidationReviewUi() {
    return { open: false, expanded: null, ...(state.loansLedger?.portfolio?.consReview || {}) };
}

function setUi(fn) {
    stateManager.batchSetState(() => {
        if (!state.loansLedger) state.loansLedger = {};
        if (!state.loansLedger.portfolio) state.loansLedger.portfolio = {};
        const x = consolidationReviewUi();
        fn(x);
        state.loansLedger.portfolio.consReview = x;
    });
    render();
}

/** Botón «Consolidaciones» (junto a «Exportar»); solo aparece si hay consolidaciones. */
export function ConsolidationReviewButton(model) {
    const { stats } = reviewOf(model.scoped || []);
    if (!stats.employees) return '';
    const bad = stats.damaged + stats.mismatch;
    return `<button type="button" class="lp-xbtn lp-cr-btn" data-app-fn="lcToggle" aria-expanded="${consolidationReviewUi().open}">Consolidaciones${bad ? ` <span class="lp-cr-pill is-bad">${bad} con error</span>` : ''}</button>`;
}

function treeHtml(nodes, depth = 0) {
    return nodes.map(node => {
        const chip = `<span class="lp-cr-chip${node.isConsolidation ? ' is-cons' : ''}">#${escapeHTML(String(node.number ?? '?'))}</span>`;
        const label = `${chip} ${escapeHTML(dm(node.startDate))} · ${M(node.principal)}${node.damaged ? ' <small class="is-bad">abierta otra vez</small>' : ''}`;
        if (!node.isConsolidation) return label;
        const kids = node.children.filter(c => c.isConsolidation);
        const plain = node.children.filter(c => !c.isConsolidation);
        return `<div class="lp-cr-node" style="--d:${depth}">${label}${depth === 0 ? ' <small>la de afuera</small>' : ''}
            ${kids.length ? treeHtml(kids, depth + 1) : ''}
            ${plain.length ? `<div class="lp-cr-node" style="--d:${depth + 1}">${plain.map(c => treeHtml([c], depth + 1)).join(' &nbsp; ')}</div>` : ''}</div>`;
    }).join('');
}

function whyText(item) {
    if (item.status === REVIEW_STATUS.DAMAGED) {
        const nums = item.doubled.map(d => `#${d.number ?? '?'}`).join(', ');
        return `La versión anterior deshizo primero la de adentro (${nums}) y después la de afuera, que la volvió a abrir. Hoy están abiertos a la vez ${nums} y los préstamos que juntaba, así que su saldo se cuenta dos veces.`;
    }
    if (item.status === REVIEW_STATUS.MISMATCH) return 'El saldo de hoy no es igual al monto real y no se reconoce el error de la versión anterior. No se repara solo: revisa los movimientos de la cuenta.';
    if (item.status === REVIEW_STATUS.PENDING) return 'Todavía está consolidada. Se deshace con «Deshacer todas» en los avisos; lo que debe no cambia.';
    if (item.status === REVIEW_STATUS.REPAIRED) return 'Se reparó: ya no se cuenta dos veces. «Volver a consolidar» quedó bloqueado en estas consolidaciones.';
    return 'Se deshizo bien: el saldo de hoy es igual al monto real.';
}

function detailHtml(item) {
    const bad = Math.abs(item.diff) >= 0.01;
    const width = item.today > 0 ? Math.min(100, item.real / item.today * 100) : 100;
    return `<div class="lp-cr-detail">
        <div class="lp-cr-box"><h6>Cómo estaban consolidados</h6>
            <div class="lp-cr-tree">${treeHtml(item.tree)}</div>
            <p>${escapeHTML(whyText(item))}</p>
        </div>
        <div class="lp-cr-box"><h6>Verificación</h6>
            <div class="lp-cr-cmp">
                <span>Monto real (consolidaciones armadas otra vez)</span><b>${M(item.real)}</b>
                <span>Saldo de hoy con los préstamos separados</span><b class="${bad ? 'is-bad' : ''}">${M(item.today)}</b>
                ${item.doubled.map(d => `<span class="is-sub">#${escapeHTML(String(d.number ?? '?'))} abierto otra vez</span><b class="is-bad">+${M(d.balance)}</b>`).join('')}
                <span class="is-tot">Diferencia</span><b class="is-tot ${bad ? 'is-bad' : 'is-ok'}">${bad ? `${item.diff > 0 ? '+' : '−'}${M(Math.abs(item.diff))}` : '✓ $0.00'}</b>
                <span class="is-sub">Total abonado (no cambia)</span><b>${M(item.paid)}</b>
            </div>
            <div class="lp-cr-bar" aria-hidden="true"><i style="width:${width}%"></i>${bad && item.diff > 0 ? `<i class="is-bad" style="left:${width}%;width:${100 - width}%"></i>` : ''}</div>
            ${item.status === REVIEW_STATUS.DAMAGED ? (item.canRepair
                ? `<div class="lp-cr-acts"><button type="button" class="lp-cr-fix" data-app-fn="lcRepair" data-arg="${escapeAttr(item.employeeId)}">Reparar #${escapeHTML(String(item.number ?? ''))}</button><small>Deshace otra vez la de adentro, en el orden correcto. El saldo quedará en ${M(item.afterRepair)}.</small></div>`
                : `<div class="lp-cr-acts"><small class="is-bad">No se puede reparar sola: ${escapeHTML(item.repairError || `quedaría en ${M(item.afterRepair ?? 0)} y el monto real es ${M(item.real)}`)}.</small></div>`)
                : item.status === REVIEW_STATUS.REPAIRED ? '<div class="lp-cr-acts"><small>🔒 «Volver a consolidar» quedó bloqueado.</small></div>' : ''}
        </div>
    </div>`;
}

/** Panel de revisión (se abre con el botón). */
export function ConsolidationReviewPanel(model) {
    const ui = consolidationReviewUi();
    if (!ui.open) return '';
    const { items, stats } = reviewOf(model.scoped || []);
    if (!stats.employees) return '';
    const sorted = [...items].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(a.number).localeCompare(String(b.number), 'es', { numeric: true }));
    const bad = stats.damaged + stats.mismatch;
    const rows = sorted.map(item => {
        const [tone, label] = STATUS_PILL[item.status];
        const open = String(ui.expanded) === String(item.employeeId);
        const diffBad = Math.abs(item.diff) >= 0.01;
        return `<div class="lp-cr-emp${tone === 'bad' ? ' is-alert' : ''}">
            <div class="lp-cr-row">
                <span class="lp-cr-n">#${escapeHTML(String(item.number ?? '?'))}</span>
                <span><b>${item.count} consolidaci${item.count === 1 ? 'ón' : 'ones'}</b>${item.levels > 1 ? ' <small>· una dentro de otra</small>' : ''}</span>
                <span class="lp-cr-r is-m">${M(item.real)}</span>
                <span class="lp-cr-r"><b>${M(item.today)}</b></span>
                <span class="lp-cr-r is-m ${diffBad ? 'is-bad' : 'is-ok'}">${diffBad ? `${item.diff > 0 ? '+' : '−'}${M(Math.abs(item.diff))}` : '✓ igual'}</span>
                <span class="lp-cr-st"><span class="lp-cr-pill is-${tone}">${label}</span>
                    <button type="button" class="lp-cr-tog" data-app-fn="lcExpand" data-arg="${escapeAttr(item.employeeId)}" aria-expanded="${open}" aria-label="${open ? 'Cerrar' : 'Ver'} detalle de #${escapeAttr(String(item.number ?? ''))}">${open ? '−' : '+'}</button></span>
            </div>
            ${open ? detailHtml(item) : ''}
        </div>`;
    }).join('');
    return `<section class="lp-cr" role="region" aria-label="Revisar consolidaciones">
        <div class="lp-cr-h"><h5>Revisar consolidaciones</h5>
            <p>Para cada empleado se vuelven a armar las consolidaciones como estaban antes de deshacerlas y se calcula lo que debía (monto real). Debe ser igual al saldo de hoy con los préstamos separados.</p></div>
        <div class="lp-cr-stats">
            <span><small>Empleados revisados</small><b>${stats.employees}</b></span>
            <span><small>Correctas</small><b class="is-ok">${stats.ok}</b></span>
            <span><small>Con error</small><b class="${bad ? 'is-bad' : 'is-ok'}">${bad}</b></span>
            <span><small>Reparadas</small><b class="is-lock">${stats.repaired}</b></span>
        </div>
        ${stats.pending ? `<p class="lp-cr-note">${stats.pending} empleado${stats.pending === 1 ? '' : 's'} con consolidaciones sin deshacer.</p>` : ''}
        <div class="lp-cr-cols" aria-hidden="true"><span>N.º</span><span>Consolidaciones</span><span class="lp-cr-r">Monto real</span><span class="lp-cr-r">Saldo hoy</span><span class="lp-cr-r">Diferencia</span><span class="lp-cr-r">Estado</span></div>
        <div class="lp-cr-list">${rows}</div>
    </section>`;
}

export function lcToggle() {
    setUi(x => { x.open = !x.open; });
}

export function lcExpand(employeeId) {
    setUi(x => { x.expanded = String(x.expanded) === String(employeeId) ? null : employeeId; });
}

function notify(msg, type) {
    if (typeof window === 'undefined') return;
    if (type === 'error' && window.showAlert) window.showAlert(msg, 'error');
    else if (window.showNotification) window.showNotification(msg, type);
}

/** Repara las consolidaciones dañadas de un empleado, después de confirmar. */
export function lcRepair(employeeId) {
    const emp = (state.employees || []).find(e => String(e.id) === String(employeeId) && entityInScope(e, peekEntityScope()));
    if (!emp) { notify('Empleado no disponible en el proyecto activo', 'error'); return; }
    const item = reviewOf([emp]).items[0] || null;
    cache = { key: null, value: null };
    if (!item?.canRepair) { notify('Esta cuenta no se puede reparar desde aquí', 'error'); return; }
    const run = () => {
        try {
            const by = (typeof window !== 'undefined' && window.currentUser?.email) || null;
            const result = repairEmployeeConsolidations(emp, { by, projectScope: captureEntityProjectScope() });
            cache = { key: null, value: null };
            saveApplicationData({ immediate: true, announce: `Consolidaciones reparadas (#${emp.number ?? ''}): saldo ${result.before.toFixed(2)} → ${result.after.toFixed(2)}, igual al monto real` });
            render();
        } catch (error) {
            notify(`❌ ${error.message}`, 'error');
        }
    };
    if (typeof window !== 'undefined' && typeof window.showConfirm === 'function') {
        window.showConfirm({
            title: `Reparar consolidaciones de #${emp.number ?? ''}`,
            message: `El saldo pasará de ${M(item.today)} a ${M(item.afterRepair)}, igual al monto real. Los abonos no cambian (${M(item.paid)}). Después, «Volver a consolidar» quedará bloqueado en estas consolidaciones.`,
            confirmText: 'Sí, reparar', cancelText: 'Cancelar', type: 'warning', onConfirm: run
        });
        return;
    }
    run();
}

export function registerConsolidationReviewGlobals() {
    if (typeof window === 'undefined') return;
    Object.assign(window, { lcToggle, lcExpand, lcRepair });
}
