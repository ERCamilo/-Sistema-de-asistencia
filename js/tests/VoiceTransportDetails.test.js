import { sendVoiceRecording, VOICE_ENDPOINT, VOICE_TEST_ENDPOINT } from '../modules/features/voice/VoiceCore.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
const record = { uid: 'user', projectKey: 'legacy', requestId: 'same-recording', fileBase64: 'AQID', mimeType: 'audio/webm', fileName: 'voice.webm', context: {} };
const call = response => sendVoiceRecording({ url: VOICE_ENDPOINT, record, getToken: async () => 'token', fetchImpl: async () => response });
test('the processing deadline also bounds an unresponsive token provider', async () => {
    const fetchImpl = jest.fn();
    await expect(sendVoiceRecording({url:VOICE_ENDPOINT,record,getToken:()=>new Promise(()=>{}),fetchImpl,timeoutMs:5})).rejects.toMatchObject({code:'PROCESSING_TIMEOUT',retryable:true});
    expect(fetchImpl).not.toHaveBeenCalled();
});
test.each([
    [400, { ok: false, error: { code: 'INVALID_AUDIO', message: 'El archivo de audio está vacío.' } }, 'INVALID_AUDIO', 'El archivo de audio está vacío.'],
    [404, { code: 404, message: 'The requested webhook is not registered.' }, '404', 'The requested webhook is not registered.'],
    [500, { error: 'Gemini service unavailable' }, 'HTTP_500', 'Gemini service unavailable'],
    [200, { ok: false, error: { code: 'GEMINI_FAILED', message: 'El modelo rechazó el formato.', retryable: true } }, 'GEMINI_FAILED', 'El modelo rechazó el formato.']
])('HTTP %s displays the actual server code and message', async (status, data, code, message) => {
    await expect(call({ status, ok: status === 200, text: async () => JSON.stringify(data) })).rejects.toMatchObject({ status, code, message: expect.stringContaining(`HTTP ${status} · ${code}: ${message}`) });
});
test('plain proxy errors are visible, HTML is not dumped into the error', async () => {
    await expect(call({ status: 403, ok: false, text: async () => 'error code: 1010' })).rejects.toThrow('error code: 1010');
    await expect(call({ status: 502, ok: false, text: async () => '<html><body>long proxy page</body></html>' })).rejects.toMatchObject({ message: expect.not.stringContaining('<html>'), status: 502 });
});
test('echoed token and audio are omitted from persistent error text', async () => {
    const secret = 'firebase-token-that-must-stay-private';
    const audio = 'audio-base64-that-must-stay-private';
    try {
        await sendVoiceRecording({ url: VOICE_ENDPOINT, record: { ...record, fileBase64: audio }, getToken: async () => secret, fetchImpl: async () => ({ status: 400, ok: false, text: async () => JSON.stringify({ message: `${secret} ${audio}` }) }) });
        throw Error('expected server failure');
    } catch (error) {
        expect(error.status).toBe(400); expect(error.message).not.toContain(secret); expect(error.message).not.toContain(audio);
    }
});
test('switching webhook presets preserves the recording and is scoped to the user', async () => {
    localStorage.clear();
    const ui = new VoiceMvpUI({ getUser: () => ({ uid: 'user' }), getScope: () => ({ enabled: false }), getEndpoint: () => VOICE_ENDPOINT });
    ui.record = { ...record }; ui.render = jest.fn();
    await ui.action('test-endpoint'); expect(ui.endpoint()).toBe(VOICE_TEST_ENDPOINT); expect(ui.record.requestId).toBe('same-recording');
    expect(localStorage.getItem('sa-voice-endpoint:other')).toBeNull();
    await ui.action('default-endpoint'); expect(ui.endpoint()).toBe(VOICE_ENDPOINT); expect(ui.record.requestId).toBe('same-recording');
});
