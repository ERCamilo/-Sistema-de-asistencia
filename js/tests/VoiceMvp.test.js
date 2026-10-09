import fs from 'fs';
import path from 'path';
import { resolveVoiceEmployees, normalizeVoiceName, readVoiceResponse, sendVoiceRecording, createVoiceContext, isVoiceEndpointAllowed, VOICE_ENDPOINT, VOICE_DEV_ENDPOINT, VOICE_DEV_ORIGIN } from '../modules/features/voice/VoiceCore.js';
import { VoiceStore, clearVoiceLocalData } from '../modules/features/voice/VoiceStore.js';
import { VoiceRecorder } from '../modules/features/voice/VoiceRecorder.js';
import { indexedDB as fakeIDB } from 'fake-indexeddb';

// jsdom does not provide structuredClone. Preserve Blob semantics in fake IDB;
// real browser persistence is checked separately.
if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    return value;
};

const result = () => ({ transcript: 'Préstamo a Carlo de cinco mil', intent: 'crear_prestamo', employee: { spokenName: 'Carlo', spokenNumber: null }, loan: { principal: 5000, interestRate: null, interestIncluded: null, installmentMode: null, installmentCount: null, installmentFrequencyWeeks: null, startDate: null, concept: null }, needsReview: true, issues: [], evidence: {} });
const reply = (id = 'req-1') => ({ ok: true, schemaVersion: 1, requestId: id, result: result() });
const employees = [{ id: 'a', name: 'Carlos Méndez', number: '00125' }, { id: 'b', name: 'Carla Medina', number: '00126' }];
const aliases = [{ employeeId: 'a', aliases: ['carlo', 'carl', 'carlito'] }, { employeeId: 'b', aliases: ['carla', 'carl', 'carlita'] }];

describe('Voice MVP: extraction contract and local matching', () => {
    test.each([['Carlo', 'a'], ['Carlita', 'b']])('%s resolves locally', (name, id) => {
        expect(resolveVoiceEmployees({ spokenName: name }, employees, aliases)[0].employee.id).toBe(id);
    });
    test('shared aliases require choice; exact number takes precedence without dropping zeroes', () => {
        expect(resolveVoiceEmployees({ spokenName: 'Carl' }, employees, aliases).filter(x => x.score === 1)).toHaveLength(2);
        expect(resolveVoiceEmployees({ spokenNumber: '00126', spokenName: 'Carlos' }, employees, aliases)[0].employee.id).toBe('b');
        expect(resolveVoiceEmployees({ spokenNumber: '126' }, employees, aliases)[0].employee.id).toBe('b');
    });
    test('non-Latin names remain searchable and aliases associate unrelated pronunciations locally', () => {
        const list = [{ id: 'jp', name: 'Jean Pierre', number: '7' }, { id: 'cn', name: '王小明', number: '8' }, { id: 'ru', name: 'Алексей', number: '9' }];
        expect(normalizeVoiceName('王小明')).toBe('王小明');
        expect(resolveVoiceEmployees({ spokenName: '王小明' }, list)[0].employee.id).toBe('cn');
        expect(resolveVoiceEmployees({ spokenName: 'Алексей' }, list)[0].employee.id).toBe('ru');
        expect(resolveVoiceEmployees({ spokenName: 'Pierre Jean' }, list)[0].employee.id).toBe('jp');
        expect(resolveVoiceEmployees({ spokenName: 'Yanpié' }, list, [{ employeeId: 'jp', aliases: ['YANPIÉ'] }])[0]).toMatchObject({ employee: { id: 'jp' }, score: 1, reason: 'Alias confirmado' });
        expect(resolveVoiceEmployees({ spokenNumber: '999', spokenName: 'Jean' }, list)).toEqual([]);
    });
    test('absent interest stays null and untrusted IDs are stripped', () => {
        const raw = reply(); raw.result.employee.id = 'external';
        expect(readVoiceResponse(raw, 'req-1').loan.interestRate).toBeNull();
        expect(readVoiceResponse(raw, 'req-1').employee.id).toBeUndefined();
    });
    test.each([d => { d.requestId = 'other'; }, d => { d.result.loan.principal = '5000'; }, d => { d.result.intent = 'save'; }, d => { d.result.needsReview = 'false'; }])('malformed provider response cannot become a draft', alter => {
        const raw = reply(); alter(raw); expect(() => readVoiceResponse(raw, 'req-1')).toThrow();
    });
    test('date context is fixed before transport', () => {
        expect(createVoiceContext(new Date('2026-10-08T12:00:00Z'), 'UTC')).toEqual({ language: 'es-DO', timeZone: 'UTC', localDate: '2026-10-08' });
    });
});

