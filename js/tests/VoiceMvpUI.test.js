import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { indexedDB } from 'fake-indexeddb';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

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
    ui.record = { uid: 'one', projectKey: 'legacy', requestId: 'request-1', createdAt: Date.UTC(2026, 9, 9, 13, 30), fileBase64: 'AQID', mimeType: 'audio/webm', fileName: 'voice.webm', context: { timeZone: 'America/Santo_Domingo' }, result: extracted(), draft: { ...extracted().loan, principal: 6000, dueDate: '2030-12-31' }, mention: { spokenName: 'Carlo' }, selectedEmployeeId: 'carlos', dirty: true };
    ui.render = jest.fn(); ui.dialog = { open: false }; ui.close = jest.fn();
    return { ui, store, onLoan, setUser: value => { user = value; } };
}

const originalFetch = global.fetch;
describe('Voice draft UI: confirmation and async boundaries', () => {
    afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
    test('Tests offers an opt-in voice switch and renders its saved state', () => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.getElementById('voiceMvpEnabled').checked).toBe(false);
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { voiceMvpEnabled: true } } });
        expect(document.getElementById('voiceMvpEnabled').checked).toBe(true);
    });
    test('disabling voice hides the launcher, stops capture and retains saved drafts', async () => {
        const { ui, store } = setup(); let enabled = false; let notify;
        ui.adapter.isEnabled = () => enabled;
        const unsubscribe = jest.fn();
        ui.adapter.subscribeEnabled = callback => { notify = callback; return unsubscribe; };
        ui.close = VoiceMvpUI.prototype.close.bind(ui);
        ui.mount(); ui.dialog.close = () => { ui.dialog.open = false; };
        expect(ui.launcher.hidden).toBe(true);
        await expect(ui.open()).rejects.toThrow('Configuración');
        enabled = true; notify(); expect(ui.launcher.hidden).toBe(false);
        const cancel = jest.fn(); ui.recorder = { cancel }; ui.recording = true; ui.dialog.open = true;
        enabled = false; notify();
        expect(cancel).toHaveBeenCalled(); expect(ui.recording).toBe(false); expect(ui.dialog.open).toBe(false);
        expect(ui.launcher.hidden).toBe(true); expect(ui.record.draft.principal).toBe(6000);
        expect(store.put).not.toHaveBeenCalled();
        ui.destroy(); expect(unsubscribe).toHaveBeenCalled();
    });
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
        expect(onLoan).toHaveBeenCalledWith('carlos', expect.objectContaining({ principal: 6000, concept: expect.stringContaining('voice - el') }), expect.objectContaining({ requestId: 'request-1' }));
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
    test('previous-rate preference applies only to defaults; an explicit or edited rate wins', async () => {
        const { ui } = setup();
        ui.adapter.getLoanDefaults = employee => ({ previousRate: employee ? 15 : null, usePrevious: true, periods: [{ payDate: '2030-12-31' }] });
        const response = extracted(); response.loan.interestRate = null;
        ui.applyResult(response);
        expect(ui.record.draft.interestRate).toBe(20);
        await ui.action('select', 'carlos'); expect(ui.record.draft.interestRate).toBe(15);
        await ui.change({ dataset: { voiceField: 'interestRate' }, value: '0' });
        await ui.action('select', 'carlos'); expect(ui.record.draft.interestRate).toBe(0);
        response.loan.interestRate = 30; ui.applyResult(response);
        await ui.action('select', 'carlos'); expect(ui.record.draft.interestRate).toBe(30);
    });
    test('a confirmed recording registers once and keeps the draft if duplicate review is cancelled', async () => {
        const { ui, onLoan } = setup();
        onLoan.mockResolvedValueOnce(null); await ui.action('loan');
        expect(ui.close).not.toHaveBeenCalled();
        onLoan.mockResolvedValueOnce({ id: 'loan-1' }); await ui.action('loan');
        expect(ui.record.completedLoanId).toBe('loan-1');
        await expect(ui.action('loan')).rejects.toThrow('ya registró');
        expect(onLoan).toHaveBeenCalledTimes(2);
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
            expect(ui.dialog.querySelector('[data-voice-field]')).toBeNull();
            await ui.action('choose');
            expect(ui.dialog.textContent).toContain('Jean Pierre');
            expect(ui.dialog.textContent).toContain('王小明');
            expect(ui.dialog.querySelector('[data-voice-action="loan"]')).toBeNull();
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


describe('Voice modal continuity and inline confirmations', () => {
    let ui;
    beforeEach(() => {
        ({ ui } = setup());
        ui.dialog = document.createElement('dialog'); document.body.append(ui.dialog);
        ui.dialog.open = true;
        ui.record.audio = new Blob(['audio'], { type: 'audio/webm' });
        ui.render = VoiceMvpUI.prototype.render.bind(ui);
        URL.createObjectURL = jest.fn(() => 'blob:voice-test');
        URL.revokeObjectURL = jest.fn();
        ui.render();
    });
    afterEach(() => { ui.dialog.remove(); jest.restoreAllMocks(); });
    test('editing the loan preserves input, cursor, disclosure and scroll', async () => {
        const shell = ui.dialog;
        const input = shell.querySelector('[data-voice-field=concept]');
        const audio = shell.querySelector('audio');
        const body = shell.querySelector('.voice-body');
        const details = shell.querySelector('details'); details.open = true;
        body.scrollTop = 180;
        input.value = 'Herramientas'; input.focus(); input.setSelectionRange(3, 6);
        await ui.change(input);
        expect(shell.querySelector('[data-voice-field=concept]')).toBe(input);
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, 6]);
        expect(shell.querySelector('audio')).toBeNull();
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(body.scrollTop).toBe(180);
        expect(details.open).toBe(true);
        expect(shell.querySelectorAll('.voice-primary')).toHaveLength(1);
    });
    test('inline confirmation cancels without registering and explicitly accepts', async () => {
        const pending = ui.confirmInline('¿Registrar un préstamo parecido?');
        expect(ui.dialog.querySelector('.voice-body').inert).toBe(true);
        expect(document.activeElement.dataset.voiceAction).toBe('confirm-cancel');
        await ui.action('loan'); expect(ui.adapter.onLoan).not.toHaveBeenCalled();
        await ui.action('confirm-cancel'); await expect(pending).resolves.toBe(false);
        expect(ui.dialog.querySelector('.voice-body').inert).toBe(false);
        const accepted = ui.confirmInline('¿Reemplazar las ediciones?');
        await ui.action('confirm-accept'); await expect(accepted).resolves.toBe(true);
    });
    test('a needsReview draft explains why its only primary action is disabled', () => {
        ui.record.result.needsReview = true; ui.render();
        expect(ui.dialog.querySelector('.voice-primary').disabled).toBe(true);
        expect(ui.dialog.querySelector('.voice-hint').textContent).toMatch('revisaste las advertencias');
    });
});

