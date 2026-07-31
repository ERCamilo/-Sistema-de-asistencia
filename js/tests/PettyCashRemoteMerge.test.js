import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

describe('PettyCashStore — mezcla segura de snapshots remotos', () => {
    beforeEach(() => {
        indexedDBService.getAll.mockReset().mockResolvedValue([]);
        indexedDBService.clear.mockReset().mockResolvedValue(undefined);
        indexedDBService.batchUpdate.mockReset().mockResolvedValue(0);
    });

    test('un snapshot no borra facturas locales que siguen en revisión', async () => {
        const localDraft = {
            id: 'draft-1',
            amount: 100,
            localDraft: true,
            reviewPending: true
        };
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashMovements') return [localDraft];
            return [];
        });

        const merged = await PettyCashStore.applyRemote(
            'movements',
            [{ id: 'remote-1', amount: 50 }]
        );

        expect(merged).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'remote-1' }),
            expect.objectContaining({ id: 'draft-1', localDraft: true })
        ]));
        expect(indexedDBService.batchUpdate).toHaveBeenCalledWith(
            'pettyCashMovements',
            expect.arrayContaining([expect.objectContaining({ id: 'draft-1' })])
        );
    });

    test('una escritura pendiente local prevalece sobre el snapshot anterior', async () => {
        const local = { id: 'm1', amount: 200 };
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashMovements') return [local];
            if (store === 'pettyCashOutbox') {
                return [{
                    key: 1,
                    col: 'movements',
                    id: 'm1',
                    op: 'save',
                    data: local,
                    status: 'pending'
                }];
            }
            return [];
        });

        const merged = await PettyCashStore.applyRemote(
            'movements',
            [{ id: 'm1', amount: 100 }]
        );

        expect(merged).toEqual([expect.objectContaining({ id: 'm1', amount: 200 })]);
    });

    test('un borrado pendiente no resucita por un snapshot remoto', async () => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashOutbox') {
                return [{
                    key: 1,
                    col: 'movements',
                    id: 'm1',
                    op: 'delete',
                    status: 'pending'
                }];
            }
            return [];
        });

        const merged = await PettyCashStore.applyRemote(
            'movements',
            [{ id: 'm1', amount: 100 }]
        );

        expect(merged).toEqual([]);
    });

    test('conserva el contador local más alto del proyecto', async () => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashProjects') {
                return [{ id: 'p1', name: 'Obra', nextRecordNumber: 15 }];
            }
            return [];
        });

        const merged = await PettyCashStore.applyRemote(
            'projects',
            [{ id: 'p1', name: 'Obra', nextRecordNumber: 12 }]
        );

        expect(merged).toEqual([
            expect.objectContaining({ id: 'p1', nextRecordNumber: 15 })
        ]);
    });
});
