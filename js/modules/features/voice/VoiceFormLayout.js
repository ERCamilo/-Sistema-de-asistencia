/** Shared presentation for voice drafts; save handlers belong to the original forms. */
import { escapeHTML } from '../../utils/Sanitize.js';
import { voiceEmployeeCard, voiceIcon } from './VoiceVisuals.js';

export function voiceFormHeader(title, titleId, close) {
    return `<header class="voice-form-header"><h2 id="${titleId}">${escapeHTML(title)}</h2><button type="button" class="voice-form-icon" data-app-fn="${close}" aria-label="Cerrar">${voiceIcon('close')}</button></header>`;
}
export function voiceFormEmployee(employee, positions, change) {
    return voiceEmployeeCard(employee, `<button type="button" class="voice-form-swap" data-app-fn="${change}" aria-label="Cambiar empleado" title="Cambiar empleado">${voiceIcon('swap')}</button>`, positions);
}
export function voiceFormSource(source) {
    return `<details class="voice-form-source" ${source.needsReview ? 'open' : ''}><summary>Texto reconocido</summary><p>${escapeHTML(source.transcript)}</p>${source.needsReview || source.issues?.length ? `<div class="voice-form-issues">${source.issues?.length ? source.issues.map(i => `<p>${escapeHTML(i.message)}</p>`).join('') : 'Revisa los datos antes de guardar.'}</div>` : ''}</details>`;
}
export function voiceFormFooter(close, save, label, enabled = true, hint = '') {
    return `<footer class="voice-form-footer"><button type="button" class="voice-form-icon" data-app-fn="${close}" aria-label="Cancelar">${voiceIcon('close')}</button><button type="button" class="voice-form-save" data-app-fn="${save}" ${enabled ? '' : 'disabled'}>${escapeHTML(label)}${voiceIcon('arrow')}</button>${hint ? `<small class="voice-form-hint" role="status">${escapeHTML(hint)}</small>` : ''}</footer>`;
}
