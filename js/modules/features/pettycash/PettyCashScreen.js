/**
 * Pantalla nueva de Caja chica (HTML puro): saldo, acciones, filtros por estado,
 * interruptor «primero en revisión», tarjetas de gastos y columna del editor.
 *
 * Los bloques que ya existían (formularios, búsqueda, avisos de lote…) se
 * reciben listos en `slots`; aquí solo se organiza lo nuevo.
 * Probado en js/tests/PettyCashScreen.test.js.
 */
import { RECEIPT_STATES, groupReviewFirst } from './PettyCashReceiptReview.js';
import { formatPettyCashDate, receiptBackupState } from './PettyCashPresentation.js';
import { formatPettyCashRecordNumber } from './PettyCashRecordNumber.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rd = (n) => 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FILTERS = Object.freeze([['todos', 'Todos'], ['revisar', RECEIPT_STATES.revisar.label], ['respaldo', RECEIPT_STATES.respaldo.label],
    ['consumo', RECEIPT_STATES.consumo.label], ['otra', RECEIPT_STATES.otra.label], ['leida', RECEIPT_STATES.leida.label]]);
const CAMERA_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

export function balanceCardHTML({ saldo = 0, reposiciones = 0, gastos = 0, reembolso = 0 } = {}) {
    const used = reposiciones > 0 ? Math.min(100, Math.max(0, Math.round((gastos / reposiciones) * 100))) : 0;
    return `<section class="pcn-balance" data-pcn-balance>
        <div class="pcn-balance-label">Saldo disponible</div>
        <div class="pcn-balance-value" data-pcn-saldo data-negative="${saldo < 0}">${rd(saldo)}</div>
        <div class="pcn-track"><span data-pcn-spent-bar style="width:${used}%"></span></div>
        <div class="pcn-balance-foot"><span>Fondo ${rd(reposiciones)}</span><span>Gastado ${rd(gastos)}</span></div>
        ${reembolso > 0 ? `<div class="pcn-balance-refund">Por reembolsar ${rd(reembolso)}</div>` : ''}
    </section>`;
}

export function movementCardHTML({ movement: m, key, duplicate }, { cerrada = false, selected = false } = {}) {
    const isGasto = m.type === 'gasto';
    const title = isGasto ? (m.paidTo || m.description || 'Gasto') : (m.description || 'Reposición');
    const state = isGasto ? RECEIPT_STATES[key] : null;
    const unsent = isGasto && receiptBackupState(m)?.state === 'pending';
    const meta = [formatPettyCashDate(m.fechaEmision || m.date), isGasto ? m.category : 'Reposición'].filter(Boolean).map(esc).join(' · ');
    const dupLabel = duplicate?.confidence === 'exact' ? 'Coincide con' : 'Se parece a';
    return `<div class="pcn-card" data-pcn-card="${esc(m.id)}" data-selected="${!!selected}" data-app-fn="pcOpenMovement" data-arg="${esc(m.id)}" role="button" tabindex="0" title="Ver / editar detalle">
        <div class="pcn-card-main">
            <div class="pcn-card-title"><span class="pcn-card-num">${esc(formatPettyCashRecordNumber(m.recordNumber))}</span> ${esc(title)}</div>
            <div class="pcn-card-meta">${meta}${unsent ? ' · <span class="pcn-unsent">Sin subir</span>' : ''}</div>
            ${duplicate ? `<button type="button" class="pcn-dup" data-app-fn="pcOpenDuplicateReference" data-arg="${esc(duplicate.referenceId)}" data-app-stop="1" title="${esc(duplicate.reason)}. Abrir registro de referencia.">⚠ ${dupLabel} ${esc(formatPettyCashRecordNumber(duplicate.referenceNumber))} · ${esc(duplicate.referencePeriodLabel)}</button>` : ''}
        </div>
        <div class="pcn-card-side">
            <div class="pcn-card-amount" data-kind="${isGasto ? 'gasto' : 'reposicion'}">${isGasto ? '−' : '+'} ${rd(m.amount)}</div>
            ${state ? `<div class="pcn-state" data-pcn-state="${key}"><span class="pcn-dot" style="background:${state.color}"></span>${state.label}</div>` : ''}
        </div>
        ${cerrada ? '' : `<button type="button" class="pcn-del" data-app-fn="pcDeleteMovement" data-arg="${esc(m.id)}" data-app-stop="1" aria-label="Eliminar">✕</button>`}
    </div>`;
}

