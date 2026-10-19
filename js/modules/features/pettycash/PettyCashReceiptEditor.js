/**
 * Editor de factura de la pantalla nueva de Caja chica (HTML puro).
 *
 * Imagen de la factura con el recuadro del dato activo, avisos de las mismas
 * revisiones que usa la cámara, y el formulario ordenado en cuatro columnas
 * (en teléfono baja a una o dos). Los ids `pce-*` son los que lee
 * `pcSaveMovementEdit`; los datos fiscales que antes no se podían editar
 * (descuento, propina, exento, ITBIS incluido) añaden los suyos.
 *
 * Lo que la persona escribió sin guardar viaja en `ui.draft` (claves del
 * gasto, no ids), para que los avisos reflejen lo que ve en pantalla.
 *
 * Probado en js/tests/PettyCashReceiptEditor.test.js.
 */
import { fixesFor, receiptNotes } from './PettyCashReceiptChecks.js';
import { RECEIPT_STATES, movementReviewState } from './PettyCashReceiptReview.js';
import { formatPettyCashDate, receiptBackupState } from './PettyCashPresentation.js';

/** id del campo → clave del gasto y tipo (lo usan el render y el guardado). */
export const EDITOR_FIELDS = Object.freeze({
    'pce-amount': { key: 'amount', type: 'number' },
    'pce-date': { key: 'date', type: 'date' },
    'pce-tienda': { key: 'paidTo', type: 'text' },
    'pce-rnc': { key: 'rncEmisor', type: 'text' },
    'pce-ncf': { key: 'ncf', type: 'text' },
    'pce-subtotal': { key: 'subtotal', type: 'number' },
    'pce-itbis': { key: 'itbis', type: 'number' },
    'pce-total': { key: 'total', type: 'number' },
    'pce-cat': { key: 'category', type: 'select' },
    'pce-desc': { key: 'description', type: 'text' },
    'pce-cliente': { key: 'cliente', type: 'text' },
    'pce-rnccli': { key: 'rncCliente', type: 'text' },
    'pce-descuento': { key: 'descuento', type: 'number' },
    'pce-propina': { key: 'propina', type: 'number' },
    'pce-exento': { key: 'exento', type: 'number' },
    'pce-itbisincl': { key: 'itbisIncluido', type: 'checkbox' },
    'pce-femision': { key: 'fechaEmision', type: 'date' },
    'pce-fvenc': { key: 'fechaVencimiento', type: 'date' },
    'pce-notas': { key: 'notas', type: 'textarea' },
    'pce-receipt': { key: 'hasReceipt', type: 'checkbox' }
});
export const EDITOR_FIELD_IDS = Object.freeze(Object.keys(EDITOR_FIELDS));
const ID_OF = Object.freeze(Object.fromEntries(Object.entries(EDITOR_FIELDS).map(([id, f]) => [f.key, id])));

export const EDITOR_CATEGORIES = Object.freeze(['Materiales', 'Transporte', 'Comida', 'Herramientas', 'Mano de obra', 'Combustible', 'Otros']);

/** Datos que el lector enmarca en la foto, en el orden de los chips. */
const BOX_FIELDS = Object.freeze([
    ['rncEmisor', 'RNC emisor'], ['ncf', 'NCF'], ['date', 'Fecha'], ['subtotal', 'Subtotal'], ['itbis', 'ITBIS'], ['total', 'Total']
]);
const LABELS = Object.freeze({
    paidTo: 'Comercio', rncEmisor: 'RNC emisor', ncf: 'NCF', date: 'Fecha', subtotal: 'Subtotal', itbis: 'ITBIS',
    propina: 'Propina', total: 'Total', descuento: 'Descuento', exento: 'Exento', cliente: 'Cliente', rncCliente: 'RNC del cliente',
    amount: 'Monto de caja', fechaEmision: 'Fecha de emisión', fechaVencimiento: 'Vencimiento', notas: 'Notas'
});
const INPUT_FOR_ISSUE = Object.freeze({
    total: 'pce-total', ncf: 'pce-ncf', rncEmisor: 'pce-rnc', rncCliente: 'pce-rnccli', date: 'pce-date', itbis: 'pce-itbis'
});
const RED_ISSUES = new Set(['client-rnc', 'ncf-duplicate']);
const WINDOW_SIZES = ['pequeña', 'media', 'grande'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rd = (n) => 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const pct = (n) => String(+Number(n).toFixed(2));
const hasBox = (box) => Array.isArray(box) && box.length === 4 && box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000);

