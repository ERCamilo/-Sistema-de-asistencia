/**
 * ProjectReconciliationStaleSnapshotR07.test.js — R07 A2c-1
 *
 * Contracts (H5 / requirement 6):
 *   a. A caller employee snapshot that is STALE (missing a durable loan/name
 *      edit) must not clobber the durable record: repair changes only
 *      projectId while preserving the freshest durable fields.
 *   b. An unsaved CURRENT in-memory edit (captured by a suspended save) is
 *      preserved in memory after repair: the memory update merges projectId
 *      into the current object rather than replacing it with a snapshot.
 *   c. Attendance unrelated fields remain byte-equivalent except projectId.
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

const VALID_PROJECT = { id: 'PRJ-snap-valid-001', name: 'Valid Snap', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID    = 'PRJ-snap-orphan-999';

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-stale-snapshot-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationStaleSnapshotR07', () => {
    test('a. stale caller employee does not clobber durable loan/name edits while projectId changes', async () => {
        const id = 'emp-snap-a-001';
        // Freshest durable employee has a loan and a newer name.
        const durableEmployee = {
            id,
            number: id,
            name: 'Durable Latest Name',
            active: true,
            positions: [],
            loans: [{ id: `loan-${id}`, amount: 100, balance: 80 }],
            projectId: ORPHAN_PID
        };
        await db.update('employees', durableEmployee);

        // Stale caller snapshot: missing the durable loan AND has an older name.
        const staleSnapshot = {
            id,
            number: id,
            name: 'Stale Old Name',
            active: true,
            positions: [],
            loans: [],
            projectId: ORPHAN_PID
        };
        stateManager.setState({ employees: [staleSnapshot], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [staleSnapshot],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);

        // Durable record preserved the freshest fields; only projectId changed.
        const durableEmployees = await db.getAll('employees');
        const durable = durableEmployees.find(e => e.id === id);
        expect(durable.projectId).toBe(VALID_PROJECT.id);
        expect(durable.name).toBe('Durable Latest Name');
        expect(durable.loans).toEqual([{ id: `loan-${id}`, amount: 100, balance: 80 }]);
    });

    test('b. unsaved CURRENT in-memory edit is preserved in memory after repair (not replaced)', async () => {
        const id = 'emp-snap-b-001';
        const durableEmployee = {
            id,
            number: id,
            name: 'Durable Name',
            active: true,
            positions: [],
            loans: [],
            projectId: ORPHAN_PID
        };
        await db.update('employees', durableEmployee);

        // CURRENT in-memory has an unsaved name edit the caller snapshot lacks.
        const inMemory = {
            id,
            number: id,
            name: 'Unsaved New Name',
            active: true,
            positions: [],
            loans: [],
            projectId: ORPHAN_PID
        };
        stateManager.setState({ employees: [inMemory], attendance: {} }, { silent: true });

        // Caller passes a STALE snapshot (the pre-edit object).
        const staleSnapshot = JSON.parse(JSON.stringify(durableEmployee));

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [staleSnapshot],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);

        // Memory preserves the unsaved edit and only merges projectId.
        const mem = stateManager._state.employees.find(e => e.id === id);
        expect(mem.projectId).toBe(VALID_PROJECT.id);
        expect(mem.name).toBe('Unsaved New Name');

        // Durable write only changed ownership; it did NOT persist the unsaved edit.
        const durableEmployees = await db.getAll('employees');
        const durable = durableEmployees.find(e => e.id === id);
        expect(durable.projectId).toBe(VALID_PROJECT.id);
        expect(durable.name).toBe('Durable Name');
    });

    test('c. attendance unrelated fields remain byte-equivalent except projectId', async () => {
        const id = 'emp-snap-c-001';
        const employee = {
            id,
            number: id,
            name: `Emp ${id}`,
            active: true,
            positions: [],
            loans: [],
            projectId: ORPHAN_PID
        };
        await db.update('employees', employee);

        const attKey = `${id}-2026-09-18`;
        const attendanceRecord = {
            key: attKey,
            employeeId: id,
            date: '2026-09-18',
            present: true,
            hoursWorked: 8,
            overtimeHours: 2,
            notes: 'leave a note',
            projectId: ORPHAN_PID
        };
        await db.update('attendance', attendanceRecord);

        stateManager.setState({ employees: [employee], attendance: { [attKey]: attendanceRecord } }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee],
            attendance: { [attKey]: attendanceRecord },
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);

        const durableAttendance = await db.getAll('attendance');
        const reloaded = durableAttendance.find(a => a.key === attKey);
        expect(reloaded).toBeDefined();

        // Byte-equivalent except projectId (ownership) and updatedAt (H2 freshness
        // stamp that makes Firebase attendance LWW prefer this repair).
        const { updatedAt, ...reloadedRest } = reloaded;
        expect(reloadedRest).toEqual({ ...attendanceRecord, projectId: VALID_PROJECT.id });
        expect(typeof updatedAt).toBe('number');
    });
});
