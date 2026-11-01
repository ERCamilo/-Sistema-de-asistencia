import { voiceAudioExpiry } from './VoiceRetention.js';
import { VOICE_LIMITS } from './VoiceCore.js';

export const VOICE_PROCESSING_LEASE_MS = 120000;
export const voiceHasPendingWork = record => !!record && !record.completedLoanId && !record.completedCashId && record.purpose !== 'name-example'
    && !record.cashDraft?.pendingMovement && (['queued','processing','paused','error'].includes(record.processingState) || !!record.error || !record.result && !record.pendingResult);
export const voiceKeepPending = record => !!record && !record.completedLoanId && !record.completedCashId && record.purpose !== 'name-example' && record.processingState !== 'expired' && (!!record.processingState || !!record.error || !!record.processingRequested);
export function voiceProcessingStatus(record, now = Date.now()) {
    if (record.completedLoanId || record.completedCashId) return 'Registrado';
    if (record.processingState === 'processing') return record.processingLease?.until > now ? 'Procesando…' : 'Envío interrumpido';
    if (record.processingState === 'queued') return globalThis.navigator?.onLine === false ? 'En espera de conexión' : 'Pendiente de envío';
    if (record.processingState === 'paused') return 'Envío pausado';
    if (record.error) return record.retryAt > now ? 'Espera para reintentar' : 'Error de envío';
    if (record.pendingResult) return 'Nuevo resultado por revisar';
    if (record.result) return 'Borrador listo';
    return record.processingState === 'paused' ? 'Envío pausado' : 'Sin enviar';
}
export function voiceCanProcess(record, policy, now = Date.now()) {
    return !!record.audio && record.audio.size > 0 && record.audio.size <= VOICE_LIMITS.maxBytes && !(record.durationMs > VOICE_LIMITS.maxDurationMs)
        && !record.discarded && !record.unsaved && !record.completedLoanId && !record.completedCashId
        && !record.cashDraft?.pendingMovement && record.purpose !== 'name-example' && voiceAudioExpiry(record, policy) > now;
}
// Compare the request payload, excluding credentials and editable business data.
// Retrying never reconstructs the recording's original date/time context.
export function voiceRequestDescriptor(record) {
    const context = Object.fromEntries(Object.entries(record.context || {}).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify([context, record.mimeType, record.fileName, record.fileBase64 || null, record.audio?.size, record.audio?.type]);
}
export async function voiceRequestSignature(record) {
    const header = voiceRequestDescriptor(record);
    if (!globalThis.crypto?.subtle || !record.audio?.arrayBuffer) throw Error('No se pudo verificar el audio. Usa un navegador actualizado con HTTPS.');
    const bytes = new Uint8Array(await record.audio.arrayBuffer()), prefix = new TextEncoder().encode(header);
    const payload = new Uint8Array(prefix.length + bytes.length); payload.set(prefix); payload.set(bytes, prefix.length);
    const hash = await crypto.subtle.digest('SHA-256', payload);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
