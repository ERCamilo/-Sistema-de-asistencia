import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { applyOwnershipRepair, REPAIR_ACTION, REPAIR_STATUS } from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const A = { id: 'PRJ-catalog-a', name: 'Obra A', status: 'active' };
const B = { id: 'PRJ-catalog-b', name: 'Obra B', status: 'active' };
const position = { id: 'POS-catalog-old', name: 'Ayudante', leaderId: 'LDR-catalog-old', hourlyRate: 125 };
const leader = { id: 'LDR-catalog-old', name: 'Líder', active: true };

describe('batch assignment for unresolved positions and leaders', () => {
    let db;
    let previous;
    beforeEach(async () => {
        previous = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {}
        }));
        db = new IndexedDBService('r07-catalog-map-' + Math.random());
        await db.init();
        await db.update('projects', A);
        await db.update('projects', B);
        await db.update('positions', position);
        await db.update('leaders', leader);
        stateManager.setState({ employees: [], positions: [position], leaders: [leader], attendance: {} }, { silent: true });
    });
    afterEach(() => {
        stateManager.setState(previous, { silent: true });
        try { db.db.close(); } catch (_) {}
        jest.restoreAllMocks();
    });
    const params = db => ({
        action: REPAIR_ACTION.MAP_CATALOG_ENTITIES,
        employees: [], targetProjectId: A.id,
        positionIds: [position.id], leaderIds: [leader.id], _db: db
    });
    test('assigns linked definitions together without changing salary or identity', async () => {
        const result = await applyOwnershipRepair(params(db));
        expect(result.status).toBe(REPAIR_STATUS.OK);
        const pos = (await db.getAll('positions')).find(x => x.id === position.id);
        const ldr = (await db.getAll('leaders')).find(x => x.id === leader.id);
        expect(pos.projectId).toBe(A.id);
        expect(ldr.projectId).toBe(A.id);
        expect(pos.hourlyRate).toBe(125);
        expect(pos.leaderId).toBe(leader.id);
        expect(stateManager._state.positions.find(x => x.id === position.id).projectId).toBe(A.id);
        expect(stateManager._state.leaders.find(x => x.id === leader.id).projectId).toBe(A.id);
    });
    test('rejects a different-project employee using the selected position with zero writes', async () => {
        const employee = { id: 'EMP-catalog-b', projectId: B.id, positions: [position.id] };
        await db.update('employees', employee);
        const before = JSON.stringify(await db.getAll('positions'));
        const result = await applyOwnershipRepair(params(db));
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'CATALOG_POSITION_EMPLOYEE_PROJECT')).toBe(true);
        expect(JSON.stringify(await db.getAll('positions'))).toBe(before);
    });
    test('commits employee, linked catalog and worked days in one repair', async () => {
        const employee = {
            id: 'EMP-catalog-unscoped', name: 'Ana', positions: [position.id],
            positionSalaries: { [position.id]: 190 }
        };
        const attendance = {
            key: 'EMP-catalog-unscoped-2026-09-01', employeeId: employee.id,
            date: '2026-09-01', present: true, hoursWorked: 8,
            selectedPosition: position.id, positionHours: [{ positionId: position.id, hours: 8 }]
        };
        await db.update('employees', employee);
        await db.update('attendance', attendance);
        stateManager.setState({ employees: [employee], attendance: { [attendance.key]: attendance } }, { silent: true });
        const result = await applyOwnershipRepair({
            ...params(db), action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [{ id: employee.id }],
            attendance: { [attendance.key]: attendance }
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('employees'))[0]).toMatchObject({
            projectId: A.id, positionSalaries: { [position.id]: 190 }
        });
        expect((await db.getAll('attendance'))[0]).toMatchObject({
            projectId: A.id, selectedPosition: position.id
        });
        expect((await db.getAll('positions'))[0].projectId).toBe(A.id);
        expect((await db.getAll('leaders'))[0].projectId).toBe(A.id);
    });
    test('creates a project and assigns its employees, positions and leaders together', async () => {
        const employee = { id: 'EMP-catalog-new', name: 'Juan', positions: [position.id] };
        await db.update('employees', employee);
        const projectId = 'PRJ-catalog-created';
        const result = await applyOwnershipRepair({
            ...params(db), action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [{ id: employee.id }], projectId, projectName: 'Obra nueva'
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('projects')).some(p => p.id === projectId)).toBe(true);
        expect((await db.getAll('employees'))[0].projectId).toBe(projectId);
        expect((await db.getAll('positions'))[0].projectId).toBe(projectId);
        expect((await db.getAll('leaders'))[0].projectId).toBe(projectId);
    });
    test('keeps two positions, their special rates and their worked days', async () => {
        const second = { id: 'POS-catalog-second', name: 'Soldador', leaderId: leader.id };
        const employee = { id: 'EMP-catalog-two', positions: [position.id, second.id],
            positionSalaries: { [position.id]: 190, [second.id]: 245 } };
        await db.update('positions', second);
        await db.update('employees', employee);
        const attendance = [
            { key: 'EMP-catalog-two-2026-09-01', employeeId: employee.id, date: '2026-09-01',
              present: true, hoursWorked: 8, selectedPosition: position.id, positionHours: [{ positionId: position.id, hours: 8 }] },
            { key: 'EMP-catalog-two-2026-09-02', employeeId: employee.id, date: '2026-09-02',
              present: true, hoursWorked: 6, selectedPosition: second.id, positionHours: [{ positionId: second.id, hours: 6 }] }
        ];
        for (const record of attendance) await db.update('attendance', record);
        const result = await applyOwnershipRepair({
            ...params(db), action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [{ id: employee.id }], positionIds: [position.id, second.id]
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect((await db.getAll('employees'))[0].positionSalaries).toEqual(employee.positionSalaries);
        expect((await db.getAll('attendance')).map(r => r.selectedPosition).sort())
            .toEqual([position.id, second.id].sort());
        expect((await db.getAll('attendance')).every(r => r.projectId === A.id)).toBe(true);
        expect((await db.getAll('positions')).every(p => p.projectId === A.id)).toBe(true);
    });
    test('a catalog conflict rolls back the employee and its worked days', async () => {
        const employee = { id: 'EMP-catalog-unscoped', positions: [position.id] };
        const other = { id: 'EMP-catalog-other', projectId: B.id, positions: [position.id] };
        const attendance = {
            key: 'EMP-catalog-unscoped-2026-09-01', employeeId: employee.id,
            date: '2026-09-01', present: true, hoursWorked: 8
        };
        await db.update('employees', employee);
        await db.update('employees', other);
        await db.update('attendance', attendance);
        const result = await applyOwnershipRepair({
            ...params(db), action: REPAIR_ACTION.MAP_TO_EXISTING, employees: [{ id: employee.id }]
        });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('employees')).find(e => e.id === employee.id).projectId).toBeUndefined();
        expect((await db.getAll('attendance'))[0].projectId).toBeUndefined();
        expect((await db.getAll('positions'))[0].projectId).toBeUndefined();
    });
    test('refuses to map a leader while its position remains unassigned', async () => {
        const result = await applyOwnershipRepair({ ...params(db), positionIds: [] });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('leaders')).find(x => x.id === leader.id).projectId).toBeUndefined();
    });
});
