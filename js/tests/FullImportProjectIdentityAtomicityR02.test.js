import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { projectContext, getEntityScope } from '../modules/features/projects/ProjectContext.js';
import {
    getScopedEmployees,
    effectiveProjectId,
    peekEntityScope,
    replaceEntityScope,
    DEFAULT_PROJECT_LS_KEY
} from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import * as ProjectPayrollConfigStore from '../modules/features/payroll/ProjectPayrollConfigStore.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

const OLD_PROJECT_ID = 'PRJ-mu1p73r3-iu8a';
const NEW_PROJECT_ID = 'PRJ-mu8nkbk5-qbli';
const EMP_34_ID = 'emp-1789749741792';
const EMP_405_ID = 'emp-1789586033810';

function makeStructuralFixture() {
    const employees = [];
    let empCounter = 1;
    for (let i = 1; i <= 55; i++) {
        if (empCounter === 34) empCounter++;
        if (empCounter === 405) empCounter++;
        employees.push({
            id: `emp-leg-${i}`,
            number: String(empCounter),
            name: `Empleado Legacy ${i}`,
            active: true,
            positions: ['pos-master'],
            loans: []
        });
        empCounter++;
    }

    employees.push({
        id: EMP_34_ID,
        number: '34',
        name: 'Andres Sanchez',
        projectId: OLD_PROJECT_ID,
        active: true,
        positions: ['pos-master'],
        loans: []
    });
    employees.push({
        id: EMP_405_ID,
        number: '405',
        name: 'Lano Borno',
        projectId: OLD_PROJECT_ID,
        active: true,
        positions: ['pos-master'],
        loans: []
    });

    const positions = [
        { id: 'pos-master', name: 'Cargo Master', active: true }
    ];
    for (let i = 2; i <= 12; i++) {
        positions.push({ id: `pos-${i}`, name: `Cargo ${i}`, active: true });
    }
    positions.push({
        id: 'pos-stamped',
        name: 'Cargo Especialista',
        projectId: OLD_PROJECT_ID,
        active: true
    });

    const leaders = [];
    for (let i = 1; i <= 4; i++) {
        leaders.push({ id: `lead-${i}`, number: String(i), name: `Lider ${i}`, active: true });
    }

    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Empresa Constructora', regularHoursPerDay: 8 },
            employees,
            positions,
            leaders,
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: OLD_PROJECT_ID, name: 'Obra Original', status: 'active', createdAt: 1000 }
            ],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                exportedAt: '2026-09-19T16:46:03.402Z',
                defaultProjectId: OLD_PROJECT_ID,
                activeProjectId: OLD_PROJECT_ID,
                projectIds: [OLD_PROJECT_ID]
            },
            projectPayrollConfigs: [
                { projectId: OLD_PROJECT_ID, regularHoursPerDay: 8, schemaVersion: 1 }
            ]
        }
    };
}

