import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { auth } from '../modules/data/firebase.js';

const movement = {
    id: 'mov-abc-123',
    projectId: 'proj-1',
    periodId: 'per-1',
    recordNumber: 14,
    type: 'gasto',
    amount: 250,
    createdAt: 100,
    updatedAt: 200
};

beforeEach(() => {
    auth.currentUser = { uid: 'firebase-user' };
    indexedDBService.getAll.mockReset().mockResolvedValue([]);
    indexedDBService.get.mockReset().mockResolvedValue(null);
    indexedDBService.update.mockReset().mockResolvedValue(1);
    indexedDBService.delete.mockReset().mockResolvedValue(undefined);
});

describe('PettyCashStore mirror outbox', () => {
    test('guardar un movimiento encola un upsert independiente', async () => {
        await PettyCashStore.save('movements', movement, {
            source: 'identity-normalization'
        });

        expect(indexedDBService.update).toHaveBeenCalledWith(
            'pettyCashMirrorOutbox',
            expect.objectContaining({
                id: movement.id,
                op: 'save',
                ownerUid: 'firebase-user',
                status: 'pending',
                source: 'identity-normalization',
                data: expect.objectContaining({ recordNumber: 14 })
            })
        );
    });

    test('eliminar conserva el snapshot necesario para el tombstone', async () => {
        indexedDBService.get.mockResolvedValue(movement);

        await PettyCashStore.remove('movements', movement.id);

        expect(indexedDBService.update).toHaveBeenCalledWith(
            'pettyCashMirrorOutbox',
            expect.objectContaining({
                id: movement.id,
                op: 'delete',
                data: movement
            })
        );
    });

    test('proyectos y periodos no se envían al espejo de movimientos', async () => {
        await PettyCashStore.save('projects', { id: 'proj-1', name: 'Obra' });

        const mirrorWrites = indexedDBService.update.mock.calls
            .filter(([store]) => store === 'pettyCashMirrorOutbox');
        expect(mirrorWrites).toHaveLength(0);
    });

    test('flushMirror no envía las peticiones de borrado de comprobantes (M3) que comparten el store', async () => {
        auth.currentUser = { uid: 'firebase-user', getIdToken: async () => 'token' };
        const previousFetch = global.fetch;
        const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
        global.fetch = fetchMock;
        const mirrorEntry = { id: movement.id, op: 'save', data: movement, status: 'pending', ownerUid: 'firebase-user', ts: 2 };
        indexedDBService.getAll.mockResolvedValue([
            { id: 'receipt-delete:mov-1', kind: 'receipt-delete', txId: 'mov-1', status: 'pending', ownerUid: 'firebase-user', ts: 1 },
            mirrorEntry
        ]);
        indexedDBService.get.mockImplementation(async (_store, id) => (id === movement.id ? mirrorEntry : null));
        try {
            await PettyCashStore.flushMirror();
        } finally {
            global.fetch = previousFetch;
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ transactionId: movement.id, action: 'upsert' });
        const touched = [...indexedDBService.update.mock.calls, ...indexedDBService.delete.mock.calls]
            .filter(([store, value]) => store === 'pettyCashMirrorOutbox' && String(value?.id || value).startsWith('receipt-delete:'));
        expect(touched).toEqual([]);
    });
});
