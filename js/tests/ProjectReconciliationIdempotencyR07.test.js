/**
 * ProjectReconciliationIdempotencyR07.test.js — R07 A2b
 *
 * Contracts:
 *   1. Applying the same MAP_TO_EXISTING resolution twice is safe — the second
 *      invocation is a no-op and produces no duplicates of employees, attendance,
 *      loans, or metadata.
 *   2. Applying MAP_TO_EXISTING after QUARANTINE on the same employee: the
 *      employee is no longer an orphan in the original sense, so the second
 *      attempt to map-to-existing from the quarantine state requires the caller
 *      to supply the quarantined employee at its current state; the service
 *      does not resurrect old state.
 *   3. CREATE_PROJECT_AND_MAP with the same stable projectId twice: second run
 *      is a no-op for already-mapped employees — no duplicate project is created.
 *   4. Re-running QUARANTINE on an already-quarantined employee is a no-op.
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

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-idem-v-001', name: 'Valid Idem', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID = 'PRJ-orphan-idem-002';

function makeEmployee(id, overrides = {}) {
    return {
        id, number: id, name: `Emp ${id}`,
        active: true, positions: [], loans: [{ id: `loan-${id}`, amount: 100, balance: 50 }],
        projectId: ORPHAN_PID, ...overrides
    };
}

async function seedDurable(db, employees, attendance = {}) {
    for (const emp of (Array.isArray(employees) ? employees : [employees])) await db.update('employees', emp);
    for (const record of Object.values(attendance || {})) await db.update('attendance', record);
}

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-idempotency-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationIdempotencyR07', () => {
    test('applying MAP_TO_EXISTING twice produces no duplicate employees, attendance or loans', async () => {
        const emp = makeEmployee('emp-idem-001');
        const att = {
            [`${emp.id}-2026-09-18`]: {
                key: `${emp.id}-2026-09-18`,
                employeeId: emp.id,
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: ORPHAN_PID
            }
        };
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });
        await seedDurable(db, emp, att);

        const r1 = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: att,
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(r1.status).toBe(REPAIR_STATUS.OK);

        const memAfterFirst = {
            employees: JSON.parse(JSON.stringify(stateManager._state.employees)),
            attendance: JSON.parse(JSON.stringify(stateManager._state.attendance))
        };

        // Second run: pass the ALREADY REPAIRED employee.
        const alreadyMapped = stateManager._state.employees.find(e => e.id === emp.id);
        const alreadyMappedAtt = JSON.parse(JSON.stringify(stateManager._state.attendance));

        const r2 = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [alreadyMapped],
            attendance: alreadyMappedAtt,
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect([REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP]).toContain(r2.status);

        // Employee count in memory unchanged.
        expect(stateManager._state.employees.filter(e => e.id === emp.id)).toHaveLength(1);

        // IDB employee count: only one.
        const idbEmployees = await db.getAll('employees');
        expect(idbEmployees.filter(e => e.id === emp.id)).toHaveLength(1);

        // Loan NOT duplicated.
        const idbEmp = idbEmployees.find(e => e.id === emp.id);
        expect(idbEmp.loans.filter(l => l.id === `loan-${emp.id}`)).toHaveLength(1);

        // Attendance NOT duplicated.
        const idbAtt = await db.getAll('attendance');
        expect(idbAtt.filter(a => a.key === `${emp.id}-2026-09-18`)).toHaveLength(1);
    });

    test('second MAP_TO_EXISTING does not add a second metadata repair entry for already-mapped employees', async () => {
        const emp = makeEmployee('emp-idem-002');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        const meta1 = await db.get('settings', RECONCILIATION_META_KEY);
        const repairCount1 = meta1?.repairs?.length ?? 0;

        const alreadyMapped = stateManager._state.employees.find(e => e.id === emp.id);
        const r2 = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [alreadyMapped],
            attendance: {},
            catalog: [VALID_PROJECT],
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });
        expect(r2.status).toBe(REPAIR_STATUS.NO_OP);

        // No new metadata written on no-op.
        const meta2 = await db.get('settings', RECONCILIATION_META_KEY);
        const repairCount2 = meta2?.repairs?.length ?? 0;
        expect(repairCount2).toBe(repairCount1);
    });

    test('CREATE_PROJECT_AND_MAP refuses to generate a fresh project id implicitly', async () => {
        const emp = makeEmployee('emp-idem-no-stable-id');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);
        const beforeProjects = await db.getAll('projects');

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            attendance: {},
            catalog: [],
            projectName: 'Must not generate implicitly',
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.reason).toMatch(/stable explicit projectId/i);
        const afterProjects = await db.getAll('projects');
        expect(afterProjects).toEqual(beforeProjects);
    });

    test('CREATE_PROJECT_AND_MAP with same stable projectId on already-mapped employees is a no-op', async () => {
        const stableProjectId = 'PRJ-recovery-stable-idem-003';
        const emp = makeEmployee('emp-idem-003');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        const r1 = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [emp],
            attendance: {},
            catalog: [],
            projectId: stableProjectId,
            projectName: 'Stable Recovery Project',
            _db: db
        });
        expect(r1.status).toBe(REPAIR_STATUS.OK);
        expect(r1.createdProject).toBeDefined();
        expect(r1.createdProject.id).toBe(stableProjectId);

        const idbProjectsBefore = await db.getAll('projects');
        const metaBeforeRetry = await db.get('settings', RECONCILIATION_META_KEY);
        const repairsBeforeRetry = metaBeforeRetry?.repairs?.length ?? 0;

        // Second run: employee is already mapped to stableProjectId.
        const alreadyMapped = stateManager._state.employees.find(e => e.id === emp.id);
        const augmentedCatalog = [r1.createdProject];

        const r2 = await applyOwnershipRepair({
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            employees: [alreadyMapped],
            attendance: {},
            catalog: augmentedCatalog,
            projectId: stableProjectId,
            projectName: 'Stable Recovery Project',
            _db: db
        });

        expect(r2.status).toBe(REPAIR_STATUS.NO_OP);

        // No second project or metadata event was created.
        const idbProjectsAfter = await db.getAll('projects');
        const matchingProjects = idbProjectsAfter.filter(p => p.id === stableProjectId);
        expect(matchingProjects).toHaveLength(1);
        const metaAfterRetry = await db.get('settings', RECONCILIATION_META_KEY);
        expect(metaAfterRetry?.repairs?.length ?? 0).toBe(repairsBeforeRetry);
    });

    test('repeated QUARANTINE on already-quarantined employee is a no-op', async () => {
        const emp = makeEmployee('emp-idem-004');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        const r1 = await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });
        expect(r1.status).toBe(REPAIR_STATUS.OK);

        const alreadyQuarantined = stateManager._state.employees.find(e => e.id === emp.id);
        const r2 = await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [alreadyQuarantined],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });
        expect(r2.status).toBe(REPAIR_STATUS.NO_OP);
        expect(r2.skipped).toContain(emp.id);

        // Employee count unchanged.
        const idbEmployees = await db.getAll('employees');
        expect(idbEmployees.filter(e => e.id === emp.id)).toHaveLength(1);
    });
});