describe('FullImportProjectIdentityAtomicityR02 Contract (Suite A)', () => {
    let db;
    let originalState;
    let preEmployees;
    let prePositions;
    let preLeaders;
    let preAttendance;
    let preSettings;
    let preProjects;
    let preConfigs;
    let preScope;

    beforeEach(async () => {
        jest.useFakeTimers();
        delete window.location;
        window.location = { reload: jest.fn(), href: 'http://localhost/' };
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

        db = new IndexedDBService('test-proj-atomicity-r02-' + Math.random());
        await db.init();

        mockedIDB.saveState.mockImplementation((s, o) => db.saveState(s, o));
        mockedIDB.getAll.mockImplementation((...args) => db.getAll(...args));
        mockedIDB.get.mockImplementation((...args) => db.get(...args));
        mockedIDB.update.mockImplementation((...args) => db.update(...args));
        mockedIDB.delete.mockImplementation((...args) => db.delete(...args));
        mockedIDB.batchUpdate.mockImplementation((...args) => db.batchUpdate(...args));
        mockedIDB.batchDelete.mockImplementation((...args) => db.batchDelete(...args));
        mockedIDB.clear.mockImplementation((...args) => db.clear(...args));
        mockedIDB.clearAll.mockImplementation((...args) => db.clearAll(...args));

        projectStore.db = db;
        defaultProjectService.store = projectStore;
        projectContext.store = projectStore;
        projectContext.defaults = defaultProjectService;

        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, NEW_PROJECT_ID);
        await db.update('projects', { id: NEW_PROJECT_ID, name: 'Mi obra limpia PRE', status: 'active', createdAt: 500 });
        await db.update('projectPayrollConfigs', { projectId: NEW_PROJECT_ID, regularHoursPerDay: 9, schemaVersion: 1 });
        replaceEntityScope({ enabled: true, projectId: NEW_PROJECT_ID, defaultProjectId: NEW_PROJECT_ID });

        // Seed minimal PRE-state dataset
        const initialEmployees = [
            { id: 'emp-pre-1', number: '999', name: 'Pre Empleado', projectId: NEW_PROJECT_ID, active: true, positions: ['pos-pre-1'], loans: [] }
        ];
        const initialPositions = [
            { id: 'pos-pre-1', name: 'Cargo Pre', projectId: NEW_PROJECT_ID, active: true }
        ];
        const initialLeaders = [
            { id: 'lead-pre-1', number: '888', name: 'Lider Pre', projectId: NEW_PROJECT_ID, active: true }
        ];
        const initialAttendance = {
            'emp-pre-1-2026-09-18': { employeeId: 'emp-pre-1', date: '2026-09-18', present: true, hoursWorked: 8, projectId: NEW_PROJECT_ID }
        };
        const initialSettings = { companyName: 'Base Limpia Pre', regularHoursPerDay: 8 };

        Object.assign(state, {
            employees: initialEmployees,
            positions: initialPositions,
            leaders: initialLeaders,
            attendance: initialAttendance,
            settings: initialSettings,
            isDataLoaded: true,
            useIndexedDB: true
        });

        await db.saveState(state, { clearFirst: true });

        preEmployees = await db.getAll('employees');
        prePositions = await db.getAll('positions');
        preLeaders = await db.getAll('leaders');
        preAttendance = await db.getAll('attendance');
        preSettings = await db.getAll('settings');
        preProjects = await db.getAll('projects');
        preConfigs = await db.getAll('projectPayrollConfigs');
        preScope = peekEntityScope();
    });

    afterEach(() => {
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
        db.db.close();
        Object.assign(state, originalState);
        delete window.showConfirm;
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

    test('A1-A5 (Success): restore adopts backup project identity: catalog, default, active, scope and config match OLD with 57 in-scope and zero orphans', async () => {
        const payload = makeStructuralFixture();
        await executeConfirmImport(payload);

        const scope = await getEntityScope();

        // 1. Projects catalog must contain OLD_PROJECT_ID
        const allProjects = await projectStore.listAll();
        const projectIds = allProjects.map(p => p.id);
        expect(projectIds).toContain(OLD_PROJECT_ID);

        // 2. Default pointer must match backup default OLD_PROJECT_ID
        const currentDefault = localStorage.getItem(DEFAULT_PROJECT_LS_KEY);
        expect(currentDefault).toBe(OLD_PROJECT_ID);

        // 3. Scope must reflect OLD_PROJECT_ID
        expect(scope.defaultProjectId).toBe(OLD_PROJECT_ID);

        // 4. Scoped employees must include all 57 employees (55 unstamped + emp34 + emp405)
        const scoped = getScopedEmployees(state, scope);
        expect(scoped.length).toBe(57);
        expect(scoped.some(e => e.id === EMP_34_ID)).toBe(true);
        expect(scoped.some(e => e.id === EMP_405_ID)).toBe(true);

        // 5. Zero orphan projectIds: every effective projectId must be in the projects catalog
        const effectiveIds = new Set(state.employees.map(e => effectiveProjectId(e, scope)));
        for (const effId of effectiveIds) {
            expect(projectIds).toContain(effId);
        }

        // 6. ProjectPayrollConfigs matches backup
        const config = await ProjectPayrollConfigStore.getConfig(OLD_PROJECT_ID, { idb: db });
        expect(config).not.toBeNull();
        expect(config?.projectId).toBe(OLD_PROJECT_ID);
        expect(config?.regularHoursPerDay).toBe(8);
    });

    test('A2 (Rollback): induced failure when writing projects causes total rollback to exact PRE-import state', async () => {
        const probe = db.db.transaction(['projects'], 'readwrite');
        const proto = Object.getPrototypeOf(probe.objectStore('projects'));
        const origPut = proto.put;
        probe.abort();
        jest.spyOn(proto, 'put').mockImplementation(function (val, ...args) {
            if (this.name === 'projects') {
                throw new DOMException('Injected projects storage error', 'QuotaExceededError');
            }
            return origPut.call(this, val, ...args);
        });

        const payload = makeStructuralFixture();
        try {
            await executeConfirmImport(payload);
        } catch (_) {
            // Expected failure
        }

        // Atomicity requirement: failure writing projects leaves EVERYTHING exactly PRE-import
        const afterEmployees = await db.getAll('employees');
        const afterPositions = await db.getAll('positions');
        const afterLeaders = await db.getAll('leaders');
        const afterAttendance = await db.getAll('attendance');
        const afterSettings = await db.getAll('settings');
        const afterProjects = await db.getAll('projects');
        const afterConfigs = await db.getAll('projectPayrollConfigs');

        expect(afterEmployees).toEqual(preEmployees);
        expect(afterPositions).toEqual(prePositions);
        expect(afterLeaders).toEqual(preLeaders);
        expect(afterAttendance).toEqual(preAttendance);
        expect(afterSettings).toEqual(preSettings);
        expect(afterProjects).toEqual(preProjects);
        expect(afterConfigs).toEqual(preConfigs);

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('A3 (Rollback): induced failure when writing projectPayrollConfigs causes total rollback to exact PRE-import state', async () => {
        const probe = db.db.transaction(['projectPayrollConfigs'], 'readwrite');
        const proto = Object.getPrototypeOf(probe.objectStore('projectPayrollConfigs'));
        const origPut = proto.put;
        probe.abort();
        jest.spyOn(proto, 'put').mockImplementation(function (val, ...args) {
            if (this.name === 'projectPayrollConfigs') {
                throw new DOMException('Injected projectPayrollConfigs storage error', 'QuotaExceededError');
            }
            return origPut.call(this, val, ...args);
        });

        const payload = makeStructuralFixture();
        try {
            await executeConfirmImport(payload);
        } catch (_) {
            // Expected failure
        }

        // Atomicity requirement: failure writing projectPayrollConfigs leaves EVERYTHING exactly PRE-import
        const afterEmployees = await db.getAll('employees');
        const afterPositions = await db.getAll('positions');
        const afterLeaders = await db.getAll('leaders');
        const afterAttendance = await db.getAll('attendance');
        const afterSettings = await db.getAll('settings');
        const afterProjects = await db.getAll('projects');
        const afterConfigs = await db.getAll('projectPayrollConfigs');

        expect(afterEmployees).toEqual(preEmployees);
        expect(afterPositions).toEqual(prePositions);
        expect(afterLeaders).toEqual(preLeaders);
        expect(afterAttendance).toEqual(preAttendance);
        expect(afterSettings).toEqual(preSettings);
        expect(afterProjects).toEqual(preProjects);
        expect(afterConfigs).toEqual(preConfigs);

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope()).toEqual(preScope);
    });

    test('A4 (Atomicity): pointers cannot advance before the atomic transaction commits', async () => {
        // Inject failure on attendance write so transaction aborts before commit
        const probe = db.db.transaction(['attendance'], 'readwrite');
        const proto = Object.getPrototypeOf(probe.objectStore('attendance'));
        const origPut = proto.put;
        probe.abort();
        jest.spyOn(proto, 'put').mockImplementation(function (val, ...args) {
            if (this.name === 'attendance') {
                throw new DOMException('Injected attendance storage error', 'AbortError');
            }
            return origPut.call(this, val, ...args);
        });

        const payload = makeStructuralFixture();
        try {
            await executeConfirmImport(payload);
        } catch (_) {
            // Expected failure
        }

        // Pointers must not have advanced to OLD_PROJECT_ID
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(NEW_PROJECT_ID);
        expect(peekEntityScope().defaultProjectId).toBe(NEW_PROJECT_ID);
    });

    test('A5 (Fail-Closed): invalid explicit projectId absent from backup projects triggers fail-closed rejection', async () => {
        const payload = makeStructuralFixture();
        // Inject an invalid explicit foreign projectId not present in backup projects
        payload.data.employees[0].projectId = 'PRJ-unlisted-orphan-ghost';

        let threw = false;
        try {
            await executeConfirmImport(payload);
        } catch (_) {
            threw = true;
        }

        // Must reject or abort and NOT persist orphaned project reference
        const afterProjects = await db.getAll('projects');
        const projectIds = afterProjects.map(p => p.id);
        expect(projectIds).not.toContain('PRJ-unlisted-orphan-ghost');

        // Total state must not have adopted the orphan
        const afterEmployees = await db.getAll('employees');
        const orphanEmp = afterEmployees.find(e => e.projectId === 'PRJ-unlisted-orphan-ghost');
        expect(orphanEmp).toBeUndefined();
    });

    test('A6 (Control): projects OFF preserves legacy behavior and imports successfully', async () => {
        setProjectsEnabled(false);
        replaceEntityScope({ enabled: false, projectId: null, defaultProjectId: null });

        const payload = makeStructuralFixture();
        await executeConfirmImport(payload);

        expect(state.employees.length).toBe(57);
        expect(state.positions.length).toBe(13);
        expect(state.leaders.length).toBe(4);
    });
});
