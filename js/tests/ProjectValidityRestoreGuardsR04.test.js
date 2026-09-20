import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { projectStore } from '../modules/features/projects/ProjectStore.js';
import { defaultProjectService, DEFAULT_PROJECT_LS_KEY } from '../modules/features/projects/DefaultProject.js';
import { projectContext, getEntityScope, ACTIVE_PROJECT_LS_KEY } from '../modules/features/projects/ProjectContext.js';
import {
    getScopedEmployees,
    effectiveProjectId,
    peekEntityScope,
    replaceEntityScope,
    resetEntityScope
} from '../modules/features/projects/EntityProjectScope.js';
import { initProjectsInfrastructure } from '../modules/features/projects/ProjectsBoot.js';
import { migrateEntityProjectStamps } from '../modules/features/projects/EntityProjectMigration.js';
import { stampAttendanceWrite } from '../modules/features/attendance/AttendanceRecordWriter.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import * as ProjectPayrollConfigStore from '../modules/features/payroll/ProjectPayrollConfigStore.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (x) => JSON.parse(JSON.stringify(x));
}

const OLD_PROJECT_ID = 'PRJ-mu1p73r3-iu8a';
const NEW_PROJECT_ID = 'PRJ-mu8nkbk5-qbli';
const EMP_34_ID = 'emp-1789749741792';
const EMP_405_ID = 'emp-1789586033810';

function makeMockModal(innerHTML) {
    const el = document.createElement('div');
    el.innerHTML = innerHTML;
    return { element: el, close: jest.fn() };
}

function employeeFormHTML({ number = '101', name = 'Empleado Sintético', posId = 'pos-master' } = {}) {
    return `
        <input id="empNumber" value="${number}">
        <input id="empName" value="${name}">
        <input id="empHireDate" value="2026-01-01">
        <input id="empPhone" value=""><input id="empEmail" value="">
        <textarea id="empNotes"></textarea>
        <input type="checkbox" name="empPosition" value="${posId}" checked>
        <input class="custom-salary-input" data-pos-id="${posId}" value="">
    `;
}

/**
 * Synthetic fixture conforming strictly to the Direction contract:
 * - NO real PII (synthetic numbers, names, and concepts)
 * - Single OLD project in catalog
 * - Mix of unstamped legacy + explicitly stamped OLD entities
 * - Petty Cash linked to OLD official project
 * - ProjectPayrollConfig linked to OLD
 */
function makeSyntheticBackupFixture() {
    const employees = [
        { id: 'emp-leg-1', number: '1', name: 'Personal Legacy 1', active: true, positions: ['pos-master'], loans: [] },
        { id: 'emp-leg-2', number: '2', name: 'Personal Legacy 2', active: true, positions: ['pos-master'], loans: [] },
        { id: 'emp-leg-3', number: '3', name: 'Personal Legacy 3', active: true, positions: ['pos-master'], loans: [] },
        { id: 'emp-leg-4', number: '4', name: 'Personal Legacy 4', active: true, positions: ['pos-master'], loans: [] },
        { id: 'emp-leg-5', number: '5', name: 'Personal Legacy 5', active: true, positions: ['pos-master'], loans: [] },
        {
            id: EMP_34_ID,
            number: '34',
            name: 'Personal Especialista 34',
            projectId: OLD_PROJECT_ID,
            active: true,
            positions: ['pos-master'],
            loans: [{ id: 'loan-34', amount: 500, balance: 250, status: 'active' }]
        },
        {
            id: EMP_405_ID,
            number: '405',
            name: 'Personal Especialista 405',
            projectId: OLD_PROJECT_ID,
            active: true,
            positions: ['pos-master'],
            loans: []
        }
    ];

    const positions = [
        { id: 'pos-master', name: 'Puesto Principal', active: true },
        { id: 'pos-2', name: 'Puesto Secundario', active: true },
        { id: 'pos-3', name: 'Puesto Auxiliar', active: true },
        { id: 'pos-stamped', name: 'Puesto Especialista', projectId: OLD_PROJECT_ID, active: true }
    ];

    const leaders = [
        { id: 'lead-1', number: '1', name: 'Lider Equipo 1', active: true },
        { id: 'lead-2', number: '2', name: 'Lider Equipo 2', active: true }
    ];

    const attendance = {
        'emp-leg-1-2026-09-18': {
            employeeId: 'emp-leg-1',
            date: '2026-09-18',
            present: true,
            hoursWorked: 8
        },
        [`${EMP_34_ID}-2026-09-18`]: {
            employeeId: EMP_34_ID,
            date: '2026-09-18',
            present: true,
            hoursWorked: 8,
            projectId: OLD_PROJECT_ID
        }
    };

    const pettyCash = {
        projects: [{ id: 'pc-proj-1', name: 'Caja Obra Principal', officialProjectId: OLD_PROJECT_ID }],
        periods: [{ id: 'pc-per-1', projectId: 'pc-proj-1', status: 'open' }],
        movements: [{ id: 'pc-mov-1', projectId: 'pc-proj-1', periodId: 'pc-per-1', amount: 150, concept: 'Gasto Operativo Sintetico' }]
    };

    return {
        version: '1.0.0',
        exportDate: '2026-09-19T16:46:03.402Z',
        data: {
            settings: { companyName: 'Constructora Sintetica SA', regularHoursPerDay: 8 },
            employees,
            positions,
            leaders,
            attendance,
            tempAssignments: [],
            dayHoursConfig: {},
            projects: [
                { id: OLD_PROJECT_ID, name: 'Obra Principal Backup', status: 'active', createdAt: 1000 }
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
            ],
            pettyCash
        }
    };
}

