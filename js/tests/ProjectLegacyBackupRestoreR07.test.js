import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText, getLastFullImportReconciliation } from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext } from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY, replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

/**
 * R07 A2a — ProjectLegacyBackupRestoreR07
 *
 * Contract: a PURE legacy backup (no project surface, no explicit projectIds)
 * restored with Projects ON must resolve EXACTLY ONE real local default
 * project BEFORE the durable commit and assign every project-owned legacy
 * record to it. A valid default must never be duplicated (no second project).
 * Explicit orphan projectIds fail closed before any mutation. Projects OFF
 * keeps legacy behavior untouched.
 */
function makeLegacyBackupFixture() {
    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Constructora Legacy SA', regularHoursPerDay: 8 },
            employees: [
                { id: 'emp-leg-1', number: '1', name: 'Legacy Uno', active: true, positions: ['pos-master'], loans: [] },
                { id: 'emp-leg-2', number: '2', name: 'Legacy Dos', active: true, positions: ['pos-master'], loans: [] }
            ],
            positions: [
                { id: 'pos-master', name: 'Puesto Master', active: true },
                { id: 'pos-2', name: 'Puesto Secundario', active: true }
            ],
            leaders: [
                { id: 'lead-1', number: '1', name: 'Lider Legacy', active: true }
            ],
            attendance: {
                'emp-leg-1-2026-09-18': { employeeId: 'emp-leg-1', date: '2026-09-18', present: true, hoursWorked: 8 },
                'emp-leg-2-2026-09-18': { employeeId: 'emp-leg-2', date: '2026-09-18', present: false, hoursWorked: 0 }
            },
            tempAssignments: [],
            dayHoursConfig: {}
        }
    };
}

describe('ProjectLegacyBackupRestoreR07 Contract Suite', () => {
    let db;
    let originalState;

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

        db = new IndexedDBService('test-r07-legacy-restore-' + Math.random());
        await db.init();
        hookMockedIDBTo(db);
        wireProjectServices(db);
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

    test('pure legacy backup resolves exactly one real local default project and assigns every project-owned record to it', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: null, defaultProjectId: null });

        const catalogBefore = await db.getAll('projects');
        expect(catalogBefore.length).toBe(0);

        await executeConfirmImport(makeLegacyBackupFixture());

        // 1. Exactly ONE project was resolved/created: no second default.
        const catalog = await db.getAll('projects');
        expect(catalog.length).toBe(1);
        const defaultProject = catalog[0];
        expect(defaultProject.id).toBeTruthy();
        expect(defaultProject.name).toBe('Mi obra');
        expect(defaultProject.status).toBe('active');

        // 2. Default pointer resolved to that real project before commit.
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(defaultProject.id);

        // 3. Every project-owned legacy record is assigned to that project.
        const storedEmployees = await db.getAll('employees');
        expect(storedEmployees.length).toBe(2);
        for (const emp of storedEmployees) expect(emp.projectId).toBe(defaultProject.id);

        const storedPositions = await db.getAll('positions');
        expect(storedPositions.length).toBe(2);
        for (const pos of storedPositions) expect(pos.projectId).toBe(defaultProject.id);

        const storedLeaders = await db.getAll('leaders');
        expect(storedLeaders.length).toBe(1);
        for (const lead of storedLeaders) expect(lead.projectId).toBe(defaultProject.id);

        const storedAttendance = await db.getAll('attendance');
        expect(storedAttendance.length).toBe(2);
        for (const att of storedAttendance) expect(att.projectId).toBe(defaultProject.id);

        // 4. No quarantine/sentinel materialized during import.
        const allRecords = [...storedEmployees, ...storedPositions, ...storedLeaders, ...storedAttendance];
        expect(allRecords.every(r => !String(r.projectId || '').startsWith('legacy-unresolved:'))).toBe(true);

        // 5. Successful import is not a reconciliation stop.
        expect(getLastFullImportReconciliation()).toBeNull();
    });

    test('pure legacy backup with an existing valid default binds to it WITHOUT creating a second project', async () => {
        setProjectsEnabled(true);
        const LOCAL_ID = 'PRJ-local-default-0001';
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, LOCAL_ID);
        await db.update('projects', { id: LOCAL_ID, name: 'Obra Local Real', status: 'active', createdAt: 100 });

        await executeConfirmImport(makeLegacyBackupFixture());

        // No second project was created: the valid default was reused.
        const catalog = await db.getAll('projects');
        expect(catalog.length).toBe(1);
        expect(catalog[0].id).toBe(LOCAL_ID);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(LOCAL_ID);

        const storedEmployees = await db.getAll('employees');
        for (const emp of storedEmployees) expect(emp.projectId).toBe(LOCAL_ID);
        const storedPositions = await db.getAll('positions');
        for (const pos of storedPositions) expect(pos.projectId).toBe(LOCAL_ID);
        const storedAttendance = await db.getAll('attendance');
        for (const att of storedAttendance) expect(att.projectId).toBe(LOCAL_ID);
    });

    test('legacy backup referencing an explicit projectId absent from the local catalog fails closed before mutation', async () => {
        setProjectsEnabled(true);
        const LOCAL_ID = 'PRJ-local-keep-0001';
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, LOCAL_ID);
        await db.update('projects', { id: LOCAL_ID, name: 'Obra Local', status: 'active', createdAt: 100 });

        const preEmployees = [{ id: 'emp-pre-1', number: '9', name: 'Pre Empleado', projectId: LOCAL_ID, active: true, positions: [], loans: [] }];
        state.employees = preEmployees;
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        state.settings = { companyName: 'Base Pre' };
        await db.saveState(state, { clearFirst: true });
        const preStoredEmployees = await db.getAll('employees');

        const payload = makeLegacyBackupFixture();
        payload.data.employees[0].projectId = 'PRJ-unlisted-legacy-ghost';

        await executeConfirmImport(payload);

        // Fail closed: local catalog untouched, ghost never adopted nor persisted.
        const catalog = await db.getAll('projects');
        expect(catalog.map(p => p.id)).toEqual([LOCAL_ID]);

        const afterEmployees = await db.getAll('employees');
        expect(afterEmployees).toEqual(preStoredEmployees);
        expect(afterEmployees.some(e => e.projectId === 'PRJ-unlisted-legacy-ghost')).toBe(false);
        expect(state.employees).toEqual(preEmployees);
    });

    test('Projects OFF keeps legacy behavior: no project created, no record stamped', async () => {
        setProjectsEnabled(false);
        replaceEntityScope({ enabled: false, projectId: null, defaultProjectId: null });

        await executeConfirmImport(makeLegacyBackupFixture());

        const catalog = await db.getAll('projects');
        expect(catalog.length).toBe(0);

        const storedEmployees = await db.getAll('employees');
        expect(storedEmployees.length).toBe(2);
        for (const emp of storedEmployees) expect(emp.projectId).toBeUndefined();

        const storedPositions = await db.getAll('positions');
        for (const pos of storedPositions) expect(pos.projectId).toBeUndefined();

        const storedAttendance = await db.getAll('attendance');
        for (const att of storedAttendance) expect(att.projectId).toBeUndefined();
    });
});
