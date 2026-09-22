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
 * R07 A2c-3 H7 — ProjectSentinelCatalogR07
 *
 * Contract for the FULL-import preflight sentinel guard: a `legacy-unresolved:*`
 * quarantine id must NEVER be accepted as a real project definition, default/
 * active pointer, or payroll surface. Rejected before any memory/IDB/pointer
 * mutation, with structured reconciliation metadata (reason
 * SENTINEL_PROJECT_ID_IN_BACKUP) for the future UI. Local quarantine outside
 * FULL is unaffected.
 */
const PRJ_A = 'PRJ-obra-alpha-0001';
const SENTINEL = 'legacy-unresolved:xyz';
const NEW_PROJECT_ID = 'PRJ-mu8nkbk5-qbli';

function makeSingleValidBackupFixture() {
    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Constructora SA', regularHoursPerDay: 8 },
            employees: [
                { id: 'emp-a-1', number: '11', name: 'De Obra Alpha', projectId: PRJ_A, active: true, positions: ['pos-a'], loans: [] }
            ],
            positions: [
                { id: 'pos-a', name: 'Puesto Alpha', projectId: PRJ_A, active: true }
            ],
            leaders: [
                { id: 'lead-a-1', number: '1', name: 'Lider Alpha', projectId: PRJ_A, active: true }
            ],
            attendance: {
                'emp-a-1-2026-09-18': { employeeId: 'emp-a-1', date: '2026-09-18', present: true, hoursWorked: 8, projectId: PRJ_A }
            },
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: PRJ_A, name: 'Obra Alpha', status: 'active', createdAt: 1000 }
            ],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                exportedAt: '2026-09-19T16:46:03.402Z',
                defaultProjectId: PRJ_A,
                activeProjectId: PRJ_A,
                projectIds: [PRJ_A]
            },
            projectPayrollConfigs: [
                { projectId: PRJ_A, regularHoursPerDay: 8, schemaVersion: 1 }
            ]
        }
    };
}

describe('ProjectSentinelCatalogR07 Contract Suite', () => {
    let db;
    let originalState;
    let preProjects;
    let preEmployees;
    let preConfigs;
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

        db = new IndexedDBService('test-r07-sentinel-catalog-' + Math.random());
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

    test('sentinel project definition in the catalog is rejected before any mutation', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.projects = [
            { id: SENTINEL, name: 'Cuarentena', status: 'active', createdAt: 1 },
            { id: PRJ_A, name: 'Obra Alpha', status: 'active', createdAt: 1000 }
        ];

        await executeConfirmImport(payload);

        const reconciliation = getLastFullImportReconciliation();
        expect(reconciliation).toBeTruthy();
        expect(reconciliation.reconciliationRequired).toBe(true);
        expect(reconciliation.reason).toBe('SENTINEL_PROJECT_ID_IN_BACKUP');
        expect(reconciliation.sentinelId).toBe(SENTINEL);

        // Zero mutation: no sentinel row materialized, dataset/pointers untouched.
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(await db.getAll('projectPayrollConfigs')).toEqual(preConfigs);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope()).toEqual(preScope);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('sentinel default/active pointer is rejected before any mutation', async () => {
        const payload = makeSingleValidBackupFixture();
        // Real-only catalog, but sentinel pointers.
        payload.data.projectBackup.defaultProjectId = SENTINEL;
        payload.data.projectBackup.activeProjectId = SENTINEL;

        await executeConfirmImport(payload);

        const reconciliation = getLastFullImportReconciliation();
        expect(reconciliation).toBeTruthy();
        expect(reconciliation.reason).toBe('SENTINEL_PROJECT_ID_IN_BACKUP');
        expect(reconciliation.sentinelId).toBe(SENTINEL);

        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope()).toEqual(preScope);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('sentinel projectPayrollConfigs projectId fails closed before mutation (real catalog)', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.projectPayrollConfigs = [
            { projectId: SENTINEL, regularHoursPerDay: 8, schemaVersion: 1 }
        ];

        await executeConfirmImport(payload);

        // Fail closed; no sentinel config row materialized.
        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('projectPayrollConfigs')).toEqual(preConfigs);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('record with sentinel projectId under real catalog still fails closed (no sentinel project)', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.employees[0].projectId = 'legacy-unresolved:emp-u-1';

        await executeConfirmImport(payload);

        const afterProjects = await db.getAll('projects');
        expect(afterProjects).toEqual(preProjects);
        expect(afterProjects.some(p => String(p.id).startsWith('legacy-unresolved:'))).toBe(false);
        const afterEmployees = await db.getAll('employees');
        expect(afterEmployees).toEqual(preEmployees);
        expect(afterEmployees.some(e => String(e.projectId || '').startsWith('legacy-unresolved:'))).toBe(false);
        expect(window.location.reload).not.toHaveBeenCalled();
    });

    test('Projects OFF: sentinel-bearing data.projects is invisible (legacy passthrough, no sentinel rejection)', async () => {
        setProjectsEnabled(false);
        const payload = makeSingleValidBackupFixture();
        payload.data.projects = [
            { id: SENTINEL, name: 'Cuarentena', status: 'active', createdAt: 1 }
        ];
        payload.data.projectBackup.defaultProjectId = SENTINEL;
        payload.data.projectBackup.activeProjectId = SENTINEL;

        await executeConfirmImport(payload);

        // No sentinel reconciliation metadata produced (surface path skipped).
        expect(getLastFullImportReconciliation()).toBeNull();
        // The projects store is not polluted with the sentinel entry.
        const afterProjects = await db.getAll('projects');
        expect(afterProjects.some(p => String(p.id).startsWith('legacy-unresolved:'))).toBe(false);
    });

    test('ghost (non-sentinel) pointer absent from catalog still throws before mutation', async () => {
        const payload = makeSingleValidBackupFixture();
        payload.data.projectBackup.defaultProjectId = 'PRJ-ghost-not-in-backup';

        await executeConfirmImport(payload);

        expect(await db.getAll('projects')).toEqual(preProjects);
        expect(await db.getAll('employees')).toEqual(preEmployees);
        expect(getLastFullImportReconciliation()).toBeNull();
        expect(window.location.reload).not.toHaveBeenCalled();
    });
});
