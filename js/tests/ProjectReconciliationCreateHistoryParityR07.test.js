/**
 * ProjectReconciliationCreateHistoryParityR07.test.js — R07 CREATE/MAP history parity.
 *
 * CREATE_PROJECT_AND_MAP with positionRemaps:[{migrateHistory:true}] must mirror
 * MAP_TO_EXISTING: the remapped attendance record reaches the in-memory state
 * (attendanceRecordPatches via applyFieldScopedMemoryUpdate) and affected[]
 * carries remappedHistoryCount.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const SOURCE_PROJECT = {
    id: 'PRJ-create-hist-source', name: 'Obra origen', status: 'active',
    createdAt: 1, updatedAt: 1, schemaVersion: 1
};
const OLD_POSITION = {
    id: 'POS-create-hist-old', name: 'Albañil origen', active: true,
    projectId: SOURCE_PROJECT.id, hourlyRate: 120
};
const NEW_PROJECT_ID = 'PRJ-create-hist-new';
const NEW_PROJECT_NAME = 'Obra nueva historial';
const NEW_POSITION_ID = 'POS-create-hist-new';

function employee() {
    return {
        id: 'emp-create-hist-1', number: '34', name: 'Andres Sanchez',
        active: true, projectId: 'PRJ-create-hist-orphan',
        positions: [OLD_POSITION.id],
        positionSalaries: { [OLD_POSITION.id]: 150 },
        positionSalaryModes: { [OLD_POSITION.id]: 'hourly' },
        customWorkingDays: { [OLD_POSITION.id]: [1, 2, 3, 4, 5] },
        loans: [{ id: 'loan-safe', balance: 275 }],
        updatedAt: 10, positionsUpdatedAt: 10
    };
}

function attendance(emp = employee()) {
    const key = emp.id + '-2026-09-18';
    return {
        [key]: {
            key, employeeId: emp.id, date: '2026-09-18',
            present: true, hoursWorked: 8, overtimeHours: 0,
            projectId: 'PRJ-create-hist-orphan',
            selectedPosition: OLD_POSITION.id,
            positionHours: [{ positionId: OLD_POSITION.id, hours: 8, overtimeHours: 0 }],
            updatedAt: 10
        }
    };
}

describe('ProjectReconciliationCreateHistoryParityR07', () => {
    let db;
    let previous;

    beforeEach(async () => {
        previous = JSON.parse(JSON.stringify({
            employees: stateManager._state.employees || [],
            positions: stateManager._state.positions || [],
            leaders: stateManager._state.leaders || [],
            attendance: stateManager._state.attendance || {}
        }));
        db = new IndexedDBService('r07-create-history-parity-' + Math.random());
        await db.init();
        await db.update('projects', SOURCE_PROJECT);
        await db.update('positions', OLD_POSITION);
    });

    afterEach(() => {
        stateManager.setState(previous, { silent: true });
        try { db.db.close(); } catch (_) {}
        jest.restoreAllMocks();
    });

    test('CREATE with migrateHistory:true remaps durable AND in-memory attendance with remappedHistoryCount', async () => {
        const emp = employee();
        const att = attendance(emp);
        const key = emp.id + '-2026-09-18';
        await db.update('employees', emp);
        for (const rec of Object.values(att)) await db.update('attendance', rec);
        stateManager.setState({
            employees: [emp],
            positions: [OLD_POSITION],
            leaders: [],
            attendance: att
        }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            allEmployees: [emp],
            attendance: att,
            positions: [OLD_POSITION],
            leaders: [],
            catalog: [SOURCE_PROJECT],
            projectId: NEW_PROJECT_ID,
            projectName: NEW_PROJECT_NAME,
            positionRemaps: [{
                employeeId: emp.id,
                fromPositionId: OLD_POSITION.id,
                toPositionId: NEW_POSITION_ID,
                migrateHistory: true
            }],
            positionCopies: [{
                fromPositionId: OLD_POSITION.id,
                newPositionId: NEW_POSITION_ID,
                name: 'Albañil nueva'
            }],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);

        // Durable is remapped (write path already covers this).
        const durableAtt = (await db.getAll('attendance')).find(r => r.employeeId === emp.id);
        expect(durableAtt.selectedPosition).toBe(NEW_POSITION_ID);
        expect(durableAtt.positionHours).toEqual([
            { positionId: NEW_POSITION_ID, hours: 8, overtimeHours: 0 }
        ]);

        // MAP parity: affected carries the remapped-history count.
        expect(result.affected[0].remappedHistoryCount).toBe(1);

        // MAP parity: in-memory attendance reflects the remap (attendanceRecordPatches).
        const memoryAtt = stateManager._state.attendance[key];
        expect(memoryAtt.selectedPosition).toBe(NEW_POSITION_ID);
        expect(memoryAtt.positionHours).toEqual([
            { positionId: NEW_POSITION_ID, hours: 8, overtimeHours: 0 }
        ]);
    });
});
