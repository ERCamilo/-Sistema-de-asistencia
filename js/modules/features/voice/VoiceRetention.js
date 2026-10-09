export const VOICE_AUDIO_BUDGET = 50 * 1024 * 1024;
export const VOICE_DAY = 24 * 60 * 60 * 1000;
export function voiceRetentionPolicy(settings = {}) {
    const days = Number(settings.voiceAudioRetentionDays ?? 5);
    return { keep: settings.voiceKeepLoanAudio !== false, days: Number.isInteger(days) ? Math.min(5, Math.max(1, days)) : 5 };
}
export function voiceAudioExpiry(record, policy = { keep: true, days: 5 }) {
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
