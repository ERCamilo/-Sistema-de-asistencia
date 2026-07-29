import {
    buildMovementMirrorRequest,
    sendMovementMirror
} from '../modules/features/pettycash/PettyCashMovementMirror.js';

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

describe('PettyCashMovementMirror', () => {
    test('construye un upsert autenticado con el snapshot completo', () => {
        expect(buildMovementMirrorRequest({
            id: movement.id,
            op: 'save',
            data: movement
        }, 'firebase-token')).toEqual({
            idToken: 'firebase-token',
            action: 'upsert',
            transactionId: movement.id,
            movement
        });
    });

    test('conserva el snapshot al generar un tombstone', () => {
        const request = buildMovementMirrorRequest({
            id: movement.id,
            op: 'delete',
            data: movement
        }, 'firebase-token');

        expect(request.action).toBe('delete');
        expect(request.movement.recordNumber).toBe(14);
    });

    test('reporta el error funcional devuelto por el servidor', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ ok: false, error: 'INVALID_RECORD_NUMBER' })
        });

        await expect(sendMovementMirror({
            url: 'https://example.test/mirror',
            entry: { id: movement.id, op: 'save', data: movement },
            idToken: 'firebase-token',
            fetchImpl
        })).rejects.toThrow('INVALID_RECORD_NUMBER');
    });
});
