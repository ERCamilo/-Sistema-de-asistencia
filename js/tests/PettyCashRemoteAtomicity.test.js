import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

describe('durable remote cash merge', () => {
    let db;
    beforeEach(async () => {
        db = new IndexedDBService('cash-atomic-' + Math.random());
        await db.init();
        for (const method of ['getAll', 'clear', 'batchUpdate']) jest.spyOn(indexedDBService, method).mockImplementation(db[method].bind(db));
        if (indexedDBService.reconcilePettyCashSnapshot) jest.spyOn(indexedDBService, 'reconcilePettyCashSnapshot').mockImplementation(db.reconcilePettyCashSnapshot.bind(db));
        await db.update('pettyCashMovements', { id: 'local', amount: 800, updatedAt: 200 });
    });
    afterEach(() => { jest.restoreAllMocks(); db.db.close(); });
    test('failed remote write rejects and preserves the complete local collection', async () => {
        await expect(PettyCashStore.applyRemote('movements', [{ id: {}, amount: 5 }])).rejects.toThrow();
        expect(await db.getAll('pettyCashMovements')).toEqual([{ id: 'local', amount: 800, updatedAt: 200 }]);
    });
    test('stale remote cannot overwrite a newer local amount', async () => {
        const result = await PettyCashStore.applyRemote('movements', [{ id: 'local', amount: 10, updatedAt: 100 }]);
        expect(result[0].amount).toBe(800);
        expect((await db.getAll('pettyCashMovements'))[0].amount).toBe(800);
    });
    test('pending repaired project link wins and remains queued', async () => {
        const cash = { id: 'cash', officialProjectId: 'new', updatedAt: 200 };
        await db.update('pettyCashProjects', cash);
        await db.update('pettyCashOutbox', { col: 'projects', id: 'cash', op: 'save', data: cash, status: 'pending' });
        expect(await PettyCashStore.applyRemote('projects', [{ id: 'cash', officialProjectId: 'old', updatedAt: 100 }])).toEqual([cash]);
        expect(await db.getAll('pettyCashOutbox')).toHaveLength(1);
    });
    test('newer remote version is accepted and durable', async () => {
        const remote = { id: 'local', amount: 950, updatedAt: 300 };
        expect(await PettyCashStore.applyRemote('movements', [remote])).toEqual([remote]);
        expect(await db.getAll('pettyCashMovements')).toEqual([remote]);
    });
    test('merge exception leaves persisted records unchanged', async () => {
        await expect(db.reconcilePettyCashSnapshot('pettyCashMovements', () => {
            throw new Error('merge failed');
        })).rejects.toThrow('merge failed');
        expect((await db.getAll('pettyCashMovements'))[0].amount).toBe(800);
    });

});
