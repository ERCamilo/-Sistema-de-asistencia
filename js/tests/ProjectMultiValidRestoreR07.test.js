import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText, getLastFullImportReconciliation } from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext } from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY, ACTIVE_PROJECT_LS_KEY, peekEntityScope, replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

/**
 * R07 A2a — ProjectMultiValidRestoreR07
 *
 * Contract for FULL-import preflight over backups WITH project surface:
 * - Multiple valid projects + unscoped project-owned records ⇒ STOP BEFORE ANY
 *   MUTATION with structured reconciliation-required metadata (A1 analysis +
 *   allowed choices) for the future UI; never guess an owner.
 * - Exactly one valid project + unscoped records ⇒ deterministic binding of
 *   those records to that backup project (real id, never a sentinel).
 * - Explicit orphan projectId absent from the incoming catalog ⇒ fail closed
 *   before mutation; referenced projects that exist in the backup are VALID.
 * - Quarantine/sentinel ids are never materialized during import.
 */
const PRJ_A = 'PRJ-obra-alpha-0001';
const PRJ_B = 'PRJ-obra-beta-0002';
const NEW_PROJECT_ID = 'PRJ-mu8nkbk5-qbli';

function makeMultiValidBackupFixture() {
    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Constructora Multi SA', regularHoursPerDay: 8 },
            employees: [
                { id: 'emp-a-1', number: '11', name: 'De Obra Alpha', projectId: PRJ_A, active: true, positions: ['pos-a'], loans: [] },
                { id: 'emp-b-1', number: '22', name: 'De Obra Beta', projectId: PRJ_B, active: true, positions: ['pos-master'], loans: [] },
                { id: 'emp-u-1', number: '33', name: 'Sin Dueno Uno', active: true, positions: ['pos-master'], loans: [] },
                { id: 'emp-u-2', number: '44', name: 'Sin Dueno Dos', active: true, positions: ['pos-a'], loans: [] }
            ],
            positions: [
                { id: 'pos-a', name: 'Puesto Alpha', projectId: PRJ_A, active: true },
                { id: 'pos-master', name: 'Puesto Master', active: true }
            ],
            leaders: [
                { id: 'lead-a-1', number: '1', name: 'Lider Alpha', projectId: PRJ_A, active: true },
                { id: 'lead-u-1', number: '2', name: 'Lider Sin Dueno', active: true }
            ],
            attendance: {
                'emp-a-1-2026-09-18': { employeeId: 'emp-a-1', date: '2026-09-18', present: true, hoursWorked: 8, projectId: PRJ_A },
                'emp-u-1-2026-09-18': { employeeId: 'emp-u-1', date: '2026-09-18', present: true, hoursWorked: 4 }
            },
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: PRJ_A, name: 'Obra Alpha', status: 'active', createdAt: 1000 },
                { id: PRJ_B, name: 'Obra Beta', status: 'active', createdAt: 2000 }
            ],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                exportedAt: '2026-09-19T16:46:03.402Z',
                defaultProjectId: PRJ_A,
                activeProjectId: PRJ_A,
                projectIds: [PRJ_A, PRJ_B]
            },
            projectPayrollConfigs: [
                { projectId: PRJ_A, regularHoursPerDay: 8, schemaVersion: 1 },
                { projectId: PRJ_B, regularHoursPerDay: 8, schemaVersion: 1 }
            ]
        }
    };
}

function makeSingleValidBackupFixture() {
    const fixture = makeMultiValidBackupFixture();
    fixture.data.projects = [fixture.data.projects[0]];
    fixture.data.projectBackup.projectIds = [PRJ_A];
    fixture.data.projectPayrollConfigs = [fixture.data.projectPayrollConfigs[0]];
    // Single valid project: keep only its explicit records, leave the rest unscoped.
    fixture.data.employees = fixture.data.employees.filter(e => e.id !== 'emp-b-1');
    fixture.data.leaders = [fixture.data.leaders[0]];
    fixture.data.leaders.push({ id: 'lead-u-2', number: '3', name: 'Lider Sin Dueno Dos', active: true });
    return fixture;
}

