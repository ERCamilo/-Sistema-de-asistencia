import { voiceDraftReady, voiceBlocked } from './VoiceCore.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { voiceLoanNote } from './VoiceLoanDraft.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { voiceIcon, voiceEmployeeCard, voiceReview } from './VoiceVisuals.js';
const money = value => '$' + Number(value).toLocaleString('es-DO', { minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: 2 });
export function VoiceLoanView(ui, button) {
    const record = ui.record, result = record.result, employee = ui.selected(), draft = record.draft;
    const defaults = ui.adapter.getLoanDefaults?.(employee) || {};
    const periods = (defaults.periods || []).filter(p => p.payDate > getDateKey(new Date()));
    const issue = field => result.issues.filter(x => String(x.field || '').replace(/^loan\./,'') === field).map(x => `<small class="voice-field-issue" role="alert">${escapeHTML(x.message)}</small>`).join('');
    const input = (field,label,type='number') => `<label class="voice-field voice-field-${field}">${label}<input aria-label="${label}" data-voice-field="${field}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${escapeAttr(String(draft[field] ?? ''))}" ${field === 'concept' ? 'placeholder="Nota opcional"' : ''}>${issue(field)}</label>`;
    const select = (field,label,options) => `<label class="voice-field">${label}<select data-voice-field="${field}">${options.map(([v,text]) => `<option value="${escapeAttr(String(v))}" ${String(draft[field] ?? '') === String(v) ? 'selected' : ''}>${escapeHTML(text)}</option>`).join('')}</select>${issue(field)}</label>`;
    let preview = '<p class="voice-preview-pending">Completa el monto para ver el total.</p>';
    if (voiceDraftReady(draft)) {
        try {
            const p = ui.adapter.previewLoan(employee,draft);
            preview = `<section class="voice-totals"><div><span>Total</span><strong>${money(p.total)}</strong></div><div><span>Saldo</span><strong>${money(p.current)} <span aria-label="pasa a">→</span> ${money(p.projected)}</strong></div></section>${p.installments?.length ? `<details><summary>Ver cuotas</summary>${p.installments.map(x => `<p>${money(x.amount)} · ${escapeHTML(x.dueDate || 'Pendiente')}</p>`).join('')}</details>` : ''}`;
        } catch (_) { preview = '<p class="voice-preview-pending">Revisa los datos para ver el total.</p>'; }
    }
    const swap = button('choose', `${voiceIcon('swap')}<span class="voice-sr">Otro empleado</span>`,ui.busy);
    return `${voiceEmployeeCard(employee,swap)}<fieldset class="voice-loan-fields" ${ui.busy ? 'disabled' : ''}><legend class="voice-sr">Datos del préstamo</legend>${input('principal','Monto')}<div class="voice-field-pair">${input('interestRate','Interés (%)')}${input('installmentCount','Cuotas')}</div>${draft.installmentMode === 'lump' ? select('dueDate','Cobro', [['','Seleccionar nómina'],...periods.map(p => [p.payDate,p.label || p.payDate])]) : ''}${draft.installmentMode === 'lump' && !periods.length ? '<p role="alert" class="voice-field-issue">Configura una nómina futura.</p>' : ''}${input('concept','Nota opcional','text')}</fieldset>${preview}${voiceReview(ui,['principal','interestRate','installmentCount','dueDate','concept'])}<details class="voice-loan-options"><summary>Más opciones</summary>${defaults.previousRate !== null && defaults.previousRate !== undefined ? button('previous-interest', `Usar tasa anterior: ${escapeHTML(String(defaults.previousRate))} %`,ui.busy) : ''}<fieldset ${ui.busy ? 'disabled' : ''}>${input('startDate','Fecha del préstamo','date')}${select('interestIncluded','Interés incluido',[['false','No'],['true','Sí']])}${select('installmentMode','Cobro',[['lump','Pago único'],['installments','Cuotas']])}</fieldset><p>Nota: ${escapeHTML(voiceLoanNote(record,draft.concept))}</p><label>Texto entendido<textarea data-voice-transcript ${ui.busy ? 'disabled' : ''}>${escapeHTML(record.transcript)}</textarea></label><label>Pronunciación<input data-voice-alias value="${escapeAttr(record.mention.spokenName || '')}"></label>${button('learn','Guardar coincidencia',ui.busy)}<p>Variantes guardadas: ${(ui.employeeAliases?.find(r => r.employeeId === employee.id)?.aliases || []).map(escapeHTML).join(', ') || 'Ninguna'}</p></details>${button('loan', `Agregar préstamo ${voiceIcon('arrow')}`,ui.busy || voiceBlocked(result) || !!record.completedLoanId || !ui.loanReady() || ((result.needsReview || result.issues.length) && !record.reviewed))}`;
}
