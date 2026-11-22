/**
 * MERGE_PROJECT en el motor de reparación: una sola transacción de IndexedDB,
 * memoria de la app al día sin pisar ediciones sin guardar y cola hacia la nube.
 * Mismo arnés que ProjectRepairCloudPropagationR07 / DurableAtomicityR07.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS,
    RECONCILIATION_META_KEY
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const A = { id: 'PRJ-a-0001', name: 'Torre Norte', status: 'active', createdAt: 1, updatedAt: 10, schemaVersion: 1 };
const B = { id: 'PRJ-b-0002', name: 'Edificio Sur', status: 'active', createdAt: 2, updatedAt: 10, schemaVersion: 1 };
const OTHER = { id: 'PRJ-c-0003', name: 'Hospital', status: 'active', createdAt: 3, updatedAt: 10, schemaVersion: 1 };

const emp = (id, projectId, extra = {}) => ({ id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId, updatedAt: 10, ...extra });
const att = (employeeId, date, projectId) => ({ key: `${employeeId}-${date}`, employeeId, date, present: true, hoursWorked: 8, projectId, updatedAt: 10 });

function fixture() {
    const employees = [
        emp('e1', B.id, { loans: [{ id: 'L1', projectId: B.id, amount: 100 }] }),
        emp('e2', B.id),
        emp('e3', A.id),
        emp('e4', OTHER.id)
    ];
    const positions = [{ id: 'p1', name: 'Albañil', projectId: B.id, updatedAt: 10 }, { id: 'p2', name: 'Maestro', projectId: A.id, updatedAt: 10 }];
    const leaders = [{ id: 'l1', name: 'Jefe', projectId: B.id, updatedAt: 10 }];
    const attendance = [att('e1', '2026-01-05', B.id), att('e2', '2026-01-05', B.id), att('e3', '2026-01-05', A.id)];
    return { employees, positions, leaders, attendance };
}

let db;
let saved;
let entitiesSpy;
let dailySpy;

async function seed({ employees, positions, leaders, attendance }, { memory = true } = {}) {
    for (const project of [A, B, OTHER]) await db.update('projects', project);
    for (const row of employees) await db.update('employees', row);
    for (const row of positions) await db.update('positions', row);
    for (const row of leaders) await db.update('leaders', row);
    for (const row of attendance) await db.update('attendance', row);
    if (memory) {
        stateManager.setState({
            employees: JSON.parse(JSON.stringify(employees)),
            positions: JSON.parse(JSON.stringify(positions)),
            leaders: JSON.parse(JSON.stringify(leaders)),
            attendance: Object.fromEntries(attendance.map(r => [r.key, JSON.parse(JSON.stringify(r))])),
            settings: { ...(stateManager._state.settings || {}), schemaVersion: 3 }
        }, { silent: true });
    }
}

const merge = (extra = {}) => applyOwnershipRepair({
    action: REPAIR_ACTION.MERGE_PROJECT,
    sourceProjectId: B.id,
    targetProjectId: A.id,
    protectedIds: { defaultProjectId: A.id },
    _db: db,
    ...extra
});
const durable = async store => db.getAll(store);
const byId = (rows, id) => rows.find(row => row.id === id);

beforeEach(async () => {
    saved = JSON.parse(JSON.stringify({
        employees: stateManager._state.employees || [], positions: stateManager._state.positions || [],
        leaders: stateManager._state.leaders || [], attendance: stateManager._state.attendance || {},
        settings: stateManager._state.settings || {}
    }));
    localStorage.clear();
    db = new IndexedDBService('merge-engine-' + Math.random());
    await db.init();
    entitiesSpy = jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined);
    dailySpy = jest.spyOn(MainSyncStore, 'enqueueDailyRepairPatch').mockResolvedValue(undefined);
    jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(false);
});
afterEach(() => {
    jest.restoreAllMocks();
    stateManager.setState(saved, { silent: true });
    localStorage.clear();
    try { db.db.close(); } catch (_) { /* ignore */ }
});

