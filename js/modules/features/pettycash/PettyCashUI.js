/**
 * PettyCashUI — pantalla de Caja Chica (Fase 1, integración Paso 4 · opción C).
 *
 * State PLANO: { projects[], periods[], movements[] } (per-doc, enlazado por
 * projectId/periodId). La vista anidada se compone con selectores puros.
 *
 * Persistencia (opción C):
 *   - localStorage como caché local (offline básico, sin tocar el schema de
 *     IndexedDB todavía).
 *   - Firestore vía PettyCashRepository en cada cambio (si hay sesión).
 *   - PettyCashLiveSync aplica cambios remotos (multi-dispositivo).
 * La migración a stores propios de IndexedDB (opción A) queda para después.
 */

import { state } from '../../core/AppState.js';
import icons from '../../ui/IconSystem.js';
import { Modal } from '../../components/Modal.js';
import {
    resumenPeriodo, round2,
    periodsOfProject, movementsOfPeriod, saldoProyectoFlat
} from './PettyCashCalc.js';
import { PettyCashRepository } from '../../services/PettyCashRepository.js';
import { PettyCashLiveSync } from '../../services/PettyCashLiveSync.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { compressImage } from './PettyCashPhoto.js';
import { APP_CONFIG } from '../../config/Config.js';

const LS_KEY = '_pettycash_local_v2';
const CATEGORIAS = ['Materiales', 'Transporte', 'Comida', 'Herramientas', 'Mano de obra', 'Combustible', 'Otros'];

// ── state + persistencia local ───────────────────────────────────────
function _base() {
    return { projects: [], periods: [], movements: [], selectedProjectId: null, selectedPeriodId: null, form: null, periodForm: null, editMov: null };
}
function _loadLocal() {
    try {
        const d = JSON.parse(localStorage.getItem(LS_KEY));
        if (d && Array.isArray(d.projects) && Array.isArray(d.periods) && Array.isArray(d.movements)) {
            return { ..._base(), projects: d.projects, periods: d.periods, movements: d.movements,
                selectedProjectId: d.selectedProjectId || null, selectedPeriodId: d.selectedPeriodId || null };
        }
    } catch { /* noop */ }
    return _base();
}
function pc() {
    if (!state.pettyCash) state.pettyCash = _loadLocal();
    return state.pettyCash;
}
function persist() {
    try {
        const d = pc();
        localStorage.setItem(LS_KEY, JSON.stringify({
            projects: d.projects, periods: d.periods, movements: d.movements,
            selectedProjectId: d.selectedProjectId, selectedPeriodId: d.selectedPeriodId
        }));
    } catch { /* noop */ }
}

// ── sync a Firestore (no-op sin sesión) ──────────────────────────────
function _saveRemote(repo, item) {
    try { repo.saveOne(item).catch(e => console.warn('⚠️ PettyCash saveOne:', e)); }
    catch (e) { console.warn('⚠️ PettyCash saveOne:', e); }
}
function _deleteRemote(repo, id) {
    try { repo.deleteOne(id).catch(e => console.warn('⚠️ PettyCash deleteOne:', e)); }
    catch (e) { console.warn('⚠️ PettyCash deleteOne:', e); }
}
const saveProject  = (p) => _saveRemote(PettyCashRepository.projects, p);
const savePeriod   = (p) => _saveRemote(PettyCashRepository.periods, p);
const saveMovement = (m) => _saveRemote(PettyCashRepository.movements, m);

function dedupById(arr) {
    return arr ? [...new Map(arr.map(i => [i.id, i])).values()] : [];
}

