import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { VOICE_TEST_ENDPOINT } from './VoiceCore.js';
import { voicePlayer, voiceIcon } from './VoiceVisuals.js';
export function VoiceAudioView(ui, button) {
    const r = ui.record;
    const seconds = Math.max(0, Math.round((r?.durationMs || 0) / 1000));
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return r?.audio ? `<section class="voice-audio-summary"><span class="voice-audio-mic">${voiceIcon('mic')}</span><strong>Grabación lista</strong><span class="voice-audio-duration">${duration}</span></section>${voicePlayer(ui,button)}${button('process', `${ui.busy ? 'Procesando…' : r.error ? 'Reintentar' : 'Enviar'} ${voiceIcon('arrow')}`,ui.busy || !!r.unsaved || r.retryAt > Date.now())}${r.unsaved ? button('save-audio','Guardar audio',ui.busy) : ''}${r.pendingResult ? button('apply-result','Usar nuevo resultado',ui.busy) : ''}<details><summary>Opciones de audio</summary>${button('record','Volver a grabar',ui.busy)}<label>URL del webhook<input data-voice-endpoint value="${escapeAttr(ui.endpoint())}" ${ui.busy ? 'disabled' : ''}></label><div class="voice-endpoint-presets">${button('default-endpoint','Webhook activo',ui.busy)}${button('test-endpoint','Webhook de prueba',ui.busy)}</div>${ui.endpoint() === VOICE_TEST_ENDPOINT ? '<p class="voice-test-hint">En n8n, activa «Escuchar evento de prueba».</p>' : ''}<p>${escapeHTML(location.origin)}</p></details>` : `<div class="voice-record-ready">${voiceIcon('mic')}</div>${button('record','Iniciar grabación')}<p>Máximo 60 segundos.</p>`;
}
