import { escapeHTML } from '../../utils/Sanitize.js';
import { resolveVoiceEmployees, normalizeVoiceName } from './VoiceMatching.js';
import { voiceAliasCollisions } from './VoiceSettingsData.js';
import { voiceEmployeeCard, voiceIcon } from './VoiceVisuals.js';

export function needsVoiceAliasPrompt(name, employee, aliases = []) {
    if (!normalizeVoiceName(name)) return false;
    return !resolveVoiceEmployees({ spokenName: name }, [employee], aliases).some(match => match.score >= 1);
}

// A separate step inside the existing dialog keeps its overlay, focus and morph.
export function VoiceAliasView(ui, button) {
    const pending = ui.aliasSelection;
    const employee = ui.adapter.getEmployees().find(item => item.id === pending?.employeeId);
    const shared = employee ? voiceAliasCollisions(pending?.spokenName, employee.id, ui.adapter.getEmployees(), ui.employeeAliases || []) : [];
    const sharedOwners = shared.map(person => escapeHTML(person.name || 'Sin nombre') + ' (N.º ' + escapeHTML(person.number || '—') + ')').join(', ');
    return `<section class="voice-alias-pair" aria-label="Coincidencia a guardar"><blockquote>«${escapeHTML(pending?.spokenName || '')}»</blockquote><span class="voice-alias-arrow" aria-hidden="true">${voiceIcon('arrow')}</span>${voiceEmployeeCard(employee, '', ui.adapter.getPositions?.() || [])}</section>${shared.length ? '<p class="voice-review">Esta pronunciación compartida también coincide con ' + sharedOwners + '. Al buscarla tendrás que elegir.</p>' : ''}<p class="voice-alias-local">Solo en este dispositivo.</p>${button('alias-back', 'Elegir otro empleado', ui.busy)}${button('alias-save', 'Guardar coincidencia', ui.busy)}${button('alias-skip', 'Ahora no', ui.busy)}`;
}
