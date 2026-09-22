/**
 * ProjectReconciliationDependenciesR07.test.js — R07 A2b
 *
 * Contracts:
 *   1. Any referenced position/leader must exist and already belong to the
 *      chosen target project before employee ownership may be repaired.
 *   2. Shared definitions with a conflicting projectId block and are never moved.
 *   3. Exclusive definitions with a conflicting projectId also block: A2b does
 *      not silently rewrite project-owned dependencies.
 *   4. Legacy-unscoped or missing dependency definitions fail closed.
 *   5. preflightDependencies returns the same structured result pre-mutation.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS,
    preflightDependencies
} from '../modules/features/projects/ProjectOwnershipRepairService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

const VALID_PROJECT   = { id: 'PRJ-dep-v-001', name: 'Valid Dep Base', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 };
const SOURCE_PROJECT  = { id: 'PRJ-dep-src-002', name: 'Source Project', status: 'active', createdAt: 2, updatedAt: 2, schemaVersion: 1 };
const ORPHAN_PID      = 'PRJ-orphan-dep-003';
const CATALOG = [VALID_PROJECT, SOURCE_PROJECT];

function makeEmployee(id, overrides = {}) {
    return { id, number: id, name: `Emp ${id}`, active: true, positions: [], loans: [], projectId: ORPHAN_PID, ...overrides };
}

function makePosition(id, overrides = {}) {
    return { id, name: `Pos ${id}`, active: true, ...overrides };
}

function makeLeader(id, overrides = {}) {
    return { id, number: id, name: `Lead ${id}`, active: true, ...overrides };
}

let db;
let savedState;

beforeEach(async () => {
    jest.useFakeTimers();
    savedState = {
        employees:  JSON.parse(JSON.stringify(stateManager._state.employees || [])),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance || {}))
    };
    db = new IndexedDBService('r07-dep-' + Math.random());
    await db.init();
    for (const p of CATALOG) await db.update('projects', p);
});

afterEach(() => {
    stateManager.setState({ employees: savedState.employees, attendance: savedState.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

async function seedDurable({ employees = [], positions = [], leaders = [] } = {}) {
    for (const emp of employees) await db.update('employees', emp);
    for (const pos of positions) await db.update('positions', pos);
    for (const lead of leaders) await db.update('leaders', lead);
}

describe('ProjectReconciliationDependenciesR07', () => {
    // ── 1. Exclusive dependency with wrong ownership still blocks ─────────────
    test('position referenced only by selected employees still blocks when owned by another/missing project', async () => {
        const pos = makePosition('pos-exclusive-001', { projectId: ORPHAN_PID });
        const emp = makeEmployee('emp-dep-001', { positions: [pos.id] });
        await seedDurable({ employees: [emp], positions: [pos] });
        stateManager.setState({ employees: [emp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [emp],
            allEmployees: [emp],
            positions: [pos],
            leaders: [],
            attendance: {},
            catalog: CATALOG,
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'POSITION_PROJECT_CONFLICT')).toBe(true);
        expect(stateManager._state.employees[0].projectId).toBe(ORPHAN_PID);
    });

    // ── 2. Shared position with conflicting explicit projectId blocks ──────────
    test('shared position with conflicting explicit projectId blocks repair before mutation', async () => {
        // pos-shared is referenced by the SELECTED employee AND an outside employee.
        const pos = makePosition('pos-shared-002', { projectId: SOURCE_PROJECT.id }); // explicit conflict
        const selectedEmp   = makeEmployee('emp-dep-selected-002', { positions: [pos.id] });
        const outsiderEmp   = makeEmployee('emp-dep-outsider-002', {
            positions: [pos.id],
            projectId: SOURCE_PROJECT.id // outsider is in a different project
        });
        await seedDurable({ employees: [selectedEmp, outsiderEmp], positions: [pos] });
        stateManager.setState({ employees: [selectedEmp, outsiderEmp], attendance: {} }, { silent: true });

        const memBefore = JSON.stringify(stateManager._state.employees);

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [selectedEmp],         // only the selected orphan
            allEmployees: [selectedEmp, outsiderEmp],
            positions: [pos],
            leaders: [],
            attendance: {},
            catalog: CATALOG,
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(Array.isArray(result.conflicts)).toBe(true);
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.conflicts[0].kind).toBe('SHARED_POSITION_CONFLICT');
        expect(result.conflicts[0].entityId).toBe(pos.id);

        // Memory must be untouched.
        expect(JSON.stringify(stateManager._state.employees)).toBe(memBefore);
    });

    // ── 3. Leader in another project is detached, not blocking ─────────────────
    test('leader in another project is detached from the employee instead of blocking', async () => {
        const lead       = makeLeader('lead-shared-003', { projectId: SOURCE_PROJECT.id });
        const selectedEmp  = makeEmployee('emp-dep-sel-003', { leaderId: lead.id });
        const outsiderEmp  = makeEmployee('emp-dep-out-003', { leaderId: lead.id, projectId: SOURCE_PROJECT.id });
        await seedDurable({ employees: [selectedEmp, outsiderEmp], leaders: [lead] });
        stateManager.setState({ employees: [selectedEmp, outsiderEmp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [selectedEmp],
            allEmployees: [selectedEmp, outsiderEmp],
            positions: [],
            leaders: [lead],
            attendance: {},
            catalog: CATALOG,
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        // R07 Direction: a cross-project leader is NOT an operational relation to
        // preserve nor a conflict the user must resolve — it is detached silently.
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.detachedLeaders).toEqual([{ employeeId: selectedEmp.id, leaderId: lead.id }]);

        const durableEmp = (await db.getAll('employees')).find(e => e.id === selectedEmp.id);
        expect(durableEmp.leaderId).toBeNull();
        expect(durableEmp.projectId).toBe(VALID_PROJECT.id);
    });

    // ── 4. Shared unscoped definition fails closed ─────────────────────────────
    test('shared legacy-unscoped position is NOT silently moved and blocks until reconciled', async () => {
        // pos has NO projectId — legacy-unscoped. Shared with outsider.
        const pos          = makePosition('pos-unscoped-004'); // no projectId
        const selectedEmp  = makeEmployee('emp-dep-sel-004', { positions: [pos.id] });
        const outsiderEmp  = makeEmployee('emp-dep-out-004', { positions: [pos.id], projectId: SOURCE_PROJECT.id });
        await seedDurable({ employees: [selectedEmp, outsiderEmp], positions: [pos] });
        stateManager.setState({ employees: [selectedEmp, outsiderEmp], attendance: {} }, { silent: true });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [selectedEmp],
            allEmployees: [selectedEmp, outsiderEmp],
            positions: [pos],
            leaders: [],
            attendance: {},
            catalog: CATALOG,
            targetProjectId: VALID_PROJECT.id,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect(result.conflicts.some(c => c.kind === 'UNRESOLVED_POSITION_OWNERSHIP')).toBe(true);
        expect(stateManager._state.employees.find(e => e.id === selectedEmp.id)?.projectId).toBe(ORPHAN_PID);
    });

    // ── 5. preflightDependencies returns structured result before mutation ─────
    test('preflightDependencies returns structured conflict summary without mutating', () => {
        const pos         = makePosition('pos-preflight-005', { projectId: SOURCE_PROJECT.id });
        const selectedEmp = makeEmployee('emp-dep-sel-005', { positions: [pos.id] });
        const outsiderEmp = makeEmployee('emp-dep-out-005', { positions: [pos.id], projectId: SOURCE_PROJECT.id });

        const before = JSON.stringify([selectedEmp, outsiderEmp]);

        const result = preflightDependencies({
            employees: [selectedEmp],
            allEmployees: [selectedEmp, outsiderEmp],
            positions: [pos],
            leaders: [],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(false);
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.conflicts[0].kind).toBe('SHARED_POSITION_CONFLICT');
        expect(result.dependencySummary).toBeDefined();
        expect(result.dependencySummary.sharedPositions).toContain(pos.id);

        // No mutation.
        expect(JSON.stringify([selectedEmp, outsiderEmp])).toBe(before);
    });

    // ── 6. Non-conflicting dependency summary is exposed for UI ───────────────
    test('preflightDependencies exposes aligned dependencies in dependencySummary', () => {
        const pos = makePosition('pos-dep-sum-006', { projectId: VALID_PROJECT.id });
        const emp = makeEmployee('emp-dep-sum-006', { positions: [pos.id] });

        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [pos],
            leaders: [],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.dependencySummary.positions).toContain(pos.id);
    });

    test('missing referenced position definition blocks before mutation', () => {
        const emp = makeEmployee('emp-missing-pos-007', { positions: ['pos-does-not-exist'] });
        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [],
            leaders: [],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(false);
        expect(result.conflicts.some(c => c.kind === 'MISSING_POSITION_DEFINITION')).toBe(true);
    });

    test('exclusive leader in another project is reported for detach, not a blocking conflict', () => {
        const lead = makeLeader('lead-exclusive-008', { projectId: SOURCE_PROJECT.id });
        const emp = makeEmployee('emp-exclusive-lead-008', { leaderId: lead.id });
        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [],
            leaders: [lead],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.dependencySummary.detachedLeaders).toEqual([
            expect.objectContaining({ kind: 'LEADER_PROJECT_CONFLICT', entityId: lead.id, targetProjectId: VALID_PROJECT.id })
        ]);
    });

    test('inactive same-project employee leader is reported as non-blocking detach', () => {
        const lead = makeLeader('lead-inactive-009', { projectId: VALID_PROJECT.id, active: false });
        const emp = makeEmployee('emp-inactive-lead-009', { leaderId: lead.id });
        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [],
            leaders: [lead],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.dependencySummary.detachedLeaders).toEqual([
            expect.objectContaining({
                kind: 'INACTIVE_LEADER',
                entityId: lead.id,
                currentProjectId: VALID_PROJECT.id
            })
        ]);
    });

    test('position-level cross-project leader is reported for detach in preflight', () => {
        const lead = makeLeader('lead-position-other-010', { projectId: SOURCE_PROJECT.id });
        const pos = makePosition('pos-position-leader-010', {
            projectId: VALID_PROJECT.id,
            leaderId: lead.id
        });
        const emp = makeEmployee('emp-position-leader-010', { positions: [pos.id] });
        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [pos],
            leaders: [lead],
            targetProjectId: VALID_PROJECT.id
        });

        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.dependencySummary.detachedLeaders).toEqual([
            expect.objectContaining({
                kind: 'LEADER_PROJECT_CONFLICT',
                entityId: lead.id,
                positionId: pos.id,
                message: expect.stringContaining('belongs to another project')
            })
        ]);
    });

    // ── R07 Phase B: preflightDependencies previews destination-owned copies ──
    test('preflightDependencies resolves a position conflict via a destination-owned copy preview', () => {
        const pos = makePosition('pos-copy-preview-001', { projectId: SOURCE_PROJECT.id });
        const emp = makeEmployee('emp-copy-preview-001', { positions: [pos.id] });

        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [pos],
            leaders: [],
            targetProjectId: VALID_PROJECT.id,
            positionCopies: [{ fromPositionId: pos.id, newPositionId: 'pos-copy-new', name: 'Copia' }],
            positionRemaps: [{ employeeId: emp.id, fromPositionId: pos.id, toPositionId: 'pos-copy-new', migrateHistory: false }]
        });

        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
    });

    test('preflightDependencies surfaces a position copy conflict without mutating inputs', () => {
        const pos = makePosition('pos-copy-conflict-001', { projectId: SOURCE_PROJECT.id });
        const emp = makeEmployee('emp-copy-conflict-001', { positions: [pos.id] });

        const before = JSON.stringify([emp]);

        const result = preflightDependencies({
            employees: [emp],
            allEmployees: [emp],
            positions: [pos],
            leaders: [],
            targetProjectId: VALID_PROJECT.id,
            positionCopies: [{ fromPositionId: 'POS-does-not-exist', newPositionId: 'pos-copy-x' }]
        });

        expect(result.ok).toBe(false);
        expect(result.conflicts.some(c => c.kind === 'POSITION_COPY_SOURCE_MISSING')).toBe(true);
        expect(JSON.stringify([emp])).toBe(before);
    });
});
