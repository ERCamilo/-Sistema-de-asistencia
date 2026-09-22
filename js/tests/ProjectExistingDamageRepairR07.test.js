/**
 * ProjectExistingDamageRepairR07.test.js — R07 A2b
 *
 * Contract: recreate the historical 36-valid + 34/405 orphan scenario.
 * Mapping employees 34 and 405 to a chosen valid project must yield
 * 38 valid / 0 orphan without changing employee stable IDs.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import {
    applyOwnershipRepair,
    REPAIR_ACTION,
    REPAIR_STATUS
} from '../modules/features/projects/ProjectOwnershipRepairService.js';
import {
    analyzeProjectOwnership,
    CLASSIFICATION
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

// Historical known IDs from the task spec.
const EMP_34_ID  = 'emp-1789749741792';
const EMP_405_ID = 'emp-1789586033810';
const ORPHAN_PROJECT_ID = 'PRJ-mu1p73r3-iu8a'; // absent from catalog
const VALID_PROJECT_ID  = 'PRJ-valid-anchor-001';

function makeValidProject(id = VALID_PROJECT_ID) {
    return { id, name: 'Valid Anchor Project', status: 'active', createdAt: 1000, updatedAt: 1000, schemaVersion: 1 };
}

function makeEmployee(overrides = {}) {
    const n = overrides.number || '1';
    return {
        id:        `emp-stable-${n}`,
        number:    n,
        name:      `Employee ${n}`,
        active:    true,
        positions: [],
        loans:     [],
        projectId: VALID_PROJECT_ID,
        ...overrides
    };
}

/** Build the historical scenario: 36 valid employees + 34 and 405 as EXPLICIT_ORPHAN. */
function buildScenario() {
    const employees = [];
    for (let i = 1; i <= 36; i++) {
        employees.push(makeEmployee({ number: String(i), id: `emp-valid-${i}`, projectId: VALID_PROJECT_ID }));
    }
    // The two historically affected employees reference a missing project.
    employees.push({
        id: EMP_34_ID, number: '34-hist', name: 'Andres Sanchez',
        active: true, positions: [], loans: [], projectId: ORPHAN_PROJECT_ID
    });
    employees.push({
        id: EMP_405_ID, number: '405-hist', name: 'Lano Borno',
        active: true, positions: [], loans: [{ id: 'loan-405-a', amount: 500, balance: 200 }],
        projectId: ORPHAN_PROJECT_ID
    });

    const attendance = {};
    attendance[`${EMP_34_ID}-2026-09-18`]  = { key: `${EMP_34_ID}-2026-09-18`,  employeeId: EMP_34_ID,  date: '2026-09-18', present: true,  hoursWorked: 8, projectId: ORPHAN_PROJECT_ID };
    attendance[`${EMP_405_ID}-2026-09-18`] = { key: `${EMP_405_ID}-2026-09-18`, employeeId: EMP_405_ID, date: '2026-09-18', present: false, hoursWorked: 0, projectId: ORPHAN_PROJECT_ID };

    const catalog = [makeValidProject()];
    return { employees, attendance, catalog };
}

async function seedScenarioDurably(db, { employees, attendance }) {
    for (const emp of employees) await db.update('employees', emp);
    for (const record of Object.values(attendance || {})) await db.update('attendance', record);
}

let db;
let originalStateSnapshot;

beforeEach(async () => {
    jest.useFakeTimers();
    originalStateSnapshot = {
        employees: JSON.parse(JSON.stringify(stateManager._state.employees)),
        attendance: JSON.parse(JSON.stringify(stateManager._state.attendance))
    };

    db = new IndexedDBService('r07-damage-repair-' + Math.random());
    await db.init();
    await db.update('projects', makeValidProject());
});

