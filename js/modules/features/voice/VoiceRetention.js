export const VOICE_AUDIO_BUDGET = 50 * 1024 * 1024;
export const VOICE_DAY = 24 * 60 * 60 * 1000;
export const VOICE_RETENTION_DEFAULT_DAYS = 1;
export const VOICE_RETENTION_MAX_DAYS = 31;
export const VOICE_RETENTION_DAY_OPTIONS = [1, 5, 7, 15, 31];
export const VOICE_RETENTION_OPTIONS = [0, ...VOICE_RETENTION_DAY_OPTIONS];
const VOICE_RETENTION_LEGACY_DAY_MAP = new Map([[2, 5], [3, 5], [4, 5]]);

export function isValidVoiceRetentionDays(days) {
    return Number.isInteger(days) && VOICE_RETENTION_DAY_OPTIONS.includes(days);
}
export function isValidVoiceRetentionChoice(days) {
    return Number.isInteger(days) && VOICE_RETENTION_OPTIONS.includes(days);
}
export function voiceRetentionParts(days) {
    if (days === 0) return { primary: 'No', secondary: 'guardar' };
    if (days === 1) return { primary: '1', secondary: 'día' };
    if (days === 7) return { primary: '1', secondary: 'semana' };
    return { primary: String(days), secondary: 'días' };
}
export function voiceRetentionLabel(days) {
    const { primary, secondary } = voiceRetentionParts(days);
    return `${primary} ${secondary}`;
}
export function voiceRetentionPolicy(settings = {}) {
    const raw = settings?.voiceAudioRetentionDays;
    const parsed = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    const days = isValidVoiceRetentionDays(parsed)
        ? parsed
        : (VOICE_RETENTION_LEGACY_DAY_MAP.get(parsed) ?? VOICE_RETENTION_DEFAULT_DAYS);
    return { keep: settings?.voiceKeepLoanAudio !== false, days };
}
export function voiceAudioExpiry(record, policy = { keep: true, days: VOICE_RETENTION_DEFAULT_DAYS }) {
    if (!record.completedLoanId) return Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) + VOICE_DAY : 0;
    const registeredAt = Number(record.registeredAt || record.createdAt);
    if (!Number.isFinite(registeredAt)) return 0;
    return policy.keep ? Math.min(Number(record.audioExpiresAt) || Infinity, registeredAt + policy.days * VOICE_DAY) : 0;
}
export async function voiceStorageStatus(records, estimate = () => globalThis.navigator?.storage?.estimate?.()) {
    const bytes = records.reduce((sum, record) => sum + (record.audio?.size || 0), 0);
    let browser = null;
    try { browser = await estimate(); } catch (_) { /* Browser quota is an optional estimate. */ }
    const available = browser?.quota > 0 ? Math.max(0, browser.quota - (browser.usage || 0)) : null;
    const low = bytes >= VOICE_AUDIO_BUDGET * .8 || (browser?.quota > 0 && browser.usage / browser.quota >= .85);
    return { bytes, count: records.filter(r => r.audio).length, limit: VOICE_AUDIO_BUDGET, available, low };
}
