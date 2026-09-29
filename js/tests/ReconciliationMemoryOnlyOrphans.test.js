import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    adoptMemoryOnlyOrphans,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

/**
 * Un empleado que llega de la nube con una obra inexistente se ve en pantalla,
 * pero el guardado local lo omite. «Aplicar todo» fallaba con
 * `selected employee "…" is not a durable employee yet`: la reparación debe
 * incorporarlo (y su asistencia) y dejarlo guardado en la obra elegida.
 */
const OBRA = 'PRJ-obra-uno-0001';
const GHOST = 'PRJ-inexistente-0009';
const project = (id, name) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 });

let db, snapshot;
beforeEach(async () => {
    jest.useFakeTimers();
    snapshot = { employees: stateManager._state.employees, attendance: stateManager._state.attendance };
    db = new IndexedDBService('memory-only-orphans-' + Math.random());
    await db.init();
    await db.update('projects', project(OBRA, 'Mi obra 1'));
    await db.update('employees', { id: 'emp-guardado', number: '1', name: 'Guardado', active: true, positions: [], loans: [], projectId: OBRA });
    await db.update('attendance', { key: 'emp-guardado-2026-09-01', employeeId: 'emp-guardado', date: '2026-09-01', present: true, projectId: OBRA, updatedAt: 1 });
    stateManager.setState({
        employees: [
            await db.get('employees', 'emp-guardado'),
            { id: 'emp-nube', number: '2', name: 'Desde la nube', active: true, positions: [], loans: [], projectId: GHOST }
        ],
        attendance: {
            'emp-guardado-2026-09-01': await db.get('attendance', 'emp-guardado-2026-09-01'),
            'emp-nube-2026-09-01': { employeeId: 'emp-nube', date: '2026-09-01', present: true, hoursWorked: 8, projectId: GHOST, updatedAt: 2 }
        }
    }, { silent: true });
    replaceEntityScope({ enabled: true, projectId: OBRA, defaultProjectId: OBRA });
});
afterEach(() => {
    stateManager.setState(snapshot, { silent: true });
    resetEntityScope();
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.useRealTimers();
});

test('asigna el empleado y la asistencia que solo están en memoria', async () => {
    expect(await db.get('employees', 'emp-nube')).toBeFalsy();
    const employees = stateManager._state.employees;
    const result = await applyOwnershipRepair({
        action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: OBRA,
        employees: [employees[1]], allEmployees: employees, attendance: stateManager._state.attendance,
        positions: [], leaders: [], catalog: [project(OBRA, 'Mi obra 1')], _db: db
    });

    expect(result.status).toBe(REPAIR_STATUS.OK);
    expect(await db.get('employees', 'emp-nube')).toMatchObject({ projectId: OBRA, name: 'Desde la nube' });
    expect(await db.get('attendance', 'emp-nube-2026-09-01')).toMatchObject({ projectId: OBRA, hoursWorked: 8 });
    expect(stateManager._state.employees.find(e => e.id === 'emp-nube').projectId).toBe(OBRA);
    // Lo ya guardado en una obra válida no cambia.
    expect(await db.get('employees', 'emp-guardado')).toMatchObject({ projectId: OBRA });
});

test('solo se incorporan registros ausentes de IndexedDB y sin obra válida', () => {
    const durable = {
        projects: [project(OBRA, 'Mi obra 1')],
        employees: [{ id: 'a', projectId: GHOST, name: 'guardado' }],
        positions: [], leaders: [], attendance: []
    };
    const adopted = adoptMemoryOnlyOrphans(durable, {
        employees: [
            { id: 'a', projectId: GHOST, name: 'memoria' },   // ya durable: manda IndexedDB
            { id: 'b', projectId: OBRA },                     // obra válida: no es reparación
            { id: 'c', projectId: GHOST },                    // huérfano solo en memoria
            { id: 'd' }                                       // sin obra = obra por defecto válida
        ],
        positions: [{ id: 'p1', projectId: GHOST }],
        leaders: [],
        attendance: { 'c-2026-09-01': { employeeId: 'c', date: '2026-09-01', projectId: GHOST } }
    }, { enabled: true, defaultProjectId: OBRA });

    expect(adopted).toEqual({ employees: 1, positions: 1, leaders: 0, attendance: 1 });
    expect(durable.employees.map(e => e.id)).toEqual(['a', 'c']);
    expect(durable.employees[0].name).toBe('guardado');
    expect(durable.attendance[0].key).toBe('c-2026-09-01');
});