describe('Simplified voice workflow', () => {
    test('unique exact match continues directly, shared names and conflicting number require a choice', async () => {
        const { ui } = setup();
        ui.record.selectedEmployeeId = null; ui.matches = [{employee:ui.adapter.getEmployees()[0],score:1}];
        await ui.routeResult(); expect(ui.view).toBe('loan'); expect(ui.record.selectedEmployeeId).toBe('carlos');
        ui.record.selectedEmployeeId = null; ui.matches.push({employee:{id:'other'},score:1});
        await ui.routeResult(); expect(ui.view).toBe('employees'); expect(ui.record.selectedEmployeeId).toBeNull();
        ui.matches = [ui.matches[0]]; ui.record.mention={spokenName:'Carla Medina',spokenNumber:'00125'};
        await ui.routeResult(); expect(ui.view).toBe('employees');
    });
    test('changing employee preserves the whole draft; historical rate requires an explicit action', async () => {
        const { ui } = setup();
        ui.adapter.getEmployees=()=>[{id:'carlos',name:'Carlos Méndez'},{id:'carla',name:'Carla Medina'}];
        ui.adapter.getLoanDefaults=()=>({previousRate:30});
        ui.record.rateDefault=true; ui.record.employeeDefaultsApplied=true;
        const draft={...ui.record.draft};
        await ui.action('choose'); await ui.action('select','carla');
        expect(ui.record.selectedEmployeeId).toBe('carla'); expect(ui.record.draft).toEqual(draft);
        await ui.action('previous-interest'); expect(ui.record.draft).toEqual({...draft,interestRate:30});
    });
    test('cancel removes pending audio and a late provider response cannot restore it', async () => {
        const {ui,store}=setup();let resolve;
        store.remove=jest.fn().mockResolvedValue();
        global.fetch=jest.fn(()=>new Promise(done=>{resolve=done;}));
        const processing=ui.process(); await Promise.resolve(); await Promise.resolve();
        ui.close=VoiceMvpUI.prototype.close.bind(ui); ui.dialog.close=jest.fn(); ui.launcher={focus:jest.fn(),setAttribute:jest.fn()};
        const record=ui.record; await ui.action('close');
        expect(record.discarded).toBe(true); expect(store.remove).toHaveBeenCalledWith('one','request-1');
        const writes=store.put.mock.calls.length;
        resolve({ok:true,status:200,json:async()=>({ok:true,schemaVersion:1,requestId:'request-1',result:extracted()})});
        await processing; expect(store.put.mock.calls.length).toBe(writes);
        global.fetch=originalFetch;
    });
    test('no-retention keeps the normal loan registration but removes its audio', async () => {
        const {ui,onLoan,store}=setup();
        ui.record.audio=new Blob(['audio']); ui.adapter.getSettings=()=>({voiceKeepLoanAudio:false});
        onLoan.mockResolvedValue({id:'registered'}); await ui.action('loan');
        expect(ui.record.completedLoanId).toBe('registered'); expect(ui.record.audio).toBeUndefined();
        expect(store.put).toHaveBeenCalledWith(expect.objectContaining({completedLoanId:'registered',audioDiscardedAt:expect.any(Number)}));
    });
    test('keyboard start-stop and release during permission do not record after release', async () => {
        const {ui,store}=setup(); store.remove=jest.fn().mockResolvedValue();
        let permitted; const stop=jest.fn(); let constructed=0;
        const {VoiceRecorder}=await import('../modules/features/voice/VoiceRecorder.js');
        ui.recorderFactory=options=>new VoiceRecorder({...options, mediaDevices:{getUserMedia:()=>new Promise(resolve=>{permitted=resolve;})},Recorder:class {constructor(){constructed++;}}});
        const starting=ui.beginHold(); await Promise.resolve(); await Promise.resolve();
        ui.finishHold(); permitted({getTracks:()=>[{stop}]}); await starting;
        expect(constructed).toBe(0); expect(stop).toHaveBeenCalled(); expect(ui.recording).toBe(false);
    });
});
