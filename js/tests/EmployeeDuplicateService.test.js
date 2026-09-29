/**
 * Servicio único de duplicados (caso real 2026-09-29: #004 Wilmer, fusionado
 * en #031, volvió sin obra porque la copia seguía en la nube y en IndexedDB).
 */
import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import * as persistence from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import {
    mergeDuplicateEmployees,
    persistDuplicateResolution,
    absorbIncomingMergeMarkers,
    deleteDuplicateEmployee
} from '../modules/features/employees/EmployeeDuplicateService.js';
import {
    EMPLOYEE_MERGE_REGISTRY_KEY,
    mergedTargetOf,
    withoutMergedAway,
    rememberEmployeeMerge
} from '../modules/features/employees/EmployeeMergeRegistry.js';

describe('EmployeeDuplicateService', () => {
    let enqueued, snapshot;
    beforeEach(() => {
        snapshot = { employees: state.employees, attendance: state.attendance };
        localStorage.removeItem(EMPLOYEE_MERGE_REGISTRY_KEY);
        enqueued = [];
        jest.spyOn(MainSyncStore, 'enqueueDelete').mockImplementation(async (entity, id, v, opts = {}) => { enqueued.push({ entity, id, ...opts }); });
        jest.spyOn(persistence, 'saveApplicationData').mockResolvedValue(undefined);
        indexedDBService.delete.mockClear();
        state.employees = [
            { id: 'emp-31', number: '031', name: 'Wilmer Exilien', projectId: 'PRJ-a', loans: [{ id: 'L1', amount: 100 }] },
            { id: 'emp-4', number: '004', name: 'Wilmer Exilien', loans: [{ id: 'L2', amount: 50 }] }
        ];
        state.attendance = {
            'emp-4-2026-09-01': { employeeId: 'emp-4', date: '2026-09-01', present: true, hoursWorked: 8 }
        };
    });
    afterEach(() => {
        state.employees = snapshot.employees;
        state.attendance = snapshot.attendance;
        jest.restoreAllMocks();
    });

    test('fusionar deja lápida con mergedIntoId, registro local y borra la copia del dispositivo', async () => {
        const result = mergeDuplicateEmployees({ masterId: 'emp-31', duplicateIds: ['emp-4'] });
        expect(result.merged).toBe(1);
        expect(state.employees.map(e => e.id)).toEqual(['emp-31']);
        expect(state.employees[0].loans.map(l => l.id).sort()).toEqual(['L1', 'L2']);
        expect(state.attendance['emp-31-2026-09-01']).toMatchObject({ employeeId: 'emp-31', hoursWorked: 8 });
        expect(enqueued).toEqual([expect.objectContaining({ entity: 'employee', id: 'emp-4', mergedIntoId: 'emp-31' })]);
        expect(mergedTargetOf('emp-4')).toBe('emp-31');

        expect(await persistDuplicateResolution()).toBe(1);
        expect(indexedDBService.delete).toHaveBeenCalledWith('employees', 'emp-4');
    });

    test('una copia fusionada no vuelve al cargar desde IndexedDB', () => {
        rememberEmployeeMerge('emp-4', 'emp-31');
        expect(withoutMergedAway([{ id: 'emp-31' }, { id: 'emp-4' }]).map(e => e.id)).toEqual(['emp-31']);
    });

    test('la nube todavía con la copia viva (lápida sin subir) no la trae de vuelta', () => {
        mergeDuplicateEmployees({ masterId: 'emp-31', duplicateIds: ['emp-4'] });
        const { incoming } = absorbIncomingMergeMarkers([
            { id: 'emp-31', number: '031', name: 'Wilmer Exilien' },
            { id: 'emp-4', number: '004', name: 'Wilmer Exilien' }
        ]);
        expect(incoming.map(e => e.id)).toEqual(['emp-31']);
        // Se vuelve a encolar la lápida para corregir la nube.
        expect(enqueued.filter(e => e.id === 'emp-4').length).toBeGreaterThanOrEqual(2);
    });

    test('otro dispositivo recibe la lápida y une su copia local (conserva su asistencia)', () => {
        const { incoming, absorbed } = absorbIncomingMergeMarkers([
            { id: 'emp-31', number: '031', name: 'Wilmer Exilien', projectId: 'PRJ-a' },
            { id: 'emp-4', deletedAt: 10, updatedAt: 10, mergedIntoId: 'emp-31' }
        ]);
        expect(absorbed).toBe(1);
        expect(state.employees.map(e => e.id)).toEqual(['emp-31']);
        expect(state.attendance['emp-31-2026-09-01']).toMatchObject({ employeeId: 'emp-31' });
        expect(incoming.map(e => e.id)).toEqual(['emp-31', 'emp-4']); // la lápida sigue para el merge normal
        expect(mergedTargetOf('emp-4')).toBe('emp-31');
        expect(enqueued).toEqual([]); // la lápida ya está en la nube
    });

    test('eliminar un duplicado usa lápida (sin mergedIntoId)', () => {
        deleteDuplicateEmployee('emp-4', { purgeAttendance: false, at: 7 });
        expect(state.employees.map(e => e.id)).toEqual(['emp-31']);
        expect(enqueued).toEqual([expect.objectContaining({ id: 'emp-4', deletedAt: 7 })]);
        expect(enqueued[0].mergedIntoId).toBeFalsy();
    });

    test('sin master disponible no toca nada', () => {
        expect(mergeDuplicateEmployees({ masterId: 'no-existe', duplicateIds: ['emp-4'] })).toEqual({ merged: 0, skipped: ['emp-4'] });
        expect(state.employees).toHaveLength(2);
        expect(enqueued).toEqual([]);
    });
});
