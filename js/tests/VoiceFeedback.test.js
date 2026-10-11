/**
 * Señales al grabar con Voz: un "tic" que sube y una vibración corta al
 * empezar a escuchar; un "tic" que baja y doble vibración al terminar;
 * solo vibración al cancelar o fallar. Todo es opcional: sin Web Audio o
 * sin vibración (iPhone) no falla, y el ajuste voiceFeedback lo apaga.
 */
import { createVoiceFeedback, VOICE_CUES } from '../modules/features/voice/VoiceFeedback.js';

function fakeAudio() {
    const calls = { contexts: 0, oscillators: [], resumed: 0, closed: 0 };
    class Param {
        constructor() { this.events = []; }
        setValueAtTime(v, t) { this.events.push(['set', v, t]); }
        exponentialRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); }
    }
    class Ctx {
        constructor() { calls.contexts++; this.currentTime = 10; this.state = 'suspended'; this.destination = {}; }
        resume() { calls.resumed++; this.state = 'running'; return Promise.resolve(); }
        close() { calls.closed++; return Promise.resolve(); }
        createOscillator() {
            const osc = { frequency: new Param(), connect: (g) => g, start: jest.fn(), stop: jest.fn() };
            calls.oscillators.push(osc);
            return osc;
        }
        createGain() { return { gain: new Param(), connect: (d) => d }; }
    }
    return { Ctx, calls };
}

describe('VoiceFeedback', () => {
    test('empezar: tic que sube y vibración corta', () => {
        const { Ctx, calls } = fakeAudio();
        const vibrate = jest.fn();
        const fb = createVoiceFeedback({ AudioContextImpl: Ctx, nav: { vibrate } });
        fb.play('start');
        expect(calls.oscillators).toHaveLength(1);
        const freq = calls.oscillators[0].frequency.events;
        expect(freq[0]).toEqual(['set', VOICE_CUES.start.tone[0], 10]);
        expect(freq[1][0]).toBe('ramp');
        expect(freq[1][1]).toBe(VOICE_CUES.start.tone[1]);
        expect(VOICE_CUES.start.tone[1]).toBeGreaterThan(VOICE_CUES.start.tone[0]);
        expect(vibrate).toHaveBeenCalledWith(VOICE_CUES.start.vibrate);
    });

    test('terminar: tic que baja y doble vibración', () => {
        const { Ctx, calls } = fakeAudio();
        const vibrate = jest.fn();
        createVoiceFeedback({ AudioContextImpl: Ctx, nav: { vibrate } }).play('stop');
        const [from, to] = [calls.oscillators[0].frequency.events[0][1], calls.oscillators[0].frequency.events[1][1]];
        expect(to).toBeLessThan(from);
        expect(vibrate).toHaveBeenCalledWith([12, 50, 12]);
    });

    test('cancelar y error: solo vibración, sin sonido', () => {
        const { Ctx, calls } = fakeAudio();
        const vibrate = jest.fn();
        const fb = createVoiceFeedback({ AudioContextImpl: Ctx, nav: { vibrate } });
        fb.play('cancel'); fb.play('error');
        expect(calls.oscillators).toHaveLength(0);
        expect(vibrate.mock.calls.map(c => c[0])).toEqual([VOICE_CUES.cancel.vibrate, VOICE_CUES.error.vibrate]);
    });

    test('prime() crea y activa el audio dentro del gesto; se reutiliza un solo contexto', () => {
        const { Ctx, calls } = fakeAudio();
        const fb = createVoiceFeedback({ AudioContextImpl: Ctx, nav: {} });
        fb.prime();
        expect(calls.contexts).toBe(1);
        expect(calls.resumed).toBe(1);
        fb.play('start'); fb.play('stop');
        expect(calls.contexts).toBe(1);
        fb.close();
        expect(calls.closed).toBe(1);
    });

    test('desactivado por ajuste: no suena ni vibra', () => {
        const { Ctx, calls } = fakeAudio();
        const vibrate = jest.fn();
        const fb = createVoiceFeedback({ AudioContextImpl: Ctx, nav: { vibrate }, isEnabled: () => false });
        fb.prime(); fb.play('start');
        expect(calls.contexts).toBe(0);
        expect(vibrate).not.toHaveBeenCalled();
    });

    test('sin Web Audio ni vibración (o si fallan) no rompe', () => {
        expect(() => createVoiceFeedback({ AudioContextImpl: undefined, nav: {} }).play('start')).not.toThrow();
        class Broken { constructor() { throw new Error('no audio'); } }
        const vibrate = () => { throw new Error('blocked'); };
        const fb = createVoiceFeedback({ AudioContextImpl: Broken, nav: { vibrate } });
        expect(() => { fb.prime(); fb.play('stop'); }).not.toThrow();
        expect(() => fb.play('nada')).not.toThrow();
    });
});
