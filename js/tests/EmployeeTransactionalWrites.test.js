import { auth, runTransaction, setDoc } from '../modules/data/firebase.js';
import { EmployeeRepository } from '../modules/services/EmployeeRepository.js';

describe('transactional employee writes', () => {
    let transaction;
    beforeEach(() => {
        auth.currentUser = { uid: 'synthetic' };
        transaction = { get: jest.fn(), set: jest.fn() };
        runTransaction.mockImplementation(async (_db, operation) => operation(transaction));
        setDoc.mockClear();
    });
    afterEach(() => { auth.currentUser = null; });
    const remote = value => ({ exists: () => true, data: () => value });
    test('transaction retry merges the latest payment instead of reusing an earlier payload', async () => {
        const base = { id: 'e', updatedAt: 100, loans: [{ id: 'loan', amount: 1000, payments: [] }] };
        const latest = { ...base, updatedAt: 200, loans: [{ ...base.loans[0], payments: [{ id: 'a', amount: 200 }] }] };
        transaction.get.mockResolvedValueOnce(remote(base)).mockResolvedValueOnce(remote(latest));
        runTransaction.mockImplementation(async (_db, operation) => { await operation(transaction); transaction.set.mockClear(); return operation(transaction); });
        await EmployeeRepository.saveOne({ ...base, updatedAt: 300, loans: [{ ...base.loans[0], payments: [{ id: 'b', amount: 300 }] }] }, { mergeRemote: true });
        const written = transaction.set.mock.calls[0][1];
        expect(written.loans[0].payments.map(p => p.id).sort()).toEqual(['a', 'b']);
        expect(setDoc).not.toHaveBeenCalled();
    });
    test('recovery explicitly clears the persisted tombstone without dropping financial history', async () => {
        transaction.get.mockResolvedValue(remote({ id: 'e', updatedAt: 200, deletedAt: 200, active: false, loans: [{ id: 'loan', amount: 1000 }] }));
        await EmployeeRepository.saveOne({ id: 'e', updatedAt: 300, active: true }, { mergeRemote: true });
        expect(transaction.set.mock.calls[0][1]).toMatchObject({ deletedAt: null, active: true, loans: [{ id: 'loan', amount: 1000 }] });
    });
    test('a map key removed locally is removed in the cloud too (no merge:true deep-merge)', async () => {
        // Bucle de sanitización 2026-09-29: el puesto duplicado «albanil» se
        // quitaba de positionSalaries, pero merge:true lo conservaba en la nube.
        transaction.get.mockResolvedValue(remote({ id: 'e', updatedAt: 100, positionsUpdatedAt: 100,
            positions: ['albanil', 'uuid-albanil'], positionSalaries: { albanil: 250, 'uuid-albanil': 250 },
            notes: 'solo en la nube', photo: { state: 'ready', revision: 'original:2026-09-14T19:43:38Z|thumbnail:2026-09-14T19:43:39Z', updatedAt: 50 } }));
        await EmployeeRepository.saveOne({ id: 'e', updatedAt: 300, positionsUpdatedAt: 300,
            positions: ['uuid-albanil'], positionSalaries: { 'uuid-albanil': 250 } }, { mergeRemote: true });
        const [, written, options] = transaction.set.mock.calls[0];
        expect(options).toBeUndefined();
        expect(written.positionSalaries).toEqual({ 'uuid-albanil': 250 });
        expect(written.positions).toEqual(['uuid-albanil']);
        // Lo que solo estaba en la nube se conserva: el documento es la fusión completa.
        expect(written).toMatchObject({ notes: 'solo en la nube', photo: { state: 'ready', updatedAt: 50 } });
    });
    test('a delayed deletion is rejected before writing over a newer employee', async () => {
        transaction.get.mockResolvedValue(remote({ id: 'e', updatedAt: 300, active: true }));
        await expect(EmployeeRepository.tombstoneOne('e', 200)).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(transaction.set).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
    });
    test('deletion read failure does not fall back to a blind delete', async () => {
        transaction.get.mockRejectedValue(new Error('offline'));
        await expect(EmployeeRepository.tombstoneOne('e', 200)).rejects.toThrow('offline');
        expect(transaction.set).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
    });
});
