import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { voiceIcon, voiceEmployeeCard } from './VoiceVisuals.js';

const paths = {
    settings: '<path d="m10 3-1 3-3 1-3-1-1 4 2 2-1 3 3 2 3-1 2 3 4-1 1-3 3-1 1-4-3-2-1-3Z"/><circle cx="11" cy="11" r="3"/>',
    users: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-18a3 3 0 0 1 0 6m2 12v-4a5 5 0 0 0-2-4"/>',
    wave: '<path d="M3 10v4m4-7v10m5-15v20m5-16v12m4-8v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>', back: '<path d="m14 5-7 7 7 7"/>',
    edit: '<path d="m15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z"/>', plus: '<path d="M12 5v14M5 12h14"/>'
};
export const vsIcon = name => paths[name] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>` : voiceIcon(name);
export const vsArrow = () => `<span class="vs-arrow">${vsIcon('chevron')}</span>`;
export function vsButton(action, label, { value = '', primary = false, danger = false, disabled = false, icon = '' } = {}) {
    return `<button type="button" class="vs-btn${primary ? ' vs-primary' : ''}${danger ? ' vs-danger' : ''}" data-vs-action="${action}" data-value="${escapeAttr(value)}" ${disabled ? 'disabled' : ''}>${icon ? vsIcon(icon) : ''}${escapeHTML(label)}</button>`;
}
export function vsIconButton(action, icon, label, value = '', disabled = false) {
    return `<button type="button" class="vs-icon-button" data-vs-action="${action}" data-value="${escapeAttr(value)}" aria-label="${escapeAttr(label)}" ${disabled ? 'disabled' : ''}>${vsIcon(icon)}</button>`;
}
export const vsIdentity = (ui, employee) => voiceEmployeeCard(employee, '', ui.adapter.getPositions?.() || []);
export const vsFeedback = () => '<p class="vs-feedback" data-vs-feedback role="status" aria-live="polite"></p>';
export function vsDate(timestamp, timeZone) {
    try { const date = new Date(timestamp); return Number.isFinite(date.getTime()) ? date.toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }) : 'Fecha no disponible'; }
    catch (_) { return 'Fecha no disponible'; }
}
export function vsWave() {
    return `<div class="vs-wave" aria-hidden="true">${[10,18,26,14,32,22,40,29,48,25,38,20,32,16,26,12,18].map(height => `<i style="height:${height}px"></i>`).join('')}</div>`;
}
