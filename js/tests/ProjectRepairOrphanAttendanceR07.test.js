/**
 * ProjectRepairOrphanAttendanceR07.test.js — R07 A2c-1
 *
 * Contracts (H6 / requirements 7 & 8):
 *   a. When the employee already carries the target projectId but one of its
 *      canonically-owned attendance records is still orphaned, MAP_TO_EXISTING
 *      must return OK and repair the attendance — NOT a NO_OP.
 *   b. The same principle holds for QUARANTINE: an already-quarantined employee
 *      whose canonically-owned attendance still points elsewhere is repaired
 *      (attendance brought to the same quarantine id), not a NO_OP.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { isQuarantineProjectId, makeQuarantineProjectId } from '../modules/features/projects/ProjectOwnershipReconciliation.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-orphan-att-valid-001', name: 'Valid Att Base', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID    = 'PRJ-orphan-att-gone-999';

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-orphan-attendance-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectRepairOrphanAttendanceR07', () => {
    test('a. employee already in target with one orphan attendance => OK and attendance repaired, not NO_OP', async () => {
        const id = 'emp-oatt-a-001';
        const employee = {
            id,
            number: id,
            name: `Emp ${id}`,
            active: true,
            positions: [],
            loans: [],
            projectId: VALID_PROJECT.id // already mapped
        };
        await db.update('employees', employee);

        const orphanKey   = `${id}-2026-09-18`;
        const alreadyKey  = `${id}-2026-09-19`;
        const orphanAtt   = { key: orphanKey,  employeeId: id, date: '2026-09-18', present: true,  hoursWorked: 8, projectId: ORPHAN_PID };
        const alreadyAtt  = { key: alreadyKey, employeeId: id, date: '2026-09-19', present: false, hoursWorked: 0, projectId: VALID_PROJECT.id };
        await db.update('attendance', orphanAtt);
        await db.update('attendance', alreadyAtt);

        const attendance = { [orphanKey]: orphanAtt, [alreadyKey]: alreadyAtt };
        stateManager.setState({ employees: [employee], attendance }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee],
            attendance,
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.status).not.toBe(REPAIR_STATUS.NO_OP);

        // Orphan attendance repaired; already-mapped attendance untouched.
        const durableAttendance = await db.getAll('attendance');
        expect(durableAttendance.find(a => a.key === orphanKey)?.projectId).toBe(VALID_PROJECT.id);
        expect(durableAttendance.find(a => a.key === alreadyKey)?.projectId).toBe(VALID_PROJECT.id);

        const mem = stateManager._state.attendance[orphanKey];
        expect(mem?.projectId).toBe(VALID_PROJECT.id);
    });

    test('c. attendance with empty projectId is reconciled to the employee destination', async () => {
        const id = 'emp-oatt-empty-003';
        const employee = {
            id,
            number: id,
            name: `Emp ${id}`,
            active: true,
            positions: [],
            loans: [],
            projectId: 'PRJ-orphan-empty'
        };
        const key = `${id}-2026-09-20`;
        const orphanAttendance = {
            key,
            employeeId: id,
            date: '2026-09-20',
            present: true,
            hoursWorked: 8,
            projectId: '',
            selectedPosition: 'POS-history',
            updatedAt: 10
        };
        await db.update('employees', employee);
        await db.update('attendance', orphanAttendance);
        stateManager.setState({
            employees: [employee],
            attendance: { [key]: orphanAttendance }
        }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [employee],
            attendance: { [key]: orphanAttendance },
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        const durable = (await db.getAll('attendance')).find(record => record.key === key);
        expect(durable.projectId).toBe(VALID_PROJECT.id);
        expect(durable.selectedPosition).toBe(orphanAttendance.selectedPosition);
        expect(durable.updatedAt).toBeGreaterThan(10);
        expect(stateManager._state.attendance[key].projectId).toBe(VALID_PROJECT.id);
    });

    test('b. already-quarantined employee with mismatched attendance => attendance repaired, not NO_OP', async () => {
        const id = 'emp-oatt-b-001';
        const quarantineId = makeQuarantineProjectId(id);
        const employee = {
            id,
            number: id,
            name: `Emp ${id}`,
            active: true,
            positions: [],
            loans: [],
            projectId: quarantineId // already quarantined
        };
        await db.update('employees', employee);

        const mismatchedKey = `${id}-2026-09-18`;
        const matchedKey    = `${id}-2026-09-19`;
        const mismatchedAtt = { key: mismatchedKey, employeeId: id, date: '2026-09-18', present: true,  hoursWorked: 8, projectId: ORPHAN_PID };
        const matchedAtt    = { key: matchedKey,    employeeId: id, date: '2026-09-19', present: false, hoursWorked: 0, projectId: quarantineId };
        await db.update('attendance', mismatchedAtt);
        await db.update('attendance', matchedAtt);

        const attendance = { [mismatchedKey]: mismatchedAtt, [matchedKey]: matchedAtt };
        stateManager.setState({ employees: [employee], attendance }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [employee],
            attendance,
            catalog: [VALID_PROJECT],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.status).not.toBe(REPAIR_STATUS.NO_OP);

        const durableAttendance = await db.getAll('attendance');
        expect(durableAttendance.find(a => a.key === mismatchedKey)?.projectId).toBe(quarantineId);
        expect(durableAttendance.find(a => a.key === matchedKey)?.projectId).toBe(quarantineId);

        const mem = stateManager._state.attendance[mismatchedKey];
        expect(mem?.projectId).toBe(quarantineId);
        expect(isQuarantineProjectId(mem.projectId)).toBe(true);
    });
});