describe('fusionar B en A', () => {
    test('mueve todo a A en IndexedDB, retira B y renombra A, sin pedir empleados', async () => {
        await seed(fixture());
        const result = await merge({ projectName: 'Torre Norte II' });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.counts).toMatchObject({ employees: 2, positions: 1, leaders: 1, attendance: 2 });
        const employees = await durable('employees');
        expect(['e1', 'e2', 'e3'].map(id => byId(employees, id).projectId)).toEqual([A.id, A.id, A.id]);
        expect(byId(employees, 'e4').projectId).toBe(OTHER.id);
        expect(byId(employees, 'e1').loans[0]).toMatchObject({ id: 'L1', projectId: A.id, amount: 100 });
        expect(byId(await durable('positions'), 'p1').projectId).toBe(A.id);
        expect(byId(await durable('leaders'), 'l1').projectId).toBe(A.id);
        expect((await durable('attendance')).map(r => r.projectId).sort()).toEqual([A.id, A.id, A.id]);

        const projects = await durable('projects');
        expect(byId(projects, B.id)).toMatchObject({ deletedAt: expect.any(Number), mergedIntoId: A.id });
        expect(byId(projects, A.id)).toMatchObject({ name: 'Torre Norte II' });
        expect(byId(projects, A.id).deletedAt).toBeUndefined();
        expect(byId(projects, OTHER.id)).toEqual(OTHER);
    });

    test('deja constancia en el historial de reparaciones', async () => {
        await seed(fixture());
        await merge();
        const meta = await db.get('settings', RECONCILIATION_META_KEY);
        expect(meta.repairs.at(-1)).toMatchObject({ action: 'MERGE_PROJECT', fromProject: B.id, intoProject: A.id, counts: { employees: 2 } });
    });

    test('la memoria queda al día y conserva las ediciones sin guardar', async () => {
        await seed(fixture());
        const memory = stateManager._state.employees.find(e => e.id === 'e2');
        memory.name = 'Editado sin guardar';
        stateManager.setState({ employees: stateManager._state.employees }, { silent: true });

        await merge();

        const employees = stateManager._state.employees;
        expect(employees.find(e => e.id === 'e2')).toMatchObject({ projectId: A.id, name: 'Editado sin guardar' });
        expect(employees.find(e => e.id === 'e1').loans[0].projectId).toBe(A.id);
        expect(employees.find(e => e.id === 'e4').projectId).toBe(OTHER.id);
        expect(stateManager._state.positions.find(p => p.id === 'p1').projectId).toBe(A.id);
        expect(stateManager._state.leaders.find(l => l.id === 'l1').projectId).toBe(A.id);
        expect(stateManager._state.attendance['e1-2026-01-05'].projectId).toBe(A.id);
        expect(stateManager._state.attendance['e3-2026-01-05'].projectId).toBe(A.id);
    });

    test('encola la nube: entidades actuales y asistencia con la obra destino', async () => {
        await seed(fixture());
        const result = await merge();
        expect(result.cloudQueued).toBe(true);
        expect(entitiesSpy).toHaveBeenCalledTimes(1);
        const [employees] = entitiesSpy.mock.calls[0];
        expect(employees.find(e => e.id === 'e1').projectId).toBe(A.id);
        expect(dailySpy).toHaveBeenCalledTimes(1);
        const [date, records, scope] = dailySpy.mock.calls[0];
        expect(date).toBe('2026-01-05');
        expect(Object.keys(records).sort()).toEqual(['e1-2026-01-05', 'e2-2026-01-05']);
        expect(scope.projectId).toBe(A.id);
    });
});

describe('el historial no deja obras «en uso»', () => {
    test('tras fusionar, A se puede volver a fusionar en otra obra', async () => {
        await seed(fixture());
        await merge();
        const second = await applyOwnershipRepair({
            action: REPAIR_ACTION.MERGE_PROJECT, sourceProjectId: A.id, targetProjectId: OTHER.id,
            protectedIds: { defaultProjectId: OTHER.id }, _db: db
        });
        expect(second.status).toBe(REPAIR_STATUS.OK);
        expect(byId(await durable('employees'), 'e1').projectId).toBe(OTHER.id);
    });
});

