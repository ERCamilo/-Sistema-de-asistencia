import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

/**
 * «Asignar todo a esta obra» lleva a la obra destino TODOS los huérfanos,
 * incluida la asistencia de empleados que ya no existen (también los
 * tombstones que la memoria compactó pero siguen en IndexedDB). La obra creada
 * desde la reconciliación nace con la configuración de nómina de la obra por
 * defecto.
 */
const OBRA = 'PRJ-obra-uno-0001';
const OTRA = 'PRJ-obra-dos-0002';
const GHOST = 'PRJ-inexistente-0009';
const project = (id, name) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 });
const att = (employeeId, date, extra = {}) => ({ employeeId, date, present: true, hoursWorked: 8, updatedAt: 1, ...extra });

let db, snapshot;
beforeEach(async () => {
    jest.useFakeTimers();
    snapshot = { employees: stateManager._state.employees, attendance: stateManager._state.attendance };
    db = new IndexedDBService('orphan-attendance-' + Math.random());
    await db.init();
    await db.update('projects', project(OBRA, 'Obra uno'));
    await db.update('projects', project(OTRA, 'Obra dos'));
    await db.update('projectPayrollConfigs', { projectId: OBRA, regularHoursPerDay: 8, holidays: ['2026-01-26'], schemaVersion: 1, updatedAt: 1 });
    await db.update('employees', { id: 'emp-vivo', number: '1', name: 'Vivo', active: true, positions: [], loans: [], projectId: OBRA });
    const records = {
        'emp-ido-2026-09-01': att('emp-ido', '2026-09-01'),                           // sin obra
        'emp-ido-2026-09-02': att('emp-ido', '2026-09-02', { projectId: GHOST }),     // obra inexistente
        'emp-ido-2026-09-03': att('emp-ido', '2026-09-03', { deletedAt: 5 }),         // tombstone solo en IndexedDB
        'emp-ido-2026-09-04': att('emp-ido', '2026-09-04', { projectId: OTRA }),      // obra válida: no se toca
        'emp-vivo-2026-09-01': att('emp-vivo', '2026-09-01', { projectId: OBRA })
    };
    for (const [key, record] of Object.entries(records)) await db.update('attendance', { key, ...record });
    // La memoria ya compactó el tombstone viejo.
    const memory = { ...records };
    delete memory['emp-ido-2026-09-03'];
    stateManager.setState({ employees: [await db.get('employees', 'emp-vivo')], attendance: memory }, { silent: true });
    replaceEntityScope({ enabled: true, projectId: OBRA, defaultProjectId: OBRA });
});
afterEach(() => {
    stateManager.setState(snapshot, { silent: true });
    resetEntityScope();
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.useRealTimers();
});

const base = () => ({
    employees: [], allEmployees: stateManager._state.employees, attendance: stateManager._state.attendance,
    positions: [], leaders: [], catalog: [project(OBRA, 'Obra uno'), project(OTRA, 'Obra dos')],
    assignAllOrphanAttendance: true, _db: db
});

test('asigna a la obra destino toda la asistencia huérfana, también la que solo está en IndexedDB', async () => {
    const result = await applyOwnershipRepair({ ...base(), action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: OTRA });

    expect(result.status).toBe(REPAIR_STATUS.OK);
    expect((await db.get('attendance', 'emp-ido-2026-09-01')).projectId).toBe(OTRA);
    expect((await db.get('attendance', 'emp-ido-2026-09-02')).projectId).toBe(OTRA);
    expect(await db.get('attendance', 'emp-ido-2026-09-03')).toMatchObject({ projectId: OTRA, deletedAt: 5 });
    // Lo que ya tenía obra válida queda intacto.
    expect(await db.get('attendance', 'emp-ido-2026-09-04')).toMatchObject({ projectId: OTRA, updatedAt: 1 });
    expect(await db.get('attendance', 'emp-vivo-2026-09-01')).toMatchObject({ projectId: OBRA, updatedAt: 1 });
    // La memoria refleja la nueva obra.
    expect(stateManager._state.attendance['emp-ido-2026-09-01'].projectId).toBe(OTRA);
});

test('sin la opción, la asistencia huérfana no se toca', async () => {
    const result = await applyOwnershipRepair({ ...base(), assignAllOrphanAttendance: false,
        employees: [await db.get('employees', 'emp-vivo')], action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: OBRA });

    expect([REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP]).toContain(result.status);
    expect((await db.get('attendance', 'emp-ido-2026-09-01')).projectId).toBeUndefined();
    expect((await db.get('attendance', 'emp-ido-2026-09-02')).projectId).toBe(GHOST);
});

test('crear una obra: recibe la asistencia huérfana y la configuración de nómina de la obra por defecto', async () => {
    const NUEVA = 'PRJ-obra-nueva-0003';
    const result = await applyOwnershipRepair({ ...base(), action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
        projectId: NUEVA, projectName: 'Obra recuperada' });

    expect(result.status).toBe(REPAIR_STATUS.OK);
    expect((await db.get('projects', NUEVA)).name).toBe('Obra recuperada');
    expect((await db.get('attendance', 'emp-ido-2026-09-01')).projectId).toBe(NUEVA);
    expect(await db.get('projectPayrollConfigs', NUEVA)).toMatchObject({ projectId: NUEVA, holidays: ['2026-01-26'], regularHoursPerDay: 8 });
    // La configuración de origen no cambia.
    expect(await db.get('projectPayrollConfigs', OBRA)).toMatchObject({ projectId: OBRA, updatedAt: 1 });
});

test('usa lo que se ve en pantalla cuando es más nuevo o aún no está guardado (llegó de la nube)', async () => {
    const shown = {
        ...stateManager._state.attendance,
        // Solo en memoria: llegó por la suscripción de la nube.
        'emp-otro-2026-09-10': att('emp-otro', '2026-09-10', { updatedAt: 50 }),
        // Guardado con obra válida, pero la nube trajo una versión más nueva sin obra.
        'emp-ido-2026-09-04': att('emp-ido', '2026-09-04', { updatedAt: 60, hoursWorked: 6 })
    };
    stateManager.setState({ attendance: shown }, { silent: true });

    const result = await applyOwnershipRepair({ ...base(), attendance: shown, action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: OBRA });

    expect(result.status).toBe(REPAIR_STATUS.OK);
    expect(await db.get('attendance', 'emp-otro-2026-09-10')).toMatchObject({ projectId: OBRA, hoursWorked: 8 });
    expect(await db.get('attendance', 'emp-ido-2026-09-04')).toMatchObject({ projectId: OBRA, hoursWorked: 6 });
    expect(stateManager._state.attendance['emp-otro-2026-09-10'].projectId).toBe(OBRA);
});
