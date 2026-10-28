import { escapeHTML } from '../../utils/Sanitize.js';
import { voiceIcon } from './VoiceVisuals.js';

export function VoicePositionView(ui, button) {
    const context = ui.employeeResolution;
    if (!context) return '';
    const hints = context.hints.map(hint => hint.positions.length ? hint.positions.map(position=>position.name).join(' / ') : hint.phrase);
    return `${hints.length ? `<section class="voice-position-context" aria-label="Pista de posición"><span>${voiceIcon('search')}</span><div><strong>${context.ignored ? 'Pista ignorada' : 'Posición mencionada'}</strong><p>${escapeHTML([...new Set(hints)].join(' · '))}</p></div>${button('position-hint',context.ignored?'Usar pista':'Ignorar pista',ui.busy)}</section>` : ''}${context.warnings.length ? `<div class="voice-position-warning" role="status">${context.warnings.map(message=>`<p>${escapeHTML(message)}</p>`).join('')}</div>` : ''}`;
}
