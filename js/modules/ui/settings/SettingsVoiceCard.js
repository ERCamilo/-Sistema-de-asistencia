import { vsIcon } from '../../features/voice/VoiceSettingsViewUtils.js';

// General retains one compact entry. All voice controls live in the modal.
export function SettingsVoiceCard() {
    return `<button type="button" class="settings-voice-entry" data-settings-voice data-settings-action="open-voice-settings"><span class="vs-icon-box">${vsIcon('mic')}</span><span class="vs-copy"><strong id="voice-settings-title">Voz</strong><small>Configuración, pronunciaciones y audios</small></span><span class="vs-arrow">${vsIcon('chevron')}</span></button>`;
}
