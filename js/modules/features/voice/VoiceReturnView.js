import { escapeHTML } from '../../utils/Sanitize.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { voiceIcon } from './VoiceVisuals.js';

// A receipt/menu, never an editable or confirmable operation.
export function VoiceReturnView(summary, button) {
    const title = summary?.kind === 'cash' ? 'Gasto registrado' : summary?.kind === 'loan' ? 'Préstamo registrado' : 'Consulta de préstamos';
    return `<section class="voice-return-summary"><span>${voiceIcon('check')}</span><h3>${title}</h3>${summary?.name ? `<p>${escapeHTML(summary.name)}</p>` : ''}${Number.isFinite(summary?.amount) ? `<strong>${formatCurrency(summary.amount)}</strong>` : ''}<p>${summary?.kind === 'loans' ? 'Puedes continuar desde Voz.' : 'La operación ya está guardada.'}</p></section>${button('record',`${voiceIcon('mic')} Nueva nota de voz`)}${button('voice-settings','Configuración de voz')}`;
}
