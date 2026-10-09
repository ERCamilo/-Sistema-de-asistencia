import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { indexedDB } from 'fake-indexeddb';

// jsdom lacks structuredClone; preserve Blob semantics for fake IndexedDB.
if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
};

const extracted = () => ({ transcript: 'Préstamo a Carlo de cinco mil', intent: 'crear_prestamo', employee: { spokenName: 'Carlo', spokenNumber: null }, loan: { principal: 5000, interestRate: 10, interestIncluded: false, installmentMode: 'lump', installmentCount: null, installmentFrequencyWeeks: null, startDate: '2026-10-08', concept: null }, needsReview: false, issues: [] });
function setup() {
    let user = { uid: 'one', getIdToken: async () => 'test-token' };
    const store = { put: jest.fn().mockResolvedValue(), aliases: async () => [], close: jest.fn() };
    const onLoan = jest.fn();
    const ui = new VoiceMvpUI({ getUser: () => user, getScope: () => ({ enabled: false }), getEmployees: () => [{ id: 'carlos', name: 'Carlos Méndez', number: '00125' }], getEndpoint: () => 'https://n8n.example/voice', validateLoan: () => ({ valid: true, errors: [] }), onLoan }, { store });
    ui.record = { uid: 'one', projectKey: 'legacy', requestId: 'request-1', fileBase64: 'AQID', mimeType: 'audio/webm', fileName: 'voice.webm', context: {}, result: extracted(), draft: { ...extracted().loan, principal: 6000 }, mention: { spokenName: 'Carlo' }, selectedEmployeeId: 'carlos', dirty: true };
    ui.render = jest.fn(); ui.dialog = { open: false }; ui.close = jest.fn();
    return { ui, store, onLoan, setUser: value => { user = value; } };
}

