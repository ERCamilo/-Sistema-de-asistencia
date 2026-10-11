import { state } from '../modules/core/AppState.js';
import { auth } from '../modules/data/firebase.js';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { savePettyCashMovementDraft } from '../modules/features/pettycash/PettyCashUI.js';
jest.mock('../modules/features/pettycash/PettyCashStore.js', () => ({ PettyCashStore: { save: jest.fn(async () => ({ localOk: true })) } }));
const draft = () => ({ id: 'voice-cash-r1', type: 'gasto' });
const fields = () => ({ amount: 800, description: 'Transporte\nNota: viaje', date: '2026-10-11', paidTo: '', category: 'Transporte', hasReceipt: false });
const options = () => ({ periodId: 'p1', voiceRequestId: 'r1' });
beforeEach(() => {
    state.pettyCash = { projects: [{ id: 'obra', name: 'Obra' }], periods: [{ id: 'p1', projectId: 'obra', status: 'abierta' }], movements: [] };
    auth.currentUser = { uid: 'user' }; PettyCashStore.save.mockClear(); PettyCashStore.save.mockResolvedValue({ localOk: true });
});
test('shared registration preserves numbers, concept/note and registers one expense per recording', async () => {
    const form = draft(); const movement = await savePettyCashMovementDraft(form, fields(), options());
    expect(movement).toMatchObject({ id: form.id, type: 'gasto', amount: 800, description: 'Transporte\nNota: viaje', voiceRequestId: 'r1', hasReceipt: false, periodId: 'p1', projectId: 'obra' });
    expect(movement.createdAt).toBeGreaterThan(0); expect(movement.recordNumber).toBeTruthy();
    expect((await savePettyCashMovementDraft(draft(), fields(), options())).id).toBe(movement.id);
    expect(state.pettyCash.movements).toHaveLength(1);
    expect(PettyCashStore.save.mock.calls.filter(([col]) => col === 'movements')).toHaveLength(1);
});
test('failed local save retains the same movement id and retry does not insert another expense', async () => {
    PettyCashStore.save.mockImplementation(async col => ({ localOk: col !== 'movements' }));
    const form = draft(); await expect(savePettyCashMovementDraft(form, fields(), options())).rejects.toThrow('localmente');
    expect(state.pettyCash.movements).toHaveLength(0); expect(form.pendingMovement.id).toBe(form.id);
    PettyCashStore.save.mockResolvedValue({ localOk: true });
    await savePettyCashMovementDraft(form, { ...fields(), amount: 1000 }, options());
    expect(state.pettyCash.movements).toHaveLength(1); expect(state.pettyCash.movements[0].amount).toBe(1000);
});
test('closed or deleted destination and changed session block the write', async () => {
    state.pettyCash.periods[0].status = 'cerrada'; await expect(savePettyCashMovementDraft(draft(), fields(), options())).rejects.toThrow('abierto');
    expect(PettyCashStore.save).not.toHaveBeenCalled(); state.pettyCash.periods[0].status = 'abierta';
    PettyCashStore.save.mockImplementation(async () => { auth.currentUser = { uid: 'other' }; return { localOk: true }; });
    await expect(savePettyCashMovementDraft(draft(), fields(), options())).rejects.toThrow('sesión');
    expect(state.pettyCash.movements).toHaveLength(0);
});