describe('ProjectValidityRestoreGuardsR04 Contract Suite', () => {
    let db;
    let originalState;
    let lastSavePromise = null;

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
        lastSavePromise = null;

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

        db = new IndexedDBService('test-r04-validity-guards-' + Math.random());
        await db.init();

        hookMockedIDBTo(db);
        wireProjectServices(db);

        EmployeesUI.init({
            state,
            saveToLocalStorage: (opts) => {
                lastSavePromise = db.saveState(state, opts);
                return lastSavePromise;
            },
            render: jest.fn(),
            closeModal: jest.fn(),
            services: {}
        });
    });

    afterEach(async () => {
        if (lastSavePromise) {
            try { await lastSavePromise; } catch (_) {}
            lastSavePromise = null;
        }
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

    // ═════════════════════════════════════════════════════════════════════════
    // S1 — INICIO DESDE CERO
    // ═════════════════════════════════════════════════════════════════════════
    describe('S1 — INICIO DESDE CERO', () => {
        test('S1.1: clean start with boot auto-resolves valid default project before mutations (PASS path)', async () => {
            setProjectsEnabled(true);

            // Clean boot invocation
            const bootResult = await initProjectsInfrastructure();
            expect(bootResult.defaultProjectId).toBeTruthy();

            // Default project must exist in projects store
            const catalog = await db.getAll('projects');
            expect(catalog.length).toBeGreaterThan(0);
            const defaultInStore = catalog.find(p => p.id === bootResult.defaultProjectId);
            expect(defaultInStore).toBeDefined();
            expect(defaultInStore.status).toBe('active');

            // Default pointer and scope reflect the valid project
            expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(bootResult.defaultProjectId);
            const scope = peekEntityScope();
            expect(scope.enabled).toBe(true);
            expect(scope.defaultProjectId).toBe(bootResult.defaultProjectId);

            // Mutation after valid boot stamps/resolves to the valid project
            state.positions = [{ id: 'pos-master', name: 'Puesto Master', active: true }];
            EmployeeModal.save(makeMockModal(employeeFormHTML({ number: '10', name: 'Empleado Valido Boot' })), null);
            if (lastSavePromise) await lastSavePromise;

            const savedEmployees = await db.getAll('employees');
            expect(savedEmployees.length).toBe(1);
            const emp = savedEmployees[0];
            const effId = effectiveProjectId(emp, scope);
            expect(effId).toBe(bootResult.defaultProjectId);

            // Invariant: zero orphan entities
            expect(catalog.some(p => p.id === effId)).toBe(true);
        });

        test('S1.2: mutation without valid project in catalog/store must not persist orphan entity (guard required)', async () => {
            setProjectsEnabled(true);
            resetEntityScope();
            replaceEntityScope({ enabled: true, projectId: null, defaultProjectId: null });

            // Catalog is empty (no boot has created any project)
            const preCatalog = await db.getAll('projects');
            expect(preCatalog.length).toBe(0);

            state.positions = [{ id: 'pos-master', name: 'Puesto Master', active: true }];

            // Attempt mutation via UI modal save handler
            EmployeeModal.save(makeMockModal(employeeFormHTML({ number: '20', name: 'Empleado Sin Obra' })), null);
            if (lastSavePromise) await lastSavePromise;

            const storedProjects = await db.getAll('projects');
            const storedEmployees = await db.getAll('employees');

            // 🛡️ CONTRACT: Under Projects ON, a project-owned mutation CANNOT persist
            // an orphan entity into IndexedDB. Either:
            // 1. The system auto-created/resolved an official project in the catalog before mutating, OR
            // 2. The persistence was rejected/blocked, leaving 0 persisted entities in IDB.
            // Persisting an entity while storedProjects remains empty is an orphan violation.
            const isProtectedFromOrphan = storedEmployees.length === 0 || (
                storedProjects.length > 0 && storedEmployees.every(emp => {
                    const effId = emp.projectId || peekEntityScope().defaultProjectId;
                    return effId && storedProjects.some(p => p.id === effId);
                })
            );

            expect(isProtectedFromOrphan).toBe(true);
        });

        test('S1.3: skipping onboarding guide must not allow creating orphan attendance without valid project', async () => {
            setProjectsEnabled(true);
            resetEntityScope();
            replaceEntityScope({ enabled: true, projectId: null, defaultProjectId: null });

            // Store has 0 projects
            const preCatalog = await db.getAll('projects');
            expect(preCatalog.length).toBe(0);

            // An attendance write occurs while no valid project exists
            const attRecord = stampAttendanceWrite({
                employeeId: 'emp-new-att',
                date: '2026-09-19',
                present: true,
                hoursWorked: 8
            });

            state.attendance = { 'emp-new-att-2026-09-19': attRecord };
            await db.saveState(state);

            const storedProjects = await db.getAll('projects');
            const storedAttendance = await db.getAll('attendance');

            // 🛡️ CONTRACT: Attendance record cannot be persisted as an orphan
            // when no official project exists in catalog.
            const isAttendanceProtected = storedAttendance.length === 0 || (
                storedProjects.length > 0 && storedAttendance.every(att => {
                    const effId = att.projectId || peekEntityScope().defaultProjectId;
                    return effId && storedProjects.some(p => p.id === effId);
                })
            );

            expect(isAttendanceProtected).toBe(true);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    // S2 — FULL RESTORE CON OBRAS
    // ═════════════════════════════════════════════════════════════════════════
    describe('S2 — FULL RESTORE CON OBRAS', () => {
        test('S2.1: restore in clean env pre-seeded with NEW replaces catalog with OLD and discards NEW', async () => {
            setProjectsEnabled(true);

            // Pre-seed clean environment with NEW project
            localStorage.setItem(DEFAULT_PROJECT_LS_KEY, NEW_PROJECT_ID);
            localStorage.setItem(ACTIVE_PROJECT_LS_KEY, NEW_PROJECT_ID);
            await db.update('projects', { id: NEW_PROJECT_ID, name: 'Mi obra limpia PRE', status: 'active', createdAt: 500 });
            await db.update('projectPayrollConfigs', { projectId: NEW_PROJECT_ID, regularHoursPerDay: 9, schemaVersion: 1 });
            replaceEntityScope({ enabled: true, projectId: NEW_PROJECT_ID, defaultProjectId: NEW_PROJECT_ID });

            // Perform FULL restore of backup with OLD project
            const backupPayload = makeSyntheticBackupFixture();
            await executeConfirmImport(backupPayload);

            // 1. Projects catalog in IDB must contain OLD and NOT NEW
            const allProjects = await projectStore.listAll();
            const projectIds = allProjects.map(p => p.id);
            expect(projectIds).toContain(OLD_PROJECT_ID);
            expect(projectIds).not.toContain(NEW_PROJECT_ID);

            // 2. Default and active pointers in localStorage must point to OLD
            expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(OLD_PROJECT_ID);
            expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(OLD_PROJECT_ID);

            // 3. Scope must reflect OLD
            const scope = await getEntityScope();
            expect(scope.defaultProjectId).toBe(OLD_PROJECT_ID);
            expect(scope.projectId).toBe(OLD_PROJECT_ID);

            // 4. Legacy entities without projectId resolve to backup default OLD (not NEW)
            const scopedEmps = getScopedEmployees(state, scope);
            expect(scopedEmps.length).toBe(7); // all 5 legacy + emp34 + emp405
            for (const emp of scopedEmps) {
                const eff = effectiveProjectId(emp, scope);
                expect(eff).toBe(OLD_PROJECT_ID);
                expect(eff).not.toBe(NEW_PROJECT_ID);
            }

            // 5. Explicit OLD relations are preserved
            const emp34 = state.employees.find(e => e.id === EMP_34_ID);
            const emp405 = state.employees.find(e => e.id === EMP_405_ID);
            expect(emp34.projectId).toBe(OLD_PROJECT_ID);
            expect(emp405.projectId).toBe(OLD_PROJECT_ID);
            const posStamped = state.positions.find(p => p.id === 'pos-stamped');
            expect(posStamped.projectId).toBe(OLD_PROJECT_ID);

            // 6. Petty Cash officialProjectId resolves to OLD
            const pcProjects = await db.getAll('pettyCashProjects');
            expect(pcProjects.length).toBe(1);
            expect(pcProjects[0].officialProjectId).toBe(OLD_PROJECT_ID);

            // 7. Payroll config resolves to OLD
            const config = await ProjectPayrollConfigStore.getConfig(OLD_PROJECT_ID, { idb: db });
            expect(config).not.toBeNull();
            expect(config.projectId).toBe(OLD_PROJECT_ID);
            expect(config.regularHoursPerDay).toBe(8);
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    // S3 — LEGACY CONTROLADO
    // ═════════════════════════════════════════════════════════════════════════
    describe('S3 — LEGACY CONTROLADO', () => {
        test('S3.1: restore with mixed legacy + stamped OLD resolves all legacy to OLD without inventing NEW', async () => {
            setProjectsEnabled(true);

            const backupPayload = makeSyntheticBackupFixture();
            await executeConfirmImport(backupPayload);

            // Simulate application restart
            db.db.close();
            state.employees = [];
            state.positions = [];
            state.leaders = [];
            state.attendance = {};

            const dbRestart = new IndexedDBService(db.dbName);
            await dbRestart.init();
            hookMockedIDBTo(dbRestart);
            wireProjectServices(dbRestart);

            const scope = await getEntityScope();
            expect(scope.defaultProjectId).toBe(OLD_PROJECT_ID);

            // Execute M2 local migration stamp (yieldToUi relies on timer tick)
            const migPromise = migrateEntityProjectStamps({ idb: dbRestart, defaults: defaultProjectService });
            jest.advanceTimersByTime(200);
            await migPromise;

            // In IDB: All employees must now be stamped with OLD_PROJECT_ID
            const storedEmployees = await dbRestart.getAll('employees');
            expect(storedEmployees.length).toBe(7);
            for (const emp of storedEmployees) {
                expect(emp.projectId).toBe(OLD_PROJECT_ID);
            }

            // Positions, leaders, attendance: all stamped with OLD_PROJECT_ID
            const storedPositions = await dbRestart.getAll('positions');
            for (const pos of storedPositions) {
                expect(pos.projectId).toBe(OLD_PROJECT_ID);
            }

            const storedLeaders = await dbRestart.getAll('leaders');
            for (const lead of storedLeaders) {
                expect(lead.projectId).toBe(OLD_PROJECT_ID);
            }

            const storedAttendance = await dbRestart.getAll('attendance');
            for (const att of storedAttendance) {
                expect(att.projectId).toBe(OLD_PROJECT_ID);
            }

            // No NEW project was invented in catalog
            const catalog = await dbRestart.getAll('projects');
            expect(catalog.length).toBe(1);
            expect(catalog[0].id).toBe(OLD_PROJECT_ID);

            dbRestart.db.close();
        });

        test('S3.2: fail-closed rejection when backup references explicit projectId absent from catalog', async () => {
            setProjectsEnabled(true);

            const payload = makeSyntheticBackupFixture();
            // Inject foreign orphan reference into an employee
            payload.data.employees[0].projectId = 'PRJ-unlisted-orphan-ghost';

            try {
                await executeConfirmImport(payload);
            } catch (_) {}

            // Must reject and NOT adopt foreign orphan project into catalog
            const afterProjects = await db.getAll('projects');
            const projectIds = afterProjects.map(p => p.id);
            expect(projectIds).not.toContain('PRJ-unlisted-orphan-ghost');

            // Orphan entity must not be persisted
            const afterEmployees = await db.getAll('employees');
            const orphanEmp = afterEmployees.find(e => e.projectId === 'PRJ-unlisted-orphan-ghost');
            expect(orphanEmp).toBeUndefined();
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    // S4 — SIN OBRA VÁLIDA / FALLO DE CARGA
    // ═════════════════════════════════════════════════════════════════════════
    describe('S4 — SIN OBRA VÁLIDA / FALLO DE CARGA', () => {
        test('S4.1: broken/unresolved project state does not block full restore recovery', async () => {
            setProjectsEnabled(true);

            // Simulate broken project state: catalog is empty, pointers corrupted
            localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-corrupt-pointer');
            localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-corrupt-pointer');

            // Ensure store returns null
            const candidate = await projectStore.get('PRJ-corrupt-pointer');
            expect(candidate).toBeNull();

            // Full restore must still be able to open and execute
            const backupPayload = makeSyntheticBackupFixture();
            await executeConfirmImport(backupPayload);

            // Recovery succeeds: catalog and pointers restored to valid state
            const allProjects = await projectStore.listAll();
            expect(allProjects.map(p => p.id)).toContain(OLD_PROJECT_ID);
            expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(OLD_PROJECT_ID);
            expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(OLD_PROJECT_ID);
        });

        test('S4.2: project-owned entity mutation is rejected/blocked when project resolution fails / no valid project exists', async () => {
            setProjectsEnabled(true);

            // Projects store is empty, but entity has a non-existent explicit projectId
            const ghostId = 'PRJ-nonexistent-ghost';
            replaceEntityScope({ enabled: true, projectId: ghostId, defaultProjectId: ghostId });

            const orphanEmployee = {
                id: 'emp-ghost-orphan',
                number: '99',
                name: 'Empleado Huerfano',
                projectId: ghostId,
                active: true,
                positions: ['pos-master'],
                loans: [{ id: 'loan-ghost', amount: 300, balance: 300, status: 'active' }]
            };

            state.employees = [orphanEmployee];

            // Attempt to save state with the orphan entity
            await db.saveState(state);

            const storedProjects = await db.getAll('projects');
            const storedEmployees = await db.getAll('employees');
            const catalogIds = new Set(storedProjects.map(p => p.id));

            // 🛡️ CONTRACT: Cannot persist an entity whose projectId does not exist
            // in the projects catalog when Projects is ON.
            const hasOrphan = storedEmployees.some(emp => {
                const effId = emp.projectId || peekEntityScope().defaultProjectId;
                return !effId || !catalogIds.has(effId);
            });

            expect(hasOrphan).toBe(false);
        });

        test('S4.3: projects OFF mode preserves legacy behavior without being blocked by project validity guard', async () => {
            setProjectsEnabled(false);
            replaceEntityScope({ enabled: false, projectId: null, defaultProjectId: null });

            const legacyEmployee = {
                id: 'emp-legacy-off',
                number: '88',
                name: 'Empleado Legacy Puro',
                active: true,
                positions: ['pos-master'],
                loans: []
            };

            state.employees = [legacyEmployee];
            await db.saveState(state);

            const storedEmployees = await db.getAll('employees');
            expect(storedEmployees.length).toBe(1);
            expect(storedEmployees[0].id).toBe('emp-legacy-off');
            expect(storedEmployees[0].projectId).toBeUndefined();
        });
    });

    // ═════════════════════════════════════════════════════════════════════════
    // S5 — NO-ORPHAN INVARIANT
    // ═════════════════════════════════════════════════════════════════════════
    describe('S5 — NO-ORPHAN INVARIANT', () => {
        test('S5.1: comprehensive no-orphan invariant across all stores after restore and restart cycle', async () => {
            setProjectsEnabled(true);

            const backupPayload = makeSyntheticBackupFixture();
            await executeConfirmImport(backupPayload);

            // Simulate restart cycle (close DB, reset memory, reopen DB)
            db.db.close();
            state.employees = [];
            state.positions = [];
            state.leaders = [];
            state.attendance = {};

            const dbRestart = new IndexedDBService(db.dbName);
            await dbRestart.init();
            hookMockedIDBTo(dbRestart);
            wireProjectServices(dbRestart);

            const catalogProjects = await dbRestart.getAll('projects');
            const catalogProjectIds = new Set(catalogProjects.map(p => p.id));
            expect(catalogProjectIds.has(OLD_PROJECT_ID)).toBe(true);

            const scope = await getEntityScope();
            expect(catalogProjectIds.has(scope.defaultProjectId)).toBe(true);
            expect(catalogProjectIds.has(scope.projectId)).toBe(true);

            // 1. Employees: Every explicit projectId must be in catalog; unstamped resolves to valid default
            const dbEmployees = await dbRestart.getAll('employees');
            expect(dbEmployees.length).toBe(7);
            for (const emp of dbEmployees) {
                if (emp.projectId != null && String(emp.projectId).trim()) {
                    expect(catalogProjectIds.has(String(emp.projectId).trim())).toBe(true);
                } else {
                    const effId = effectiveProjectId(emp, scope);
                    expect(effId).toBe(scope.defaultProjectId);
                    expect(catalogProjectIds.has(effId)).toBe(true);
                }
            }

            // 2. Positions: Every explicit projectId in catalog
            const dbPositions = await dbRestart.getAll('positions');
            expect(dbPositions.length).toBe(4);
            for (const pos of dbPositions) {
                if (pos.projectId != null && String(pos.projectId).trim()) {
                    expect(catalogProjectIds.has(String(pos.projectId).trim())).toBe(true);
                } else {
                    const effId = effectiveProjectId(pos, scope);
                    expect(effId).toBe(scope.defaultProjectId);
                    expect(catalogProjectIds.has(effId)).toBe(true);
                }
            }

            // 3. Leaders: Every explicit projectId in catalog
            const dbLeaders = await dbRestart.getAll('leaders');
            expect(dbLeaders.length).toBe(2);
            for (const lead of dbLeaders) {
                if (lead.projectId != null && String(lead.projectId).trim()) {
                    expect(catalogProjectIds.has(String(lead.projectId).trim())).toBe(true);
                } else {
                    const effId = effectiveProjectId(lead, scope);
                    expect(effId).toBe(scope.defaultProjectId);
                    expect(catalogProjectIds.has(effId)).toBe(true);
                }
            }

            // 4. Attendance: Every explicit projectId in catalog
            const dbAttendance = await dbRestart.getAll('attendance');
            expect(dbAttendance.length).toBe(2);
            for (const att of dbAttendance) {
                if (att.projectId != null && String(att.projectId).trim()) {
                    expect(catalogProjectIds.has(String(att.projectId).trim())).toBe(true);
                } else {
                    const effId = effectiveProjectId(att, scope);
                    expect(effId).toBe(scope.defaultProjectId);
                    expect(catalogProjectIds.has(effId)).toBe(true);
                }
            }

            // 5. ProjectPayrollConfigs: Each config belongs to a catalog project
            const dbConfigs = await dbRestart.getAll('projectPayrollConfigs');
            expect(dbConfigs.length).toBe(1);
            for (const config of dbConfigs) {
                expect(catalogProjectIds.has(config.projectId)).toBe(true);
            }

            // 6. Petty Cash Projects: officialProjectId belongs to catalog
            const dbPettyProjects = await dbRestart.getAll('pettyCashProjects');
            expect(dbPettyProjects.length).toBe(1);
            for (const p of dbPettyProjects) {
                if (p.officialProjectId != null && String(p.officialProjectId).trim()) {
                    expect(catalogProjectIds.has(String(p.officialProjectId).trim())).toBe(true);
                }
            }

            // 7. Scoped UI check: Zero employees orphaned from scope
            state.employees = dbEmployees;
            const scoped = getScopedEmployees(state, scope);
            expect(scoped.length).toBe(7);

            dbRestart.db.close();
        });
    });
});
