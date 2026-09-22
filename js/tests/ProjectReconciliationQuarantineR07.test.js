/**
 * ProjectReconciliationQuarantineR07.test.js — R07 A2b
 *
 * Contracts:
 *   1. QUARANTINE persists the legacy-unresolved: sentinel and preserves
 *      original missing project id as provenance in reconciliation metadata.
 *   2. Quarantined records are discoverable by analyzeProjectOwnership (PENDING).
 *   3. Quarantined records are excluded from normal project scopes (no VALID).
 *   4. QUARANTINE is idempotent — re-running on an already-quarantined employee
 *      is a no-op and does not write a duplicate metadata entry.
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
import {
    analyzeProjectOwnership,
    CLASSIFICATION,
    isQuarantineProjectId,
    LEGACY_UNRESOLVED_PREFIX
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT = { id: 'PRJ-quarantine-v-001', name: 'Valid Quarantine Base', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const ORPHAN_PID = 'PRJ-orphan-quarantine-999';

function makeEmployee(id, overrides = {}) {
    return { id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId: ORPHAN_PID, ...overrides };
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
    db = new IndexedDBService('r07-quarantine-' + Math.random());
    await db.init();
    await db.update('projects', VALID_PROJECT);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectReconciliationQuarantineR07', () => {
    test('QUARANTINE persists legacy-unresolved: sentinel on employee projectId', async () => {
        const emp = makeEmployee('emp-q-001');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.durableCommitted).toBe(true);

        const updatedEmp = stateManager._state.employees.find(e => e.id === emp.id);
        expect(updatedEmp).toBeDefined();
        expect(isQuarantineProjectId(updatedEmp.projectId)).toBe(true);
        expect(updatedEmp.projectId.startsWith(LEGACY_UNRESOLVED_PREFIX)).toBe(true);
    });

    test('QUARANTINE preserves original orphan projectId as provenance in metadata', async () => {
        const emp = makeEmployee('emp-q-002');
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });

        const meta = await db.get('settings', RECONCILIATION_META_KEY);
        expect(meta).toBeDefined();
        expect(Array.isArray(meta.repairs)).toBe(true);

        const repair = meta.repairs.find(r => r.action === REPAIR_ACTION.QUARANTINE);
        expect(repair).toBeDefined();
        expect(Array.isArray(repair.provenance)).toBe(true);

        const prov = repair.provenance.find(p => p.employeeId === emp.id);
        expect(prov).toBeDefined();
        expect(prov.originalProjectId).toBe(ORPHAN_PID);
        expect(isQuarantineProjectId(prov.quarantineId)).toBe(true);
    });

    test('quarantined employees appear as PENDING in analyzeProjectOwnership', async () => {
        const emp = makeEmployee('emp-q-003');
        stateManager.setState({ employees: [emp, ...savedState.employees], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });

        const updatedEmployees = stateManager._state.employees;
        const analysis = analyzeProjectOwnership(
            { employees: updatedEmployees, positions: [], leaders: [], attendance: {} },
            [VALID_PROJECT]
        );

        const empAnalysis = analysis.issues.find(i => i.employeeId === emp.id);
        expect(empAnalysis).toBeDefined();
        expect(empAnalysis.status).toBe(CLASSIFICATION.PENDING);
    });

    test('quarantined records are excluded from VALID scope (not counted as VALID)', async () => {
        const emp = makeEmployee('emp-q-004');
        const validEmp = makeEmployee('emp-q-004-valid', { projectId: VALID_PROJECT.id });
        stateManager.setState({ employees: [emp, validEmp], attendance: {} }, { silent: true });
        await seedDurable(db, [emp, validEmp]);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });

        const analysis = analyzeProjectOwnership(
            { employees: stateManager._state.employees, positions: [], leaders: [], attendance: {} },
            [VALID_PROJECT]
        );

        expect(analysis.summary.counts[CLASSIFICATION.VALID]).toBe(1); // only validEmp
        expect(analysis.summary.counts[CLASSIFICATION.PENDING]).toBe(1);
        expect(analysis.summary.counts[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(0);
    });

    test('QUARANTINE attendance records are also updated with the sentinel', async () => {
        const emp = makeEmployee('emp-q-005');
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

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: att,
            catalog: [VALID_PROJECT],
            _db: db
        });

        const updatedAtt = stateManager._state.attendance[`${emp.id}-2026-09-18`];
        expect(updatedAtt).toBeDefined();
        expect(isQuarantineProjectId(updatedAtt.projectId)).toBe(true);
    });

    test('QUARANTINE idempotency: re-running on already-quarantined employee is a no-op', async () => {
        const emp = makeEmployee('emp-q-006');
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

        const meta1 = await db.get('settings', RECONCILIATION_META_KEY);
        const repairCountAfterFirst = meta1.repairs.length;

        // Re-run with the already-quarantined employee from memory.
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

        // No duplicate metadata repair entry was written.
        const meta2 = await db.get('settings', RECONCILIATION_META_KEY);
        expect(meta2.repairs.length).toBe(repairCountAfterFirst);
    });

    test('QUARANTINE quarantined projectId persists after IDB close and reopen', async () => {
        const emp = makeEmployee('emp-q-007');
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });
        await seedDurable(db, emp);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: {},
            catalog: [VALID_PROJECT],
            _db: db
        });

        db.db.close();
        db.isInitialized = false;
        db.db = null;
        await db.init();

        const employees = await db.getAll('employees');
        const reloaded = employees.find(e => e.id === emp.id);
        expect(reloaded).toBeDefined();
        expect(isQuarantineProjectId(reloaded.projectId)).toBe(true);
    });

    // ── R07 Direction (addendum): computeQuarantine never rewrites valid history ──
    test('QUARANTINE preserves attendance already owned by a valid durable catalog project', async () => {
        const emp = makeEmployee('emp-q-008');
        const att = {
            [`${emp.id}-2026-09-10`]: {
                key: `${emp.id}-2026-09-10`,
                employeeId: emp.id,
                date: '2026-09-10',
                present: true,
                hoursWorked: 8,
                projectId: VALID_PROJECT.id,
                updatedAt: 10
            }
        };
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });
        await seedDurable(db, emp, att);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: att,
            catalog: [VALID_PROJECT],
            _db: db
        });

        const durableAtt = (await db.getAll('attendance')).find(r => r.key === `${emp.id}-2026-09-10`);
        expect(durableAtt.projectId).toBe(VALID_PROJECT.id);
        expect(durableAtt.updatedAt).toBe(10);
        // In-memory parity: valid history is not rewritten either.
        expect(stateManager._state.attendance[`${emp.id}-2026-09-10`].projectId).toBe(VALID_PROJECT.id);
    });

    test('QUARANTINE rewrites attendance with an empty/invalid projectId to the sentinel', async () => {
        const emp = makeEmployee('emp-q-009');
        const att = {
            [`${emp.id}-2026-09-11`]: {
                key: `${emp.id}-2026-09-11`,
                employeeId: emp.id,
                date: '2026-09-11',
                present: true,
                hoursWorked: 8,
                projectId: ''
            }
        };
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });
        await seedDurable(db, emp, att);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: att,
            catalog: [VALID_PROJECT],
            _db: db
        });

        const durableAtt = (await db.getAll('attendance')).find(r => r.key === `${emp.id}-2026-09-11`);
        expect(isQuarantineProjectId(durableAtt.projectId)).toBe(true);
    });

    test('QUARANTINE rewrites attendance whose projectId is a missing orphan id (not durable catalog)', async () => {
        const emp = makeEmployee('emp-q-010');
        const att = {
            [`${emp.id}-2026-09-12`]: {
                key: `${emp.id}-2026-09-12`,
                employeeId: emp.id,
                date: '2026-09-12',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-orphan-quarantine-000' // not seeded as a durable project
            }
        };
        stateManager.setState({ employees: [emp], attendance: att }, { silent: true });
        await seedDurable(db, emp, att);

        await applyOwnershipRepair({
            action: REPAIR_ACTION.QUARANTINE,
            employees: [emp],
            attendance: att,
            catalog: [VALID_PROJECT],
            _db: db
        });

        const durableAtt = (await db.getAll('attendance')).find(r => r.key === `${emp.id}-2026-09-12`);
        expect(isQuarantineProjectId(durableAtt.projectId)).toBe(true);
    });
});
