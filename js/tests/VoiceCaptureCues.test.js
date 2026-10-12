/**
 * Voz: señales y estados visibles durante una grabación.
 *
 * - Al abrirse el micrófono: tic + vibración ('start'), panel "Escuchando · 0:00"
 *   con contador, estado 'listening' (botón flotante y evento sa:voice-state).
 * - Al terminar: tic que baja ('stop') y estado 'saved' un momento (✓).
 * - Al cancelar o fallar: solo vibración ('cancel' / 'error') y vuelta a 'idle'.
 */
import { VoiceMvpUI, VOICE_LISTEN_LEAD_MS, VOICE_WARM_MS } from '../modules/features/voice/VoiceUI.js';
import { SettingsVoiceCard } from '../modules/ui/settings/SettingsVoiceCard.js';

function setup({ startFails = false, mediaDevices, storeRemove } = {}) {
    let opts = null;
    const recorder = {
        recorder: null,
        async start(options) {
            this.startOptions = options;
            if (startFails) throw new Error('Permiso denegado');
            this.recorder = { state: 'recording' };
        },
        stop() { this.recorder.state = 'inactive'; opts.onComplete({ audio: new Blob(['a'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 1200 }); },
        cancel: jest.fn(function () { if (this.recorder) this.recorder.state = 'inactive'; })
    };
    const feedback = { prime: jest.fn(), play: jest.fn(), close: jest.fn() };
    const store = { put: jest.fn().mockResolvedValue(), list: jest.fn().mockResolvedValue([]), remove: storeRemove || jest.fn().mockResolvedValue(), aliases: async () => [], close: jest.fn(), maintain: jest.fn().mockResolvedValue(), storageStatus: jest.fn().mockResolvedValue(null) };
    const ui = new VoiceMvpUI({
        getUser: () => ({ uid: 'u1' }), isEnabled: () => true, getScope: () => ({ enabled: false }),
        getEmployees: () => [], getEndpoint: () => 'https://n8n.example/voice', notify: jest.fn()
    }, { store, feedback, recorderFactory: (o) => { opts = o; return recorder; }, ...(mediaDevices ? { mediaDevices } : {}) });
    ui.mount();
    ui.render = jest.fn();
    ui.refreshMatches = jest.fn().mockResolvedValue();
    ui.dialog.showModal = jest.fn(() => { ui.dialog.open = true; });
    ui.dialog.close = jest.fn(() => { ui.dialog.open = false; });
    const states = [];
    const onState = (e) => states.push(e.detail.state);
    window.addEventListener('sa:voice-state', onState);
    return { ui, recorder, feedback, states, store, opts: () => opts, cleanup: () => { window.removeEventListener('sa:voice-state', onState); ui.destroy(); } };
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('Voz — señales al grabar', () => {
    afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

    test('al abrirse el micrófono: start, panel Escuchando con contador y estado listening', async () => {
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold();
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS);
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
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS);
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
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold({ toggle: true });
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS);
        expect(t.ui.wave.querySelector('.voice-wave-hint').textContent).toBe('Toca de nuevo para terminar');
        t.cleanup();
    });

    test('grabación por teclado sobre el botón Voz: también "Toca de nuevo"', async () => {
        jest.useFakeTimers();
        const t = setup();
        t.ui.launcher.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        await flush();
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS);
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

describe('Voz — grabar antes de mostrar "Escuchando"', () => {
    afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

    test('antes del adelanto ya graba pero sigue en arming; luego se muestra', async () => {
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold();
        expect(t.recorder.recorder.state).toBe('recording');
        expect(t.ui.wave.hidden).toBe(true);
        expect(t.feedback.play).not.toHaveBeenCalledWith('start');
        expect(t.ui.launcher.dataset.voiceState).toBe('arming');
        expect(t.states).toContain('arming');
        expect(t.states).not.toContain('listening');
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS - 1);
        expect(t.ui.wave.hidden).toBe(true);
        jest.advanceTimersByTime(1);
        expect(t.ui.wave.hidden).toBe(false);
        expect(t.feedback.play).toHaveBeenCalledWith('start');
        expect(t.ui.launcher.dataset.voiceState).toBe('listening');
        t.cleanup();
    });

    test('soltar antes del adelanto: el audio se guarda, sin start ni panel', async () => {
        jest.useFakeTimers();
        const t = setup();
        await t.ui.startHold();
        t.ui.endHold();
        await flush();
        expect(t.states).toContain('saved');
        expect(t.feedback.play).not.toHaveBeenCalledWith('start');
        jest.advanceTimersByTime(VOICE_LISTEN_LEAD_MS * 2);
        expect(t.ui.wave.hidden).toBe(true);
        expect(t.feedback.play).not.toHaveBeenCalledWith('start');
        expect(t.states).not.toContain('listening');
        t.cleanup();
    });
});

describe('Voz — micrófono pedido al tocar (warmUp)', () => {
    afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });
    const media = () => { const stop = jest.fn(); return { stop, mediaDevices: { getUserMedia: jest.fn(async () => ({ getTracks: () => [{ stop }] })) } }; };
    const down = t => { const ev = new Event('pointerdown', { bubbles: true, cancelable: true }); Object.assign(ev, { button: 0, pointerId: 3 }); t.ui.launcher.dispatchEvent(ev); };

    test('pointerdown pide el micrófono una vez y se pasa a recorder.start', async () => {
        jest.useFakeTimers();
        const m = media();
        const t = setup({ mediaDevices: m.mediaDevices });
        down(t);
        await flush();
        expect(m.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
        expect(m.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
        expect(t.recorder.startOptions.stream).toBeInstanceOf(Promise);
        expect(await t.recorder.startOptions.stream).toEqual({ getTracks: expect.any(Function) });
        expect(t.ui.warmStream).toBeNull();
        expect(m.stop).not.toHaveBeenCalled();
        t.cleanup();
    });

    test('un toque que no graba (releaseWarm) suelta las pistas', async () => {
        jest.useFakeTimers();
        const m = media();
        const t = setup({ mediaDevices: m.mediaDevices });
        t.ui.warmUp();
        t.ui.warmUp();
        expect(m.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
        t.ui.releaseWarm();
        await flush();
        expect(m.stop).toHaveBeenCalledTimes(1);
        t.cleanup();
    });

    test('finishHold antes de grabar suelta las pistas', async () => {
        jest.useFakeTimers();
        const m = media();
        const t = setup({ mediaDevices: m.mediaDevices });
        t.ui.warmUp();
        t.ui.held = true;
        t.ui.finishHold();
        await flush();
        expect(m.stop).toHaveBeenCalledTimes(1);
        t.cleanup();
    });

    test('si nadie lo usa se suelta solo tras VOICE_WARM_MS', async () => {
        jest.useFakeTimers();
        const m = media();
        const t = setup({ mediaDevices: m.mediaDevices });
        t.ui.warmUp();
        await flush();
        jest.advanceTimersByTime(VOICE_WARM_MS - 1);
        await flush();
        expect(m.stop).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await flush();
        expect(m.stop).toHaveBeenCalledTimes(1);
        t.cleanup();
    });
});

describe('Voz — beginHold no espera a borrar la toma anterior', () => {
    afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

    test('con store.remove colgado el grabador arranca igual', async () => {
        jest.useFakeTimers();
        const storeRemove = jest.fn(() => new Promise(() => {}));
        const t = setup({ storeRemove });
        t.ui.record = { uid: 'u1', requestId: 'old', projectKey: 'legacy', audio: new Blob(['x']) };
        const old = t.ui.record;
        const startSpy = jest.spyOn(t.recorder, 'start');
        await t.ui.startHold();
        expect(storeRemove).toHaveBeenCalledWith('u1', 'old');
        expect(old.discarded).toBe(true);
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(t.recorder.recorder.state).toBe('recording');
        t.cleanup();
    });
});

describe('Botón de micrófono flotante: sin gestos del sistema al mantenerlo', () => {
    const fire = (target, type, extra = {}) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(ev, { button: 0, pointerId: 7, ...extra });
        target.dispatchEvent(ev);
        return ev;
    };

    test('no selecciona ni arrastra lo de alrededor mientras se graba', async () => {
        const t = setup();
        document.body.insertAdjacentHTML('beforeend', '<span id="vecino">ASISTENCIA</span>');
        const vecino = document.getElementById('vecino');
        expect(fire(t.ui.launcher, 'touchstart').defaultPrevented).toBe(true);
        fire(t.ui.launcher, 'pointerdown');
        await flush();
        expect(document.documentElement.classList.contains('is-holding')).toBe(true);
        expect(fire(vecino, 'selectstart').defaultPrevented).toBe(true);
        expect(fire(vecino, 'dragstart').defaultPrevented).toBe(true);
        fire(t.ui.launcher, 'pointerup');
        await flush();
        expect(document.documentElement.classList.contains('is-holding')).toBe(false);
        expect(fire(vecino, 'selectstart').defaultPrevented).toBe(false);
        t.cleanup();
    });
});

describe('Configuración → General: sonido y vibración de Voz', () => {
    test('interruptor encendido por defecto; se puede apagar', () => {
        document.body.innerHTML = SettingsVoiceCard({ state: { settings: {} } });
        expect(document.getElementById('voiceFeedback').checked).toBe(true);
        document.body.innerHTML = SettingsVoiceCard({ state: { settings: { voiceFeedback: false } } });
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