function mergeDraft(mov, draft) {
    return draft && Object.keys(draft).length ? { ...mov, ...draft } : mov;
}

// ── imagen ──────────────────────────────────────────────────────────────
function fileInputs(disabled) {
    if (disabled) return '';
    return `<label class="pcn-tool"><span>Cámara</span>
            <input type="file" accept="image/*" capture="environment" onchange="window.pcPhotoEdit(this)" style="display:none;"></label>
        <label class="pcn-tool"><span>Imagen o PDF</span>
            <input type="file" accept="image/*,application/pdf" onchange="window.pcPhotoEdit(this)" style="display:none;"></label>`;
}

function viewerHTML(mov, { cerrada, ui, source }) {
    const hasPhoto = !!(mov.hasReceipt || mov.receiptStatus);
    if (!hasPhoto) {
        return `<div class="pcn-view" data-pcn-view>
            <div class="pcn-win pcn-win--empty" data-pcn-win data-size="${ui.size}" data-zoom="false">
                <p>Este gasto no tiene foto de factura</p>
                <div class="pcn-empty-actions">${fileInputs(cerrada)}</div>
            </div>
        </div>`;
    }
    const field = ui.field;
    const box = mov.ocrBoxes?.[field];
    const isPdf = source?.mime === 'application/pdf';
    const showBox = !isPdf && hasBox(box);
    let stage;
    if (source === undefined) stage = '<p class="pcn-msg">Cargando comprobante…</p>';
    else if (!source) stage = '<p class="pcn-msg">Comprobante no disponible en este momento. Verifica la conexión.</p>';
    else {
        const src = isPdf ? (source.preview || '') : source.url;
        const [y0, x0, y1, x1] = showBox ? box : [0, 0, 0, 0];
        const zoomOn = ui.zoom && showBox;
        const width = zoomOn ? Math.min(260, Math.max(112, 100 / (((x1 - x0) / 1000) * 1.1))) : 100;
        stage = `<div class="pcn-stage" style="width:${pct(width)}%">
            ${src ? `<img class="pcn-img" src="${esc(src)}" alt="Foto de la factura">` : ''}
            ${showBox ? `<div class="pcn-box" data-pcn-box style="left:${pct(x0 / 10)}%;top:${pct(y0 / 10)}%;width:${pct((x1 - x0) / 10)}%;height:${pct((y1 - y0) / 10)}%"><span class="pcn-tag">${esc(LABELS[field] || '')}</span></div>` : ''}
        </div>
        ${isPdf ? '<p class="pcn-msg pcn-msg--pdf">PDF: no hay recuadros. Abre el original con «Ver comprobante».</p>' : ''}`;
    }
    const chips = BOX_FIELDS.filter(([k]) => hasBox(mov.ocrBoxes?.[k]) && !isPdf).map(([k, label]) =>
        `<button type="button" class="pcn-chip" data-pcn-chip data-app-fn="pcEditorField" data-arg="${k}" aria-pressed="${k === field}">${label}</button>`).join('');
    const noBox = source && !showBox && !isPdf && field
        ? `<p class="pcn-note" data-pcn-nobox>«${esc(LABELS[field] || field)}» no tiene recuadro del lector. Revisa la foto y escríbelo.</p>` : '';
    return `<div class="pcn-view" data-pcn-view>
        <div class="pcn-win" data-pcn-win data-size="${ui.size}" data-zoom="${!!(ui.zoom && showBox)}">${stage}</div>
        ${chips ? `<div class="pcn-chips">${chips}</div>` : ''}
        <div class="pcn-tools">
            <button type="button" class="pcn-tool" data-app-fn="pcEditorSize">Imagen: ${WINDOW_SIZES[ui.size] || WINDOW_SIZES[1]}</button>
            ${showBox ? `<button type="button" class="pcn-tool" data-app-fn="pcEditorZoom">${ui.zoom ? 'Ver completa' : 'Ampliar'}</button>` : ''}
            <button type="button" class="pcn-tool" data-app-fn="pcViewReceipt" data-arg="${esc(mov.id)}">Ver comprobante</button>
            ${cerrada ? '' : `<button type="button" class="pcn-tool" data-app-fn="pcRescanReceipt" data-arg="${esc(mov.id)}">Reescanear</button>${fileInputs(false)}`}
        </div>
        ${noBox}
    </div>`;
}

