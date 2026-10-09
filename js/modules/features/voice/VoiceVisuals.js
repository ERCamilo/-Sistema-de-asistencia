import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
const paths = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    swap: '<circle cx="8" cy="6" r="3"/><path d="M2 18v-3a6 6 0 0 1 12 0v3m1-10h7m-3-3 3 3-3 3m3 6h-7m3-3-3 3 3 3"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>'
};
export const voiceIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mic}</svg>`;
export function voiceEmployeeCard(employee, action = '') {
    const name = String(employee?.name || 'Sin seleccionar');
    const initials = name.trim().split(/\s+/).slice(0,2).map(word => Array.from(word)[0] || '').join('').toUpperCase();
    return `<section class="voice-identity-card"><span class="voice-avatar" aria-hidden="true">${escapeHTML(initials)}</span><span class="voice-person"><strong>${escapeHTML(name)}</strong><span class="voice-code">#${escapeHTML(employee?.number || '—')}</span></span>${action}</section>`;
}
export function voiceWaveform(samples = []) {
    const bars = Array.from({length:44}, (_,i) => {
        const level = samples.length ? Number(samples[Math.floor(i * samples.length / 44)]) || 0 : .15;
        const height = Math.max(4, Math.min(52, 4 + level * 48));
        return `<rect x="${i*7}" y="${(60-height)/2}" width="4" height="${height}" rx="2"/>`;
    }).join('');
    return `<svg class="voice-waveform" viewBox="0 0 308 60" aria-hidden="true">${bars}</svg>`;
}
export function voicePlayer(ui, button) {
    const r = ui.record;
    return `<div class="voice-player">${voiceWaveform(r?.levels)}<div class="voice-player-controls">${button('play-audio', `${voiceIcon('play')}<span class="voice-sr">Reproducir audio</span>`)}<input type="range" data-voice-seek min="0" max="${Math.max(.1,(r?.durationMs || 0)/1000)}" step=".1" value="0" aria-label="Posición del audio"><span data-voice-time class="voice-time">0:00</span></div><audio class="voice-media" src="${escapeAttr(ui.audioURL || '')}" preload="metadata"></audio></div>`;
}
export function voiceReview(ui, fields = []) {
    const r = ui.record?.result;
    if (!r || (!r.needsReview && !r.issues.length)) return '';
    const issues = r.issues.filter(issue => !fields.includes(String(issue.field || '').replace(/^loan\./,'')));
    return `<section class="voice-review">${issues.length ? `<ul>${issues.map(x => `<li>${escapeHTML(x.message)}</li>`).join('')}</ul>` : ''}<label><input type="checkbox" data-voice-reviewed ${ui.record.reviewed ? 'checked' : ''} ${ui.busy ? 'disabled' : ''}> Revisé los datos pendientes</label></section>`;
}
