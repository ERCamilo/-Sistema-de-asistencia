import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { PettyCashRepository } from '../modules/services/PettyCashRepository.js';
import { auth } from '../modules/data/firebase.js';

function entry(key, overrides = {}) {
    return {
        key,
        op: 'save',
        col: 'movements',
        id: 'm1',
        data: { id: 'm1', amount: key },
        source: 'manual',
        ts: 1000 + key,
        status: 'pending',
        ...overrides
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('PettyCashStore — compactación y drenado continuo', () => {
    let saveSpy;
    let deleteSpy;

    beforeEach(() => {
        auth.currentUser = { uid: 'outbox-user' };
        indexedDBService.getAll.mockReset().mockResolvedValue([]);
        indexedDBService.update.mockReset().mockResolvedValue(1);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        saveSpy = jest.spyOn(PettyCashRepository.movements, 'saveOne').mockResolvedValue(undefined);
        deleteSpy = jest.spyOn(PettyCashRepository.movements, 'deleteOne').mockResolvedValue(undefined);
    });

    afterEach(() => {
        auth.currentUser = null;
        saveSpy.mockRestore();
        deleteSpy.mockRestore();
    });

    test('diez ediciones pendientes del mismo documento producen un solo write', async () => {
        indexedDBService.getAll.mockResolvedValueOnce(
            Array.from({ length: 10 }, (_, index) => entry(index + 1))
        );

        await PettyCashStore.flush();

        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(saveSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ amount: 10 }));
        const deletedKeys = indexedDBService.delete.mock.calls
            .filter(([store]) => store === 'pettyCashOutbox')
            .map(([, key]) => key);
        expect(deletedKeys).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    });

    test('la última operación gana cuando guardar termina en borrar', async () => {
        indexedDBService.getAll.mockResolvedValueOnce([
            entry(1),
            entry(2, { op: 'delete', data: undefined })
        ]);

        await PettyCashStore.flush();

        expect(saveSpy).not.toHaveBeenCalled();
        expect(deleteSpy).toHaveBeenCalledTimes(1);
    });

    test('no compacta documentos diferentes', async () => {
        indexedDBService.getAll.mockResolvedValueOnce([
            entry(1, { id: 'm1', data: { id: 'm1', amount: 1 } }),
            entry(2, { id: 'm2', data: { id: 'm2', amount: 2 } })
        ]);

        await PettyCashStore.flush();

        expect(saveSpy).toHaveBeenCalledTimes(2);
    });

    test('una escritura encolada durante un flush se drena en el mismo ciclo', async () => {
        const firstWrite = deferred();
        indexedDBService.getAll
            .mockResolvedValueOnce([entry(1)])
            .mockResolvedValueOnce([entry(2, { data: { id: 'm1', amount: 2 } })])
            .mockResolvedValue([]);
        saveSpy
            .mockImplementationOnce(() => firstWrite.promise)
            .mockResolvedValueOnce(undefined);

        const flushing = PettyCashStore.flush();
        await Promise.resolve();
        await Promise.resolve();
        await PettyCashStore.flush();
        firstWrite.resolve();
        await flushing;

        expect(saveSpy).toHaveBeenCalledTimes(2);
        expect(saveSpy.mock.calls[1][0]).toEqual(expect.objectContaining({ amount: 2 }));
    });
});
