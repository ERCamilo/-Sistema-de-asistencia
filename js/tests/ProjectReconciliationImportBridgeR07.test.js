import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import {
    confirmImportFull,
    setImportFullText,
    getLastFullImportReconciliation,
    getPendingFullImport,
    requestFullImportProjectChoice,
    cancelFullImportProjectChoice
} from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext } from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY, ACTIVE_PROJECT_LS_KEY, peekEntityScope, replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

/**
 * R07 Phase B — ProjectReconciliationImportBridgeR07
 *
 * Contract for the FULL-import reconciliation bridge:
 * - MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS parks the pending payload in
 *   module memory (getPendingFullImport) with valid projects, BEFORE mutation.
 * - Explicit project choice binds ONLY the LEGACY_UNSCOPED records to the chosen
 *   valid imported project and retries the SAME FULL import durably.
 * - Cancel clears the pending payload with ZERO durable/local mutation.
 * - Sentinel remains a hard fail-closed block with NO pending payload.
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

describe('ProjectReconciliationImportBridgeR07 Contract Suite', () => {
    let db;
    let originalState;
    let preProjects;
    let preEmployees;
    let prePositions;
    let preLeaders;
    let preScope;

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

        db = new IndexedDBService('test-r07-import-bridge-' + Math.random());
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
        prePositions = await db.getAll('positions');
        preLeaders = await db.getAll('leaders');
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
        cancelFullImportProjectChoice();
        try { db.db.close(); } catch (_) {}
        Object.assign(state, originalState);
        delete window.showConfirm;
        delete window.showAlert;
        resetEntityScope();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    async function triggerMultiValidStop() {
        let onConfirmCallback = null;
        window.showConfirm = (opts) => { onConfirmCallback = opts.onConfirm; };
        setImportFullText(JSON.stringify(makeMultiValidBackupFixture()));
        confirmImportFull();
        await onConfirmCallback();
    }

    test('MULTIPLE_VALID parks the pending payload with valid projects and zero mutation', async () => {
        await triggerMultiValidStop();

        const pending = getPendingFullImport();
        expect(pending).toBeTruthy();
        expect(pending.reason).toBe('MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS');
        expect(pending.validProjects.map(p => p.id).sort()).toEqual([PRJ_A, PRJ_B].sort());
        expect(pending.legacyUnscopedCount).toBe(5);
        expect(pending.data).toBeTruthy();

        // Zero mutation: local catalog and dataset unchanged.
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(await db.getAll('positions')).toEqual(prePositions);
        expect(await db.getAll('leaders')).toEqual(preLeaders);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('explicit project choice binds only unscoped records and retries the FULL import durably', async () => {
        await triggerMultiValidStop();

        const result = await requestFullImportProjectChoice(PRJ_B);
        expect(result.ok).toBe(true);
        expect(result.assignedRecords).toBe(5);

        // Durable import happened: catalog is now the two backup projects.
        const catalog = await db.getAll('projects');
        expect(catalog.map(p => p.id).sort()).toEqual([PRJ_A, PRJ_B].sort());

        // Previously-unscoped records now carry PRJ_B; previously-bound records stay verbatim.
        const storedEmployees = await db.getAll('employees');
        const empU1 = storedEmployees.find(e => e.id === 'emp-u-1');
        const empU2 = storedEmployees.find(e => e.id === 'emp-u-2');
        const empA = storedEmployees.find(e => e.id === 'emp-a-1');
        expect(empU1.projectId).toBe(PRJ_B);
        expect(empU2.projectId).toBe(PRJ_B);
        expect(empA.projectId).toBe(PRJ_A);

        const storedLeaders = await db.getAll('leaders');
        expect(storedLeaders.find(l => l.id === 'lead-u-1').projectId).toBe(PRJ_B);
        expect(storedLeaders.find(l => l.id === 'lead-a-1').projectId).toBe(PRJ_A);

        const storedPositions = await db.getAll('positions');
        expect(storedPositions.find(p => p.id === 'pos-master').projectId).toBe(PRJ_B);
        expect(storedPositions.find(p => p.id === 'pos-a').projectId).toBe(PRJ_A);

        const storedAttendance = await db.getAll('attendance');
        expect(storedAttendance.find(a => a.employeeId === 'emp-u-1').projectId).toBe(PRJ_B);

        // No sentinel materialized.
        const all = [...storedEmployees, ...storedLeaders, ...storedPositions, ...storedAttendance];
        expect(all.every(r => !String(r.projectId || '').startsWith('legacy-unresolved:'))).toBe(true);

        // Pending is consumed after retry.
        expect(getPendingFullImport()).toBeNull();
    });

    test('rejecting an invalid/sentinel target never binds and keeps the pending payload', async () => {
        await triggerMultiValidStop();

        const sentinel = await requestFullImportProjectChoice('legacy-unresolved:fake');
        expect(sentinel.ok).toBe(false);
        expect(getPendingFullImport()).toBeTruthy();

        const outside = await requestFullImportProjectChoice('PRJ-not-in-backup');
        expect(outside.ok).toBe(false);
        expect(getPendingFullImport()).toBeTruthy();

        // Still zero durable mutation.
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
    });

    test('cancel clears the pending payload with zero mutation', async () => {
        await triggerMultiValidStop();
        expect(getPendingFullImport()).toBeTruthy();

        cancelFullImportProjectChoice();

        expect(getPendingFullImport()).toBeNull();
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('failed retry keeps the original pending payload intact and durable state unchanged', async () => {
        await triggerMultiValidStop();
        const pendingBefore = getPendingFullImport();
        const originalUnscoped = pendingBefore.data.employees.find(e => e.id === 'emp-u-1');
        expect(originalUnscoped.projectId).toBeUndefined();

        mockedIDB.saveState.mockRejectedValueOnce(new Error('disk full'));
        const result = await requestFullImportProjectChoice(PRJ_B);

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/reintentar/i);
        expect(getPendingFullImport()).toBe(pendingBefore);
        expect(getPendingFullImport().data.employees.find(e => e.id === 'emp-u-1').projectId).toBeUndefined();
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('sentinel project id stays a hard block with NO pending payload', async () => {
        const payload = makeMultiValidBackupFixture();
        payload.data.projects = [payload.data.projects[0]];
        payload.data.projectBackup.projectIds = [PRJ_A];
        payload.data.projectPayrollConfigs = [payload.data.projectPayrollConfigs[0]];
        payload.data.employees = payload.data.employees.filter(e => e.id !== 'emp-b-1');
        // Sentinel id in the project catalog itself triggers the hard block.
        payload.data.projects[0].id = 'legacy-unresolved:emp-u-1';
        payload.data.projectBackup.defaultProjectId = 'legacy-unresolved:emp-u-1';

        let onConfirmCallback = null;
        window.showConfirm = (opts) => { onConfirmCallback = opts.onConfirm; };
        setImportFullText(JSON.stringify(payload));
        confirmImportFull();
        await onConfirmCallback();

        // Hard block with reconciliation metadata but NO pending payload.
        expect(getLastFullImportReconciliation()).toBeTruthy();
        expect(getLastFullImportReconciliation().reason).toBe('SENTINEL_PROJECT_ID_IN_BACKUP');
        expect(getPendingFullImport()).toBeNull();

        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
    });
});
