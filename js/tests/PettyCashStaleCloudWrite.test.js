import { auth, runTransaction } from '../modules/data/firebase.js';
import { PettyCashRepository } from '../modules/services/PettyCashRepository.js';

describe('cash cloud write conflict protection', () => {
    let tx;
    beforeEach(() => {
        auth.currentUser = { uid: 'synthetic' };
        tx = { get: jest.fn(), set: jest.fn() };
        runTransaction.mockImplementation(async (_db, operation) => operation(tx));
    });
    afterEach(() => { auth.currentUser = null; jest.restoreAllMocks(); });
    test.each(['projects', 'periods', 'movements'])('rejects stale %s without replacing newer remote money', async col => {
        tx.get.mockResolvedValue({ exists: () => true, data: () => ({ amount: 300, updatedAt: 200 }) });
        await expect(PettyCashRepository[col].saveOne({ id: 'test', amount: 200, updatedAt: 100 }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(tx.set).not.toHaveBeenCalled();
    });
    test('a failed read never falls back to an unguarded write', async () => {
        tx.get.mockRejectedValue(new Error('offline'));
        await expect(PettyCashRepository.movements.saveOne({ id: 'test', updatedAt: 100 })).rejects.toThrow('offline');
        expect(tx.set).not.toHaveBeenCalled();
    });
    test('a newer update keeps merge behavior', async () => {
        tx.get.mockResolvedValue({ exists: () => true, data: () => ({ updatedAt: 100 }) });
        const payload = { id: 'test', amount: 300, updatedAt: 200 };
        await PettyCashRepository.movements.saveOne(payload);
        expect(tx.set).toHaveBeenCalledWith(expect.anything(), payload, { merge: true });
    });
});
