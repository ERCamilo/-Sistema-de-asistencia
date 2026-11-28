import { normalizeVoiceName } from './VoiceMatching.js';
import { voiceAudioExpiry, voiceStoredAudioPolicy, VOICE_DAY } from './VoiceRetention.js';

export const voiceProjectKey = scope => scope?.enabled ? String(scope.projectId || 'pending') : 'legacy';
export const voiceBytes = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MiB`;

export function voiceRecordingInfo(record, settings = {}, now = Date.now()) {
    const expiresAt = voiceAudioExpiry(record, voiceStoredAudioPolicy(settings));
    const available = !!record.audio && expiresAt > now;
    return { record, expiresAt, available, soon: available && expiresAt - now <= VOICE_DAY,
        bytes: available ? record.audio.size : 0,
        label: available ? record.completedLoanId ? 'Préstamo' : 'Borrador' : record.audioDiscardReason === 'manual' ? 'Audio eliminado' : expiresAt <= now ? 'Audio vencido' : 'Audio no disponible' };
}

// Use the same exact-name forms as the resolver, without running fuzzy matching
// for every alias rendered in the settings list.
export function voiceAliasCollisions(value, employeeId, employees = [], aliases = []) {
    const normalize = text => normalizeVoiceName(text).slice(0, 160);
    const compact = text => text.replace(/\s/g, '');
    const ordered = text => text.split(' ').sort().join(' ');
    const name = normalize(value), key = compact(name);
    if (!key) return [];
    const aliasMap = new Map(aliases.map(row => [row.employeeId, row.aliases || []]));
    return employees.filter(employee => {
        if (employee.id === employeeId) return false;
        const full = normalize(employee.name);
        return (full && (compact(full) === key || ordered(full) === ordered(name)))
            || full.split(' ').includes(name)
            || (aliasMap.get(employee.id) || []).some(alias => compact(normalize(alias)) === key);
    });
}
