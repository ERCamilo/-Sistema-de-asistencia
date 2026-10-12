import { transcriptWords, selectedTranscriptName, suggestTranscriptNames, VoiceNameWords } from '../modules/features/voice/VoiceNameWords.js';
import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
const employees = [{ id: 'a', name: 'Cliff Méndez', number: '00125' }, { id: 'b', name: 'Carla Medina', number: '00126' }];
const aliases = [{ employeeId: 'a', aliases: ['cleeft'] }];
function fixture(intent = 'crear_prestamo') {
    const store = { put: jest.fn(async () => {}), aliases: async () => aliases };
    const adapter = { getUser: () => ({ uid: 'u' }), getScope: () => ({ enabled: false }), getEmployees: () => employees, getSettings: () => ({ voiceAmbiguousAction: 'loan' }), getLoanDefaults: () => ({}), onLoan: jest.fn() };
    const ui = new VoiceMvpUI(adapter, { store }); ui.render = jest.fn(); ui.dialog = { open: false, showModal: jest.fn() }; ui.close = jest.fn();
    ui.record = { uid: 'u', projectKey: 'legacy', requestId: 'r', transcript: 'Préstamo a cleeft Méndez por 5000', mention: { spokenName: 'Préstamo', spokenNumber: '00126' }, result: { intent, employee: { spokenName: null, spokenNumber: null }, extracted: { amount: 5000, concept: 'cleeft' }, needsReview: false, issues: [] }, draft: { principal: 7000, interestRate: 35, concept: 'Editada' }, selectedEmployeeId: 'b', reviewed: true, rememberName: true, loanDefaultsVersion: 1 };
    return { ui, store, adapter };
}
test('Unicode words and multiword selection keep original order and spelling', () => {
    const words = transcriptWords("Busca a Jean-Luc O’Neill, José y 李明.");
    expect(words).toEqual(['Busca', 'a', 'Jean-Luc', 'O’Neill', 'José', 'y', '李明']);
    expect(selectedTranscriptName(words, [4, 2, 2])).toBe('Jean-Luc José');
});
test('local suggestions recover confirmed aliases and exclude financial words', () => {
    const suggestions = suggestTranscriptNames('Préstamo para cleeft por 5000 pesos', employees, aliases);
    expect(suggestions[0]).toMatchObject({ name: 'cleeft', matches: [{ employee: employees[0] }] });
    expect(suggestions.some(s => /prestamo|5000|pesos/i.test(s.name))).toBe(false);
});
test('selecting words clears conflicting number and employee but retains edited loan and original extraction', async () => {
    const { ui, store, adapter } = fixture(); const original = JSON.stringify(ui.record.result);
    await ui.action('name-words'); await ui.action('name-word', '3'); await ui.action('name-word', '2'); await ui.action('name-apply');
    expect(ui.record.mention).toEqual({ spokenName: 'cleeft Méndez', spokenNumber: null });
    expect(ui.record).toMatchObject({ selectedEmployeeId: null, reviewed: false, rememberName: false, dirty: true, draft: { principal: 7000, interestRate: 35, concept: 'Editada' } });
    expect(ui.matches[0].employee.id).toBe('a'); expect(ui.view).toBe('employees');
    expect(JSON.stringify(ui.record.result)).toBe(original); expect(adapter.onLoan).not.toHaveBeenCalled(); expect(store.put).toHaveBeenCalledTimes(1);
});
test('automatic suggestion still requires a click, does not assign employee or teach an alias', async () => {
    const { ui, adapter } = fixture(); await ui.action('name-words');
    expect(ui.record.selectedEmployeeId).toBe('b'); expect(ui.record.mention.spokenName).toBe('Préstamo');
    await ui.action('name-suggestion', '0'); expect(ui.record.mention.spokenName).toBe('cleeft'); expect(ui.record.selectedEmployeeId).toBeNull(); expect(adapter.onLoan).not.toHaveBeenCalled();
});
test('recovered name can guide unknown intent with amount while negative instructions stay blocked', async () => {
    const { ui, adapter } = fixture('desconocida'); await ui.action('name-words'); await ui.action('name-suggestion', '0'); await ui.routeResult();
    expect(ui.record.manualIntent).toBe('crear_prestamo'); expect(ui.record.selectedEmployeeId).toBe('a'); expect(adapter.onLoan).not.toHaveBeenCalled();
    ui.record.result.issues = [{ code: 'NEGATION', message: 'No registrar' }]; await ui.routeResult(); expect(ui.view).toBe('audio');
});
test('changed transcript invalidates stale selections and duplicate words can be selected separately', async () => {
    const { ui } = fixture(); ui.record.transcript = 'cleeft y cleeft'; await ui.action('name-words'); await ui.action('name-word', '2');
    expect(selectedTranscriptName(ui.nameWordPicker.words, ui.nameWordPicker.indexes)).toBe('cleeft');
    ui.record.transcript = 'Carla'; await ui.action('name-apply'); expect(ui.record.mention.spokenName).toBe('Préstamo'); expect(ui.nameWordPicker).toBeNull();
});
test('chips are escaped and expose selection state for keyboard and screen readers', async () => {
    const { ui } = fixture(); await ui.action('name-words'); await ui.action('name-word', '2');
    const button = (action, label, disabled, id = '') => `<button data-voice-action="${action}" data-id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    const host = document.createElement('div'); host.innerHTML = VoiceNameWords(ui, button);
    expect(host.querySelector('[data-voice-action="name-word"][data-id="2"]').getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Buscar coincidencias'); expect(host.querySelector('[aria-live]')).not.toBeNull();
});
