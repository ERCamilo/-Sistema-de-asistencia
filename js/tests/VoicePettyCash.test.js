import { readVoiceResponse } from '../modules/features/voice/VoiceCore.js';
import { VoicePettyCashUI } from '../modules/features/voice/VoicePettyCashUI.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
const response = () => ({ ok: true, schemaVersion: 1, requestId: 'cash-1', result: {
    transcript: 'Caja chica 800 por transporte', intent: 'registrar_gasto_caja_chica',
    employee: { spokenName: null, spokenNumber: null }, loan: null,
    pettyCash: { amount: 800, concept: 'Transporte', date: null, note: null, paidTo: null, spokenCategory: 'Transporte' },
    needsReview: false, issues: []
} });
let fixtures = [];
function fixture() {
    let allowed = true;
    const context = { projects: [{ id: 'obra', name: 'Obra Centro' }], periods: [{ id: 'period', projectId: 'obra', label: 'Periodo actual' }], selectedPeriodId: 'period', categories: ['Transporte', 'Otros'] };
    const adapter = { getContext: () => context, preparePhoto: jest.fn(async () => ({ originalBlob: new Blob(['photo']), processingDataUrl: 'data:image/jpeg;base64,AQID', previewDataUrl: 'data:image/jpeg;base64,AQID' })), scan: jest.fn(), save: jest.fn(async () => ({ id: 'movement' })), onSaved: jest.fn() };
    const bridge = { guard: () => { if (!allowed) throw Error('Cambió la cuenta'); }, save: jest.fn(async () => {}), remove: jest.fn(async () => {}) };
    const record = { requestId: 'cash-1', context: { localDate: '2026-10-11' }, result: readVoiceResponse(response(), 'cash-1'), transcript: response().result.transcript };
    const ui = new VoicePettyCashUI(adapter).mount(); fixtures.push(ui);
    return { ui, adapter, bridge, record, context, deny: () => { allowed = false; } };
}
beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { fixtures.forEach(ui => ui.destroy()); fixtures = []; document.body.innerHTML = ''; });
test('cash contract accepts null missing values without changing legacy responses', () => {
    const parsed = readVoiceResponse(response(), 'cash-1'); expect(parsed.pettyCash.amount).toBe(800); expect(parsed.pettyCash.date).toBeNull();
    for (const patch of [{ amount: '800' }, { concept: undefined }, { date: 'ayer' }, { date: '2026-99-99' }]) {
        const data = response(); Object.assign(data.result.pettyCash, patch); expect(() => readVoiceResponse(data, 'cash-1')).toThrow();
    }
    const mixed = response(); mixed.result.employee.spokenName = 'Carlos'; expect(() => readVoiceResponse(mixed, 'cash-1')).toThrow();
});
test('cash routes directly without matching employee names', async () => {
    const onPettyCash = jest.fn();
    const ui = new VoiceMvpUI({ onPettyCash });
    ui.record = { result: readVoiceResponse(response(), 'cash-1') }; ui.close = jest.fn(); ui.selected = jest.fn(() => { throw Error('employee lookup'); });
    await ui.routeResult(); expect(onPettyCash).toHaveBeenCalled(); expect(ui.selected).not.toHaveBeenCalled();
    ui.record.result.issues = [{ code: 'NEGATION', field: null, message: 'No registrar' }];
    await ui.routeResult(); expect(onPettyCash).toHaveBeenCalledTimes(1);
});
test('draft uses local date, explicit category/destination and writes only on confirmation', async () => {
    const { ui, adapter, bridge, record } = fixture(); await ui.open(record, bridge);
    expect(ui.draft.date).toBe('2026-10-11'); expect(adapter.save).not.toHaveBeenCalled();
    expect(ui.dialog.querySelector('[data-cash-action=save]').disabled).toBe(false);
    await ui.action('save'); expect(adapter.save).toHaveBeenCalledTimes(1); expect(bridge.remove).toHaveBeenCalledTimes(1); expect(ui.dialog.open).toBe(false);
});
test('missing and ambiguous fields block confirmation and never silently use today', async () => {
    const { ui, bridge, record, adapter } = fixture(); record.result.pettyCash.amount = null; record.result.pettyCash.spokenCategory = null;
    record.result.issues = [{ code: 'AMBIGUOUS_DATE', field: 'pettyCash.date', message: 'Fecha dudosa' }];
    await ui.open(record, bridge); expect(ui.draft.date).toBe(''); expect(ui.problem()).toContain('monto');
    await expect(ui.action('save')).rejects.toThrow(); expect(adapter.save).not.toHaveBeenCalled();
    ui.draft.amount = 100; ui.draft.date = '2026-99-99'; expect(ui.problem()).toContain('fecha');
    ui.draft.date = '2026-10-11'; ui.draft.category = 'Otros'; expect(ui.problem()).toContain('pendientes');
});
test('photo and OCR proposal retain dictated edits until explicit selected application', async () => {
    const { ui, bridge, record, adapter } = fixture(); await ui.open(record, bridge);
    const input = ui.dialog.querySelector('[data-cash-file]'); Object.defineProperty(input, 'files', { value: [new Blob(['photo'])] });
    await ui.change(input); expect(ui.draft.hasReceipt).toBe(true); expect(adapter.save).not.toHaveBeenCalled();
    adapter.scan.mockResolvedValue({ got: true, amount: 1200, description: 'Factura', date: '2026-10-09', fiscal: { ncf: 'test' } });
    ui.draft.concept = 'Mi edición'; await ui.action('scan'); expect(ui.draft.concept).toBe('Mi edición'); expect(ui.draft.amount).toBe(800);
    ui.dialog.querySelector('[data-cash-ocr=amount]').checked = true;
    await ui.action('apply-ocr'); expect(ui.draft.amount).toBe(1200); expect(ui.draft.concept).toBe('Mi edición'); expect(ui.draft.ocr).toBeNull();
    await ui.action('remove-photo'); expect(ui.draft.hasReceipt).toBe(false);
});
test('failed OCR and registration preserve the draft, cancellation creates nothing', async () => {
    const { ui, bridge, record, adapter } = fixture(); await ui.open(record, bridge);
    ui.draft.photoCapture = {}; adapter.scan.mockRejectedValue(Error('OCR error'));
    await expect(ui.action('scan')).rejects.toThrow('OCR error'); expect(ui.draft.photoCapture).toBeDefined();
    adapter.save.mockRejectedValue(Error('save error')); await expect(ui.action('save')).rejects.toThrow('save error');
    expect(ui.dialog.open).toBe(true); expect(bridge.remove).not.toHaveBeenCalled();
    await ui.action('cancel'); expect(bridge.remove).toHaveBeenCalledTimes(1); expect(adapter.onSaved).not.toHaveBeenCalled();
});
test('scope change while OCR is pending prevents late changes', async () => {
    const { ui, bridge, record, adapter, deny } = fixture(); await ui.open(record, bridge);
    let finish; adapter.scan.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = ui.action('scan'); deny(); finish({ got: true, amount: 900 }); await expect(pending).rejects.toThrow('cuenta');
    expect(ui.draft.amount).toBe(800); expect(ui.proposal).toBeNull();
});
test('returning to audio keeps cash edits for explicit reprocessing', async () => {
    const { ui, bridge, record } = fixture(); bridge.back = jest.fn();
    await ui.open(record, bridge); ui.draft.concept = 'Concepto manual'; record.dirty = true;
    await ui.action('back'); expect(bridge.back).toHaveBeenCalledTimes(1);
    expect(record.cashDraft.concept).toBe('Concepto manual'); expect(record.dirty).toBe(true); expect(ui.dialog.open).toBe(false);
});

test('cash registration commits its return point only after saving and navigation',async()=>{
 const {ui,adapter,bridge,record}=fixture();const point={commit:jest.fn(),cancel:jest.fn()};adapter.beginReturn=jest.fn(()=>point);
 await ui.open(record,bridge);adapter.save.mockRejectedValueOnce(Error('storage'));
 await expect(ui.action('save')).rejects.toThrow('storage');expect(point.cancel).toHaveBeenCalledTimes(1);expect(point.commit).not.toHaveBeenCalled();
 await ui.action('save');expect(adapter.onSaved).toHaveBeenCalledTimes(1);expect(point.commit).toHaveBeenCalledTimes(1);expect(record.completedCashId).toBe('movement');
});
