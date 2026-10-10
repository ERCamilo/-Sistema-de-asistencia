import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { voicePlayer, voiceIcon } from './VoiceVisuals.js';
export function VoiceAudioView(ui, button) {
    const r = ui.record;
    return r?.audio ? `${voicePlayer(ui,button)}${button('process', `${ui.busy ? 'Procesando…' : r.error ? 'Reintentar' : 'Enviar'} ${voiceIcon('arrow')}`,ui.busy || !!r.unsaved || r.retryAt > Date.now())}${r.unsaved ? button('save-audio','Guardar audio',ui.busy) : ''}${r.pendingResult ? button('apply-result','Usar nuevo resultado',ui.busy) : ''}<details><summary>Opciones de audio</summary>${button('record','Volver a grabar',ui.busy)}<label>URL del webhook<input data-voice-endpoint value="${escapeAttr(ui.endpoint())}" ${ui.busy ? 'disabled' : ''}></label>${button('default-endpoint','Usar URL predeterminada',ui.busy)}<p>${escapeHTML(location.origin)}</p></details>` : `<div class="voice-record-ready">${voiceIcon('mic')}</div>${button('record','Iniciar grabación')}<p>Máximo 60 segundos.</p>`;
}
