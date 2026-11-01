import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { VoiceStore } from '../modules/features/voice/VoiceStore.js';
import { needsVoiceAliasPrompt } from '../modules/features/voice/VoiceAliasView.js';
import { indexedDB } from 'fake-indexeddb';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const employee = { id: 'paul', name: 'Paul Cleeft', number: '113' };
function fixture() {
    let uid = 'user';
    const store = new VoiceStore({ indexedDB, name: 'voice-alias-prompt-' + Math.random() });
    const adapter = { getUser: () => ({ uid }), getScope: () => ({ enabled: false }), getEmployees: () => [employee], getLoanDefaults: () => ({}), validateLoan: () => ({ valid: true }), onLoan: jest.fn() };
    const ui = new VoiceMvpUI(adapter, { store });
    ui.record = { uid, projectKey: 'legacy', requestId: 'recording', createdAt: Date.now(), mention: { spokenName: 'Cleef' }, transcript: 'Préstamo a Cleef', result: { intent: 'crear_prestamo', needsReview: false, issues: [] }, draft: { principal: 7000, interestRate: 25, concept: 'Nota editada', dueDate: '2030-01-01' }, employeeDefaultsApplied: true };
    ui.dialog = document.createElement('dialog'); document.body.append(ui.dialog);
    ui.view = 'employees'; ui.render();
    return { ui, store, adapter, setUser: value => { uid = value; }, done: () => { store.close(); ui.dialog.remove(); } };
}

test('only new variants need the mandatory decision; canonical names and existing compact aliases skip it', () => {
    expect(needsVoiceAliasPrompt('Cleef', employee)).toBe(true);
    for (const name of ['', 'Paul', 'Cleeft', 'PaulCleeft']) expect(needsVoiceAliasPrompt(name, employee)).toBe(false);
    expect(needsVoiceAliasPrompt('Cle ef', employee, [{ employeeId: 'paul', aliases: ['cleef'] }])).toBe(false);
});

test('selection requires a decision, shows the pair, and saves a local alias without creating a loan', async () => {
    const { ui, store, adapter, done } = fixture();
    try {
        const originalDraft = { ...ui.record.draft };
        await ui.action('select', 'paul');
        expect(ui.view).toBe('remember');
        expect(ui.dialog.textContent).toContain('¿Recordar esta forma de llamarlo?');
        expect(ui.dialog.textContent).toContain('«Cleef»');
        expect(ui.dialog.textContent).toContain('Paul Cleeft');
        expect(ui.dialog.textContent).toContain('#113');
        expect(ui.dialog.querySelector('[data-voice-remember]')).toBeNull();
        await ui.action('close'); await ui.action('loan');
        expect(ui.view).toBe('remember');
        expect(await store.aliases('user', 'legacy')).toEqual([]);
        await ui.action('alias-save');
        expect((await store.aliases('user', 'legacy'))[0].aliases).toEqual(['cleef']);
        expect(await store.aliases('other', 'legacy')).toEqual([]);
        expect(ui.view).toBe('loan');
        expect(ui.record.selectedEmployeeId).toBe('paul');
        expect(ui.record.draft).toEqual(originalDraft);
        expect(adapter.onLoan).not.toHaveBeenCalled();
        ui.record.selectedEmployeeId = null;
        await ui.action('select', 'paul');
        expect(ui.view).toBe('loan');
    } finally { done(); }
});

test('going back from alias decision allows choosing a different employee without saving a variant', async () => {
    const { ui, store, adapter, done } = fixture();
    try {
        const other = { id: 'other', name: 'Pedro García', number: '114' };
        adapter.getEmployees = () => [employee, other];
        await ui.action('select', 'paul');
        expect(ui.view).toBe('remember');
        expect(ui.dialog.textContent).toContain('Elegir otro empleado');
        await ui.action('alias-back');
        expect(ui.view).toBe('employees');
        expect(ui.aliasSelection).toBeNull();
        expect(ui.record.selectedEmployeeId).toBeUndefined();
        await ui.action('select', 'other');
        expect(ui.view).toBe('remember');
        await ui.action('alias-skip');
        expect(ui.record.selectedEmployeeId).toBe('other');
        expect(await store.aliases('user', 'legacy')).toEqual([]);
    } finally { done(); }
});

test('Ahora no continues with the selected employee and preserves edits without teaching an alias', async () => {
    const { ui, store, done } = fixture();
    try {
        await ui.action('select', 'paul'); await ui.action('alias-skip');
        expect(ui.record.selectedEmployeeId).toBe('paul');
        expect(ui.record.draft.principal).toBe(7000);
        expect(ui.view).toBe('loan');
        expect(await store.aliases('user', 'legacy')).toEqual([]);
    } finally { done(); }
});

test('a failed alias write keeps the decision visible and can be retried or declined', async () => {
    const { ui, store, done } = fixture();
    try {
        const save = jest.spyOn(store, 'saveAlias').mockRejectedValueOnce(Error('Sin espacio'));
        await ui.action('select', 'paul');
        await expect(ui.action('alias-save')).rejects.toThrow('Sin espacio');
        expect(ui.view).toBe('remember'); expect(ui.busy).toBe(false);
        expect(ui.record.selectedEmployeeId).toBeUndefined();
        save.mockRestore(); await ui.action('alias-save');
        expect(ui.view).toBe('loan');
    } finally { done(); }
});

test('changed session cannot save a pending association', async () => {
    const { ui, store, setUser, done } = fixture();
    try {
        await ui.action('select', 'paul'); setUser('another-user');
        await expect(ui.action('alias-save')).rejects.toThrow('otra cuenta');
        expect(await store.aliases('user', 'legacy')).toEqual([]);
    } finally { done(); }
});

test('alias transaction aborts if its session guard changes after opening the store', async () => {
    const store = new VoiceStore({ indexedDB, name: 'voice-alias-guard-' + Math.random() });
    try {
        let calls = 0;
        await expect(store.saveAlias('u', 'p', 'e', 'cleef', { guard: () => { if (++calls > 1) throw Error('Cambió la sesión'); } })).rejects.toThrow('Cambió la sesión');
        expect(await store.aliases('u', 'p')).toEqual([]);
    } finally { store.close(); }
});

test('saved precision routes a sole high match to an editable draft without learning or creating a loan', async () => {
    const { ui, store, adapter, done } = fixture();
    try {
        let precision = 'precise';
        adapter.getSettings = () => ({ voiceMatchPrecision: precision });
        await ui.refreshMatches(); await ui.routeResult();
        expect(ui.view).toBe('employees');
        expect(ui.record.selectedEmployeeId).toBeUndefined();
        precision = 'high'; await ui.routeResult();
        expect(ui.record.selectedEmployeeId).toBe('paul');
        expect(ui.view).toBe('loan'); expect(ui.aliasSelection).toBeUndefined();
        expect(ui.record.draft.principal).toBe(7000);
        expect(await store.aliases('user', 'legacy')).toEqual([]);
        expect(adapter.onLoan).not.toHaveBeenCalled();
    } finally { done(); }
});