describe('ProjectMultiValidRestoreR07 Contract Suite', () => {
    let db;
    let originalState;
    let preProjects;
    let preEmployees;
    let prePositions;
    let preLeaders;
    let preConfigs;
    let preScope;
    let preDefaultPointer;

    function hookMockedIDBTo(targetDb) {
        mockedIDB.saveState.mockImplementation((s, o) => targetDb.saveState(s, o));
        mockedIDB.getAll.mockImplementation((...args) => targetDb.getAll(...args));
        mockedIDB.get.mockImplementation((...args) => targetDb.get(...args));
        mockedIDB.update.mockImplementation((...args) => targetDb.update(...args));
        mockedIDB.delete.mockImplementation((...args) => targetDb.delete(...args));
        mockedIDB.batchUpdate.mockImplementation((...args) => targetDb.batchUpdate(...args));
        mockedIDB.batchDelete.mockImplementation((...args) => targetDb.batchDelete(...args));
        mockedIDB.clear.mockImplementation((...args) => targetDb.clear(...args));
        mockedIDB.clearAll.mockImplementation((...args) => targetDb.clearAll(...args));
    }

    function wireProjectServices(targetDb) {
        projectStore.db = targetDb;
        defaultProjectService.store = projectStore;
        projectContext.store = projectStore;
        projectContext.defaults = defaultProjectService;
    }

    beforeEach(async () => {
        jest.useFakeTimers();
        delete window.location;
        window.location = { reload: jest.fn(), href: 'http://localhost/' };
        window.showAlert = jest.fn();
        localStorage.clear();

        originalState = JSON.parse(JSON.stringify({
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: state.attendance,
            settings: state.settings,
            isDataLoaded: state.isDataLoaded,
            useIndexedDB: state.useIndexedDB,
            showImportFullModal: state.showImportFullModal,
            importFullText: state.importFullText
        }));

        db = new IndexedDBService('test-r07-multivalid-restore-' + Math.random());
        await db.init();
        hookMockedIDBTo(db);
        wireProjectServices(db);

        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, NEW_PROJECT_ID);
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, NEW_PROJECT_ID);
        await db.update('projects', { id: NEW_PROJECT_ID, name: 'Mi obra limpia PRE', status: 'active', createdAt: 500 });
        replaceEntityScope({ enabled: true, projectId: NEW_PROJECT_ID, defaultProjectId: NEW_PROJECT_ID });

        state.employees = [];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        state.settings = { companyName: 'Base Limpia Pre', regularHoursPerDay: 8 };
        await db.saveState(state, { clearFirst: true });

        preProjects = await db.getAll('projects');
        preEmployees = await db.getAll('employees');
        preLeaders = await db.getAll('leaders');
        preConfigs = await db.getAll('projectPayrollConfigs');
        preScope = peekEntityScope();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        mockedIDB.saveState.mockReset();
        mockedIDB.getAll.mockReset();
        mockedIDB.get.mockReset();
        mockedIDB.update.mockReset();
        mockedIDB.delete.mockReset();
        mockedIDB.batchUpdate.mockReset();
        mockedIDB.batchDelete.mockReset();
        mockedIDB.clear.mockReset();
        mockedIDB.clearAll.mockReset();
        try { db.db.close(); } catch (_) {}
        Object.assign(state, originalState);
        delete window.showConfirm;
        delete window.showAlert;
        resetEntityScope();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    async function executeConfirmImport(payload) {
        let onConfirmCallback = null;
        window.showConfirm = (opts) => {
            onConfirmCallback = opts.onConfirm;
        };
        setImportFullText(JSON.stringify(payload));
        confirmImportFull();
        if (typeof onConfirmCallback !== 'function') {
            throw new Error('Import rejected or modal did not trigger confirm callback');
        }
        await onConfirmCallback();
    }

    test('multiple valid projects + unscoped records STOPS before any mutation with structured reconciliation metadata', async () => {
        const payload = makeMultiValidBackupFixture();
        await executeConfirmImport(payload);

        // 1. Structured reconciliation-required metadata is exposed for the future UI.
        const reconciliation = getLastFullImportReconciliation();
        expect(reconciliation).toBeTruthy();
        expect(reconciliation.reconciliationRequired).toBe(true);
        expect(reconciliation.reason).toBe('MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS');
        expect(reconciliation.allowedChoices).toEqual(['map-to-existing']);
        expect(reconciliation.requiresUserChoice).toBe(true);
        expect(reconciliation.assignedRecords).toBe(0);

        // 2. The analysis is the frozen A1 analysis, UI-ready.
        expect(reconciliation.analysis.counts.LEGACY_UNSCOPED).toBe(5); // 2 employees + 1 position + 1 leader + 1 attendance
        expect(reconciliation.analysis.validProjects.map(p => p.id).sort()).toEqual([PRJ_A, PRJ_B].sort());
        expect(Array.isArray(reconciliation.analysis.issues)).toBe(true);
        expect(reconciliation.analysis.issues.length).toBe(reconciliation.analysis.counts.LEGACY_UNSCOPED);
        for (const issue of reconciliation.analysis.issues) {
            expect(issue.status).toBe('LEGACY_UNSCOPED');
            expect(typeof issue.collection).toBe('string');
            expect(typeof issue.recordKey).toBe('string');
        }

        // 3. STOP BEFORE ANY MUTATION: local catalog untouched (backup projects NOT adopted).
        const afterProjects = await db.getAll('projects');
        expect(afterProjects).toEqual(preProjects);

        // 4. No dataset change: all stores equal the PRE-import snapshot.
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(await db.getAll('leaders')).toEqual(preLeaders);
        expect(await db.getAll('projectPayrollConfigs')).toEqual(preConfigs);
        expect(await db.getAll('attendance')).toEqual([]);

        // 5. Pointers/scope untouched.
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('one valid project + unscoped records binds them deterministically to the backup project (no sentinel)', async () => {
        const payload = makeSingleValidBackupFixture();
        await executeConfirmImport(payload);

        // Catalog: exactly the backup project (local NEW discarded by FULL replacement).
        const catalog = await db.getAll('projects');
        expect(catalog.map(p => p.id)).toEqual([PRJ_A]);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(PRJ_A);

        // Every record previously unscoped now carries the REAL backup projectId.
        const storedEmployees = await db.getAll('employees');
        expect(storedEmployees.length).toBe(3);
        for (const emp of storedEmployees) expect(emp.projectId).toBe(PRJ_A);

        const storedPositions = await db.getAll('positions');
        expect(storedPositions.length).toBe(2);
        for (const pos of storedPositions) expect(pos.projectId).toBe(PRJ_A);

        const storedLeaders = await db.getAll('leaders');
        expect(storedLeaders.length).toBe(2);
        for (const lead of storedLeaders) expect(lead.projectId).toBe(PRJ_A);

        const storedAttendance = await db.getAll('attendance');
        expect(storedAttendance.length).toBe(2);
        for (const att of storedAttendance) expect(att.projectId).toBe(PRJ_A);

        // Zero orphans and zero sentinels materialized.
        const allRecords = [...storedEmployees, ...storedPositions, ...storedLeaders, ...storedAttendance];
        expect(allRecords.every(r => String(r.projectId || '').startsWith('legacy-unresolved:') === false)).toBe(true);
        expect(getLastFullImportReconciliation()).toBeNull();
    });

    test('explicit records already bound to a backup project stay VALID and verbatim after binding', async () => {
        const payload = makeSingleValidBackupFixture();
        const empA = payload.data.employees.find(e => e.id === 'emp-a-1');
        const attA = payload.data.attendance['emp-a-1-2026-09-18'];
        await executeConfirmImport(payload);

        expect(state.employees.find(e => e.id === 'emp-a-1').projectId).toBe(PRJ_A);
        expect(state.attendance['emp-a-1-2026-09-18'].projectId).toBe(PRJ_A);
        expect(empA.projectId).toBe(PRJ_A);
        expect(attA.projectId).toBe(PRJ_A);
    });

    test('explicit orphan projectId absent from the incoming catalog still fails closed before mutation', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.employees[0].projectId = 'PRJ-ghost-not-in-backup';

        await executeConfirmImport(payload);

        const afterProjects = await db.getAll('projects');
        expect(afterProjects).toEqual(preProjects);
        const afterEmployees = await db.getAll('employees');
        expect(afterEmployees).toEqual(preEmployees);
        expect(afterEmployees.some(e => e.projectId === 'PRJ-ghost-not-in-backup')).toBe(false);
        expect(getLastFullImportReconciliation()).toBeNull();
    });

    test('quarantine/sentinel ids are never materialized during import (fail closed, no sentinel project)', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.employees[0].projectId = 'legacy-unresolved:emp-u-1';

        await executeConfirmImport(payload);

        const afterProjects = await db.getAll('projects');
        // No sentinel-bearing project was created; dataset unchanged.
        expect(afterProjects).toEqual(preProjects);
        expect(afterProjects.some(p => String(p.id).startsWith('legacy-unresolved:'))).toBe(false);
        const afterEmployees = await db.getAll('employees');
        expect(afterEmployees).toEqual(preEmployees);
        expect(
            afterEmployees.some(e => String(e.projectId || '').startsWith('legacy-unresolved:'))
        ).toBe(false);
    });
});
