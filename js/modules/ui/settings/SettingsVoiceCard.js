/**
 * SettingsVoiceCard.js — Voz en Configuración → General.
 *
 * Antes vivía en Tests como "Prueba de voz"; ya es una función de uso diario.
 * Los interruptores conservan sus ids (voiceMvpEnabled, voiceFeedback, ...):
 * los guarda AUTO_SAVE_SWITCH_IDS en SettingsUI.js y VoiceUI.js pinta el
 * estado de los audios en [data-voice-storage-status].
 *
 * Probado en js/tests/SettingsVoiceCard.test.js.
 */

// Mismo trazo que el micrófono de la barra inferior (BottomNav.js); el
// registro de IconSystem no tiene micrófono.
const MIC_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8"/></svg>';

const switchRow = (id, on, title, hint) => `
                    <label class="stg-switch-row ${on ? 'is-active' : ''}" role="switch" aria-checked="${on}">
                        <input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
                        <span class="stg-switch-copy"><strong>${title}</strong><small>${hint}</small></span>
                        <span class="stg-switch-track" aria-hidden="true"><span class="stg-switch-handle"></span></span>
                    </label>`;

export function SettingsVoiceCard(context = {}) {
    const settings = context.state?.settings || {};
    const signedIn = Boolean(context.currentUser);
    const retention = Number(settings.voiceAudioRetentionDays ?? 5);

    return `
                <!-- Voz -->
                <div class="stg-panel" data-settings-voice>
                    <div class="stg-header">
                        <div>
                            <h3 id="voice-settings-title">
                                <span>${MIC_ICON}</span>
                                <span>Voz</span>
                            </h3>
                        </div>
                    </div>
                    ${switchRow('voiceMvpEnabled', settings.voiceMvpEnabled === true, 'Activar botón de voz', 'Muestra el micrófono para grabar y revisar instrucciones de voz.')}
                    <p class="stg-voice-note">Mantén pulsado para grabar y suelta para terminar. Al terminar se envía el audio. Revisa el borrador antes de registrar.</p>
                    <fieldset class="stg-choice-fieldset"><legend>Cuando la intención sea ambigua</legend><div class="stg-choice-group">
                        ${[['loan', 'Proponer préstamo'], ['cash', 'Proponer caja chica'], ['ask', 'Preguntar siempre']].map(([value, label]) => `<label class="stg-choice-option ${(settings.voiceAmbiguousAction || 'loan') === value ? 'is-selected' : ''}"><input type="radio" name="voiceAmbiguousAction" value="${value}" ${(settings.voiceAmbiguousAction || 'loan') === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}
                    </div></fieldset>
                    ${switchRow('voiceUsePreviousInterest', settings.voiceUsePreviousInterest === true, 'Usar la tasa anterior del empleado en préstamos por voz', 'Si no indicas interés, reutiliza su última tasa válida; sin una anterior usa 20 %. Una tasa indicada en la voz o editada tiene prioridad.')}
                    ${switchRow('voiceKeepLoanAudio', settings.voiceKeepLoanAudio !== false, 'Conservar audio de préstamos', 'Solo en este navegador. Desactivarlo elimina los audios de préstamos guardados y no conserva los nuevos.')}
                    ${switchRow('voiceFeedback', settings.voiceFeedback !== false, 'Sonido y vibración al grabar', 'Un tic y una vibración corta al empezar a escuchar, y otro al terminar. En iPhone solo suena: el navegador no permite vibrar.')}
                    <fieldset class="stg-choice-fieldset">
                        <legend>Tiempo de conservación desde el registro</legend>
                        <div class="stg-choice-group" role="group" aria-label="Días de conservación de audio">
                            ${[1, 2, 3, 4, 5].map(days => `<label class="stg-choice-option ${retention === days ? 'is-selected' : ''}"><input type="radio" name="voiceAudioRetentionDays" value="${days}" ${retention === days ? 'checked' : ''}><span>${days} ${days === 1 ? 'día' : 'días'}</span></label>`).join('')}
                        </div>
                    </fieldset>
                    <p class="stg-voice-note" data-voice-storage-status role="status">${signedIn ? 'Consultando el espacio de audios…' : 'Inicia sesión para gestionar tus audios.'}</p>
                    <button type="button" class="btn btn-secondary" data-voice-storage-retry hidden>Reintentar consulta</button>
                    <p class="stg-voice-note" data-voice-storage-warning role="status" hidden></p>
                    <button type="button" class="btn btn-secondary" data-settings-action="manage-voice-audio" ${signedIn ? '' : 'disabled'}>Gestionar audios guardados</button>
                    <p class="stg-voice-note">Las búsquedas y los audios descartados se eliminan. Los vencidos se limpian al abrir la app y mientras está abierta. Límite local: 50 MiB.</p>
                </div>`;
}
