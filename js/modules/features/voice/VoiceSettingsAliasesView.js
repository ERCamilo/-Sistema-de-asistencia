import { normalizeVoiceName } from './VoiceMatching.js';
import { voiceAliasCollisions } from './VoiceSettingsData.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { vsArrow, vsIdentity, vsIcon, vsIconButton } from './VoiceSettingsViewUtils.js';

export function VoiceSettingsAliasesView(ui) {
    const employees = [...ui.adapter.getEmployees()].sort((a,b) => String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }) || String(a.name).localeCompare(String(b.name)));
    return `<div class="vs-search">${vsIcon('search')}<input type="search" data-vs-search autocomplete="off" placeholder="Nombre, número o pronunciación" aria-label="Buscar empleado o pronunciación" value="${escapeAttr(ui.search)}"></div><div class="vs-list-meta"><span>${employees.length} empleados</span><span>${ui.aliasCount()} variantes</span></div>${employees.map(employee => `<button type="button" class="vs-person-row" data-vs-action="person" data-value="${escapeAttr(employee.id)}" data-vs-person-search="${escapeAttr(normalizeVoiceName([employee.name,employee.number,...ui.aliasesFor(employee.id)].join(' ')))}">${vsIdentity(ui, employee)}<span class="vs-alias-count">${ui.aliasesFor(employee.id).length}<small>variantes</small></span>${vsArrow()}</button>`).join('')}<p class="vs-empty" data-vs-no-employees ${employees.length ? 'hidden' : ''}>No hay coincidencias.</p>`;
}
export function VoiceSettingsPersonView(ui) {
    const employee = ui.employee();
    return `${vsIdentity(ui, employee)}<div class="vs-list-meta"><span>Cómo le llaman</span><span>${ui.aliasesFor(employee.id).length} variantes</span></div>${ui.aliasesFor(employee.id).map(alias => `<div class="vs-alias-row"><span class="vs-alias-text">«${escapeHTML(alias)}»${voiceAliasCollisions(alias, employee.id, ui.adapter.getEmployees(), ui.aliases).length ? '<br><span class="vs-shared">Compartida</span>' : ''}</span>${vsIconButton('edit-alias','edit',`Editar ${alias}`,alias,ui.busy)}${vsIconButton('remove-alias','trash',`Eliminar ${alias}`,alias,ui.busy)}</div>`).join('') || '<p class="vs-empty">Todavía no hay pronunciaciones.</p>'}<button type="button" class="vs-secondary-wide" data-vs-action="teach" ${ui.busy || ui.adapter.isEnabled?.() === false ? 'disabled' : ''}>${vsIcon('mic')} Enseñar con voz</button>${ui.adapter.isEnabled?.() === false ? '<p class="vs-help">Activa voz para grabar un nombre.</p>' : ''}`;
}
export function VoiceSettingsAliasEditView(ui) {
    return `<label class="vs-field-label" for="vs-alias-input">Cómo le llaman</label><input id="vs-alias-input" data-vs-alias-input class="vs-text-field" maxlength="160" autocomplete="off" value="${escapeAttr(ui.aliasText)}" placeholder="Ej. carlito" ${ui.busy ? 'disabled' : ''}><div class="vs-flow-arrow">${vsIcon('arrow')}</div>${vsIdentity(ui,ui.employee())}<p class="vs-notice" data-vs-alias-warning role="status" hidden></p>`;
}