describe('Voice transport', () => {
    test('public configuration uses HTTPS and retains the scoped local HTTP exception', () => {
        const root = path.resolve(__dirname, '../..');
        const config = fs.readFileSync(path.join(root, 'js/modules/config/Config.js'), 'utf8');
        const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
        expect(config).toContain(`VOICE_WEBHOOK_URL: "${VOICE_ENDPOINT}"`);
        expect(isVoiceEndpointAllowed(VOICE_ENDPOINT, 'https://test-sa-voice-mvp.sistema-de-asistencia.pages.dev')).toBe(true);
        expect(headers).toContain(`connect-src 'self' ${VOICE_DEV_ENDPOINT}`);
    });
    test.each([
        [VOICE_DEV_ENDPOINT, VOICE_DEV_ORIGIN, true],
        [VOICE_DEV_ENDPOINT, 'http://localhost:8080', false],
        [VOICE_DEV_ENDPOINT, 'https://sa.example', false],
        ['http://100.91.16.14:5678/webhook/other', VOICE_DEV_ORIGIN, false],
        [VOICE_DEV_ENDPOINT + '?other=1', VOICE_DEV_ORIGIN, false],
        ['http://100.91.16.15:5678/webhook/sa-voice-v1-dev', VOICE_DEV_ORIGIN, false],
        ['http://100.91.16.14:5679/webhook/sa-voice-v1-dev', VOICE_DEV_ORIGIN, false],
        ['https://user:password@n8n.example/voice', VOICE_DEV_ORIGIN, false],
        ['https://n8n.example/voice', 'https://sa.example', true]
    ])('endpoint %s from %s: allowed=%s', (url, origin, allowed) => {
        expect(isVoiceEndpointAllowed(url, origin)).toBe(allowed);
    });
    test('forbidden HTTP endpoint is rejected before reading a token or sending bytes', async () => {
        const getToken = jest.fn(); const fetchImpl = jest.fn();
        await expect(sendVoiceRecording({ url: VOICE_DEV_ENDPOINT, origin: 'http://localhost:8080', record: {}, getToken, fetchImpl })).rejects.toThrow('127.0.0.1:8080');
        expect(getToken).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    });
    const record = { requestId: 'req-1', mimeType: 'audio/webm;codecs=opus', fileName: 'voice.webm', fileBase64: 'AQID', context: { language: 'es-DO', localDate: '2026-10-08', timeZone: 'UTC' }, employeeId: 'private', aliases };
    test('401 refresh retains request identity and never sends employees', async () => {
        const fetchImpl = jest.fn().mockResolvedValueOnce({ status: 401, ok: false }).mockResolvedValueOnce({ status: 200, ok: true, json: async () => reply() });
        const getToken = jest.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
        await sendVoiceRecording({ url: 'https://n8n.example/voice', record, getToken, fetchImpl });
        expect(getToken.mock.calls).toEqual([[false], [true]]);
        const bodies = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(bodies[0].requestId).toBe(bodies[1].requestId);
        expect(bodies[1].idToken).toBe('new');
        expect(Object.keys(bodies[0]).sort()).toEqual(['schemaVersion', 'requestId', 'fileBase64', 'mimeType', 'fileName', 'idToken', 'context'].sort());
    });
    test('429 carries Retry-After; forbidden and network failures stay distinct', async () => {
        const args = { url: 'https://n8n.example/voice', record, getToken: async () => 'token' };
        await expect(sendVoiceRecording({ ...args, fetchImpl: async () => ({ status: 429, ok: false, headers: { get: () => '30' }, json: async () => ({ error: { code: 'RATE_LIMITED' } }) }) })).rejects.toMatchObject({ status: 429, retryAfterMs: 30000, retryable: true });
        await expect(sendVoiceRecording({ ...args, fetchImpl: async () => ({ status: 403, ok: false, json: async () => ({}) }) })).rejects.toMatchObject({ status: 403, retryable: false });
        await expect(sendVoiceRecording({ ...args, fetchImpl: async () => { throw Error('network'); } })).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    });
});