// ── avisos ──────────────────────────────────────────────────────────────
function issueText(issue) {
    const d = issue.detail || {};
    const parts = [];
    if (issue.code === 'total-mismatch' || issue.code === 'itbis-rate') parts.push(`Leído ${rd(d.read)} · calculado ${rd(d.calc)}.`);
    else if (issue.code === 'client-rnc') parts.push(d.expected ? `RNC de la empresa: ${esc(d.expected)}.` : '');
    else if (d.read) parts.push(`Leído: ${esc(d.read)}.`);
    if (issue.hint) parts.push(esc(issue.hint));
    return parts.filter(Boolean).join(' ');
}

function fixLabel(issue, fix) {
    if (fix.kind === 'accept') return 'Dar por bueno';
    if (fix.kind === 'apply') {
        if (issue.code === 'date-outside-period') return `Usar ${formatPettyCashDate(fix.value)}`;
        return `Usar ${rd(fix.value)}`;
    }
    const names = { total: 'el total', ncf: 'el NCF', rncEmisor: 'el RNC', rncCliente: 'el RNC del cliente', date: 'la fecha', itbis: 'el ITBIS' };
    return `Escribir ${names[fix.field] || 'el dato'}`;
}

function issueCardHTML(issue, cerrada) {
    const tone = RED_ISSUES.has(issue.code) ? 'red' : 'amber';
    const fixes = fixesFor(issue);
    // Total e ITBIS leídos mal también se pueden escribir a mano.
    const manual = { 'total-mismatch': ['pce-total', 'el total'], 'itbis-rate': ['pce-itbis', 'el ITBIS'] }[issue.code];
    const buttons = cerrada ? '' : fixes.flatMap((fix, i) => (manual && i === fixes.length - 1
        ? [{ kind: 'manual' }, fix] : [fix])).map((fix) => {
        if (fix.kind === 'manual') return `<button type="button" class="pcn-fix" data-app-fn="pcEditorFocus" data-arg="${manual[0]}">Escribir ${manual[1]}</button>`;
        if (fix.kind === 'input') {
            const inputId = INPUT_FOR_ISSUE[fix.field];
            return inputId ? `<button type="button" class="pcn-fix" data-app-fn="pcEditorFocus" data-arg="${inputId}">${fixLabel(issue, fix)}</button>` : '';
        }
        return `<button type="button" class="pcn-fix" data-app-fn="pcEditorFix" data-arg="${issue.code}|${fix.kind}">${fixLabel(issue, fix)}</button>`;
    }).join('');
    const detail = issueText(issue);
    return `<div class="pcn-issue" data-pcn-issue="${issue.code}" data-tone="${tone}">
        <b>${esc(issue.message)}</b>${detail ? `<div class="pcn-issue-detail">${detail}</div>` : ''}
        ${buttons ? `<div class="pcn-fixes">${buttons}</div>` : ''}
    </div>`;
}