describe('fallos cerrados: no cambia nada', () => {
    async function snapshot() {
        const rows = {};
        for (const store of ['projects', 'employees', 'positions', 'leaders', 'attendance']) rows[store] = await durable(store);
        return JSON.stringify(rows);
    }

    test('con cierres de nómina en B', async () => {
        await seed(fixture());
        await db.update('payrollClosures', { id: 'C1', projectId: B.id, rows: [] });
        const before = await snapshot();
        const memoryBefore = JSON.stringify(stateManager._state.employees);
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toContain('PAYROLL_CLOSURES');
        expect(await snapshot()).toBe(before);
        expect(JSON.stringify(stateManager._state.employees)).toBe(memoryBefore);
        expect(entitiesSpy).not.toHaveBeenCalled();
    });

    test('con cambios sin sincronizar de B', async () => {
        await seed(fixture());
        await db.update('mainSyncOutbox', { id: 'o1', kind: 'daily', status: 'pending', scope: { projectId: B.id } });
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toContain('UNSYNCED_CHANGES');
    });

    test('con un nombre que ya usa otra obra', async () => {
        await seed(fixture());
        const before = await snapshot();
        const result = await merge({ projectName: 'hospital' });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toEqual(['NAME_TAKEN']);
        expect(await snapshot()).toBe(before);
    });

    test('si B es la obra inicial', async () => {
        await seed(fixture());
        const result = await merge({ protectedIds: { defaultProjectId: B.id } });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toEqual(['SOURCE_IS_DEFAULT']);
    });

    test('sin protectedIds usa la obra inicial guardada en el dispositivo', async () => {
        await seed(fixture());
        localStorage.setItem('asistencia_default_project_id', B.id);
        const result = await merge({ protectedIds: undefined });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toEqual(['SOURCE_IS_DEFAULT']);
    });

    test('un empleado de B que solo existe en memoria (sin guardar)', async () => {
        await seed(fixture());
        stateManager.setState({ employees: [...stateManager._state.employees, emp('e9', B.id)] }, { silent: true });
        const before = await snapshot();
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toContain('UNSAVED_CHANGES');
        expect(await snapshot()).toBe(before);
    });

    test('asistencia de B que solo existe en memoria (sin guardar)', async () => {
        await seed(fixture());
        stateManager.setState({ attendance: { ...stateManager._state.attendance, 'e1-2026-02-01': att('e1', '2026-02-01', B.id) } }, { silent: true });
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toContain('UNSAVED_CHANGES');
    });

    test('un préstamo editado en memoria y sin guardar no se pisa', async () => {
        await seed(fixture());
        const memory = stateManager._state.employees.find(e => e.id === 'e1');
        memory.loans = [{ id: 'L1', projectId: B.id, amount: 999 }];
        stateManager.setState({ employees: stateManager._state.employees }, { silent: true });
        const before = await snapshot();
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toContain('UNSAVED_CHANGES');
        expect(await snapshot()).toBe(before);
    });

    test('si una escritura falla, la transacción entera se revierte', async () => {
        await seed(fixture());
        const before = await snapshot();
        const originalTransaction = db.db.transaction.bind(db.db);
        let calls = 0;
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = originalTransaction(...args);
            if (++calls === 1) {
                const store = tx.objectStore('attendance');
                const put = store.put.bind(store);
                store.put = (...putArgs) => { put(...putArgs); tx.abort(); };
            }
            return tx;
        });
        await expect(merge()).rejects.toBeDefined();
        jest.restoreAllMocks();
        expect(await snapshot()).toBe(before);
        expect(stateManager._state.employees.find(e => e.id === 'e1').projectId).toBe(B.id);
    });
});

describe('adopción en un dispositivo atrasado', () => {
    const tombstone = { ...B, deletedAt: 300, mergedIntoId: A.id, updatedAt: 300 };

    async function seedStale() {
        const data = fixture();
        await seed(data);
        await db.update('projects', tombstone);
    }
    const adopt = (extra = {}) => merge({ adopt: true, ...extra });

    test('mueve lo que quedó bajo la obra retirada y deja el catálogo como está', async () => {
        await seedStale();
        const result = await adopt();
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(byId(await durable('employees'), 'e1').projectId).toBe(A.id);
        expect(byId(await durable('projects'), B.id)).toEqual(tombstone);
        expect(byId(await durable('projects'), A.id)).toEqual(A);
    });

    test('repetirla no cambia nada', async () => {
        await seedStale();
        await adopt();
        const again = await adopt();
        expect(again.status).toBe(REPAIR_STATUS.NO_OP);
    });

    test('solo adopta si la lápida apunta a ese destino', async () => {
        await seedStale();
        await db.update('projects', { ...tombstone, mergedIntoId: 'PRJ-otra' });
        const result = await adopt();
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.map(c => c.kind)).toEqual(['SOURCE_NOT_MERGED']);
    });
});

describe('fusionar sin cambios', () => {
    test('si B ya no tiene nada, solo se retira y se informa', async () => {
        const empty = { employees: [emp('e3', A.id)], positions: [], leaders: [], attendance: [att('e3', '2026-01-05', A.id)] };
        await seed(empty);
        const result = await merge();
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.counts).toMatchObject({ employees: 0, positions: 0, leaders: 0, attendance: 0 });
        expect(byId(await durable('projects'), B.id)).toMatchObject({ mergedIntoId: A.id });
        expect(dailySpy).not.toHaveBeenCalled();
    });
});
