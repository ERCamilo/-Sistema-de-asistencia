import { readVoiceResponse } from '../modules/features/voice/VoiceCore.js';
import { suggestedVoiceIntent } from '../modules/features/voice/VoiceIntent.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
const response = (extracted = { spokenName: 'Carlo', amount: 5000 }, intent = 'desconocida') => ({ ok: true, schemaVersion: 1, requestId: 'r1', result: { intent, transcript: 'Carlo cinco mil', employee: { spokenName: null, spokenNumber: null }, loan: null, needsReview: true, issues: [], extracted } });
function fixture(preference = 'loan') {
    const employee = { id: 'a', name: 'Carlos', number: '00125' };
    const store = { put: jest.fn(async () => {}), aliases: async () => [{ employeeId: 'a', aliases: ['carlo'] }] };
    const adapter = { getUser: () => ({ uid: 'u' }), getScope: () => ({ enabled: false }), getSettings: () => ({ voiceAmbiguousAction: preference }), getEmployees: () => [employee], getLoanDefaults: () => ({ periods: [{ payDate: '2030-01-01' }] }), onLoan: jest.fn(), onPettyCash: jest.fn(async () => {}) };
    const ui = new VoiceMvpUI(adapter, { store }); ui.render = jest.fn(); ui.close = jest.fn(); ui.dialog = { open: false, showModal: jest.fn() };
    ui.record = { uid: 'u', projectKey: 'legacy', requestId: 'r1' }; ui.applyResult(readVoiceResponse(response(), 'r1'));
    return { ui, adapter, store };
}
test('loose extraction retains fields with unknown action, and known actions can use extracted data', () => {
    expect(readVoiceResponse(response(), 'r1').extracted).toMatchObject({ spokenName: 'Carlo', amount: 5000 });
    expect(readVoiceResponse(response({ amount: 5000 }, 'crear_prestamo'), 'r1').extracted.amount).toBe(5000);
    expect(() => readVoiceResponse(response({ amount: 'five' }), 'r1')).toThrow();
});
test('unknown action retains explicit interest and combines it with a generic extracted amount', () => {
    const { ui } = fixture(); const data = response();
    data.result.loan = { principal: null, interestRate: 35, interestIncluded: null, installmentMode: null, installmentCount: null, installmentFrequencyWeeks: null, startDate: null, concept: null };
    ui.applyResult(readVoiceResponse(data, 'r1'));
    expect(ui.record.draft).toMatchObject({ principal: 5000, interestRate: 35, installmentCount: 1 });
    expect(ui.record.rateDefault).toBe(false);
});
test.each([
    [{ spokenName: 'Carlo', amount: 5000 }, 'loan', 'crear_prestamo'],
    [{ spokenName: 'Carlo', amount: 5000 }, 'cash', 'registrar_gasto_caja_chica'],
    [{ spokenName: 'Carlo', amount: 5000 }, 'ask', null],
    [{ spokenName: 'Carlo' }, 'ask', 'buscar_empleado'],
    [{ amount: 800, concept: 'Transporte' }, 'loan', null]
])('suggestion respects fields and preference', (extracted, preference, expected) => {
    expect(suggestedVoiceIntent(readVoiceResponse(response(extracted), 'r1'), preference)).toBe(expected);
});
test('unknown name and amount propose an editable loan without saving a business operation', async () => {
    const { ui, adapter } = fixture(); await ui.refreshMatches(); await ui.routeResult();
    expect(ui.view).toBe('loan'); expect(ui.record.selectedEmployeeId).toBe('a'); expect(ui.record.draft).toMatchObject({ principal: 5000, interestRate: 20, installmentCount: 1 });
    expect(ui.record.result.intent).toBe('desconocida'); expect(ui.record.manualIntent).toBe('crear_prestamo'); expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('asking preference opens selector, and a negation cannot be converted by a type change', async () => {
    const { ui, adapter } = fixture('ask'); await ui.routeResult(); expect(ui.view).toBe('intent');
    ui.record.result.issues = [{ code: 'NEGATION', field: null, message: 'No registrar' }];
    await ui.routeResult(); expect(ui.view).toBe('audio'); await expect(ui.chooseIntent('crear_prestamo')).rejects.toThrow('negación'); expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('an intent marked ambiguous uses the preference even if the model tentatively classified it', async () => {
    const { ui, adapter } = fixture('ask');
    ui.applyResult(readVoiceResponse(response({ spokenName: 'Carlo', amount: 5000 }, 'crear_prestamo'), 'r1'));
    ui.record.result.issues = [{ code: 'AMBIGUOUS_INTENT', field: 'intent', message: 'Acción dudosa' }];
    await ui.routeResult(); expect(ui.view).toBe('intent'); expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('switching keeps money and each draft, without assigning employee name as provider', async () => {
    const { ui } = fixture(); await ui.refreshMatches(); await ui.routeResult();
    ui.record.draft.interestRate = 35; ui.record.draft.principal = 7000; ui.record.draft.concept = 'Nota del préstamo';
    await ui.chooseIntent('registrar_gasto_caja_chica'); expect(ui.record.cashTransfer).toMatchObject({ amount: 7000, note: 'Nota del préstamo' });
    ui.record.cashDraft = { amount: 8000, concept: 'Transporte', note: 'Nota del gasto', paidTo: '', category: 'Otros', photoCapture: { originalName: 'receipt.jpg' } };
    await ui.chooseIntent('crear_prestamo'); expect(ui.record.draft).toMatchObject({ principal: 8000, interestRate: 35, concept: 'Nota del préstamo' }); expect(ui.record.selectedEmployeeId).toBe('a');
    await ui.chooseIntent('registrar_gasto_caja_chica'); expect(ui.record.cashDraft).toMatchObject({ amount: 8000, concept: 'Transporte', paidTo: '', photoCapture: { originalName: 'receipt.jpg' } });
});
test('first switch from a cash draft carries its edited concept and note into the loan note', async () => {
    const { ui } = fixture();
    ui.applyResult(readVoiceResponse(response({ amount: 800 }, 'registrar_gasto_caja_chica'), 'r1'));
    ui.record.cashDraft = { amount: 900, concept: 'Comida', note: 'Viaje', paidTo: 'Proveedor' };
    await ui.chooseIntent('crear_prestamo');
    expect(ui.record.draft).toMatchObject({ principal: 900, concept: 'Comida · Viaje' });
    expect(ui.record.mention.spokenName).toBeNull();
});
test('default sends after saving the recording, review setting keeps the send step', async () => {
    for (const review of [false, true]) {
        let options;
        const store = { put: jest.fn(async () => {}), list: async () => [], remove: async () => {} };
        const ui = new VoiceMvpUI({ getUser: () => ({ uid: 'u' }), getScope: () => ({ enabled: false }), getSettings: () => ({ voiceReviewBeforeSend: review }) }, { store, recorderFactory: o => { options = o; return { start: async () => {}, cancel: () => {} }; } });
        ui.showWave = jest.fn(); ui.feedback = { play: jest.fn() }; ui.setCaptureState = jest.fn(); ui.refreshMatches = jest.fn(async () => {}); ui.render = jest.fn(); ui.dialog = { open: false, showModal: jest.fn() }; ui.process = jest.fn(async () => { expect(store.put).toHaveBeenCalled(); });
        if (!global.crypto.randomUUID) global.crypto.randomUUID = () => 'record';
        await ui.action('record'); await options.onComplete({ audio: new Blob(['sound']), mimeType: 'audio/webm', durationMs: 500 });
        expect(ui.process).toHaveBeenCalledTimes(review ? 0 : 1);
    }
});
