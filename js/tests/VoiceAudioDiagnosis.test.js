import { VoiceAudioView } from '../modules/features/voice/VoiceAudioView.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VOICE_ENDPOINT, VOICE_TEST_ENDPOINT } from '../modules/features/voice/VoiceCore.js';
const button = (action, label) => `<button data-voice-action="${action}">${label}</button>`;
function render(result) {
    document.body.innerHTML = VoiceAudioView({ record: { audio: new Blob(['test']), result, durationMs: 1000 }, endpoint: () => VOICE_ENDPOINT }, button);
    return document.querySelector('.voice-audio-diagnosis');
}
test('a blocked instruction shows the original Gemini transcript and its issue messages in audio options', () => {
    const panel = render({ intent: 'buscar_empleado', transcript: 'No registres un préstamo a Carlos', issues: [{ code: 'NEGATION', field: null, message: 'La instrucción niega registrar una operación.' }] });
    expect(panel.closest('details').querySelector('summary').textContent).toBe('Opciones de audio');
    expect(panel.textContent).toContain('No registres un préstamo a Carlos');
    expect(panel.textContent).toContain('La instrucción niega registrar una operación.'); expect(panel.textContent).toContain('NEGATION');
});
test('unknown intent without issues shows what Gemini returned and does not invent a reason', () => {
    const panel = render({ intent: 'desconocida', transcript: 'Una frase poco clara', issues: [] });
    expect(panel.textContent).toContain('Una frase poco clara'); expect(panel.textContent).toContain('«desconocida» sin un motivo adicional');
});
test('missing transcripts and malicious response text are displayed safely', () => {
    expect(render({ intent: 'desconocida', transcript: '', issues: [] }).textContent).toContain('no devolvió texto reconocido');
    const untrusted = '<img src=x onerror="window.bad=1">';
    const panel = render({ intent: 'desconocida', transcript: untrusted, issues: [{ code: 'UNKNOWN', field: null, message: untrusted }] });
    expect(panel.querySelector('img')).toBeNull(); expect(panel.textContent).toContain(untrusted);
});
test('no Gemini diagnosis is invented before a result or for an accepted instruction', () => {
    expect(render(undefined)).toBeNull();
    expect(render({ intent: 'buscar_empleado', transcript: 'Busca a Carlos', issues: [] })).toBeNull();
});
test('production is default even with an old saved test preference; test selection ends on close', async () => {
    localStorage.clear(); localStorage.setItem('sa-voice-endpoint:user', VOICE_TEST_ENDPOINT);
    const ui = new VoiceMvpUI({ getUser: () => ({ uid: 'user' }), getScope: () => ({ enabled: false }), getEndpoint: () => VOICE_ENDPOINT });
    ui.render = jest.fn(); ui.dialog = { close: jest.fn(), querySelector: () => null }; ui.launcher = { focus: jest.fn() }; ui.showWave = jest.fn();
    expect(ui.endpoint()).toBe(VOICE_ENDPOINT);
    await ui.action('test-endpoint'); expect(ui.endpoint()).toBe(VOICE_TEST_ENDPOINT);
    ui.close(); expect(ui.endpoint()).toBe(VOICE_ENDPOINT);
});
