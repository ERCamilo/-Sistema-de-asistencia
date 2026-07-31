import {
    normalizeMovementIdentity,
    PETTY_CASH_IDENTITY_NORMALIZATION_SOURCE
} from '../modules/features/pettycash/PettyCashUI.js';

describe('Caja Chica — normalización de identidad', () => {
    test('etiqueta proyectos y movimientos históricos con un origen medible', async () => {
        const saveProject = jest.fn().mockResolvedValue(undefined);
        const saveMovement = jest.fn().mockResolvedValue(undefined);
        const data = {
            projects: [{ id: 'project-1', name: 'Obra' }],
            movements: [
                { id: 'mov-a', projectId: 'project-1', createdAt: 100 },
                { id: 'mov-b', projectId: 'project-1', createdAt: 200 }
            ]
        };

        const result = await normalizeMovementIdentity(data, {
            saveProject,
            saveMovement
        });

        expect(result.changedProjects).toHaveLength(1);
        expect(result.changedMovements).toHaveLength(2);
        expect(saveProject).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'project-1', lastMovementRecordNumber: 2 }),
            null,
            PETTY_CASH_IDENTITY_NORMALIZATION_SOURCE
        );
        expect(saveMovement).toHaveBeenCalledTimes(2);
        saveMovement.mock.calls.forEach(([, announce, source]) => {
            expect(announce).toBeNull();
            expect(source).toBe(PETTY_CASH_IDENTITY_NORMALIZATION_SOURCE);
        });
    });
});
