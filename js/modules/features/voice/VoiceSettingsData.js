import { voiceAudioExpiry, voiceRetentionPolicy, VOICE_DAY } from './VoiceRetention.js';

export const voiceProjectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';
export const voiceBytes = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MiB`;

export function voiceRecordingInfo(record, settings = {}, now = Date.now()) {
    const expiresAt = voiceAudioExpiry(record, voiceRetentionPolicy(settings));
    const available = !!record.audio && expiresAt > now;
    return { record, expiresAt, available, soon: available && expiresAt - now <= VOICE_DAY,
        bytes: available ? record.audio.size : 0,
        label: available ? record.completedLoanId ? 'Préstamo' : 'Borrador' : record.audioDiscardReason === 'manual' ? 'Audio eliminado' : expiresAt <= now ? 'Audio vencido' : 'Audio no disponible' };
}

export function voiceAliasCollisions(value, employeeId, employees, aliases) {
    const compact = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const key = compact(value);
    if (!key) return [];
    return employees.filter(employee => employee.id !== employeeId && (
        compact(employee.name) === key || String(employee.name || '').split(/\s+/).some(part => compact(part) === key)
        || (aliases.find(row => row.employeeId === employee.id)?.aliases || []).some(alias => compact(alias) === key)));
}