describe('Voice local persistence', () => {
    test('full local wipe clears audio and aliases from the separate MVP database', async () => {
        const store = new VoiceStore({ indexedDB: fakeIDB });
        await store.put({ uid: 'wipe-user', requestId: 'wipe-record', projectKey: 'legacy', audio: new Blob(['test']) });
        await store.saveAlias('wipe-user', 'legacy', 'a', 'Carlo');
        await clearVoiceLocalData(fakeIDB);
        expect(await store.list('wipe-user', 'legacy')).toHaveLength(0);
        expect(await store.aliases('wipe-user', 'legacy')).toHaveLength(0);
        store.close();
    });
    test('audio, edited draft and request identity survive reopening; users stay isolated', async () => {
        const name = 'voice-' + Math.random();
        const store = new VoiceStore({ indexedDB: fakeIDB, name });
        await store.put({ uid: 'one', requestId: 'r', projectKey: 'p', audio: new Blob(['audio']), context: { localDate: '2026-10-08' }, draft: { principal: 6000 }, dirty: true });
        await store.saveAlias('one', 'p', 'a', 'Carlo');
        store.close();
        const reopened = new VoiceStore({ indexedDB: fakeIDB, name });
        const saved = await reopened.get('one', 'r');
        expect(saved.requestId).toBe('r'); expect(saved.audio.size).toBe(5); expect(saved.draft.principal).toBe(6000); expect(saved.dirty).toBe(true);
        expect(await reopened.list('two', 'p')).toHaveLength(0);
        expect(await reopened.aliases('two', 'p')).toHaveLength(0);
        expect((await reopened.aliases('one', 'p'))[0].aliases).toEqual(['carlo']);
        await reopened.remove('one', 'r'); expect(await reopened.get('one', 'r')).toBeUndefined();
        reopened.close();
    });
});

describe('Voice recorder lifecycle', () => {
    test('oversized audio is not offered for processing and frees the microphone', async () => {
        const onError = jest.fn(); const onComplete = jest.fn(); const stopTrack = jest.fn(); let native;
        class FakeRecorder {
            static isTypeSupported() { return true; }
            constructor() { native = this; this.mimeType = 'audio/webm'; this.state = 'inactive'; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.onstop(); }
        }
        const capture = new VoiceRecorder({ Recorder: FakeRecorder, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) }, onError, onComplete });
        await capture.start(); native.ondataavailable({ data: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) });
        expect(onComplete).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalled();
    });
    test('negotiates actual MIME, preserves chunks, limits duration and releases microphone', async () => {
        const stopTrack = jest.fn(); let recorder; let timer;
        class FakeRecorder {
            static isTypeSupported(type) { return type.startsWith('audio/mp4'); }
            constructor() { recorder = this; this.mimeType = 'audio/mp4'; this.state = 'inactive'; }
            start() { this.state = 'recording'; }
            stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/mp4' }) }); this.onstop(); }
        }
        const onComplete = jest.fn();
        const capture = new VoiceRecorder({ mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) }, Recorder: FakeRecorder, onComplete, setTimer: fn => { timer = fn; return 1; }, clearTimer: jest.fn() });
        await capture.start(); expect(recorder.mimeType).toBe('audio/mp4'); timer();
        expect(onComplete.mock.calls[0][0].mimeType).toBe('audio/mp4'); expect(stopTrack).toHaveBeenCalled();
    });
    test('cancel while permission dialog is open never starts a recorder', async () => {
        let grant; const stopTrack = jest.fn(); const Recorder = jest.fn(); Recorder.isTypeSupported = () => true;
        const capture = new VoiceRecorder({ mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) }, Recorder, onComplete: jest.fn() });
        const pending = capture.start(); capture.cancel(); grant({ getTracks: () => [{ stop: stopTrack }] }); await pending;
        expect(Recorder).not.toHaveBeenCalled(); expect(stopTrack).toHaveBeenCalled();
    });
});

test('discarding a recording aborts the pending transport request', async () => {
    const external = new AbortController(); let signal;
    const fetchImpl = jest.fn((url, options) => new Promise((resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), {name:'AbortError'})), {once:true});
    }));
    const pending = sendVoiceRecording({url:'https://n8n.example/voice',record:{requestId:'cancel',fileBase64:'AQID',mimeType:'audio/webm',fileName:'voice.webm',context:{}},getToken:async()=> 'token',externalSignal:external.signal,fetchImpl});
    await Promise.resolve(); external.abort();
    await expect(pending).rejects.toMatchObject({code:'PROCESSING_TIMEOUT'});
    expect(signal.aborted).toBe(true); expect(fetchImpl).toHaveBeenCalledTimes(1);
});
