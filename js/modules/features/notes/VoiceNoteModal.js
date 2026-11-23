import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { voiceFormHeader, voiceFormEmployee, voiceFormSource, voiceFormFooter } from '../voice/VoiceFormLayout.js';

export function VoiceNoteModal(employee, state) {
    return `<div class="modal-overlay voice-form-overlay voice-note-overlay" data-app-close-on-self="close-note-modal">
        <section class="voice-form-sheet voice-form-sheet--note" role="dialog" aria-modal="true" aria-labelledby="note-modal-title" data-app-stop-only="1">
            ${voiceFormHeader('Nueva nota', 'note-modal-title', 'closeNoteModal')}
            <div class="voice-form-body">
                ${voiceFormEmployee(employee, state.positions || [], 'changeVoiceNoteEmployee')}
                <label class="voice-form-field" for="note-modal-date">Fecha<input id="note-modal-date" type="date" value="${escapeAttr(state.noteModalDate)}" onchange="setNoteModalDate(this.value)"></label>
                <label class="voice-form-field voice-form-note" for="note-modal-text">Nota<textarea id="note-modal-text" rows="4" placeholder="Escribe la nota…" oninput="setNoteModalText(this.value)">${escapeHTML(state.noteModalText || '')}</textarea></label>
                <p class="voice-form-caption">Se añade a las notas de ese día.</p>
                ${voiceFormSource(state.noteModalVoice)}
            </div>
            ${voiceFormFooter('closeNoteModal', 'saveNoteModal', 'Guardar nota')}
        </section>
    </div>`;
}
