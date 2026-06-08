/**
 * PettyCashUI — pantalla de Caja Chica (PROTOTIPO de prueba, Fase 1).
 *
 * ⚠️ TEMPORAL: persiste en localStorage (`_pettycash_prototype_v1`) solo para
 * poder probar la UX. La persistencia real (Firestore per-doc + IndexedDB +
 * sync) llega en el Paso 2/3 con PettyCashRepository/LiveSync (con TDD).
 *
 * Modelo: Proyecto → Periodo de caja → Movimiento.
 * Usa PettyCashCalc para todos los saldos.
 */

import { state } from '../../core/AppState.js';
import icons from '../../ui/IconSystem.js';
import { Modal } from '../../components/Modal.js';
import { resumenPeriodo, saldoProyecto, round2 } from './PettyCashCalc.js';

const LS_KEY = '_pettycash_prototype_v1';
const CATEGORIAS = ['Materiales', 'Transporte', 'Comida', 'Herramientas', 'Mano de obra', 'Combustible', 'Otros'];

// ── persistencia temporal ───────────────────────────────────────────
function _base() {
    return { projects: [], selectedProjectId: null, selectedPeriodId: null, form: null };
}
function _load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || _base(); }
    catch { return _base(); }
}
function pc() {
    if (!state.pettyCash) state.pettyCash = _load();
    return state.pettyCash;
}
function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(pc())); } catch { /* noop */ }
}
function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
function today() {
    return new Date().toISOString().slice(0, 10);
}
function rd(n) {
    return 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── lookups ──────────────────────────────────────────────────────────
function currentProject() {
    const d = pc();
    return d.projects.find(p => p.id === d.selectedProjectId) || null;
}
function currentPeriod() {
    const proj = currentProject();
    if (!proj) return null;
    return (proj.periods || []).find(p => p.id === pc().selectedPeriodId) || null;
}

// ── render ─────────────────────────────────────────────────────────────
export function PettyCashTab() {
    const d = pc();
    const proj = currentProject();

    return `
    <div class="pc-wrap" style="max-width:980px;margin:0 auto;padding:16px;color:#e2e8f0;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
            <h2 style="margin:0;font-size:1.4rem;display:flex;align-items:center;gap:8px;">
                ${icons.get('dollar', { size: 22 })} Caja Chica
            </h2>
            <span style="font-size:.72rem;background:rgba(245,158,11,.18);color:#fbbf24;border:1px solid rgba(245,158,11,.4);padding:3px 8px;border-radius:999px;">PROTOTIPO · datos locales</span>
        </div>

        ${_projectBar(d)}
        ${proj ? _projectBody(proj) : _emptyProjects()}
    </div>`;
}

function _projectBar(d) {
    const options = d.projects.map(p =>
        `<option value="${p.id}" ${p.id === d.selectedProjectId ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">
        <select data-app-fn="pcSelectProject" data-app-onchange="1"
            onchange="window.pcSelectProject(this.value)"
            style="flex:1;min-width:180px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:9px 12px;font-size:.95rem;">
            <option value="">— Selecciona un proyecto —</option>
            ${options}
        </select>
        ${d.selectedProjectId ? `
        <button type="button" data-app-fn="pcEditProject" title="Renombrar proyecto"
            style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:9px 12px;cursor:pointer;">✏️</button>
        <button type="button" data-app-fn="pcDeleteProject" title="Eliminar proyecto"
            style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:9px 12px;cursor:pointer;">🗑️</button>` : ''}
        <button type="button" data-app-fn="pcNewProject"
            style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;">
            + Proyecto
        </button>
    </div>`;
}

function _emptyProjects() {
    return `<div style="text-align:center;padding:48px 20px;color:#64748b;">
        <div style="font-size:3rem;opacity:.4;">🏗️</div>
        <p>Crea tu primer proyecto/obra para empezar.</p>
    </div>`;
}

function _projectBody(proj) {
    const periods = proj.periods || [];
    const totalProyecto = saldoProyecto(periods);
    const period = currentPeriod();

    const periodChips = periods.map(p => {
        const r = resumenPeriodo(p.movimientos);
        const active = period && p.id === period.id;
        const color = r.saldo < 0 ? '#f87171' : '#34d399';
        return `<button type="button" data-app-fn="pcSelectPeriod" data-arg="${p.id}"
            style="text-align:left;background:${active ? '#0f3a4d' : '#1e293b'};border:1px solid ${active ? '#0ea5e9' : '#334155'};border-radius:10px;padding:10px 12px;cursor:pointer;min-width:150px;">
            <div style="font-weight:600;font-size:.85rem;">${esc(p.label)} ${p.status === 'cerrada' ? '🔒' : ''}</div>
            <div style="color:${color};font-weight:700;margin-top:4px;">${rd(r.saldo)}</div>
        </button>`;
    }).join('');

    return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div style="font-size:.8rem;color:#94a3b8;">Saldo total del proyecto</div>
        <div style="font-size:1.25rem;font-weight:800;color:${totalProyecto < 0 ? '#f87171' : '#34d399'};">${rd(totalProyecto)}</div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;margin-bottom:18px;">
        ${periodChips}
        <button type="button" data-app-fn="pcNewPeriod"
            style="background:transparent;border:1px dashed #475569;color:#94a3b8;border-radius:10px;padding:10px 14px;cursor:pointer;min-width:120px;">
            + Periodo
        </button>
    </div>

    ${period ? _periodPanel(period) : '<div style="color:#64748b;padding:20px 0;">Selecciona o crea un periodo de caja.</div>'}`;
}

function _periodPanel(period) {
    const r = resumenPeriodo(period.movimientos);
    const cerrada = period.status === 'cerrada';
    const form = pc().form;
    const periodForm = pc().periodForm;
    const editMovId = pc().editMov;
    const editMov = editMovId ? (period.movimientos || []).find(m => m.id === editMovId) : null;

    return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
                <div style="font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:8px;">
                    ${esc(period.label)} ${cerrada ? '<span style="font-size:.7rem;color:#fbbf24;">🔒 cerrada</span>' : ''}
                    <button type="button" data-app-fn="pcEditPeriod" aria-label="Editar periodo" title="Editar nombre / fechas"
                        style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">✏️</button>
                    <button type="button" data-app-fn="pcDeletePeriod" aria-label="Eliminar periodo" title="Eliminar periodo"
                        style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">🗑️</button>
                </div>
                <div style="font-size:.72rem;color:#64748b;margin-top:4px;">
                    📅 Apertura: ${esc(period.openingDate || '—')} · Cierre: ${esc(period.closingDate || '—')}
                </div>
            </div>
            ${cerrada ? '' : `
            <div style="display:flex;gap:8px;">
                <button type="button" data-app-fn="pcOpenForm" data-arg="gasto"
                    style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;">− Gasto</button>
                <button type="button" data-app-fn="pcOpenForm" data-arg="reposicion"
                    style="background:#22c55e;color:#062;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">+ Reposición</button>
            </div>`}
        </div>

        ${periodForm ? _periodEditForm(period) : ''}

        <div style="display:flex;gap:18px;flex-wrap:wrap;margin:14px 0;padding:12px;background:#1e293b;border-radius:10px;">
            <div><div style="font-size:.7rem;color:#94a3b8;">Saldo</div><div style="font-weight:800;font-size:1.2rem;color:${r.saldo < 0 ? '#f87171' : '#34d399'};">${rd(r.saldo)}</div></div>
            <div><div style="font-size:.7rem;color:#94a3b8;">Reposiciones</div><div style="font-weight:600;color:#34d399;">${rd(r.reposiciones)}</div></div>
            <div><div style="font-size:.7rem;color:#94a3b8;">Gastos</div><div style="font-weight:600;color:#f87171;">${rd(r.gastos)}</div></div>
            ${r.reembolso > 0 ? `<div><div style="font-size:.7rem;color:#fbbf24;">Por reembolsar</div><div style="font-weight:800;color:#fbbf24;">${rd(r.reembolso)}</div></div>` : ''}
        </div>

        ${cerrada && period.efectivoContado !== undefined && period.efectivoContado !== null ? _conciliacionBlock(period) : ''}

        ${form && !cerrada ? _movementForm(form) : ''}

        ${editMov ? _movementEditForm(editMov, cerrada) : ''}

        ${_movementsList(period, cerrada)}

        ${cerrada ? '' : `<div style="margin-top:14px;text-align:right;">
            <button type="button" data-app-fn="pcClosePeriod"
                style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.85rem;">🔒 Cerrar periodo</button>
        </div>`}
    </div>`;
}

function _movementForm(form) {
    const isGasto = form.type === 'gasto';
    return `
    <div style="background:#172033;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;margin-bottom:10px;">${isGasto ? '− Nuevo gasto' : '+ Nueva reposición'}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            <label style="font-size:.75rem;color:#94a3b8;">Monto (RD$)
                <input id="pc-amount" type="number" inputmode="decimal" step="0.01" min="0" value="${form.amount || ''}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha
                <input id="pc-date" type="date" value="${form.date || today()}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            ${isGasto ? `
            <label style="font-size:.75rem;color:#94a3b8;">Tienda / proveedor
                <input id="pc-tienda" type="text" value="${esc(form.paidTo || '')}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Categoría
                <select id="pc-cat" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
                    ${CATEGORIAS.map(c => `<option ${form.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </label>
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción
                <input id="pc-desc" type="text" value="${esc(form.description || '')}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;">
                <input id="pc-receipt" type="checkbox" ${form.hasReceipt ? 'checked' : ''}> Tiene comprobante (factura)
            </label>` : `
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nota (opcional)
                <input id="pc-desc" type="text" value="${esc(form.description || '')}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>`}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelForm" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSaveMovement" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _conciliacionBlock(period) {
    const dif = Number(period.diferencia || 0);
    const estado = dif === 0
        ? { t: 'Cuadra ✓', c: '#34d399' }
        : dif > 0
            ? { t: 'Sobra', c: '#fbbf24' }
            : { t: 'Falta', c: '#f87171' };
    return `<div style="display:flex;gap:18px;flex-wrap:wrap;margin:0 0 14px;padding:12px;background:#172033;border:1px solid #334155;border-radius:10px;">
        <div><div style="font-size:.7rem;color:#94a3b8;">Efectivo contado</div><div style="font-weight:700;">${rd(period.efectivoContado)}</div></div>
        <div><div style="font-size:.7rem;color:#94a3b8;">Saldo calculado</div><div style="font-weight:700;">${rd(period.saldoFinal)}</div></div>
        <div><div style="font-size:.7rem;color:${estado.c};">Diferencia · ${estado.t}</div><div style="font-weight:800;color:${estado.c};">${rd(dif)}</div></div>
    </div>`;
}

function _periodEditForm(period) {
    return `
    <div style="background:#172033;border:1px solid #334155;border-radius:10px;padding:14px;margin:12px 0;">
        <div style="font-weight:700;margin-bottom:10px;">✏️ Editar periodo</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nombre / etiqueta
                <input id="pc-per-label" type="text" value="${esc(period.label)}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de apertura
                <input id="pc-per-open" type="date" value="${esc(period.openingDate || today())}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de cierre
                <input id="pc-per-close" type="date" value="${esc(period.closingDate || '')}"
                    style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelPeriodEdit" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSavePeriodEdit" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _movementEditForm(mov, cerrada) {
    const isGasto = mov.type === 'gasto';
    const ro = cerrada ? 'disabled' : '';
    const inp = (id, val, type = 'text', extra = '') =>
        `<input id="${id}" type="${type}" ${extra} ${ro} value="${esc(val ?? '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">`;
    const lab = (text, field) => `<label style="font-size:.75rem;color:#94a3b8;">${text}${field}</label>`;

    return `
    <div style="background:#172033;border:1px solid #0ea5e9;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;margin-bottom:10px;">${isGasto ? '🏪 Detalle del gasto' : '💰 Detalle de la reposición'}${cerrada ? ' <span style="font-size:.7rem;color:#fbbf24;">(periodo cerrado · solo lectura)</span>' : ''}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            ${lab('Monto (RD$)', inp('pce-amount', mov.amount, 'number', 'step="0.01" min="0" inputmode="decimal"'))}
            ${lab('Fecha del movimiento', inp('pce-date', mov.date || today(), 'date'))}
            ${isGasto ? `
            ${lab('Tienda / proveedor', inp('pce-tienda', mov.paidTo))}
            ${lab('RNC / comprobante de la empresa', inp('pce-rnc', mov.rncEmisor))}
            ${lab('NCF · N° de comprobante fiscal', inp('pce-ncf', mov.ncf))}
            ${lab('Categoría', `<select id="pce-cat" ${ro} style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">${CATEGORIAS.map(c => `<option ${mov.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción${inp('pce-desc', mov.description)}</label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;"><input id="pce-receipt" type="checkbox" ${ro} ${mov.hasReceipt ? 'checked' : ''}> Tiene comprobante (factura)</label>
            <div style="grid-column:1/-1;border-top:1px solid #334155;margin-top:6px;padding-top:10px;font-size:.72rem;color:#64748b;font-weight:700;letter-spacing:.04em;">DATOS FISCALES DE LA FACTURA</div>
            ${lab('Subtotal', inp('pce-subtotal', mov.subtotal, 'number', 'step="0.01"'))}
            ${lab('ITBIS', inp('pce-itbis', mov.itbis, 'number', 'step="0.01"'))}
            ${lab('Total', inp('pce-total', mov.total, 'number', 'step="0.01"'))}
            ${lab('Fecha emisión', inp('pce-femision', mov.fechaEmision, 'date'))}
            ${lab('Fecha vencimiento', inp('pce-fvenc', mov.fechaVencimiento, 'date'))}
            ` : `
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nota${inp('pce-desc', mov.description)}</label>
            `}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelMovementEdit" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">${cerrada ? 'Cerrar' : 'Cancelar'}</button>
            ${cerrada ? '' : `<button type="button" data-app-fn="pcSaveMovementEdit" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar cambios</button>`}
        </div>
    </div>`;
}

function _movementsList(period, cerrada) {
    const movs = (period.movimientos || []).slice().reverse();
    if (!movs.length) return '<div style="color:#64748b;padding:14px 0;">Sin movimientos aún.</div>';

    return `<div style="display:flex;flex-direction:column;gap:6px;">
        ${movs.map(m => {
            const isGasto = m.type === 'gasto';
            const sign = isGasto ? '−' : '+';
            const color = isGasto ? '#f87171' : '#34d399';
            const titulo = isGasto ? (m.paidTo || m.description || 'Gasto') : 'Reposición';
            return `<div data-app-fn="pcOpenMovement" data-arg="${m.id}" role="button" tabindex="0" title="Ver / editar detalle"
                style="display:flex;align-items:center;gap:10px;background:#0f172a;border:1px solid #1e293b;border-radius:9px;padding:10px 12px;cursor:pointer;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:6px;">
                        ${isGasto ? '🏪' : '💰'} ${esc(titulo)}
                        ${isGasto && m.hasReceipt ? '<span title="Tiene comprobante">🧾</span>' : ''}
                        ${isGasto && m.category ? `<span style="font-size:.68rem;background:#1e293b;border:1px solid #334155;padding:1px 7px;border-radius:999px;color:#94a3b8;">${esc(m.category)}</span>` : ''}
                    </div>
                    <div style="font-size:.72rem;color:#64748b;">📅 ${esc(m.date)}${isGasto && m.ncf ? ' · NCF: ' + esc(m.ncf) : ''}${m.description && isGasto && m.paidTo ? ' · ' + esc(m.description) : ''}</div>
                </div>
                <div style="font-weight:800;color:${color};white-space:nowrap;">${sign} ${rd(m.amount)}</div>
                ${cerrada ? '' : `<button type="button" data-app-fn="pcDeleteMovement" data-arg="${m.id}" data-app-stop="1" aria-label="Eliminar"
                    style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:1rem;padding:4px 6px;">✕</button>`}
            </div>`;
        }).join('')}
    </div>`;
}

// ── handlers (window.*) ──────────────────────────────────────────────
export function registerPettyCashGlobals() {
    window.pcNewProject = async () => {
        const name = (await Modal.prompt({
            title: '🏗️ Nuevo proyecto / obra',
            message: 'Nombre del proyecto u obra:',
            placeholder: 'Ej. Torre A',
            confirmText: 'Crear'
        }) || '').trim();
        if (!name) return;
        const d = pc();
        const p = { id: uid('proj'), name, periods: [] };
        d.projects.push(p);
        d.selectedProjectId = p.id;
        d.selectedPeriodId = null;
        save(); window.render?.();
    };

    window.pcSelectProject = (id) => {
        const d = pc();
        d.selectedProjectId = id || null;
        d.selectedPeriodId = null;
        d.form = null;
        save(); window.render?.();
    };

    window.pcNewPeriod = async () => {
        const proj = currentProject();
        if (!proj) return;
        const label = (await Modal.prompt({
            title: '💵 Nuevo periodo de caja',
            message: 'Etiqueta del periodo:',
            placeholder: 'Ej. Quincena 1 - Enero',
            confirmText: 'Crear'
        }) || '').trim();
        if (!label) return;
        const per = { id: uid('per'), label, status: 'abierta', openingDate: today(), closingDate: null, movimientos: [] };
        proj.periods.push(per);
        pc().selectedPeriodId = per.id;
        pc().form = null;
        pc().periodForm = null;
        save(); window.render?.();
    };

    window.pcSelectPeriod = (id) => {
        pc().selectedPeriodId = id;
        pc().form = null;
        pc().periodForm = null;
        pc().editMov = null;
        save(); window.render?.();
    };

    window.pcOpenForm = (type) => {
        pc().form = { type, amount: '', date: today(), category: CATEGORIAS[0], hasReceipt: false };
        pc().periodForm = null;
        pc().editMov = null;
        window.render?.();
    };

    window.pcOpenMovement = (movId) => {
        pc().editMov = movId;
        pc().form = null;
        pc().periodForm = null;
        window.render?.();
    };

    window.pcCancelMovementEdit = () => { pc().editMov = null; window.render?.(); };

    window.pcSaveMovementEdit = () => {
        const period = currentPeriod();
        if (!period) return;
        const mov = (period.movimientos || []).find(m => m.id === pc().editMov);
        if (!mov) return;
        const numOrNull = (id) => {
            const v = document.getElementById(id)?.value;
            return (v === '' || v == null) ? null : round2(parseFloat(v));
        };
        const txt = (id) => document.getElementById(id)?.value?.trim() || '';
        const amount = parseFloat(document.getElementById('pce-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) {
            Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' });
            return;
        }
        mov.amount = round2(amount);
        mov.date = document.getElementById('pce-date')?.value || mov.date;
        mov.description = txt('pce-desc');
        if (mov.type === 'gasto') {
            mov.paidTo = txt('pce-tienda');
            mov.rncEmisor = txt('pce-rnc');
            mov.ncf = txt('pce-ncf');
            mov.category = document.getElementById('pce-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pce-receipt')?.checked;
            mov.subtotal = numOrNull('pce-subtotal');
            mov.itbis = numOrNull('pce-itbis');
            mov.total = numOrNull('pce-total');
            mov.fechaEmision = document.getElementById('pce-femision')?.value || null;
            mov.fechaVencimiento = document.getElementById('pce-fvenc')?.value || null;
        }
        pc().editMov = null;
        save(); window.render?.();
    };

    window.pcEditPeriod = () => {
        if (!currentPeriod()) return;
        pc().periodForm = true;
        pc().form = null;
        window.render?.();
    };

    window.pcCancelPeriodEdit = () => { pc().periodForm = null; window.render?.(); };

    window.pcSavePeriodEdit = () => {
        const period = currentPeriod();
        if (!period) return;
        const label = document.getElementById('pc-per-label')?.value?.trim();
        if (!label) {
            Modal.alert({ title: 'Nombre requerido', message: 'El nombre del periodo no puede estar vacío.' });
            return;
        }
        period.label = label;
        period.openingDate = document.getElementById('pc-per-open')?.value || period.openingDate || today();
        const close = document.getElementById('pc-per-close')?.value || '';
        period.closingDate = close || null;
        pc().periodForm = null;
        save(); window.render?.();
    };

    window.pcDeletePeriod = async () => {
        const proj = currentProject();
        const period = currentPeriod();
        if (!proj || !period) return;
        const n = (period.movimientos || []).length;
        const ok = await Modal.confirm({
            title: '🗑️ Eliminar periodo',
            message: `¿Eliminar el periodo "${esc(period.label)}"${n ? ` y sus ${n} movimiento(s)` : ''}? No se puede deshacer.`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!ok) return;
        proj.periods = proj.periods.filter(p => p.id !== period.id);
        pc().selectedPeriodId = null;
        pc().periodForm = null;
        pc().form = null;
        save(); window.render?.();
    };

    window.pcCancelForm = () => { pc().form = null; window.render?.(); };

    window.pcSaveMovement = () => {
        const period = currentPeriod();
        const form = pc().form;
        if (!period || !form) return;
        const amount = parseFloat(document.getElementById('pc-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) {
            Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' });
            return;
        }
        const date = document.getElementById('pc-date')?.value || today();
        const description = document.getElementById('pc-desc')?.value?.trim() || '';
        const mov = { id: uid('mov'), type: form.type, amount, date, description };
        if (form.type === 'gasto') {
            mov.paidTo = document.getElementById('pc-tienda')?.value?.trim() || '';
            mov.category = document.getElementById('pc-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pc-receipt')?.checked;
        }
        period.movimientos.push(mov);
        pc().form = null;
        save(); window.render?.();
    };

    window.pcDeleteMovement = async (movId) => {
        const period = currentPeriod();
        if (!period) return;
        const mov = (period.movimientos || []).find(m => m.id === movId);
        if (!mov) return;
        const label = mov.type === 'gasto' ? (mov.paidTo || mov.description || 'gasto') : 'reposición';
        const ok = await Modal.confirm({
            title: '🗑️ Eliminar movimiento',
            message: `¿Eliminar "${esc(label)}" de ${rd(mov.amount)}?`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!ok) return;
        period.movimientos = (period.movimientos || []).filter(m => m.id !== movId);
        save(); window.render?.();
    };

    window.pcClosePeriod = async () => {
        const period = currentPeriod();
        if (!period) return;
        const r = resumenPeriodo(period.movimientos);
        const contadoStr = await Modal.prompt({
            title: '🔒 Cerrar periodo — conciliación',
            message: `Saldo calculado: <b>${rd(r.saldo)}</b>. Ingresa el efectivo realmente contado (RD$):`,
            inputType: 'number',
            defaultValue: String(Math.max(0, r.saldo)),
            confirmText: 'Cerrar periodo',
            cancelText: 'Cancelar'
        });
        if (contadoStr === null) return; // canceló
        const contado = round2(parseFloat(contadoStr) || 0);
        const diferencia = round2(contado - r.saldo);
        period.status = 'cerrada';
        period.saldoFinal = r.saldo;
        period.efectivoContado = contado;
        period.diferencia = diferencia;
        period.closingDate = today();
        save(); window.render?.();
        const estado = diferencia === 0 ? 'Cuadra perfecto ✓' : diferencia > 0 ? `Sobra ${rd(diferencia)}` : `Falta ${rd(-diferencia)}`;
        Modal.alert({
            title: 'Periodo cerrado',
            message: `Saldo calculado: ${rd(r.saldo)}<br>Efectivo contado: ${rd(contado)}<br><b>Diferencia: ${estado}</b>`
        });
    };

    window.pcEditProject = async () => {
        const proj = currentProject();
        if (!proj) return;
        const name = (await Modal.prompt({
            title: '✏️ Renombrar proyecto',
            message: 'Nuevo nombre del proyecto:',
            defaultValue: proj.name,
            confirmText: 'Guardar'
        }) || '').trim();
        if (!name) return;
        proj.name = name;
        save(); window.render?.();
    };

    window.pcDeleteProject = async () => {
        const d = pc();
        const proj = currentProject();
        if (!proj) return;
        const np = (proj.periods || []).length;
        const ok = await Modal.confirm({
            title: '🗑️ Eliminar proyecto',
            message: `¿Eliminar el proyecto "${esc(proj.name)}"${np ? ` y sus ${np} periodo(s)` : ''}? No se puede deshacer.`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            type: 'danger'
        });
        if (!ok) return;
        d.projects = d.projects.filter(p => p.id !== proj.id);
        d.selectedProjectId = null;
        d.selectedPeriodId = null;
        d.form = null;
        d.periodForm = null;
        save(); window.render?.();
    };
}