const originalFetch = global.fetch;
describe('Voice draft UI: confirmation and async boundaries', () => {
    afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
    test('a first recording is cancelled on account change even before any audio is saved', () => {
        const { ui, setUser } = setup(); let changed;
        ui.adapter.subscribeSession = callback => { changed = callback; return () => {}; };
        ui.mount(); ui.record = null; ui.recording = true; ui.recordingUid = 'one';
        setUser({ uid: 'two' }); changed();
        expect(ui.close).toHaveBeenCalled();
        ui.destroy();
    });
    test('reprocessing preserves manual edits and selection, pending result is explicit', async () => {
        const { ui, onLoan } = setup();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, schemaVersion: 1, requestId: 'request-1', result: extracted() }) });
        await ui.process();
        expect(ui.record.draft.principal).toBe(6000);
        expect(ui.record.selectedEmployeeId).toBe('carlos');
        expect(ui.record.pendingResult.loan.principal).toBe(5000);
        expect(onLoan).not.toHaveBeenCalled();
        await ui.action('loan');
        expect(onLoan).toHaveBeenCalledWith('carlos', expect.objectContaining({ principal: 6000 }));
    });
    test('negation and unresolved employee never hand off to the normal form', async () => {
        const { ui, onLoan } = setup();
        ui.record.result.issues = [{ code: 'NEGATED_ACTION', field: null, message: 'No registrar' }];
        await expect(ui.action('loan')).rejects.toThrow('negada');
        ui.record.result.issues = []; ui.record.selectedEmployeeId = null;
        await expect(ui.action('loan')).rejects.toThrow('Selecciona');
        expect(onLoan).not.toHaveBeenCalled();
    });
    test('switching account during a request does not apply returned data to the new account', async () => {
        const { ui, setUser, onLoan } = setup(); let finish; let notifyStarted; const started = new Promise(resolve => { notifyStarted = resolve; });
        global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; notifyStarted(); }));
        const pending = ui.process();
        await started;
        setUser({ uid: 'two' }); ui.record = { uid: 'two', requestId: 'request-2', projectKey: 'legacy', draft: { principal: 77 } };
        finish({ ok: true, status: 200, json: async () => ({ ok: true, schemaVersion: 1, requestId: 'request-1', result: extracted() }) });
        await pending;
        expect(ui.record.draft.principal).toBe(77); expect(ui.record.result).toBeUndefined(); expect(onLoan).not.toHaveBeenCalled();
    });
    test('reopening another recording while a request completes cannot receive the old result', async () => {
        const { ui } = setup(); ui.record.dirty = false; let finish; let notifyStarted; const started = new Promise(resolve => { notifyStarted = resolve; });
        global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; notifyStarted(); }));
        const pending = ui.process();
        await started;
        ui.record = { uid: 'one', projectKey: 'legacy', requestId: 'request-2', draft: { principal: 77 } };
        finish({ ok: true, status: 200, json: async () => ({ ok: true, schemaVersion: 1, requestId: 'request-1', result: extracted() }) });
        await pending;
        expect(ui.record.draft.principal).toBe(77); expect(ui.record.pendingResult).toBeUndefined();
    });
    test('editing the recognized identity clears the old choice and requires selecting again', async () => {
        const { ui, onLoan } = setup();
        await ui.change({ dataset: { voiceMention: 'spokenName' }, value: 'Carla' });
        expect(ui.record.selectedEmployeeId).toBeNull();
        await expect(ui.action('loan')).rejects.toThrow('Selecciona');
        expect(onLoan).not.toHaveBeenCalled();
    });
    test('the picker shows suggestions before all others and learns a rare pronunciation for future audio', async () => {
        const { ui, onLoan } = setup();
        const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
        URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};
        const store = new VoiceStore({ indexedDB, name: 'voice-ui-alias-' + Math.random() });
        try {
            ui.store = store;
            ui.adapter.getEmployees = () => [{ id: 'jean', name: 'Jean Pierre', number: '0007' }, { id: 'carlos', name: 'Carlos Méndez', number: '00125' }, { id: 'cn', name: '王小明', number: '0008' }];
            ui.dialog = document.createElement('dialog');
            ui.render = VoiceMvpUI.prototype.render.bind(ui);
            ui.record.audio = new Blob(['audio']); ui.record.selectedEmployeeId = null;
            await ui.refreshMatches(); ui.render();
            expect(ui.dialog.querySelector('[data-voice-action="select"]').dataset.id).toBe('carlos');
            expect(ui.dialog.textContent).toContain('Jean Pierre');
            expect(ui.dialog.textContent).toContain('王小明');
            expect(ui.dialog.querySelector('[data-voice-action="loan"]').disabled).toBe(true);
            const search = ui.dialog.querySelector('[data-voice-search]');
            search.value = 'MENDEZ'; search.dispatchEvent(new Event('input'));
            expect([...ui.dialog.querySelectorAll('[data-voice-name]')].filter(row => !row.hidden)).toHaveLength(1);
            search.value = '不存在'; search.dispatchEvent(new Event('input'));
            expect(ui.dialog.querySelector('[data-voice-empty]').hidden).toBe(false);
            await ui.change({ dataset: { voiceMention: 'spokenName' }, value: 'Yanpié' });
            expect(ui.matches).toHaveLength(0);
            await ui.action('select', 'jean');
            expect(ui.dialog.querySelector('[data-voice-alias]').value).toBe('Yanpié');
            await ui.action('learn');
            expect(ui.dialog.textContent).toContain('Variantes guardadas: yanpie');
            // A new recording has no selection; the saved alias offers Jean as a suggestion.
            ui.record.selectedEmployeeId = null; ui.record.requestId = 'request-2';
            store.close(); await ui.refreshMatches(); ui.render();
            expect(ui.matches[0]).toMatchObject({ employee: { id: 'jean' }, reason: 'Alias confirmado' });
            expect(ui.record.selectedEmployeeId).toBeNull();
            expect(ui.dialog.querySelector('[data-voice-action="select"]').dataset.id).toBe('jean');
            expect(onLoan).not.toHaveBeenCalled();
        } finally { store.close(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
    });
});
