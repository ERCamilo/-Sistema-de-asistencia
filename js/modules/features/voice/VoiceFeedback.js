/**
 * Sound + haptic cues for Voice capture.
 *
 *   start  — rising "tick" + short buzz: the microphone is now listening.
 *   stop   — falling "tick" + double buzz: the take was captured.
 *   cancel / error — vibration only (no sound for something that did not happen).
 *
 * Tones are synthesised with Web Audio (no files to download). Browsers only
 * let audio start inside a user gesture, so callers `prime()` on pointerdown
 * and `play()` later, once the microphone actually opened. Everything is
 * best-effort: no Web Audio, no vibration (iOS) or a blocked call is ignored.
 * `isEnabled` maps to settings.voiceFeedback (Configuración → Tests).
 *
 * Tested in js/tests/VoiceFeedback.test.js.
 */
export const VOICE_CUES = Object.freeze({
    start: { tone: [620, 980], vibrate: 18 },
    stop: { tone: [900, 520], vibrate: [12, 50, 12] },
    cancel: { tone: null, vibrate: 30 },
    error: { tone: null, vibrate: [40, 40, 40] }
});

const TONE_SECONDS = 0.12;
const PEAK_GAIN = 0.18;

export function createVoiceFeedback({
    isEnabled = () => true,
    AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
    nav = globalThis.navigator
} = {}) {
    let ctx = null;

    const context = () => {
        if (ctx || !AudioContextImpl) return ctx;
        try { ctx = new AudioContextImpl(); } catch (_) { ctx = null; AudioContextImpl = null; }
        return ctx;
    };

    const tone = ([from, to]) => {
        const audio = context();
        if (!audio) return;
        try {
            if (audio.state === 'suspended') audio.resume?.().catch?.(() => {});
            const now = audio.currentTime;
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(from, now);
            osc.frequency.exponentialRampToValueAtTime(to, now + TONE_SECONDS);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + TONE_SECONDS + 0.04);
            osc.connect(gain).connect(audio.destination);
            osc.start(now);
            osc.stop(now + TONE_SECONDS + 0.06);
        } catch (_) { /* audio is optional */ }
    };

    const buzz = (pattern) => {
        try { nav?.vibrate?.(pattern); } catch (_) { /* vibration is optional */ }
    };

    return {
        /** Call synchronously inside the user's gesture (pointerdown / keydown). */
        prime() {
            if (!isEnabled()) return;
            const audio = context();
            try { if (audio?.state === 'suspended') audio.resume?.().catch?.(() => {}); } catch (_) { /* optional */ }
        },
        play(name) {
            const cue = VOICE_CUES[name];
            if (!cue || !isEnabled()) return;
            if (cue.tone) tone(cue.tone);
            if (cue.vibrate) buzz(cue.vibrate);
        },
        close() {
            try { ctx?.close?.(); } catch (_) { /* optional */ }
            ctx = null;
        }
    };
}