/**
 * @param {object} model
 * @param {{label:string, cerrada:boolean}} model.period
 * @param {{saldo:number, reposiciones:number, gastos:number, reembolso:number}} model.summary
 * @param {'camera'|'native'} model.cameraMode  cámara nueva o la del sistema
 * @param {{movement:object, key:string, duplicate:object|null}[]} model.items  ya ordenados y filtrados
 * @param {object} model.counts  conteos por filtro
 */
export function screenHTML(model) {
    const { period, summary, cameraMode, items, counts, filter, reviewFirst, selectedId, editing, editorHTML, slots = {}, hasMore, moreLabel } = model;
    const cerrada = !!period?.cerrada;
    const cta = cameraMode === 'native'
        ? `<label class="pcn-cta" data-pcn-cta>${CAMERA_ICON} Tomar foto de factura<input type="file" accept="image/*" capture="environment" onchange="window.pcCameraBatchPhoto(this)" style="display:none;"></label>`
        : `<button type="button" class="pcn-cta" data-pcn-cta data-app-fn="pcOpenCamera">${CAMERA_ICON} Tomar foto de factura</button>`;
    const groups = groupReviewFirst(items, { first: reviewFirst, filter });
    const list = groups.length
        ? groups.map((g) => `${g.title ? `<div class="pcn-sec" data-pcn-section="${g.id}">${g.title} <b>${g.items.length}</b></div>` : ''}
            <div class="pcn-cards">${g.items.map((it) => movementCardHTML(it, { cerrada, selected: it.movement.id === selectedId })).join('')}</div>`).join('')
        : `<div class="pcn-empty" data-pcn-empty>${filter !== 'todos' ? 'No hay registros con ese estado.' : 'Sin movimientos aún.'}</div>`;
    return `<div class="pcn-screen" data-pcn-screen data-editing="${!!editing}">
        <div class="pcn-main">
            ${balanceCardHTML(summary)}
            ${cerrada ? '' : `${cta}
            <div class="pcn-actions" data-pcn-actions>
                <button type="button" class="pcn-ghost" data-app-fn="pcOpenForm" data-arg="gasto">Gasto manual</button>
                <button type="button" class="pcn-ghost" data-app-fn="pcOpenForm" data-arg="reposicion">Reposición</button>
                <button type="button" class="pcn-ghost" data-app-fn="pcOpenReceiptSourcePicker">Archivos</button>
            </div>`}
            ${slots.before || ''}
            <button type="button" class="pcn-switch" data-pcn-review-first role="switch" aria-checked="${!!reviewFirst}" data-app-fn="pcToggleReviewFirst">
                <span class="pcn-switch-track"><i></i></span>Mostrar primero los registros en revisión
            </button>
            ${slots.search || ''}
            <div class="pcn-filters">${FILTERS.map(([k, label]) =>
                `<button type="button" class="pcn-filter" data-pcn-filter data-app-fn="pcFilterState" data-arg="${k}" aria-pressed="${k === filter}">${label} <b>${counts?.[k] ?? 0}</b></button>`).join('')}</div>
            ${slots.sort || ''}
            ${list}
            ${hasMore ? `<div class="pcn-more"><button type="button" class="pcn-ghost" data-app-fn="pcLoadMoreMovements">${esc(moreLabel)}</button></div>` : ''}
            ${slots.after || ''}
        </div>
        ${editing ? `<div class="pcn-backdrop" data-pcn-backdrop data-app-fn="pcCancelMovementEdit"></div>
        <aside class="pcn-side" data-pcn-side>${editorHTML || ''}</aside>` : ''}
    </div>`;
}
