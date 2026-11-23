import { voiceFormHeader, voiceFormEmployee, voiceFormSource, voiceFormFooter } from '../voice/VoiceFormLayout.js';

/** Financial values/fields are supplied by the ordinary PayModal calculation. */
export function VoicePaymentModal(view) {
    return `${voiceFormHeader('Nuevo abono', 'la-modal-title', 'laClose')}
        <div class="voice-form-body">
            ${voiceFormEmployee(view.employee, view.positions, 'laVoiceChangeEmployee')}
            <div class="voice-form-amount">${view.amountField}</div>
            <div class="voice-form-quick">${view.quickAmounts}</div>
            <div class="voice-form-pair">${view.dateField}${view.channelField}</div>
            ${view.targetField}${view.periodField}${view.noteField}
            <section class="voice-form-balance" aria-label="Saldo después del abono"><span>Saldo</span><div><span>${view.currentBalance}</span><span aria-label="pasa a">→</span><strong>${view.remaining}</strong></div></section>
            ${view.warning}
            <details class="voice-form-breakdown"><summary>Ver reparto <span>${view.loanCount}</span></summary>${view.breakdown}</details>
            ${voiceFormSource(view.source)}
        </div>
        ${voiceFormFooter('laClose', 'laSave', 'Guardar abono', view.canSave, view.hint)}`;
}
