/** Editable input for the existing note/payment forms. No business writes here. */
import { voiceFacts } from './VoiceIntent.js';

export const VOICE_FORM_INTENTS = ['crear_nota', 'registrar_abono'];
export const isVoiceFormIntent = intent => VOICE_FORM_INTENTS.includes(intent);
export function validVoiceDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function voiceActionDraft(result, intent, today) {
    const facts = voiceFacts(result);
    if (intent === 'crear_nota') return { text: result.note?.text ?? facts.note ?? '', date: result.note?.date ?? facts.date ?? today };
    const p = result.payment || {};
    return { amount: p.amount ?? facts.amount ?? '', date: p.date ?? facts.date ?? today,
        note: p.note ?? facts.note ?? '', channel: p.channel ?? '', period: p.payrollDate ?? '',
        spokenLoanNumber: p.spokenLoanNumber ?? null };
}
export function assertVoiceFormContext(context, employeeId) {
    context.guard();
    if (String(context.employeeId) !== String(employeeId)) throw Error('Cambió el empleado. Vuelve a abrir el borrador de voz.');
}
export function hasVoiceSource(items, context) {
    return items.some(item => item?.voiceRequestId === context.requestId && item?.voiceActorUid === context.uid);
}
