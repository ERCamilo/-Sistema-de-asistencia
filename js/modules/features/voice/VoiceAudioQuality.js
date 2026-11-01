// Local signal level, never speech recognition or transcription confidence.
// The existing live meter supplies one RMS value every 80 ms (at most 800).
export function assessVoiceAudio(rmsSamples = [], durationMs = 0) {
    const samples = rmsSamples.filter(value => Number.isFinite(value) && value >= 0 && value <= 1).slice(0, 800);
    if (samples.length < 8 || durationMs < 600) return { status: 'unmeasured' };
    samples.sort((a, b) => b - a);
    const strongest = samples.slice(0, Math.max(2, Math.ceil(samples.length * .2)));
    const rms = Math.sqrt(strongest.reduce((sum, value) => sum + value * value, 0) / strongest.length);
    return { status: samples[0] < .0015 ? 'silent' : rms < .015 ? 'low' : 'normal', samples: samples.length };
}

export const voiceAudioNeedsReview = record => ['silent', 'low'].includes(record?.audioQuality?.status);

export function voiceAudioQualityNotice(record) {
    if (!voiceAudioNeedsReview(record)) return '';
    const silent = record.audioQuality.status === 'silent';
    return `<section class="voice-quality-notice" role="status" aria-label="Nivel de la grabación"><span class="voice-quality-icon" aria-hidden="true">!</span><div><strong>${silent ? 'No se detectó sonido' : 'El audio se escucha muy bajo'}</strong><p>Escúchalo antes de enviar. Puedes repetirlo o enviarlo de todos modos.</p><small>Nivel del micrófono · no mide qué entendió Gemini</small></div></section>`;
}
