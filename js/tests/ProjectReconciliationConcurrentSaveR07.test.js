/**
 * ProjectReconciliationConcurrentSaveR07.test.js — R07 A2b
 *
 * Contract: a stale/in-flight save cannot resurrect the pre-repair orphan
 * projectId after the repair transaction has committed. The repair uses a
 * dedicated, narrow IDB transaction that is independent from saveState's
 * epoch-guard. A concurrent ordinary save that flushes old in-memory state
 * after the repair must not overwrite the repaired rows with the old orphan.
 *
 * This test verifies the memory-then-save ordering: because the repair updates
 * in-memory state immediately after durable commit, any subsequent save that
 * reads current in-memory state will serialize the already-repaired data.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { stampDatasetEpochOptions } from '../modules/services/PersistenceService.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-concurrent-v-001', name: 'Valid Proj', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const SOURCE_PROJECT = { id: 'PRJ-concurrent-source-002', name: 'Source Proj', status: 'active', createdAt: 2, updatedAt: 2, schemaVersion: 1 };
const ORPHAN_PID = 'PRJ-orphan-concurrent-003';

function makeEmployee(id, overrides = {}) {
    return { id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId: ORPHAN_PID, ...overrides };
}

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-concurrent-save-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
    await db.update('projects', SOURCE_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationConcurrentSaveR07', () => {
    test('in-flight save captured before repair is rejected after the repair advances dataset epoch', async () => {
        const emp = makeEmployee('emp-concurrent-001', { projectId: SOURCE_PROJECT.id });
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const staleSnapshot = {
            employees: JSON.parse(JSON.stringify([emp])),
            positions: [],
            leaders: [],
            attendance: {},
            settings: {}
        };

        let releaseHeldWrite;
        const releasePromise = new Promise(resolve => { releaseHeldWrite = resolve; });
        let heldWriteReached;
        const heldWritePromise = new Promise(resolve => { heldWriteReached = resolve; });
        const realBatchUpdate = db.batchUpdate.bind(db);
        let held = false;

        jest.spyOn(db, 'batchUpdate').mockImplementation(async (storeName, records) => {
            if (!held && storeName === 'employees') {
                held = true;
                heldWriteReached();
                await releasePromise;
            }
            return realBatchUpdate(storeName, records);
        });

        const staleOptions = stampDatasetEpochOptions({
            skipValidation: true,
            entityScope: { enabled: false, projectId: null, defaultProjectId: null }
        });
        const staleSavePromise = db.saveState(staleSnapshot, staleOptions);
        await heldWritePromise;

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            allEmployees: [emp],
            attendance: {},
            catalog: [SOURCE_PROJECT, VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(stateManager._state.employees.find(e => e.id === emp.id)?.projectId).toBe(VALID_PROJECT.id);

        // Release the pre-repair save only AFTER R07 committed and advanced the epoch.
        releaseHeldWrite();
        await staleSavePromise;
        jest.restoreAllMocks();

        const durableEmployees = await db.getAll('employees');
        const durableEmployee = durableEmployees.find(e => e.id === emp.id);
        expect(durableEmployee?.projectId).toBe(VALID_PROJECT.id);
        expect(durableEmployees.some(e => e.id === emp.id && e.projectId === SOURCE_PROJECT.id)).toBe(false);
    });

    test('repair result is durably isolated — a concurrent read between repair and save sees repaired data', async () => {
        const emp = makeEmployee('emp-concurrent-002');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);

        // A read from IDB immediately after commit sees repaired data.
        const idbEmployees = await db.getAll('employees');
        const idbEmp = idbEmployees.find(e => e.id === emp.id);
        expect(idbEmp?.projectId).toBe(VALID_PROJECT.id);
    });

    test('two sequential repairs are idempotent and the second does not resurrect orphan', async () => {
        const emp = makeEmployee('emp-concurrent-003');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const r1 = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(r1.status).toBe(REPAIR_STATUS.OK);

        // Second repair using current memory (which is already repaired).
        const currentEmployee = stateManager._state.employees.find(e => e.id === emp.id);
        const r2 = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [currentEmployee],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        // Should be a no-op (already mapped).
        expect([REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP]).toContain(r2.status);

        // IDB still correct.
        const idbEmployees = await db.getAll('employees');
        const idbEmp = idbEmployees.find(e => e.id === emp.id);
        expect(idbEmp?.projectId).toBe(VALID_PROJECT.id);
    });
});