// ── formulario ──────────────────────────────────────────────────────────
function fieldHTML(id, label, mov, { cerrada, span = '', type = null, mode = 'text', warn = false, low = false } = {}) {
    const def = EDITOR_FIELDS[id];
    const value = mov[def.key] == null ? '' : mov[def.key];
    const kind = type || (def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text');
    const extra = def.type === 'number' ? ' step="0.01" inputmode="decimal"' : (mode === 'numeric' ? ' inputmode="numeric"' : '');
    return `<div class="pcn-field ${span}">
        <label class="pcn-label" for="${id}">${label}${low ? ' <span class="pcn-low" data-pcn-low title="El lector no está seguro de este dato"></span>' : ''}</label>
        <input id="${id}" class="pcn-input${warn ? ' is-warn' : ''}" type="${kind}"${extra} ${cerrada ? 'disabled' : ''} value="${esc(value)}">
    </div>`;
}

function itemsHTML(mov, ui) {
    const items = Array.isArray(mov.items) ? mov.items : [];
    if (!items.length) return '';
    const sum = items.reduce((a, it) => a + (Number(it?.precio) || 0), 0);
    const subtotal = num(mov.subtotal);
    const ok = subtotal !== null && Math.abs(sum - subtotal) <= 1;
    return `<section class="pcn-fold" data-pcn-items>
        <button type="button" class="pcn-fold-head" data-app-fn="pcEditorItems" aria-expanded="${!!ui.itemsOpen}">
            <span>Artículos (${items.length})</span>
            <span data-pcn-items-status data-ok="${ok}">Suma ${rd(sum)} · ${ok ? 'cuadra con el subtotal' : 'no cuadra con el subtotal'}</span>
        </button>
        ${ui.itemsOpen ? `<ul class="pcn-items">${items.map((it) => `<li><span>${esc(it?.cantidad ?? 1)}× ${esc(it?.descripcion || 'Artículo')}</span><b>${rd(it?.precio)}</b></li>`).join('')}</ul>` : ''}
    </section>`;
}

function confidenceHTML(mov, ui) {
    const conf = mov.ocrConfidence && typeof mov.ocrConfidence === 'object' ? mov.ocrConfidence : null;
    const keys = conf ? Object.keys(conf).filter((k) => typeof conf[k] === 'number') : [];
    const avg = keys.length ? Math.round(keys.reduce((a, k) => a + conf[k], 0) / keys.length * 100) : null;
    const color = (p) => (p >= 90 ? '#10b981' : p >= 75 ? '#f59e0b' : '#ef4444');
    const open = ui.secOpen === null || ui.secOpen === undefined ? keys.length > 0 : ui.secOpen;
    const body = keys.length
        ? `<div class="pcn-bar"><span style="width:${avg}%;background:${color(avg)}"></span></div>
           ${keys.map((k) => { const p = Math.round(conf[k] * 100); return `<div class="pcn-conf-row" data-pcn-conf-row><span>${esc(LABELS[k] || k)}</span><span class="pcn-bar"><span style="width:${p}%;background:${color(p)}"></span></span><b style="color:${color(p)}">${p} %</b></div>`; }).join('')}`
        : '<p class="pcn-note">Aún no disponible: el lector actual no informa qué tan seguro está de cada dato. Cuando lo haga, aquí aparecerá el nivel por campo y los dudosos se marcarán con un punto ámbar.</p>';
    return `<section class="pcn-fold" data-pcn-confidence>
        <button type="button" class="pcn-fold-head" data-app-fn="pcEditorSecurity" aria-expanded="${!!open}">
            <span>Seguridad de la lectura${avg !== null ? ` <b style="color:${color(avg)}">${avg} %</b>` : ''}</span>
        </button>
        ${open ? `<div class="pcn-fold-body">${body}</div>` : ''}
    </section>`;
}

function footerHTML(mov, cerrada) {
    return `<div class="pcn-footer">
        ${(mov.reviewPending && !cerrada) ? `<button type="button" class="pcn-btn pcn-btn--ok" data-app-fn="pcConfirmMovement" data-arg="${esc(mov.id)}">✓ Confirmar</button>` : ''}
        <button type="button" class="pcn-btn" data-app-fn="pcCancelMovementEdit">${cerrada ? 'Cerrar' : 'Cancelar'}</button>
        ${cerrada ? '' : '<button type="button" class="pcn-btn pcn-btn--primary" data-app-fn="pcSaveMovementEdit">Guardar cambios</button>'}
    </div>`;
}

function reposicionHTML(mov, cerrada) {
    return `<section class="pcn-editor" data-pcn-editor>
        <header class="pcn-head"><div><div class="pcn-title">Detalle de la reposición</div>${cerrada ? '<div class="pcn-sub">Periodo cerrado · solo lectura</div>' : ''}</div></header>
        <div class="pcn-body"><div class="pcn-form">
            <div class="pcn-grid">
                ${fieldHTML('pce-amount', 'Monto (RD$)', mov, { cerrada })}
                ${fieldHTML('pce-date', 'Fecha', mov, { cerrada })}
                ${fieldHTML('pce-desc', 'Nota', mov, { cerrada, span: 'pcn-c2' })}
            </div>
            ${footerHTML(mov, cerrada)}
        </div></div>
    </section>`;
}

/**
 * Lo que el editor está mostrando ahora: el estado derivado con sus avisos y si
 * «Más datos» y «Seguridad» están abiertos (en automático no guardan true/false).
 */
export function editorViewState(movement, { context = {}, ui = {}, showConfidence = false } = {}) {
    const mov = mergeDraft(movement, ui.draft);
    const review = movementReviewState(mov, context);
    const more = ui.more === null || ui.more === undefined ? review.issues.some((i) => i.code === 'client-rnc') : !!ui.more;
    const conf = showConfidence && mov.ocrConfidence && typeof mov.ocrConfidence === 'object';
    const hasConf = !!conf && Object.values(mov.ocrConfidence).some((v) => typeof v === 'number');
    const secOpen = ui.secOpen === null || ui.secOpen === undefined ? hasConf : !!ui.secOpen;
    return { mov, review, more, secOpen };
}

/**
 * @param {object} movement gasto o reposición guardados
 * @param {{cerrada?:boolean, context?:object, ui?:object, source?:object|null|undefined, showConfidence?:boolean}} options
 *   source: undefined = cargando, null = no disponible, {url, mime, preview} = lista
 */
export function receiptEditorHTML(movement, { cerrada = false, context = {}, ui = {}, source, showConfidence = false } = {}) {
    const view = { field: 'total', zoom: true, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {}, ...ui };
    const mov = mergeDraft(movement, view.draft);
    if (mov.type !== 'gasto') return reposicionHTML(mov, cerrada);

    const review = movementReviewState(mov, context);
    const state = RECEIPT_STATES[review.key];
    const hasPhoto = !!(mov.hasReceipt || mov.receiptStatus);
    const issueCodes = new Set(review.issues.map((i) => i.code));
    const notes = receiptNotes(mov).concat(review.notes.filter((n) => n.code === 'no-ncf'));
    const backup = hasPhoto ? receiptBackupState(mov) : null;
    const moreOpen = view.more === null || view.more === undefined ? issueCodes.has('client-rnc') : !!view.more;
    const total = num(mov.total);
    const amountDiff = total !== null && num(mov.amount) !== null && Math.abs(num(mov.amount) - total) > 0.005;
    const conf = showConfidence && mov.ocrConfidence && typeof mov.ocrConfidence === 'object' ? mov.ocrConfidence : {};
    const low = (key) => typeof conf[key] === 'number' && conf[key] < 0.8;
    const warn = {
        total: issueCodes.has('total-mismatch') || issueCodes.has('missing-total'),
        subtotal: issueCodes.has('total-mismatch'),
        itbis: issueCodes.has('total-mismatch') || issueCodes.has('itbis-rate'),
        rncCliente: issueCodes.has('client-rnc'),
        rncEmisor: issueCodes.has('rnc-invalid'),
        ncf: issueCodes.has('ncf-format') || issueCodes.has('ncf-duplicate'),
        date: issueCodes.has('date-outside-period'),
        amount: amountDiff
    };
    const f = (id, label, opts = {}) => {
        const key = EDITOR_FIELDS[id].key;
        return fieldHTML(id, label, mov, { cerrada, warn: !!warn[key], low: low(key), ...opts });
    };
    const catOptions = EDITOR_CATEGORIES.includes(mov.category) || !mov.category ? EDITOR_CATEGORIES : [mov.category, ...EDITOR_CATEGORIES];
    const extraCount = ['descuento', 'propina', 'exento'].filter((k) => num(mov[k]) > 0).length
        + (mov.itbisIncluido === true ? 1 : 0) + (mov.notas ? 1 : 0) + (mov.rncCliente ? 1 : 0);

    return `<section class="pcn-editor" data-pcn-editor>
        <header class="pcn-head">
            <div class="pcn-head-main">
                <div class="pcn-title">${esc(mov.paidTo || 'Nuevo gasto')}</div>
                <div class="pcn-sub" data-pcn-status><span class="pcn-dot" style="background:${state.color}"></span>${state.label} · ${esc(review.issues[0]?.message || state.hint)}</div>
                ${backup ? `<div class="pcn-sub" data-pcn-backup data-state="${backup.state}" title="${esc(backup.title)}">${backup.state === 'uploaded' ? '✓ Respaldado en la nube' : '⏳ Por subir · guardado en el teléfono'}</div>` : ''}
            </div>
        </header>
        <div class="pcn-body" onchange="window.pcEditorTouch?.()" onfocusin="window.pcEditorFocusIn?.(event)">
            ${viewerHTML(mov, { cerrada, ui: view, source })}
            <div class="pcn-form">
                ${review.issues.map((i) => issueCardHTML(i, cerrada)).join('')}
                ${notes.length ? `<div class="pcn-notes" data-pcn-notes>${notes.map((n) => `<div>${esc(n.message)}${n.hint ? ' ' + esc(n.hint) : ''}</div>`).join('')}</div>` : ''}
                <input id="pce-receipt" type="checkbox" hidden ${hasPhoto ? 'checked' : ''}>
                <div class="pcn-grid">
                    ${f('pce-tienda', 'Comercio', { span: 'pcn-c2' })}
                    ${f('pce-rnc', 'RNC del emisor', { mode: 'numeric' })}
                    ${f('pce-ncf', 'NCF')}
                    ${f('pce-date', 'Fecha')}
                    ${f('pce-subtotal', 'Subtotal')}
                    ${f('pce-itbis', 'ITBIS')}
                    ${f('pce-total', 'Total de la factura')}
                    <div class="pcn-field">
                        ${f('pce-amount', 'Descuenta de caja')}
                        ${amountDiff ? '<small class="pcn-hint" data-pcn-amount-diff>Distinto del total</small>' : ''}
                    </div>
                    <div class="pcn-field">
                        <label class="pcn-label" for="pce-cat">Categoría</label>
                        <select id="pce-cat" class="pcn-input" ${cerrada ? 'disabled' : ''}>${catOptions.map((c) => `<option ${mov.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
                    </div>
                    ${f('pce-desc', 'Descripción', { span: 'pcn-c2' })}
                </div>
                <section class="pcn-fold">
                    <button type="button" class="pcn-fold-head" data-app-fn="pcEditorMore" aria-expanded="${moreOpen}">
                        <span>Más datos${extraCount || warn.rncCliente ? ` <i class="pcn-badge${warn.rncCliente ? ' is-red' : ''}">${extraCount || '!'}</i>` : ''}</span>
                        <small>Cliente · descuento · propina · exento · fechas · notas</small>
                    </button>
                    <div class="pcn-grid pcn-fold-body" data-pcn-more ${moreOpen ? '' : 'hidden'}>
                        ${f('pce-cliente', 'Cliente', { span: 'pcn-c2' })}
                        ${f('pce-rnccli', 'RNC del cliente', { mode: 'numeric' })}
                        <label class="pcn-check"><input id="pce-itbisincl" type="checkbox" ${cerrada ? 'disabled' : ''} ${mov.itbisIncluido === true ? 'checked' : ''}> ITBIS incluido</label>
                        ${f('pce-descuento', 'Descuento')}
                        ${f('pce-propina', 'Propina')}
                        ${f('pce-exento', 'Exento')}
                        ${f('pce-femision', 'Fecha de emisión')}
                        ${f('pce-fvenc', 'Vencimiento')}
                        <div class="pcn-field pcn-c3">
                            <label class="pcn-label" for="pce-notas">Notas</label>
                            <textarea id="pce-notas" class="pcn-input" rows="2" ${cerrada ? 'disabled' : ''}>${esc(mov.notas || '')}</textarea>
                        </div>
                    </div>
                </section>
                ${itemsHTML(mov, view)}
                ${showConfidence ? confidenceHTML(mov, view) : ''}
                ${footerHTML(mov, cerrada)}
            </div>
        </div>
    </section>`;
}
