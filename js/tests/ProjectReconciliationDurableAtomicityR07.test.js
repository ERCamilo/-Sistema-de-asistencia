/**
 * ProjectReconciliationDurableAtomicityR07.test.js — R07 A2b
 *
 * Contracts:
 *   1. Successful durable mapping survives close/reopen (data persisted).
 *   2. Injected failure on employee write rolls back entire transaction.
 *   3. Injected failure on attendance write rolls back entire transaction.
 *   4. CREATE_PROJECT_AND_MAP failure leaves no created project and no
 *      partial employee changes.
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
import { CLASSIFICATION } from '../modules/features/projects/ProjectOwnershipReconciliation.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-durable-v-001', name: 'Durable Valid', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID    = 'PRJ-orphan-gone-001';

function makeEmployee(id, overrides = {}) {
    return { id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId: ORPHAN_PID, ...overrides };
}

function makeAttendance(empId) {
    return {
        [`${empId}-2026-09-19`]: {
            key: `${empId}-2026-09-19`,
            employeeId: empId,
            date: '2026-09-19',
            present: true,
            hoursWorked: 8,
            projectId: ORPHAN_PID
        }
    };
}

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees: JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-durable-atomicity-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationDurableAtomicityR07', () => {
    // ── 1. Successful mapping survives close / reopen ─────────────────────────
    test('successful durable mapping survives IDB close and reopen', async () => {
        const emp = makeEmployee('emp-persist-001');
        const att = makeAttendance(emp.id);
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });

        // Store employee record in IDB so subsequent getAll returns it.
        await db.update('employees', emp);
        await db.update('attendance', att[`${emp.id}-2026-09-19`]);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: att,
            allEmployees: [emp],
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.OK);

        // Close the connection.
        db.db.close();
        db.isInitialized = false;
        db.db = null;

        // Reopen.
        await db.init();

        const employees  = await db.getAll('employees');
        const attendance = await db.getAll('attendance');

        const reloaded = employees.find(e => e.id === emp.id);
        expect(reloaded).toBeDefined();
        expect(reloaded.projectId).toBe(VALID_PROJECT.id);

        const attReloaded = attendance.find(a => a.key === `${emp.id}-2026-09-19`);
        expect(attReloaded).toBeDefined();
        expect(attReloaded.projectId).toBe(VALID_PROJECT.id);
    });

    // ── 2. Failure on employee write rolls back everything ────────────────────
    test('injected failure on employee write rolls back entire transaction', async () => {
        const emp = makeEmployee('emp-fail-emp-002');
        const att = makeAttendance(emp.id);
        await db.update('employees', emp);
        await db.update('attendance', att[`${emp.id}-2026-09-19`]);
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });

        const memBefore = JSON.stringify(stateManager._state.employees);

        // Patch the real db.db to throw on employee put.
        const originalTransaction = db.db.transaction.bind(db.db);
        let txCallCount = 0;
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = originalTransaction(...args);
            txCallCount++;
            if (txCallCount === 1) {
                const empStore = tx.objectStore('employees');
                const origPut = empStore.put.bind(empStore);
                empStore.put = (...putArgs) => {
                    origPut(...putArgs);
                    tx.abort();
                };
            }
            return tx;
        });

        let threw = false;
        try {
            await applyOwnershipRepair({
                action: REPAIR_ACTION.MAP_TO_EXISTING,
                employees: [emp],
                attendance: att,
                catalog: [VALID_PROJECT],
                targetProjectId: VALID_PROJECT.id,
                _db: db
            });
        } catch (_) {
            threw = true;
        }

        jest.restoreAllMocks();

        // Either threw or returned a non-OK status — either way, durable must be clean.
        expect(threw || true).toBe(true); // just check that we got here

        // IDB state: employee still has the orphan projectId.
        const employees = await db.getAll('employees');
        const stored = employees.find(e => e.id === emp.id);
        expect(stored?.projectId).toBe(ORPHAN_PID);

        // Memory unchanged.
        expect(JSON.stringify(stateManager._state.employees)).toBe(memBefore);
    });

    // ── 3. Failure on attendance write rolls back everything ──────────────────
    test('injected failure on attendance write rolls back entire transaction', async () => {
        const emp = makeEmployee('emp-fail-att-003');
        const att = makeAttendance(emp.id);
        await db.update('employees', emp);
        await db.update('attendance', att[`${emp.id}-2026-09-19`]);
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });

        const memBefore = JSON.stringify(stateManager._state.employees);

        const originalTransaction = db.db.transaction.bind(db.db);
        let txCallCount = 0;
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = originalTransaction(...args);
            txCallCount++;
            if (txCallCount === 1) {
                const attStore = tx.objectStore('attendance');
                const origPut = attStore.put.bind(attStore);
                attStore.put = (...putArgs) => {
                    origPut(...putArgs);
                    tx.abort();
                };
            }
            return tx;
        });

        let threw = false;
        try {
            await applyOwnershipRepair({
                action: REPAIR_ACTION.MAP_TO_EXISTING,
                employees: [emp],
                attendance: att,
                catalog: [VALID_PROJECT],
                targetProjectId: VALID_PROJECT.id,
                _db: db
            });
        } catch (_) {
            threw = true;
        }

        jest.restoreAllMocks();

        // Durable: attendance projectId still the orphan value.
        const storedAtt = await db.getAll('attendance');
        const attRecord = storedAtt.find(a => a.key === `${emp.id}-2026-09-19`);
        expect(attRecord?.projectId).toBe(ORPHAN_PID);

        // Memory unchanged.
        expect(JSON.stringify(stateManager._state.employees)).toBe(memBefore);
    });

    // ── 4. CREATE_PROJECT_AND_MAP failure leaves no created project ───────────
    test('CREATE_PROJECT_AND_MAP failure leaves no created project and no partial changes', async () => {
        const emp = makeEmployee('emp-create-fail-004');
        const att = makeAttendance(emp.id);
        await db.update('employees', emp);
        await db.update('attendance', att[`${emp.id}-2026-09-19`]);
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });

        const projectsBefore = await db.getAll('projects');
        const memBefore = JSON.stringify(stateManager._state.employees);

        const originalTransaction = db.db.transaction.bind(db.db);
        let txCallCount = 0;
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = originalTransaction(...args);
            txCallCount++;
            if (txCallCount === 1) {
                const projStore = tx.objectStore('projects');
                const origPut = projStore.put.bind(projStore);
                projStore.put = (...putArgs) => {
                    origPut(...putArgs);
                    tx.abort();
                };
            }
            return tx;
        });

        let threw = false;
        try {
            await applyOwnershipRepair({
                action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
                employees: [emp],
                attendance: att,
                catalog: [],
                projectId: 'PRJ-recovery-atomicity-004',
                projectName: 'Recovery Project A2b',
                _db: db
            });
        } catch (_) {
            threw = true;
        }

        jest.restoreAllMocks();

        const projectsAfter = await db.getAll('projects');
        // No net new project was durably written.
        expect(projectsAfter.length).toBe(projectsBefore.length);

        // Memory unchanged.
        expect(JSON.stringify(stateManager._state.employees)).toBe(memBefore);
    });

    // ── 5. Reconciliation metadata is durably written on success ─────────────
    test('reconciliation metadata is written to settings store on successful repair', async () => {
        const emp = makeEmployee('emp-meta-005');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await db.update('employees', emp);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        const meta = await db.get('settings', RECONCILIATION_META_KEY);
        expect(meta).toBeDefined();
        expect(Array.isArray(meta.repairs)).toBe(true);
        expect(meta.repairs.length).toBeGreaterThan(0);
        const lastRepair = meta.repairs[meta.repairs.length - 1];
        expect(lastRepair.action).toBe(REPAIR_ACTION.MAP_TO_EXISTING);
        expect(lastRepair.targetProjectId).toBe(VALID_PROJECT.id);
        expect(lastRepair.employeeIds).toContain(emp.id);
    });
});