afterEach(() => {
    stateManager.setState({ employees: originalStateSnapshot.employees, attendance: originalStateSnapshot.attendance }, { silent: true });
    try { db.db.close(); } catch (_) { /* ignore */ }
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('ProjectExistingDamageRepairR07', () => {
    test('scenario sanity: 36 valid employees + 2 EXPLICIT_ORPHAN employees + 2 orphan attendance records', () => {
        const { employees, attendance, catalog } = buildScenario();
        const analysis = analyzeProjectOwnership({ employees, positions: [], leaders: [], attendance }, catalog);
        // 36 valid employees; attendance for valid employees has no explicit projectId.
        expect(analysis.summary.counts[CLASSIFICATION.VALID]).toBe(36);
        // 2 orphan employees + 2 orphan attendance records = 4 EXPLICIT_ORPHAN total.
        expect(analysis.summary.counts[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(4);
        expect(analysis.summary.counts[CLASSIFICATION.PENDING]).toBe(0);
    });

    test('MAP_TO_EXISTING: mapping 34 and 405 yields 38 valid / 0 orphan', async () => {
        const { employees, attendance, catalog } = buildScenario();
        const orphans = employees.filter(e => e.projectId === ORPHAN_PROJECT_ID);
        expect(orphans).toHaveLength(2);

        // Prime in-memory state and the durable source of truth.
        stateManager.setState({ employees, attendance }, { silent: true });
        await seedScenarioDurably(db, { employees, attendance });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: orphans,
            attendance,
            allEmployees: employees,
            catalog,
            targetProjectId: VALID_PROJECT_ID,
            _db: db
        });

        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.durableCommitted).toBe(true);
        expect(result.affected).toHaveLength(2);

        // After repair: 38 valid, 0 orphan.
        const updatedEmployees = stateManager._state.employees;
        const updatedAttendance = stateManager._state.attendance;
        const postAnalysis = analyzeProjectOwnership(
            { employees: updatedEmployees, positions: [], leaders: [], attendance: updatedAttendance },
            catalog
        );
        // After repair: employees (36+2=38 valid) + attendance (2 records now valid) = 40 total VALID, 0 orphan.
        expect(postAnalysis.summary.counts[CLASSIFICATION.VALID]).toBe(40);
        expect(postAnalysis.summary.counts[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(0);

        // Employee stable IDs must not change.
        const emp34 = updatedEmployees.find(e => e.id === EMP_34_ID);
        const emp405 = updatedEmployees.find(e => e.id === EMP_405_ID);
        expect(emp34).toBeDefined();
        expect(emp405).toBeDefined();
        expect(emp34.id).toBe(EMP_34_ID);
        expect(emp405.id).toBe(EMP_405_ID);

        // Project ownership updated.
        expect(emp34.projectId).toBe(VALID_PROJECT_ID);
        expect(emp405.projectId).toBe(VALID_PROJECT_ID);

        // Loans preserved untouched.
        expect(emp405.loans[0].balance).toBe(200);

        // Attendance updated.
        expect(updatedAttendance[`${EMP_34_ID}-2026-09-18`].projectId).toBe(VALID_PROJECT_ID);
        expect(updatedAttendance[`${EMP_405_ID}-2026-09-18`].projectId).toBe(VALID_PROJECT_ID);
    });

    test('Employee number, name, and embedded fields survive repair', async () => {
        const { employees, attendance, catalog } = buildScenario();
        const orphans = employees.filter(e => e.projectId === ORPHAN_PROJECT_ID);
        stateManager.setState({ employees, attendance }, { silent: true });
        await seedScenarioDurably(db, { employees, attendance });

        await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: orphans,
            attendance,
            allEmployees: employees,
            catalog,
            targetProjectId: VALID_PROJECT_ID,
            _db: db
        });

        const emp405 = stateManager._state.employees.find(e => e.id === EMP_405_ID);
        expect(emp405.name).toBe('Lano Borno');
        expect(emp405.number).toBe('405-hist');
        expect(emp405.active).toBe(true);
        expect(Array.isArray(emp405.loans)).toBe(true);
        expect(emp405.loans[0].id).toBe('loan-405-a');
    });

    test('before/after counts in result reflect the repair', async () => {
        const { employees, attendance, catalog } = buildScenario();
        const orphans = employees.filter(e => e.projectId === ORPHAN_PROJECT_ID);
        stateManager.setState({ employees, attendance }, { silent: true });
        await seedScenarioDurably(db, { employees, attendance });

        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: orphans,
            attendance,
            allEmployees: employees,
            catalog,
            targetProjectId: VALID_PROJECT_ID,
            _db: db
        });

        // Before: 2 orphan employees + 2 orphan attendance records = 4; 36 valid employees.
        expect(result.before[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(4);
        expect(result.before[CLASSIFICATION.VALID]).toBe(36);
        // After: 0 orphan; 36 valid employees + 2 repaired employees + 2 repaired attendance = 40.
        expect(result.after[CLASSIFICATION.EXPLICIT_ORPHAN]).toBe(0);
        expect(result.after[CLASSIFICATION.VALID]).toBe(40);
    });

    test('EXPLICIT_ORPHAN with the absent project id is never auto-mapped to default/active', async () => {
        const { employees, attendance, catalog } = buildScenario();
        stateManager.setState({ employees, attendance }, { silent: true });

        // The repair service must NOT auto-map to anything; it needs an explicit action.
        // Calling with no action returns UNSUPPORTED, never silently maps.
        const result = await applyOwnershipRepair({
            action: 'AUTO_REPAIR', // not a supported action
            employees: employees.filter(e => e.projectId === ORPHAN_PROJECT_ID),
            attendance,
            catalog,
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.UNSUPPORTED);

        // Memory must be untouched.
        const unmodified = stateManager._state.employees.find(e => e.id === EMP_34_ID);
        if (unmodified) {
            expect(unmodified.projectId).toBe(ORPHAN_PROJECT_ID);
        }
    });

    test('missing employees array rejects immediately', async () => {
        const { catalog } = buildScenario();
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: [],
            catalog,
            targetProjectId: VALID_PROJECT_ID,
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
    });

    test('target not in catalog fails with CONFLICT before any mutation', async () => {
        const { employees, attendance, catalog } = buildScenario();
        const orphans = employees.filter(e => e.projectId === ORPHAN_PROJECT_ID);
        stateManager.setState({ employees, attendance }, { silent: true });

        const before = JSON.stringify(stateManager._state.employees);
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            employees: orphans,
            attendance,
            catalog,
            targetProjectId: 'PRJ-ghost-not-in-catalog',
            _db: db
        });
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        // Memory unchanged.
        expect(JSON.stringify(stateManager._state.employees)).toBe(before);
    });
});
