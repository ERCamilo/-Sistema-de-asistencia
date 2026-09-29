import indexedDBService from '../modules/services/IndexedDBService.js';
import { sanitizePositions, purgeMergedPositionsFromLocalStore } from '../modules/services/PersistenceService.js';
import { stateManager } from '../modules/core/AppState.js';

/**
 * Los puestos fusionados por nombre también se borran de IndexedDB (después de
 * guardar el remapeo). Sin esto volvían en cada arranque y se fusionaban otra vez.
 */
describe('purga local de puestos fusionados', () => {
    let snapshot;
    beforeEach(() => {
        snapshot = { positions: stateManager._state.positions, employees: stateManager._state.employees, attendance: stateManager._state.attendance };
        indexedDBService.delete.mockClear();
    });
    afterEach(() => stateManager.setState(snapshot, { silent: true }));

    test('borra el duplicado fusionado y conserva el master', async () => {
        stateManager.setState({
            positions: [{ id: 'uuid-albanil', name: 'Albañil' }, { id: 'albanil', name: 'Albañil' }],
            employees: [{ id: 'e1', positions: ['albanil'], positionSalaries: { albanil: 250 } }],
            attendance: {}
        }, { silent: true });
        expect(sanitizePositions(stateManager._state)).toBe(true);

        expect(await purgeMergedPositionsFromLocalStore()).toBe(1);
        expect(indexedDBService.delete).toHaveBeenCalledWith('positions', 'albanil');
        expect(indexedDBService.delete).not.toHaveBeenCalledWith('positions', 'uuid-albanil');
        // Ya purgado: no se repite.
        expect(await purgeMergedPositionsFromLocalStore()).toBe(0);
    });

    test('no borra un puesto que algo en memoria sigue usando', async () => {
        stateManager.setState({
            positions: [{ id: 'uuid-cubo', name: 'Cubo' }, { id: 'cubo', name: 'Cubo' }],
            employees: [],
            attendance: {}
        }, { silent: true });
        sanitizePositions(stateManager._state);
        // Un merge remoto posterior reintroduce la referencia vieja.
        stateManager._state.employees.push({ id: 'e2', positions: ['cubo'] });
        expect(await purgeMergedPositionsFromLocalStore()).toBe(0);
        expect(indexedDBService.delete).not.toHaveBeenCalled();
    });
});
