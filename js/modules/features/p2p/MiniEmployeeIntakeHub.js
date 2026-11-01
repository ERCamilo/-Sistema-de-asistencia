import { escapeHTML as esc, escapeAttr } from '../../utils/Sanitize.js';
import { DOMDiff } from '../../utils/DOMDiff.js';
import { summarizeIntakeGroups } from './MiniEmployeeIntakeGroups.js';

const ICONS = {
    back: '<path d="m15 18-6-6 6-6"/>',
    mini: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    text: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const button = (label, attrs, kind = 'primary') => `<button type="button" class="sa-p2p-button sa-p2p-button-${kind}" ${attrs}><span>${label}</span></button>`;
const backButton = attrs => `<button type="button" class="sa-p2p-back" ${attrs}>${icon('back', 17)}<span>Volver</span></button>`;
const formatDate = value => { const date = new Date(value || ''); return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO') : 'Sin fecha'; };

/**
 * One place for every pending personnel proposal: one row per Mini and one for pasted
 * text. A group with several shipments asks which one to open.
 */
export function renderIntakeHub(host, { groups, projectName = '', onOpenEntry, onBack }) {
    let openKey = null;
    const entryRows = group => group.entries.map(entry => {
        const pending = entry.payload.employees.length - (entry.mappings?.length || 0);
        return `<div class="sa-p2p-peer-row"><div class="sa-p2p-peer-avatar">${icon(group.kind)}</div><div class="sa-p2p-peer-copy"><div class="sa-p2p-peer-header-line"><strong>${plural(pending, 'empleado pendiente', 'empleados pendientes')}</strong></div><div class="sa-p2p-peer-meta">${esc(formatDate(entry.receivedAt))}${entry.local ? ' · Preparado desde la asistencia' : ''}</div></div><div class="sa-p2p-device-actions">${button('Revisar', `data-intake-entry-open="${escapeAttr(entry.id)}"`)}</div></div>`;
    }).join('');
    const groupRows = () => groups.map(group => {
        const blocked = group.otherProject;
        return `<div class="sa-p2p-peer-row" data-intake-group="${escapeAttr(group.key)}"><div class="sa-p2p-peer-avatar">${icon(group.kind)}</div><div class="sa-p2p-peer-copy"><div class="sa-p2p-peer-header-line"><strong>${esc(group.label)}</strong>${group.kind === 'text' ? '<span class="sa-p2p-peer-type">Pegado</span>' : ''}</div><div class="sa-p2p-peer-meta">${plural(group.pendingEmployees, 'empleado pendiente', 'empleados pendientes')} · ${plural(group.entries.length, 'envío', 'envíos')}${blocked ? ' · Cambia a la obra de destino' : ''}</div></div><div class="sa-p2p-device-actions">${button('Revisar', `data-intake-group-open="${escapeAttr(group.key)}" ${blocked ? 'disabled' : ''}`)}</div></div>`;
    }).join('');
    const render = () => {
        const group = groups.find(candidate => candidate.key === openKey);
        const summary = summarizeIntakeGroups(groups);
        DOMDiff.apply(host, group
            ? `<section class="sa-p2p-step sa-mini-intake-hub">${backButton('data-intake-hub-back')}<div><h3>${esc(group.label)}</h3><p>Elige qué envío revisar.</p></div><div class="sa-p2p-peer-list">${entryRows(group)}</div></section>`
            : `<section class="sa-p2p-step sa-mini-intake-hub">${backButton('data-intake-hub-back')}<div><h3>Personal por revisar</h3><p>${esc(projectName || 'Obra seleccionada')}</p></div>
                ${groups.length ? `<div class="sa-p2p-status" data-intake-hub-summary role="status">${esc(summary.text)}</div><div class="sa-p2p-peer-list">${groupRows()}</div>` : '<div class="sa-p2p-empty">No hay personal por revisar.</div>'}</section>`);
        host.querySelector('[data-intake-hub-back]').onclick = () => { if (openKey) { openKey = null; render(); } else onBack?.(); };
        host.querySelectorAll('[data-intake-group-open]').forEach(el => el.onclick = () => {
            const target = groups.find(candidate => candidate.key === el.dataset.intakeGroupOpen);
            if (!target || el.disabled) return;
            if (target.entries.length === 1) onOpenEntry?.(target.entries[0]); else { openKey = target.key; render(); }
        });
        host.querySelectorAll('[data-intake-entry-open]').forEach(el => el.onclick = () => {
            const entry = group?.entries.find(candidate => candidate.id === el.dataset.intakeEntryOpen);
            if (entry) onOpenEntry?.(entry);
        });
    };
    render();
}