// ── helpers varios ────────────────────────────────────────────────────
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function rd(n) { return 'RD$ ' + (Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function currentProject() {
    const d = pc();
    return d.projects.find(p => p.id === d.selectedProjectId) || null;
}
function currentPeriod() {
    const d = pc();
    return d.periods.find(p => p.id === d.selectedPeriodId) || null;
}

// ══ carga inicial + live sync (llamado desde app.js tras login) ════════
export async function startPettyCashSync() {
    const d = pc();
    try {
        const [projects, periods, movements] = await Promise.all([
            PettyCashRepository.projects.loadAll(),
            PettyCashRepository.periods.loadAll(),
            PettyCashRepository.movements.loadAll()
        ]);
        if (projects.length || periods.length || movements.length) {
            d.projects = dedupById(projects);
            d.periods = dedupById(periods);
            d.movements = dedupById(movements);
            persist();
            window.render?.();
        }
    } catch (e) {
        console.warn('⚠️ startPettyCashSync loadAll:', e);
    }

    PettyCashLiveSync.start({
        projects: {
            subscribe: (cb) => PettyCashRepository.projects.subscribe(cb),
            onApply: (list) => { pc().projects = dedupById(list); persist(); window.render?.(); }
        },
        periods: {
            subscribe: (cb) => PettyCashRepository.periods.subscribe(cb),
            onApply: (list) => { pc().periods = dedupById(list); persist(); window.render?.(); }
        },
        movements: {
            subscribe: (cb) => PettyCashRepository.movements.subscribe(cb),
            onApply: (list) => { pc().movements = dedupById(list); persist(); window.render?.(); }
        }
    });
}

// ══ render ═════════════════════════════════════════════════════════════
export function PettyCashTab() {
    const d = pc();
    // Auto-seleccionar el primer proyecto/periodo si no hay nada seleccionado
    // (en un dispositivo nuevo selectedProjectId viene null aunque haya datos).
    if (!d.selectedProjectId && d.projects.length) {
        d.selectedProjectId = d.projects[0].id;
    }
    if (d.selectedProjectId && !d.selectedPeriodId) {
        const pers = periodsOfProject(d.periods, d.selectedProjectId);
        if (pers.length) d.selectedPeriodId = pers[0].id;
    }
    const proj = currentProject();
    return `
    <div class="pc-wrap" style="max-width:980px;margin:0 auto;padding:16px;color:#e2e8f0;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
            <h2 style="margin:0;font-size:1.4rem;display:flex;align-items:center;gap:8px;">
                ${icons.get('dollar', { size: 22 })} Caja Chica
            </h2>
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
        <select onchange="window.pcSelectProject(this.value)"
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
            style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;">+ Proyecto</button>
    </div>`;
}

function _emptyProjects() {
    return `<div style="text-align:center;padding:48px 20px;color:#64748b;">
        <div style="font-size:3rem;opacity:.4;">🏗️</div>
        <p>Crea tu primer proyecto/obra para empezar.</p>
    </div>`;
}

function _projectBody(proj) {
    const d = pc();
    const periods = periodsOfProject(d.periods, proj.id);
    const totalProyecto = saldoProyectoFlat(d.movements, proj.id);
    const period = currentPeriod();

    const periodChips = periods.map(p => {
        const r = resumenPeriodo(movementsOfPeriod(d.movements, p.id));
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
            style="background:transparent;border:1px dashed #475569;color:#94a3b8;border-radius:10px;padding:10px 14px;cursor:pointer;min-width:120px;">+ Periodo</button>
    </div>
    ${period ? _periodPanel(period) : '<div style="color:#64748b;padding:20px 0;">Selecciona o crea un periodo de caja.</div>'}`;
}

function _periodPanel(period) {
    const d = pc();
    const movs = movementsOfPeriod(d.movements, period.id);
    const r = resumenPeriodo(movs);
    const cerrada = period.status === 'cerrada';
    const form = d.form;
    const periodForm = d.periodForm;
    const editMov = d.editMov ? movs.find(m => m.id === d.editMov) : null;

    return `
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div>
                <div style="font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:8px;">
                    ${esc(period.label)} ${cerrada ? '<span style="font-size:.7rem;color:#fbbf24;">🔒 cerrada</span>' : ''}
                    <button type="button" data-app-fn="pcEditPeriod" title="Editar nombre / fechas" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">✏️</button>
                    <button type="button" data-app-fn="pcDeletePeriod" title="Eliminar periodo" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:.85rem;">🗑️</button>
                </div>
                <div style="font-size:.72rem;color:#64748b;margin-top:4px;">📅 Apertura: ${esc(period.openingDate || '—')} · Cierre: ${esc(period.closingDate || '—')}</div>
            </div>
            ${cerrada ? '' : `
            <div style="display:flex;gap:8px;">
                <button type="button" data-app-fn="pcOpenForm" data-arg="reposicion" style="background:#22c55e;color:#062;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;">+ Reposición</button>
                <button type="button" data-app-fn="pcOpenForm" data-arg="gasto" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;">− Gasto</button>
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
        ${_movementsList(movs, cerrada)}

        ${cerrada ? '' : `<div style="margin-top:14px;text-align:right;">
            <button type="button" data-app-fn="pcClosePeriod" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.85rem;">🔒 Cerrar periodo</button>
        </div>`}
    </div>`;
}

function _conciliacionBlock(period) {
    const dif = Number(period.diferencia || 0);
    const estado = dif === 0 ? { t: 'Cuadra ✓', c: '#34d399' } : dif > 0 ? { t: 'Sobra', c: '#fbbf24' } : { t: 'Falta', c: '#f87171' };
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
                <input id="pc-per-label" type="text" value="${esc(period.label)}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de apertura
                <input id="pc-per-open" type="date" value="${esc(period.openingDate || today())}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha de cierre
                <input id="pc-per-close" type="date" value="${esc(period.closingDate || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelPeriodEdit" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSavePeriodEdit" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _movementForm(form) {
    const isGasto = form.type === 'gasto';
    return `
    <div style="background:#172033;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;margin-bottom:10px;">${isGasto ? '− Nuevo gasto' : '+ Nueva reposición'}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
            <label style="font-size:.75rem;color:#94a3b8;">Monto (RD$)
                <input id="pc-amount" type="number" inputmode="decimal" step="0.01" min="0" value="${form.amount || ''}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Fecha
                <input id="pc-date" type="date" value="${form.date || today()}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            ${isGasto ? `
            <label style="font-size:.75rem;color:#94a3b8;">Tienda / proveedor
                <input id="pc-tienda" type="text" value="${esc(form.paidTo || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.75rem;color:#94a3b8;">Categoría
                <select id="pc-cat" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">${CATEGORIAS.map(c => `<option ${form.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </label>
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción
                <input id="pc-desc" type="text" value="${esc(form.description || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;">
                <input id="pc-receipt" type="checkbox" ${form.hasReceipt ? 'checked' : ''}> 📷 Tiene foto/imagen de la factura
            </label>
            <div style="grid-column:1/-1;">
                <label style="font-size:.75rem;color:#94a3b8;display:block;margin-bottom:6px;">📷 Foto de la factura</label>
                ${form.photoDataUrl
                    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <img src="${form.photoDataUrl}" style="max-height:120px;border-radius:8px;border:1px solid #334155;">
                        <button type="button" data-app-fn="pcScanReceipt" style="background:#8b5cf6;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:700;cursor:pointer;">⚡ Escanear con IA</button>
                        <button type="button" data-app-fn="pcRemovePhotoNew" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;">Quitar</button>
                        ${form.scanStatus ? `<span style="font-size:.72rem;color:#94a3b8;">${esc(form.scanStatus)}</span>` : ''}
                       </div>`
                    : `<label style="display:inline-block;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:8px 12px;cursor:pointer;font-size:.85rem;">➕ Elegir / tomar foto<input type="file" accept="image/*" capture="environment" onchange="window.pcPhotoNew(this)" style="display:none;"></label>`}
            </div>` : `
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Nota (opcional)
                <input id="pc-desc" type="text" value="${esc(form.description || '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">
            </label>`}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button type="button" data-app-fn="pcCancelForm" style="background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:7px;padding:8px 14px;cursor:pointer;">Cancelar</button>
            <button type="button" data-app-fn="pcSaveMovement" style="background:#0ea5e9;color:#fff;border:none;border-radius:7px;padding:8px 16px;font-weight:600;cursor:pointer;">Guardar</button>
        </div>
    </div>`;
}

function _movementEditForm(mov, cerrada) {
    const isGasto = mov.type === 'gasto';
    const ro = cerrada ? 'disabled' : '';
    const inp = (id, val, type = 'text', extra = '') => `<input id="${id}" type="${type}" ${extra} ${ro} value="${esc(val ?? '')}" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">`;
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
            ${lab('Cliente (opcional)', inp('pce-cliente', mov.cliente))}
            ${lab('RNC cliente (opcional)', inp('pce-rnccli', mov.rncCliente))}
            ${lab('NCF · N° de comprobante fiscal', inp('pce-ncf', mov.ncf))}
            ${lab('Categoría', `<select id="pce-cat" ${ro} style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;">${CATEGORIAS.map(c => `<option ${mov.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Descripción${inp('pce-desc', mov.description)}</label>
            <label style="font-size:.8rem;color:#cbd5e1;display:flex;align-items:center;gap:8px;grid-column:1/-1;"><input id="pce-receipt" type="checkbox" ${ro} ${mov.hasReceipt ? 'checked' : ''}> 📷 Tiene foto/imagen de la factura</label>
            <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <label style="font-size:.75rem;color:#94a3b8;">📷 Comprobante:</label>
                ${pc()._editPhoto ? `<img src="${pc()._editPhoto}" style="max-height:90px;border-radius:8px;border:1px solid #0ea5e9;"><span style="font-size:.7rem;color:#34d399;">(nueva foto)</span>`
                    : (mov.receiptStatus ? `<button type="button" data-app-fn="pcViewReceipt" data-arg="${mov.id}" style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;">🧾 Ver comprobante</button>` : '<span style="font-size:.75rem;color:#64748b;">Sin foto</span>')}
                ${ro ? '' : `<label style="background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:.8rem;">${(mov.receiptStatus || pc()._editPhoto) ? '🔄 Cambiar foto' : '➕ Agregar foto'}<input type="file" accept="image/*" capture="environment" onchange="window.pcPhotoEdit(this)" style="display:none;"></label>`}
            </div>
            <div style="grid-column:1/-1;border-top:1px solid #334155;margin-top:6px;padding-top:10px;font-size:.72rem;color:#64748b;font-weight:700;letter-spacing:.04em;">DATOS FISCALES DE LA FACTURA</div>
            ${lab('Subtotal', inp('pce-subtotal', mov.subtotal, 'number', 'step="0.01"'))}
            ${lab('ITBIS', inp('pce-itbis', mov.itbis, 'number', 'step="0.01"'))}
            ${lab('Total', inp('pce-total', mov.total, 'number', 'step="0.01"'))}
            ${lab('Fecha emisión', inp('pce-femision', mov.fechaEmision, 'date'))}
            ${lab('Fecha vencimiento', inp('pce-fvenc', mov.fechaVencimiento, 'date'))}
            <label style="font-size:.75rem;color:#94a3b8;grid-column:1/-1;">Notas / detalles<textarea id="pce-notas" ${ro} rows="2" style="width:100%;margin-top:4px;background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px;color:#e2e8f0;resize:vertical;">${esc(mov.notas || '')}</textarea></label>
            ${(Array.isArray(mov.items) && mov.items.length) ? `<div style="grid-column:1/-1;border-top:1px solid #334155;margin-top:6px;padding-top:10px;"><div style="font-size:.72rem;color:#64748b;font-weight:700;letter-spacing:.04em;margin-bottom:6px;">ARTÍCULOS (${mov.items.length})</div>${mov.items.map(it => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.8rem;color:#cbd5e1;padding:2px 0;"><span>${esc((it.cantidad ? it.cantidad + '× ' : '') + (it.descripcion || '—'))}</span><span style="color:#94a3b8;white-space:nowrap;">${it.precio != null ? rd(it.precio) : ''}</span></div>`).join('')}</div>` : ''}
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

function _movementsList(movs, cerrada) {
    const list = (movs || []).slice().reverse();
    if (!list.length) return '<div style="color:#64748b;padding:14px 0;">Sin movimientos aún.</div>';
    return `<div style="display:flex;flex-direction:column;gap:6px;">
        ${list.map(m => {
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
                ${cerrada ? '' : `<button type="button" data-app-fn="pcDeleteMovement" data-arg="${m.id}" data-app-stop="1" aria-label="Eliminar" style="background:transparent;border:none;color:#64748b;cursor:pointer;font-size:1rem;padding:4px 6px;">✕</button>`}
            </div>`;
        }).join('')}
    </div>`;
}

// ══ handlers (window.*) ════════════════════════════════════════════════
export function registerPettyCashGlobals() {
    window.startPettyCashSync = startPettyCashSync;

    window.pcNewProject = async () => {
        const name = (await Modal.prompt({ title: '🏗️ Nuevo proyecto / obra', message: 'Nombre del proyecto u obra:', placeholder: 'Ej. Torre A', confirmText: 'Crear' }) || '').trim();
        if (!name) return;
        const d = pc();
        const p = { id: uid('proj'), name, status: 'activo', createdBy: 'app', updatedAt: Date.now() };
        d.projects.push(p);
        d.selectedProjectId = p.id;
        d.selectedPeriodId = null;
        persist(); saveProject(p); window.render?.();
    };

    window.pcSelectProject = (id) => {
        const d = pc();
        d.selectedProjectId = id || null;
        d.selectedPeriodId = null;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcEditProject = async () => {
        const proj = currentProject();
        if (!proj) return;
        const name = (await Modal.prompt({ title: '✏️ Renombrar proyecto', message: 'Nuevo nombre del proyecto:', defaultValue: proj.name, confirmText: 'Guardar' }) || '').trim();
        if (!name) return;
        proj.name = name; proj.updatedAt = Date.now();
        persist(); saveProject(proj); window.render?.();
    };

    window.pcDeleteProject = async () => {
        const d = pc();
        const proj = currentProject();
        if (!proj) return;
        const pers = periodsOfProject(d.periods, proj.id);
        const ok = await Modal.confirm({ title: '🗑️ Eliminar proyecto', message: `¿Eliminar el proyecto "${esc(proj.name)}"${pers.length ? ` y sus ${pers.length} periodo(s)` : ''}? No se puede deshacer.`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        // cascada: movimientos + periodos del proyecto
        d.movements.filter(m => m.projectId === proj.id).forEach(m => {
            if (m.receiptStatus) indexedDBService.deleteReceipt(m.id);
            _deleteRemote(PettyCashRepository.movements, m.id);
        });
        pers.forEach(p => _deleteRemote(PettyCashRepository.periods, p.id));
        _deleteRemote(PettyCashRepository.projects, proj.id);
        d.movements = d.movements.filter(m => m.projectId !== proj.id);
        d.periods = d.periods.filter(p => p.projectId !== proj.id);
        d.projects = d.projects.filter(p => p.id !== proj.id);
        d.selectedProjectId = null; d.selectedPeriodId = null; d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcNewPeriod = async () => {
        const proj = currentProject();
        if (!proj) return;
        const label = (await Modal.prompt({ title: '💵 Nuevo periodo de caja', message: 'Etiqueta del periodo:', placeholder: 'Ej. Quincena 1 - Enero', confirmText: 'Crear' }) || '').trim();
        if (!label) return;
        const d = pc();
        const per = { id: uid('per'), projectId: proj.id, label, status: 'abierta', openingDate: today(), closingDate: null, createdBy: 'app', updatedAt: Date.now() };
        d.periods.push(per);
        d.selectedPeriodId = per.id;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); savePeriod(per); window.render?.();
    };

    window.pcSelectPeriod = (id) => {
        const d = pc();
        d.selectedPeriodId = id;
        d.form = null; d.periodForm = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcEditPeriod = () => {
        if (!currentPeriod()) return;
        pc().periodForm = true; pc().form = null; pc().editMov = null;
        window.render?.();
    };
    window.pcCancelPeriodEdit = () => { pc().periodForm = null; window.render?.(); };
    window.pcSavePeriodEdit = () => {
        const period = currentPeriod();
        if (!period) return;
        const label = document.getElementById('pc-per-label')?.value?.trim();
        if (!label) { Modal.alert({ title: 'Nombre requerido', message: 'El nombre del periodo no puede estar vacío.' }); return; }
        period.label = label;
        period.openingDate = document.getElementById('pc-per-open')?.value || period.openingDate || today();
        period.closingDate = document.getElementById('pc-per-close')?.value || null;
        period.updatedAt = Date.now();
        pc().periodForm = null;
        persist(); savePeriod(period); window.render?.();
    };

    window.pcDeletePeriod = async () => {
        const d = pc();
        const period = currentPeriod();
        if (!period) return;
        const movs = movementsOfPeriod(d.movements, period.id);
        const ok = await Modal.confirm({ title: '🗑️ Eliminar periodo', message: `¿Eliminar el periodo "${esc(period.label)}"${movs.length ? ` y sus ${movs.length} movimiento(s)` : ''}? No se puede deshacer.`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        movs.forEach(m => {
            if (m.receiptStatus) indexedDBService.deleteReceipt(m.id);
            _deleteRemote(PettyCashRepository.movements, m.id);
        });
        _deleteRemote(PettyCashRepository.periods, period.id);
        d.movements = d.movements.filter(m => m.periodId !== period.id);
        d.periods = d.periods.filter(p => p.id !== period.id);
        d.selectedPeriodId = null; d.periodForm = null; d.form = null; d.editMov = null;
        persist(); window.render?.();
    };

    window.pcOpenForm = (type) => {
        pc().form = { type, amount: '', date: today(), category: CATEGORIAS[0], hasReceipt: false };
        pc().periodForm = null; pc().editMov = null;
        window.render?.();
    };
    window.pcCancelForm = () => { pc().form = null; window.render?.(); };

    window.pcSaveMovement = async () => {
        const d = pc();
        const period = currentPeriod();
        const form = d.form;
        if (!period || !form) return;
        const amount = parseFloat(document.getElementById('pc-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) { Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' }); return; }
        const photo = form.photoDataUrl || null;
        const mov = {
            id: uid('mov'), periodId: period.id, projectId: period.projectId,
            type: form.type, amount: round2(amount),
            date: document.getElementById('pc-date')?.value || today(),
            description: document.getElementById('pc-desc')?.value?.trim() || '',
            createdBy: 'app', updatedAt: Date.now()
        };
        if (form.type === 'gasto') {
            mov.paidTo = document.getElementById('pc-tienda')?.value?.trim() || '';
            mov.category = document.getElementById('pc-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pc-receipt')?.checked || !!photo;
            // Datos fiscales pre-extraídos por el OCR (no visibles en el form rápido)
            if (form.ocr) {
                if (form.ocr.rncEmisor) mov.rncEmisor = form.ocr.rncEmisor;
                if (form.ocr.ncf) mov.ncf = form.ocr.ncf;
                if (form.ocr.cliente) mov.cliente = form.ocr.cliente;
                if (form.ocr.rncCliente) mov.rncCliente = form.ocr.rncCliente;
                if (form.ocr.subtotal != null) mov.subtotal = form.ocr.subtotal;
                if (form.ocr.itbis != null) mov.itbis = form.ocr.itbis;
                if (form.ocr.total != null) mov.total = form.ocr.total;
                if (form.ocr.fechaEmision) mov.fechaEmision = form.ocr.fechaEmision;
                if (form.ocr.notas) mov.notas = form.ocr.notas;
                if (Array.isArray(form.ocr.items) && form.ocr.items.length) mov.items = form.ocr.items;
            }
        }
        d.movements.push(mov);
        d.form = null;
        persist(); saveMovement(mov); window.render?.();
        // Guardar la foto localmente en IndexedDB (cola para subir a Supabase vía n8n).
        if (photo && mov.type === 'gasto') {
            try {
                await indexedDBService.saveReceipt(mov.id, photo, 'pending');
                mov.receiptStatus = 'local'; mov.hasReceipt = true; mov.updatedAt = Date.now();
                persist(); saveMovement(mov); window.render?.();
            } catch (e) {
                console.warn('⚠️ saveReceipt local:', e);
                Modal.alert({ title: 'Foto', message: 'El gasto se guardó, pero la foto no se pudo guardar localmente.' });
            }
        }
    };

    window.pcOpenMovement = (movId) => {
        pc().editMov = movId; pc().form = null; pc().periodForm = null; pc()._editPhoto = null;
        window.render?.();
    };
    window.pcCancelMovementEdit = () => { pc().editMov = null; pc()._editPhoto = null; window.render?.(); };

    window.pcPhotoNew = async (input) => {
        const file = input?.files?.[0];
        if (!file || !pc().form) return;
        try { pc().form.photoDataUrl = await compressImage(file); pc().form.hasReceipt = true; window.render?.(); }
        catch (e) { console.warn('compressImage', e); Modal.alert({ title: 'Foto', message: 'No se pudo procesar la imagen.' }); }
    };
    window.pcRemovePhotoNew = () => { if (pc().form) { pc().form.photoDataUrl = null; pc().form.scanStatus = null; pc().form.ocr = null; window.render?.(); } };

    window.pcScanReceipt = async () => {
        const form = pc().form;
        if (!form || !form.photoDataUrl) return;
        const url = APP_CONFIG && APP_CONFIG.OCR_WEBHOOK_URL;
        if (!url) { Modal.alert({ title: 'OCR', message: 'No hay URL de OCR configurada.' }); return; }
        form.scanStatus = '⏳ Escaneando...';
        window.render?.();
        try {
            const base64 = String(form.photoDataUrl).split(',')[1] || form.photoDataUrl;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64 })
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            console.log('🤖 OCR respuesta:', data);
            if (!data || data.ok === false) throw new Error((data && data.error) || 'sin datos');
            const f = pc().form;
            if (!f) return;
            if (data.total != null) f.amount = data.total;
            else if (data.subtotal != null) f.amount = data.subtotal;
            if (data.emisor) f.paidTo = data.emisor;
            if (data.concepto) f.description = data.concepto;
            if (data.fecha) f.date = data.fecha;
            if (data.categoria && CATEGORIAS.includes(data.categoria)) f.category = data.categoria;
            f.ocr = {
                rncEmisor: data.rncEmisor ?? null, ncf: data.ncf ?? null,
                cliente: data.cliente ?? null, rncCliente: data.rncCliente ?? null,
                subtotal: data.subtotal ?? null, itbis: data.itbis ?? null,
                total: data.total ?? null, fechaEmision: data.fecha ?? null,
                notas: data.notas ?? null,
                items: Array.isArray(data.items) ? data.items : []
            };
            f.hasReceipt = true;
            const got = [data.emisor, data.total, data.ncf, data.fecha].some(v => v != null && v !== '');
            f.scanStatus = got ? '✅ Datos extraídos — revisa y guarda' : '⚠️ La IA no pudo leer datos de esta foto';
            window.render?.();
            // El re-render puede preservar los inputs existentes (no reescribe .value);
            // los seteamos directo tras el frame de render para garantizar que se vean.
            setTimeout(() => {
                const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = String(v); };
                setVal('pc-amount', f.amount);
                setVal('pc-tienda', f.paidTo);
                setVal('pc-desc', f.description);
                setVal('pc-date', f.date);
                const cat = document.getElementById('pc-cat');
                if (cat && f.category) cat.value = f.category;
            }, 60);
        } catch (e) {
            console.warn('OCR scan:', e);
            const f = pc().form;
            if (f) f.scanStatus = '❌ No se pudo escanear';
            window.render?.();
            Modal.alert({ title: 'Escaneo', message: 'No se pudo escanear la factura; llena los datos a mano. (' + (e.message || '') + ')' });
        }
    };

    window.pcPhotoEdit = async (input) => {
        const file = input?.files?.[0];
        if (!file) return;
        try { pc()._editPhoto = await compressImage(file); window.render?.(); }
        catch (e) { console.warn('compressImage', e); Modal.alert({ title: 'Foto', message: 'No se pudo procesar la imagen.' }); }
    };

    window.pcViewReceipt = async (movId) => {
        try {
            const rec = await indexedDBService.getReceipt(movId);
            if (!rec || !rec.dataUrl) {
                Modal.alert({ title: 'Comprobante', message: 'No hay foto guardada para este movimiento.' });
                return;
            }
            Modal.alert({ title: '🧾 Comprobante', message: `<img src="${rec.dataUrl}" style="max-width:100%;border-radius:8px;">` });
        } catch (e) {
            console.warn('getReceipt', e);
            Modal.alert({ title: 'Comprobante', message: 'No se pudo cargar la imagen.' });
        }
    };

    window.pcSaveMovementEdit = async () => {
        const d = pc();
        const mov = d.movements.find(m => m.id === d.editMov);
        if (!mov) return;
        const numOrNull = (id) => { const v = document.getElementById(id)?.value; return (v === '' || v == null) ? null : round2(parseFloat(v)); };
        const txt = (id) => document.getElementById(id)?.value?.trim() || '';
        const amount = parseFloat(document.getElementById('pce-amount')?.value);
        if (!Number.isFinite(amount) || amount <= 0) { Modal.alert({ title: 'Monto inválido', message: 'Ingresa un monto válido mayor que 0.' }); return; }
        mov.amount = round2(amount);
        mov.date = document.getElementById('pce-date')?.value || mov.date;
        mov.description = txt('pce-desc');
        if (mov.type === 'gasto') {
            mov.paidTo = txt('pce-tienda');
            mov.rncEmisor = txt('pce-rnc');
            mov.cliente = txt('pce-cliente');
            mov.rncCliente = txt('pce-rnccli');
            mov.ncf = txt('pce-ncf');
            mov.category = document.getElementById('pce-cat')?.value || '';
            mov.hasReceipt = !!document.getElementById('pce-receipt')?.checked;
            mov.subtotal = numOrNull('pce-subtotal');
            mov.itbis = numOrNull('pce-itbis');
            mov.total = numOrNull('pce-total');
            mov.fechaEmision = document.getElementById('pce-femision')?.value || null;
            mov.fechaVencimiento = document.getElementById('pce-fvenc')?.value || null;
            mov.notas = document.getElementById('pce-notas')?.value?.trim() || '';
        }
        mov.updatedAt = Date.now();
        const pendingPhoto = d._editPhoto;
        d.editMov = null; d._editPhoto = null;
        persist(); saveMovement(mov); window.render?.();
        // Subir foto reemplazada (si hay)
        if (pendingPhoto && mov.type === 'gasto') {
            try {
                await indexedDBService.saveReceipt(mov.id, pendingPhoto, 'pending');
                mov.receiptStatus = 'local'; mov.hasReceipt = true; mov.updatedAt = Date.now();
                persist(); saveMovement(mov); window.render?.();
            } catch (e) {
                console.warn('⚠️ saveReceipt local (edit):', e);
                Modal.alert({ title: 'Foto', message: 'Los cambios se guardaron, pero la foto no se pudo guardar localmente.' });
            }
        }
    };

    window.pcDeleteMovement = async (movId) => {
        const d = pc();
        const mov = d.movements.find(m => m.id === movId);
        if (!mov) return;
        const label = mov.type === 'gasto' ? (mov.paidTo || mov.description || 'gasto') : 'reposición';
        const ok = await Modal.confirm({ title: '🗑️ Eliminar movimiento', message: `¿Eliminar "${esc(label)}" de ${rd(mov.amount)}?`, confirmText: 'Eliminar', cancelText: 'Cancelar', type: 'danger' });
        if (!ok) return;
        if (mov.receiptStatus) indexedDBService.deleteReceipt(movId);
        _deleteRemote(PettyCashRepository.movements, movId);
        d.movements = d.movements.filter(m => m.id !== movId);
        persist(); window.render?.();
    };

    window.pcClosePeriod = async () => {
        const d = pc();
        const period = currentPeriod();
        if (!period) return;
        const r = resumenPeriodo(movementsOfPeriod(d.movements, period.id));
        const contadoStr = await Modal.prompt({ title: '🔒 Cerrar periodo — conciliación', message: `Saldo calculado: <b>${rd(r.saldo)}</b>. Ingresa el efectivo realmente contado (RD$):`, inputType: 'number', defaultValue: String(Math.max(0, r.saldo)), confirmText: 'Cerrar periodo', cancelText: 'Cancelar' });
        if (contadoStr === null) return;
        const contado = round2(parseFloat(contadoStr) || 0);
        const diferencia = round2(contado - r.saldo);
        period.status = 'cerrada';
        period.saldoFinal = r.saldo;
        period.efectivoContado = contado;
        period.diferencia = diferencia;
        period.closingDate = today();
        period.updatedAt = Date.now();
        persist(); savePeriod(period); window.render?.();
        const estado = diferencia === 0 ? 'Cuadra perfecto ✓' : diferencia > 0 ? `Sobra ${rd(diferencia)}` : `Falta ${rd(-diferencia)}`;
        Modal.alert({ title: 'Periodo cerrado', message: `Saldo calculado: ${rd(r.saldo)}<br>Efectivo contado: ${rd(contado)}<br><b>Diferencia: ${estado}</b>` });
    };
}
