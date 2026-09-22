/**
 * ProjectReconciliationDurableTruthR07.test.js — R07 A2c-1
 *
 * Contracts:
 *   a. A forged/stale caller catalog that lists a target absent from durable
 *      IndexedDB must NOT authorize the repair: CONFLICT, no writes.
 *   b. A target present in durable IndexedDB but omitted by the caller catalog
 *      still authorizes the repair (durable truth wins).
 *   c. CREATE_PROJECT_AND_MAP with a stable id that already exists durably and
 *      has a compatible identity is a safe retry — no duplicate project.
 *   d. CREATE_PROJECT_AND_MAP with a stable id that exists durably but has a
 *      clearly conflicting name/identity => CONFLICT, no hijack.
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

const VALID_PROJECT  = { id: 'PRJ-dt-valid-001', name: 'Valid Base', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const TARGET_PROJECT = { id: 'PRJ-dt-target-002', name: 'Durable Target', status: 'active', createdAt: 2, updatedAt: 2, schemaVersion: 1 };
const FORGED_PROJECT = { id: 'PRJ-dt-forged-003', name: 'Forged Target', status: 'active', createdAt: 3, updatedAt: 3, schemaVersion: 1 };
const ORPHAN_PID     = 'PRJ-dt-orphan-999';

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
    db = new IndexedDBService('r07-durable-truth-' + Math.random());
    await db.init();
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationDurableTruthR07', () => {
    test('a. forged caller catalog lists target but IDB does not => CONFLICT, no writes', async () => {
        await db.update('projects', VALID_PROJECT);

        const emp = makeEmployee('emp-dt-a-001');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const projectsBefore = await db.getAll('projects');

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT, FORGED_PROJECT], // forged catalog lists the target
            targetProjectId: FORGED_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);

        // No writes: durable employee still orphan, durable projects unchanged.
        const durableEmployees = await db.getAll('employees');
        expect(durableEmployees.find(e => e.id === emp.id)?.projectId).toBe(ORPHAN_PID);
        expect(await db.getAll('projects')).toEqual(projectsBefore);

        // Memory unchanged too.
        expect(stateManager._state.employees.find(e => e.id === emp.id)?.projectId).toBe(ORPHAN_PID);
    });

    test('b. IDB contains target but caller catalog omits it => repair succeeds', async () => {
        await db.update('projects', VALID_PROJECT);
        await db.update('projects', TARGET_PROJECT);

        const emp = makeEmployee('emp-dt-b-001');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT], // caller catalog omits the durable target
            targetProjectId: TARGET_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.targetProjectId).toBe(TARGET_PROJECT.id);

        const durableEmployees = await db.getAll('employees');
        expect(durableEmployees.find(e => e.id === emp.id)?.projectId).toBe(TARGET_PROJECT.id);
        expect(stateManager._state.employees.find(e => e.id === emp.id)?.projectId).toBe(TARGET_PROJECT.id);
    });

    test('c. CREATE existing durable project + stale/empty caller catalog => safe retry, no duplicate', async () => {
        const existing = { id: 'PRJ-dt-exist-004', name: 'Existing Recovery', status: 'active', createdAt: 4, updatedAt: 4, schemaVersion: 1 };
        await db.update('projects', existing);

        const emp = makeEmployee('emp-dt-c-001');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            attendance: {},
            catalog: [], // stale/empty caller catalog
            projectId: existing.id,
            projectName: existing.name,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.projectAlreadyExisted).toBe(true);
        expect(result.createdProject).toBeNull();

        const projects = await db.getAll('projects');
        expect(projects.filter(p => p.id === existing.id)).toHaveLength(1);

        const durableEmployees = await db.getAll('employees');
        expect(durableEmployees.find(e => e.id === emp.id)?.projectId).toBe(existing.id);
    });

    test('e. selected employee that exists only in caller memory is rejected and never created durably', async () => {
        await db.update('projects', TARGET_PROJECT);
        const callerOnly = makeEmployee('emp-dt-e-caller-only');
        stateManager.setState({ employees: [callerOnly], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [callerOnly],
            attendance: {},
            catalog: [TARGET_PROJECT],
            targetProjectId: TARGET_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.reason).toMatch(/durable employee/i);
        expect((await db.getAll('employees')).some(e => e.id === callerOnly.id)).toBe(false);
    });

    test('f. caller-only attendance for a selected durable employee blocks instead of being created or ignored', async () => {
        await db.update('projects', TARGET_PROJECT);
        const emp = makeEmployee('emp-dt-f-001');
        await db.update('employees', emp);

        const key = `${emp.id}-2026-09-20`;
        const callerAttendance = {
            [key]: {
                key,
                employeeId: emp.id,
                date: '2026-09-20',
                present: true,
                hoursWorked: 8,
                projectId: ORPHAN_PID
            }
        };
        stateManager.setState({ employees: [emp], attendance: callerAttendance }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: callerAttendance,
            catalog: [TARGET_PROJECT],
            targetProjectId: TARGET_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.reason).toMatch(/attendance.*durable|unpersisted attendance/i);
        expect(await db.getAll('attendance')).toEqual([]);
        expect((await db.getAll('employees')).find(e => e.id === emp.id)?.projectId).toBe(ORPHAN_PID);
    });

    test('d. CREATE same stable id but conflicting existing identity/name => CONFLICT', async () => {
        const existing = { id: 'PRJ-dt-exist-005', name: 'Original Name', status: 'active', createdAt: 5, updatedAt: 5, schemaVersion: 1 };
        await db.update('projects', existing);

        const emp = makeEmployee('emp-dt-d-001');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            attendance: {},
            catalog: [],
            projectId: existing.id,
            projectName: 'Conflicting Name', // clearly different from durable identity
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.reason).toMatch(/conflicts with existing durable project/i);

        // No hijack: the durable project keeps its original name, no duplicate, employee unmapped.
        const projects = await db.getAll('projects');
        expect(projects.filter(p => p.id === existing.id)).toHaveLength(1);
        expect(projects.find(p => p.id === existing.id)?.name).toBe('Original Name');
        const durableEmployees = await db.getAll('employees');
        expect(durableEmployees.find(e => e.id === emp.id)?.projectId).toBe(ORPHAN_PID);
    });
});
