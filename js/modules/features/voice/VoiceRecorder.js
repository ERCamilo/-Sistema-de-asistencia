import { VOICE_LIMITS } from './VoiceCore.js';
import { assessVoiceAudio } from './VoiceAudioQuality.js';

export class VoiceRecorder {
    constructor({ mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, onComplete, onLevel = () => {}, onError = () => {}, setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = id => globalThis.clearTimeout(id) } = {}) {
        Object.assign(this, { mediaDevices, Recorder, onComplete, onLevel, onError, setTimer, clearTimer }); this.generation = 0;
    }
    // `stream`: micrófono ya pedido (promesa) al tocar el botón; sin él se pide aquí.
    async start({ stream: warm = null } = {}) {
        if (!this.mediaDevices?.getUserMedia || !this.Recorder) throw Error('Este navegador no permite grabar. Usa HTTPS o el origen local compatible.');
        const generation = ++this.generation; this.cancelled = false;
        const stream = await (warm || this.mediaDevices.getUserMedia({ audio: true }));
        if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
        this.stream = stream; this.chunks = []; this.bytes = 0; this.startedAt = Date.now(); this.tooLarge = false; this.rmsSamples = [];
        try {
            const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => this.Recorder.isTypeSupported(type));
            this.recorder = new this.Recorder(stream, mime ? { mimeType: mime } : undefined);
            this.recorder.ondataavailable = event => {
                if (event.data.size) { this.chunks.push(event.data); this.bytes += event.data.size; }
                if (this.bytes > VOICE_LIMITS.maxBytes) { this.tooLarge = true; this.stop(); }
            };
            this.recorder.onerror = () => { this.cancel(); this.onError(Error('Falló la grabación. Inténtalo de nuevo.')); };
            this.recorder.onstop = () => {
                this.release(); if (this.cancelled) return;
                if (this.tooLarge) { this.onError(Error('La grabación supera 10 MiB. Graba una instrucción más corta.')); return; }
                const mimeType = this.recorder.mimeType || this.chunks[0]?.type;
                const audio = new Blob(this.chunks, { type: mimeType });
                if (!audio.size || !mimeType) { this.onError(Error('No se capturó audio.')); return; }
                const durationMs = Date.now() - this.startedAt;
                this.onComplete({ audio, mimeType, durationMs, audioQuality: assessVoiceAudio(this.rmsSamples, durationMs) });
            };
            this.recorder.start(1000); this.startMeter(); this.timer = this.setTimer(() => this.stop(), VOICE_LIMITS.maxDurationMs - 250);
        } catch (error) { this.cancel(); throw error; }
    }
    startMeter() {
        try {
            const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!Context) return;
            this.audioContext = new Context();
            this.analyser = this.audioContext.createAnalyser(); this.analyser.fftSize = 256;
            this.audioContext.createMediaStreamSource(this.stream).connect(this.analyser);
            const floating = typeof this.analyser.getFloatTimeDomainData === 'function';
            const samples = floating ? new Float32Array(this.analyser.fftSize) : new Uint8Array(this.analyser.fftSize);
            const tick = () => {
                if (!this.stream) return;
                if (floating) this.analyser.getFloatTimeDomainData(samples); else this.analyser.getByteTimeDomainData(samples);
                const rms = Math.sqrt(samples.reduce((sum, x) => sum + (floating ? x : (x - 128) / 128) ** 2, 0) / samples.length);
                // A suspended context returns zeros even when capture works.
                // Do not call that silence. Byte meters cannot reliably resolve
                // very quiet sound either, so use them only for the animation.
                if (floating && this.audioContext?.state === 'running' && this.rmsSamples.length < 800) this.rmsSamples.push(rms);
                this.onLevel(Math.min(1, rms * 5)); this.meterTimer = this.setTimer(tick, 80);
            };
            this.audioContext.resume?.().catch(() => {}); tick();
        } catch (_) { /* Capture works even when the optional volume meter is unavailable. */ }
    }
    stop() { if (this.recorder?.state === 'recording' || this.recorder?.state === 'paused') this.recorder.stop(); }
    cancel() { this.generation++; this.cancelled = true; this.stop(); this.release(); }
    release() { this.clearTimer(this.meterTimer); this.audioContext?.close?.().catch(() => {}); this.audioContext = null; this.onLevel(0); this.clearTimer(this.timer); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}
