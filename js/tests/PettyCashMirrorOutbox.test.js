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
        await PettyCashStore.save('movements', movement);

        expect(indexedDBService.update).toHaveBeenCalledWith(
            'pettyCashMirrorOutbox',
            expect.objectContaining({
                id: movement.id,
                op: 'save',
                ownerUid: 'firebase-user',
                status: 'pending',
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
});
