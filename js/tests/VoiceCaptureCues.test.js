/**
 * Voz: señales y estados visibles durante una grabación.
 *
 * - Al abrirse el micrófono: tic + vibración ('start'), panel "Escuchando · 0:00"
 *   con contador, estado 'listening' (botón flotante y evento sa:voice-state).
 * - Al terminar: tic que baja ('stop') y estado 'saved' un momento (✓).
 * - Al cancelar o fallar: solo vibración ('cancel' / 'error') y vuelta a 'idle'.
 */
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

function setup({ startFails = false } = {}) {
    let opts = null;
    const recorder = {
        recorder: null,
        async start() {
            if (startFails) throw new Error('Permiso denegado');
            this.recorder = { state: 'recording' };
        },
        stop() { this.recorder.state = 'inactive'; opts.onComplete({ audio: new Blob(['a'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 1200 }); },
        cancel: jest.fn(function () { if (this.recorder) this.recorder.state = 'inactive'; })
    };
    const feedback = { prime: jest.fn(), play: jest.fn(), close: jest.fn() };
    const store = { put: jest.fn().mockResolvedValue(), list: jest.fn().mockResolvedValue([]), remove: jest.fn().mockResolvedValue(), aliases: async () => [], close: jest.fn(), maintain: jest.fn().mockResolvedValue(), storageStatus: jest.fn().mockResolvedValue(null) };
    const ui = new VoiceMvpUI({
        getUser: () => ({ uid: 'u1' }), isEnabled: () => true, getScope: () => ({ enabled: false }),
        getEmployees: () => [], getEndpoint: () => 'https://n8n.example/voice', notify: jest.fn()
    }, { store, feedback, recorderFactory: (o) => { opts = o; return recorder; } });
    ui.mount();
    ui.render = jest.fn();
    ui.refreshMatches = jest.fn().mockResolvedValue();
    ui.dialog.showModal = jest.fn(() => { ui.dialog.open = true; });
    ui.dialog.close = jest.fn(() => { ui.dialog.open = false; });
    const states = [];
    const onState = (e) => states.push(e.detail.state);
    window.addEventListener('sa:voice-state', onState);
    return { ui, recorder, feedback, states, opts: () => opts, cleanup: () => { window.removeEventListener('sa:voice-state', onState); ui.destroy(); } };
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('Voz — señales al grabar', () => {
    afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

    test('al abrirse el micrófono: start, panel Escuchando con contador y estado listening', async () => {
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold();
        expect(t.feedback.prime).toHaveBeenCalled();
        expect(t.feedback.play).toHaveBeenCalledWith('start');
        expect(t.ui.wave.hidden).toBe(false);
        expect(t.ui.wave.querySelector('[role=status]').textContent).toBe('Escuchando · 0:00');
        expect(t.ui.wave.querySelector('.voice-wave-hint').textContent).toBe('Suelta para terminar');
        expect(t.ui.launcher.dataset.voiceState).toBe('listening');
        expect(t.states).toContain('listening');
        jest.advanceTimersByTime(3000);
        expect(t.ui.wave.querySelector('[role=status]').textContent).toBe('Escuchando · 0:03');
        t.cleanup();
    });

    test('al terminar: stop, estado saved (✓) y luego idle; el contador se detiene', async () => {
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold();
        t.ui.endHold();
        await flush();
        expect(t.feedback.play).toHaveBeenCalledWith('stop');
        expect(t.ui.launcher.dataset.voiceState).toBe('saved');
        expect(t.states).toEqual(expect.arrayContaining(['listening', 'saved']));
        expect(t.ui.wave.hidden).toBe(true);
        jest.advanceTimersByTime(1500);
        expect(t.ui.launcher.dataset.voiceState).toBe('idle');
        expect(t.states[t.states.length - 1]).toBe('idle');
        t.cleanup();
    });

    test('cancelar a mitad (otra app, Escape): solo vibración de cancelación', async () => {
        const t = setup();
        await t.ui.startHold();
        t.ui.cancelHold();
        expect(t.feedback.play).toHaveBeenCalledWith('cancel');
        expect(t.feedback.play).not.toHaveBeenCalledWith('stop');
        expect(t.ui.launcher.dataset.voiceState).toBe('idle');
        t.cleanup();
    });

    test('si el micrófono no abre: vibración de error y estado idle', async () => {
        const t = setup({ startFails: true });
        await t.ui.startHold();
        expect(t.feedback.play).toHaveBeenCalledWith('error');
        expect(t.feedback.play).not.toHaveBeenCalledWith('start');
        expect(t.ui.launcher.dataset.voiceState).toBe('idle');
        t.cleanup();
    });

    test('un fallo del grabador durante la toma: vibración de error', async () => {
        const t = setup();
        await t.ui.startHold();
        t.opts().onError(new Error('Falló la grabación.'));
        expect(t.feedback.play).toHaveBeenCalledWith('error');
        expect(t.ui.launcher.dataset.voiceState).toBe('idle');
        t.cleanup();
    });

    test('grabación por toque (Dictar del menú): la indicación dice cómo terminar', async () => {
        const t = setup();
        await t.ui.startHold({ toggle: true });
        expect(t.ui.wave.querySelector('.voice-wave-hint').textContent).toBe('Toca de nuevo para terminar');
        t.cleanup();
    });

    test('grabación por teclado sobre el botón Voz: también "Toca de nuevo"', async () => {
        const t = setup();
        t.ui.launcher.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        await flush();
        expect(t.feedback.prime).toHaveBeenCalled();
        expect(t.ui.wave.querySelector('.voice-wave-hint').textContent).toBe('Toca de nuevo para terminar');
        t.cleanup();
    });

    test('las barras tienen alturas distintas (forma de onda), no todas iguales', () => {
        const t = setup();
        const ks = [...t.ui.wave.querySelectorAll('.voice-wave-bars i')].map(i => i.style.getPropertyValue('--k'));
        expect(ks).toHaveLength(21);
        expect(new Set(ks).size).toBeGreaterThan(5);
        t.cleanup();
    });
});

describe('Configuración → Tests: sonido y vibración de Voz', () => {
    test('interruptor encendido por defecto; se puede apagar', () => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.getElementById('voiceFeedback').checked).toBe(true);
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { voiceFeedback: false } } });
        expect(document.getElementById('voiceFeedback').checked).toBe(false);
    });

    test('apagado en ajustes: la grabación no suena ni vibra', async () => {
        const vibrate = jest.fn();
        Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
        let settings = { voiceFeedback: false };
        const ui = new VoiceMvpUI({ getUser: () => ({ uid: 'u1' }), getSettings: () => settings }, { store: { close: jest.fn() } });
        ui.feedback.play('start');
        expect(vibrate).not.toHaveBeenCalled();
        settings = {};
        ui.feedback.play('start');
        expect(vibrate).toHaveBeenCalledWith(18);
        delete navigator.vibrate;
    });
});
