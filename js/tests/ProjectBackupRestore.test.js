/**
 * 🧪 ProjectBackupRestore.test.js (F1.9 S2 / SA-F1.9-PROJECT-RESTORE-068)
 *
 * Comprehensive tests for project-aware backup restore:
 * 1. OFF / Legacy no-write preservation (no store, config, or pointer writes).
 * 2. Round-trip restore of two projects, names/statuses, payroll configs,
 *    and active/default pointers (snapshot restore, exact IDs, no ID remapping/fusion).
 * 3. Invalid/dangling manifest pointer fallback (deterministic resolution to valid active project).
 * 4. Failure rollback with fault injection (proving no mixed partial result).
 * 5. Zero-write receive/review before explicit user confirmation.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { isProjectsEnabled, setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import {
    isProjectBackupApplicable,
    resolveRestoredPointers,
    planProjectRestore,
    captureRestoreRollbackSnapshot,
    applyProjectRestore,
    executeRestoreRollback,
    DEFAULT_PROJECT_LS_KEY,
    ACTIVE_PROJECT_LS_KEY
} from 'actual/services/ProjectBackupRestore.js';
import { replaceEntityScope, resetEntityScope, peekEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { PROJECT_STATUS } from 'actual/features/projects/Project.js';
import { applyBackupData, loadBackupFromFile } from '../app.js';
import { RestoreUI } from 'actual/ui/RestoreUI.js';
import { state as globalAppState, toRaw } from 'actual/core/AppState.js';


if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

if (typeof globalThis.TextEncoder === 'undefined') {
    const util = require('util');
    globalThis.TextEncoder = util.TextEncoder;
}

const PRJ_1 = 'PRJ-OBRA-000001';
const PRJ_2 = 'PRJ-OBRA-000002';

function makeValidProjectBackup() {
    return {
        version: '1.0.0',
        exportDate: '2026-09-17T00:00:00.000Z',
        companyName: 'Constructora Alfa',
        data: {
            settings: { companyName: 'Constructora Alfa' },
            positions: [{ id: 'POS-1', projectId: PRJ_1 }],
            employees: [{ id: 'EMP-1', name: 'Carlos', projectId: PRJ_1 }, { id: 'EMP-2', name: 'Diana', projectId: PRJ_2 }],
            leaders: [],
            attendance: {},
            projects: [
                { id: PRJ_1, name: 'Obra Alfa', status: PROJECT_STATUS.ACTIVE, createdAt: 1000 },
                { id: PRJ_2, name: 'Obra Beta', status: PROJECT_STATUS.CLOSED, closedAt: 2000, createdAt: 1500 }
            ],
            projectPayrollConfigs: [
                { projectId: PRJ_1, regularHoursPerDay: 9, overtimeFactor: 1.5 }
            ],
            projectBackup: {
                version: 1,
                projectsEnabled: true,
                defaultProjectId: PRJ_1,
                activeProjectId: PRJ_1,
                projectIds: [PRJ_1, PRJ_2]
            }
        }
    };
}

function makeLegacyBackup() {
    return {
        version: '1.0.0',
        exportDate: '2025-01-01T00:00:00.000Z',
        companyName: 'Legacy SA',
        data: {
            settings: { companyName: 'Legacy SA' },
            positions: [{ id: 'POS-LEG' }],
            employees: [{ id: 'EMP-LEG' }],
            leaders: [],
            attendance: {}
        }
    };
}

describe('F1.9 S2 Project Restore — (1) OFF / Legacy No-Write Preservation', () => {
    beforeEach(() => {
        localStorage.clear();
        setProjectsEnabled(false);
    });
    afterEach(() => {
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('Projects OFF: planProjectRestore returns null and performs zero writes', async () => {
        setProjectsEnabled(false);
        const backup = makeValidProjectBackup();
        expect(isProjectBackupApplicable(backup)).toBe(false);
        const plan = planProjectRestore(backup);
        expect(plan).toBeNull();
        expect(isProjectsEnabled()).toBe(false);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBeNull();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
    });

    test('Projects ON + legacy backup: planProjectRestore returns null and leaves existing stores/pointers untouched', async () => {
        setProjectsEnabled(true);
        const legacy = makeLegacyBackup();
        expect(isProjectBackupApplicable(legacy)).toBe(false);
        const plan = planProjectRestore(legacy);
        expect(plan).toBeNull();

        // Existing pointers must not be cleared or overwritten
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-EXISTING');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-EXISTING');
        await applyProjectRestore(plan);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
    });
});

describe('F1.9 S2 Project Restore — (2) Pointer Resolution & Fallback Semantics', () => {
    test('valid manifest pointers matching restored active projects are preserved verbatim', () => {
        const projects = [
            { id: PRJ_1, status: PROJECT_STATUS.ACTIVE, createdAt: 1000 },
            { id: PRJ_2, status: PROJECT_STATUS.ACTIVE, createdAt: 2000 }
        ];
        const pointers = resolveRestoredPointers(projects, {
            defaultProjectId: PRJ_2,
            activeProjectId: PRJ_1
        });
        expect(pointers.defaultProjectId).toBe(PRJ_2);
        expect(pointers.activeProjectId).toBe(PRJ_1);
    });

    test('dangling manifest pointer deterministically falls back to earliest restored active project', () => {
        const projects = [
            { id: PRJ_2, status: PROJECT_STATUS.ACTIVE, createdAt: 2000 },
            { id: PRJ_1, status: PROJECT_STATUS.ACTIVE, createdAt: 1000 }
        ];
        const pointers = resolveRestoredPointers(projects, {
            defaultProjectId: 'PRJ-DANGLING-GHOST',
            activeProjectId: 'PRJ-ANOTHER-GHOST'
        });
        // PRJ_1 has smaller createdAt (1000 < 2000), so it is chosen deterministically
        expect(pointers.defaultProjectId).toBe(PRJ_1);
        expect(pointers.activeProjectId).toBe(PRJ_1);
    });

    test('manifest pointer identifying a CLOSED project falls back to a restored active project', () => {
        const projects = [
            { id: PRJ_1, status: PROJECT_STATUS.ACTIVE, createdAt: 1000 },
            { id: PRJ_2, status: PROJECT_STATUS.CLOSED, closedAt: 1234, createdAt: 500 }
        ];
        // PRJ_2 is closed, so default/active cannot point to it
        const pointers = resolveRestoredPointers(projects, {
            defaultProjectId: PRJ_2,
            activeProjectId: PRJ_2
        });
        expect(pointers.defaultProjectId).toBe(PRJ_1);
        expect(pointers.activeProjectId).toBe(PRJ_1);
    });

    test('deterministic tie-breaking by id when createdAt timestamps are equal', () => {
        const projects = [
            { id: 'PRJ-B', status: PROJECT_STATUS.ACTIVE, createdAt: 1000 },
            { id: 'PRJ-A', status: PROJECT_STATUS.ACTIVE, createdAt: 1000 }
        ];
        const pointers = resolveRestoredPointers(projects, {});
        expect(pointers.defaultProjectId).toBe('PRJ-A');
        expect(pointers.activeProjectId).toBe('PRJ-A');
    });
});

describe('F1.9 S2 Project Restore — (3) Snapshot Restore & Exact IDs Round-Trip', () => {
    let idb;
    const DB_NAME = 'test-db-project-restore-roundtrip';

    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        idb = new IndexedDBService(DB_NAME);
        await idb.init();
        await idb.clear('projects');
        await idb.clear('projectPayrollConfigs');
    });

    afterEach(async () => {
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('round-trip proves two projects, statuses, payroll configs, and pointers are restored as authoritative snapshot', async () => {
        // Pre-populate DB with an old project that should be replaced (not merged)
        await idb.batchUpdate('projects', [{ id: 'PRJ-OLD-TO-BE-WIPED', name: 'Antigua', status: PROJECT_STATUS.ACTIVE }]);
        await idb.batchUpdate('projectPayrollConfigs', [{ projectId: 'PRJ-OLD-TO-BE-WIPED', regularHoursPerDay: 8 }]);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-OLD-TO-BE-WIPED');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-OLD-TO-BE-WIPED');

        const backup = makeValidProjectBackup();
        const plan = planProjectRestore(backup);
        expect(plan).toBeTruthy();
        expect(plan.projects).toHaveLength(2);
        expect(plan.projectPayrollConfigs).toHaveLength(1);
        expect(plan.defaultProjectId).toBe(PRJ_1);
        expect(plan.activeProjectId).toBe(PRJ_1);

        // Apply project restore
        await applyProjectRestore(plan, { idb, storage: localStorage });

        // Verify authoritative replacement in projects store (snapshot restore, not merge)
        const storedProjects = await idb.getAll('projects');
        expect(storedProjects).toHaveLength(2);
        const ids = storedProjects.map(p => p.id).sort();
        expect(ids).toEqual([PRJ_1, PRJ_2]);
        expect(storedProjects.find(p => p.id === 'PRJ-OLD-TO-BE-WIPED')).toBeUndefined();

        // Exact IDs and statuses preserved (no ID remapping, no adoption)
        const p1 = storedProjects.find(p => p.id === PRJ_1);
        expect(p1.name).toBe('Obra Alfa');
        expect(p1.status).toBe(PROJECT_STATUS.ACTIVE);
        const p2 = storedProjects.find(p => p.id === PRJ_2);
        expect(p2.name).toBe('Obra Beta');
        expect(p2.status).toBe(PROJECT_STATUS.CLOSED);

        // Verify projectPayrollConfigs store
        const storedConfigs = await idb.getAll('projectPayrollConfigs');
        expect(storedConfigs).toHaveLength(1);
        expect(storedConfigs[0].projectId).toBe(PRJ_1);
        expect(storedConfigs[0].regularHoursPerDay).toBe(9);

        // Verify pointers
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(PRJ_1);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(PRJ_1);

        // Verify entity scope was updated
        const scope = peekEntityScope();
        expect(scope.enabled).toBe(true);
        expect(scope.projectId).toBe(PRJ_1);
        expect(scope.defaultProjectId).toBe(PRJ_1);
    });

    test('structural validation rejects malformed project id or duplicate ids fail-closed', () => {
        const backup = makeValidProjectBackup();
        backup.data.projects[0].id = 'legacy-unresolved:123'; // invalid sentinel
        expect(() => planProjectRestore(backup)).toThrow(/Invalid project id/);

        const dupBackup = makeValidProjectBackup();
        dupBackup.data.projects[1].id = PRJ_1; // duplicate ID
        expect(() => planProjectRestore(dupBackup)).toThrow(/Duplicate project id/);
    });

    test('rejects projectPayrollConfigs whose projectId is not in restored projects (orphan config fails closed)', () => {
        const backup = makeValidProjectBackup();
        backup.data.projectPayrollConfigs.push({
            projectId: 'PRJ-NONEXISTENT-GHOST',
            regularHoursPerDay: 8
        });
        expect(() => planProjectRestore(backup)).toThrow(/Orphan projectPayrollConfig at index 1: project "PRJ-NONEXISTENT-GHOST" not in restored projects/);
    });

    test('rejects duplicate projectPayrollConfigs for the same project fail-closed', () => {
        const backup = makeValidProjectBackup();
        backup.data.projectPayrollConfigs.push({
            projectId: PRJ_1,
            regularHoursPerDay: 10
        });
        expect(() => planProjectRestore(backup)).toThrow(/Duplicate projectPayrollConfig for projectId "PRJ-OBRA-000001" at index 1/);
    });

    test('rejects non-object projectPayrollConfig fail-closed', () => {
        const backup = makeValidProjectBackup();
        backup.data.projectPayrollConfigs = [null];
        expect(() => planProjectRestore(backup)).toThrow(/Invalid projectPayrollConfig at index 0: expected an object/);
    });
});

describe('F1.9 S2 Project Restore — (4) Atomicity & Fault-Injection Rollback', () => {
    let idb;
    const DB_NAME = 'test-db-project-restore-atomicity';

    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        resetEntityScope();
        idb = new IndexedDBService(DB_NAME);
        await idb.init();
        await idb.clear('projects');
        await idb.clear('projectPayrollConfigs');
    });

    afterEach(async () => {
        localStorage.clear();
        setProjectsEnabled(false);
        resetEntityScope();
    });

    test('fault injection during project save rolls back core state, projects, configs, and pointers (no mixed partial state)', async () => {
        // 1. Establish initial stable state
        const initialProjects = [{ id: 'PRJ-ORIGINAL', name: 'Original', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-ORIGINAL', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-ORIGINAL');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-ORIGINAL');

        const initialCore = {
            settings: { companyName: 'Initial Co' },
            positions: [{ id: 'POS-INIT' }],
            employees: [{ id: 'EMP-INIT', name: 'Original Employee' }],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        // Snapshot before mutation
        const snapshot = await captureRestoreRollbackSnapshot(initialCore, { idb, storage: localStorage });
        expect(snapshot.projects).toHaveLength(1);
        expect(snapshot.projects[0].id).toBe('PRJ-ORIGINAL');
        expect(snapshot.defaultProjectId).toBe('PRJ-ORIGINAL');

        // 2. Prepare incoming restore plan
        const backup = makeValidProjectBackup();
        const plan = planProjectRestore(backup);

        // 3. Inject failure during project restore
        let errorCaught = false;
        try {
            await applyProjectRestore(plan, {
                idb,
                storage: localStorage,
                _faultInjection: 'during_project_save'
            });
        } catch (err) {
            errorCaught = true;
            expect(err.message).toMatch(/during_project_save/);
            // Execute rollback
            await executeRestoreRollback(snapshot, initialCore, { idb, storage: localStorage });
        }
        expect(errorCaught).toBe(true);

        // 4. Verify complete rollback: no partial result
        const restoredProjects = await idb.getAll('projects');
        expect(restoredProjects).toHaveLength(1);
        expect(restoredProjects[0].id).toBe('PRJ-ORIGINAL');

        const restoredConfigs = await idb.getAll('projectPayrollConfigs');
        expect(restoredConfigs).toHaveLength(1);
        expect(restoredConfigs[0].projectId).toBe('PRJ-ORIGINAL');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
        expect(initialCore.employees[0].name).toBe('Original Employee');
    });

    test('fault injection during config save rolls back projects and configs', async () => {
        const initialProjects = [{ id: 'PRJ-ORIGINAL', name: 'Original', status: PROJECT_STATUS.ACTIVE }];
        await idb.batchUpdate('projects', initialProjects);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-ORIGINAL');

        const initialCore = { settings: { companyName: 'Initial Co' }, employees: [] };
        const snapshot = await captureRestoreRollbackSnapshot(initialCore, { idb, storage: localStorage });

        const backup = makeValidProjectBackup();
        const plan = planProjectRestore(backup);

        let errorCaught = false;
        try {
            await applyProjectRestore(plan, {
                idb,
                storage: localStorage,
                _faultInjection: 'during_config_save'
            });
        } catch (err) {
            errorCaught = true;
            await executeRestoreRollback(snapshot, initialCore, { idb, storage: localStorage });
        }
        expect(errorCaught).toBe(true);

        const restoredProjects = await idb.getAll('projects');
        expect(restoredProjects).toHaveLength(1);
        expect(restoredProjects[0].id).toBe('PRJ-ORIGINAL');
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
    });

    test('snapshot read failure proves ZERO writes and fails closed', async () => {
        const initialProjects = [{ id: 'PRJ-STABLE', name: 'Stable', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-STABLE', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-STABLE');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-STABLE');

        const initialCore = { settings: { companyName: 'Stable Co' }, employees: [] };

        // 1. Failing IDB projects read
        const failingIdbProjects = {
            getAll: jest.fn().mockImplementation((store) => {
                if (store === 'projects') throw new Error('IDB projects read failed (lock error)');
                return [];
            }),
            clear: jest.fn(),
            batchUpdate: jest.fn()
        };

        await expect(captureRestoreRollbackSnapshot(initialCore, { idb: failingIdbProjects, storage: localStorage }))
            .rejects.toThrow(/IDB projects read failed/);

        // Verify zero writes attempted on failing IDB
        expect(failingIdbProjects.clear).not.toHaveBeenCalled();
        expect(failingIdbProjects.batchUpdate).not.toHaveBeenCalled();

        // Verify real store and pointers were completely untouched
        const currentProjects = await idb.getAll('projects');
        expect(currentProjects).toEqual(initialProjects);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-STABLE');

        // 2. Failing IDB configs read
        const failingIdbConfigs = {
            getAll: jest.fn().mockImplementation((store) => {
                if (store === 'projectPayrollConfigs') throw new Error('IDB configs read failed (I/O error)');
                return initialProjects;
            }),
            clear: jest.fn(),
            batchUpdate: jest.fn()
        };

        await expect(captureRestoreRollbackSnapshot(initialCore, { idb: failingIdbConfigs, storage: localStorage }))
            .rejects.toThrow(/IDB configs read failed/);

        // 3. Failing storage read (e.g. security error)
        const failingStorage = {
            getItem: jest.fn().mockImplementation(() => {
                throw new Error('SecurityError: localStorage restricted');
            }),
            setItem: jest.fn(),
            removeItem: jest.fn()
        };

        await expect(captureRestoreRollbackSnapshot(initialCore, { idb, storage: failingStorage }))
            .rejects.toThrow(/SecurityError/);
        expect(failingStorage.setItem).not.toHaveBeenCalled();
        expect(failingStorage.removeItem).not.toHaveBeenCalled();
    });

    test('failure AFTER projects clear (destructive write) proves projects, configs, pointers, and core are completely restored', async () => {
        const initialProjects = [{ id: 'PRJ-ORIGINAL', name: 'Original', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-ORIGINAL', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-ORIGINAL');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-ORIGINAL');

        const initialCore = {
            settings: { companyName: 'Initial Co' },
            employees: [{ id: 'EMP-INIT', name: 'Original Employee' }],
            positions: [],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        const snapshot = await captureRestoreRollbackSnapshot(initialCore, { idb, storage: localStorage });

        const backup = makeValidProjectBackup();
        const plan = planProjectRestore(backup);

        let caught = false;
        try {
            await applyProjectRestore(plan, {
                idb,
                storage: localStorage,
                _faultInjection: 'after_projects_clear'
            });
        } catch (err) {
            caught = true;
            expect(err.message).toMatch(/after_projects_clear/);

            // Right after after_projects_clear, the 'projects' table was cleared in IDB
            const wipedProjects = await idb.getAll('projects');
            expect(wipedProjects).toHaveLength(0);

            // Now execute rollback
            await executeRestoreRollback(snapshot, initialCore, { idb, storage: localStorage, saveCore: async () => true });
        }
        expect(caught).toBe(true);

        // Verify all stores, pointers, and in-memory core are fully restored
        const restoredProjects = await idb.getAll('projects');
        expect(restoredProjects).toHaveLength(1);
        expect(restoredProjects[0].id).toBe('PRJ-ORIGINAL');

        const restoredConfigs = await idb.getAll('projectPayrollConfigs');
        expect(restoredConfigs).toHaveLength(1);
        expect(restoredConfigs[0].projectId).toBe('PRJ-ORIGINAL');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
        expect(initialCore.employees[0].name).toBe('Original Employee');
    });

    test('pointer storage failure after project and config writes throws and rolls back to coherent state', async () => {
        const initialProjects = [{ id: 'PRJ-ORIGINAL', name: 'Original', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-ORIGINAL', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-ORIGINAL');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-ORIGINAL');
        replaceEntityScope({
            enabled: true,
            projectId: 'PRJ-ORIGINAL',
            defaultProjectId: 'PRJ-ORIGINAL'
        });

        const initialCore = {
            settings: { companyName: 'Initial Co' },
            employees: [{ id: 'EMP-INIT' }],
            positions: [],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        const snapshot = await captureRestoreRollbackSnapshot(initialCore, { idb, storage: localStorage });

        const backup = makeValidProjectBackup();
        const plan = planProjectRestore(backup);

        // Failing storage proxy that throws on setItem
        const failingStorage = {
            getItem: (key) => localStorage.getItem(key),
            setItem: jest.fn().mockImplementation(() => {
                throw new Error('QuotaExceededError: LocalStorage full');
            }),
            removeItem: (key) => localStorage.removeItem(key)
        };

        let caught = false;
        try {
            await applyProjectRestore(plan, { idb, storage: failingStorage });
        } catch (err) {
            caught = true;
            expect(err.message).toMatch(/QuotaExceededError/);

            // EntityProjectScope must NOT have been updated to new active project
            const scope = peekEntityScope();
            expect(scope.projectId).not.toBe(plan.activeProjectId);

            // Roll back with real storage
            await executeRestoreRollback(snapshot, initialCore, { idb, storage: localStorage, saveCore: async () => true });
        }
        expect(caught).toBe(true);

        // Verify all stores rolled back to PRJ-ORIGINAL
        const restoredProjects = await idb.getAll('projects');
        expect(restoredProjects).toHaveLength(1);
        expect(restoredProjects[0].id).toBe('PRJ-ORIGINAL');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-ORIGINAL');
    });

    test('saveCore returning non-true or throwing during rollback causes rollback failure to propagate', async () => {
        const initialCore = { settings: {}, employees: [] };
        const snapshot = await captureRestoreRollbackSnapshot(initialCore, { idb, storage: localStorage });

        // Case 1: saveCore returns false
        await expect(executeRestoreRollback(snapshot, initialCore, {
            idb,
            storage: localStorage,
            saveCore: async () => false
        })).rejects.toThrow(/Restore rollback failed.*saveCore returned non-true: false/);

        // Case 2: saveCore returns undefined
        await expect(executeRestoreRollback(snapshot, initialCore, {
            idb,
            storage: localStorage,
            saveCore: async () => undefined
        })).rejects.toThrow(/Restore rollback failed.*saveCore returned non-true: undefined/);

        // Case 3: saveCore throws
        await expect(executeRestoreRollback(snapshot, initialCore, {
            idb,
            storage: localStorage,
            saveCore: async () => { throw new Error('IndexedDB disk crash'); }
        })).rejects.toThrow(/Restore rollback failed.*saveCore threw: IndexedDB disk crash/);
    });
});

describe('F1.9 S2 Project Restore — (5) Zero Mutation Before Confirmation', () => {
    let idb;
    const DB_NAME = 'test-db-project-restore-zero-mutation';

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        setProjectsEnabled(true);
        idb = new IndexedDBService(DB_NAME);
        await idb.init();
        await idb.clear('projects');
        await idb.clear('projectPayrollConfigs');
    });

    afterEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('RestoreUI preflight modal review causes zero writes to IDB or localStorage before confirmation', async () => {
        const initialProjects = [{ id: 'PRJ-PRE', name: 'Pre Project', status: PROJECT_STATUS.ACTIVE }];
        await idb.batchUpdate('projects', initialProjects);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-PRE');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-PRE');

        const backup = makeValidProjectBackup();
        const { RestoreUI } = await import('actual/ui/RestoreUI.js');
        const { diagnoseProjectBackup } = await import('actual/services/ProjectBackupManifest.js');

        const diag = diagnoseProjectBackup(backup, {
            localProjects: initialProjects,
            defaultProjectId: 'PRJ-PRE',
            activeProjectId: 'PRJ-PRE'
        });

        // Show modal (receive / review stage)
        RestoreUI.showComparisonModal(backup, { settings: {}, employees: [] }, {}, { projectDiagnostics: diag });

        // Verify modal opened
        const modal = document.getElementById('restore-comparison-modal');
        expect(modal).toBeTruthy();

        // Verify diagnostics rendered with clear indication of restore after confirmation
        const diagBox = document.getElementById('project-backup-diagnostics');
        expect(diagBox).toBeTruthy();
        expect(diagBox.textContent).toMatch(/restaurará/i);

        // Zero writes occurred during review
        const storedProjects = await idb.getAll('projects');
        expect(storedProjects).toEqual(initialProjects);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-PRE');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-PRE');

        // User cancels via Cancel button
        const cancelBtn = modal.querySelector('.btn-cancel');
        expect(cancelBtn).toBeTruthy();
        cancelBtn.click();

        // Modal closed, still zero writes
        expect(document.getElementById('restore-comparison-modal')).toBeNull();
        const finalProjects = await idb.getAll('projects');
        expect(finalProjects).toEqual(initialProjects);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-PRE');
    });

    test('closing modal via Escape key also performs zero writes', async () => {
        const backup = makeValidProjectBackup();
        const { RestoreUI } = await import('actual/ui/RestoreUI.js');
        RestoreUI.showComparisonModal(backup, { settings: {}, employees: [] }, {});

        const modal = document.getElementById('restore-comparison-modal');
        expect(modal).toBeTruthy();

        // Press Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('restore-comparison-modal')).toBeNull();

        const storedProjects = await idb.getAll('projects');
        expect(storedProjects).toHaveLength(0);
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBeNull();
    });
});

describe('F1.9 S2 Project Restore — (6) Canonical applyBackupData & loadBackupFromFile Integration', () => {
    let idb;
    const DB_NAME = 'test-db-integrated-apply-backup';

    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        idb = new IndexedDBService(DB_NAME);
        await idb.init();
        await idb.clear('projects');
        await idb.clear('projectPayrollConfigs');
    });

    afterEach(async () => {
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('injected targetState success leaves the production global state untouched', async () => {
        const globalBefore = JSON.stringify(toRaw(globalAppState));
        const isolatedState = {
            settings: { companyName: 'Isolated Before' },
            positions: [],
            employees: [{ id: 'EMP-ISOLATED', name: 'Before' }],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };
        const saveCore = jest.fn(async () => true);

        const result = await applyBackupData(makeValidProjectBackup(), {
            state: isolatedState,
            idb,
            storage: localStorage,
            saveCore
        });

        expect(result).toBe(true);
        expect(isolatedState.settings.companyName).toBe('Constructora Alfa');
        expect(isolatedState.employees).toHaveLength(2);
        expect(JSON.stringify(toRaw(globalAppState))).toBe(globalBefore);
        expect(saveCore).toHaveBeenCalledTimes(1);
    });

    test('injected targetState failure rolls back once without touching the production global state', async () => {
        const globalBefore = JSON.stringify(toRaw(globalAppState));
        const isolatedState = {
            settings: { companyName: 'Isolated Original' },
            positions: [{ id: 'POS-ORIGINAL' }],
            employees: [{ id: 'EMP-ORIGINAL', name: 'Original Worker' }],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };
        const isolatedBefore = structuredClone(isolatedState);
        const saveCore = jest.fn(async () => true);

        const result = await applyBackupData(makeValidProjectBackup(), {
            state: isolatedState,
            idb,
            storage: localStorage,
            saveCore,
            _faultInjection: 'after_core_save'
        });

        expect(result).toBe(false);
        expect(isolatedState).toEqual(isolatedBefore);
        expect(JSON.stringify(toRaw(globalAppState))).toBe(globalBefore);
        // One attempted core save + exactly one rollback save. The old dual rollback made this 3.
        expect(saveCore).toHaveBeenCalledTimes(2);
    });

    test('failure after core save or after destructive project write triggers canonical rollback', async () => {
        const initialProjects = [{ id: 'PRJ-EXISTING', name: 'Existing Co', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-EXISTING', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-EXISTING');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-EXISTING');

        const initialCore = {
            settings: { companyName: 'Original Co' },
            positions: [],
            employees: [{ id: 'EMP-ORIGINAL', name: 'Original Worker' }],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        const backup = makeValidProjectBackup();

        // 1. Failure after core save
        const resultAfterCore = await applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async () => true,
            _faultInjection: 'after_core_save'
        });

        expect(resultAfterCore).toBe(false);

        // Pre-existing database, pointers, and memory state are rolled back
        let currentProjects = await idb.getAll('projects');
        expect(currentProjects).toHaveLength(1);
        expect(currentProjects[0].id).toBe('PRJ-EXISTING');

        let currentConfigs = await idb.getAll('projectPayrollConfigs');
        expect(currentConfigs).toHaveLength(1);
        expect(currentConfigs[0].projectId).toBe('PRJ-EXISTING');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
        expect(initialCore.employees[0].name).toBe('Original Worker');

        // 2. Failure after destructive project write (after_projects_clear)
        const resultAfterClear = await applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async () => true,
            _faultInjection: 'after_projects_clear'
        });

        expect(resultAfterClear).toBe(false);

        // Rolled back from snapshot even after idb.clear('projects') executed
        currentProjects = await idb.getAll('projects');
        expect(currentProjects).toHaveLength(1);
        expect(currentProjects[0].id).toBe('PRJ-EXISTING');

        currentConfigs = await idb.getAll('projectPayrollConfigs');
        expect(currentConfigs).toHaveLength(1);
        expect(currentConfigs[0].projectId).toBe('PRJ-EXISTING');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
    });

    test('on failure loadBackupFromFile must not call onSuccess or reload and dispatches onError', async () => {
        const onSuccess = jest.fn();
        const onError = jest.fn();

        const originalLocation = window.location;
        delete window.location;
        window.location = { reload: jest.fn() };

        let modalCallbacks = null;
        const showModalSpy = jest.spyOn(RestoreUI, 'showComparisonModal').mockImplementation(
            (_data, _state, callbacks) => {
                modalCallbacks = callbacks;
            }
        );

        try {
            // Backup with orphan payroll config fails canonical restore fail-closed
            const failingBackup = {
                version: '1.0.0',
                companyName: 'Failing Co',
                data: {
                    settings: { companyName: 'Failing Co' },
                    projects: [
                        { id: PRJ_1, name: 'Obra Alfa', status: PROJECT_STATUS.ACTIVE, createdAt: 1000 }
                    ],
                    projectPayrollConfigs: [
                        { projectId: 'PRJ-ORPHAN-NONEXISTENT', regularHoursPerDay: 8 }
                    ],
                    projectBackup: {
                        version: 1,
                        projectsEnabled: true,
                        defaultProjectId: PRJ_1,
                        activeProjectId: PRJ_1,
                        projectIds: [PRJ_1]
                    }
                }
            };
            const file = new File([JSON.stringify(failingBackup)], 'backup.json', { type: 'application/json' });

            loadBackupFromFile(file, { onSuccess, onError });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(showModalSpy).toHaveBeenCalled();
            expect(modalCallbacks).toBeTruthy();

            // User confirms local restore; real applyBackupData runs and fails due to orphan config
            await modalCallbacks.onLocalRestore();

            expect(onSuccess).not.toHaveBeenCalled();
            expect(window.location.reload).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalled();
            expect(onError.mock.calls[0][0].message).toMatch(/Error al aplicar backup local/);
        } finally {
            showModalSpy.mockRestore();
            window.location = originalLocation;
        }
    });

    test('pointer write failure in canonical applyBackupData triggers complete rollback', async () => {
        const initialProjects = [{ id: 'PRJ-EXISTING', name: 'Existing Co', status: PROJECT_STATUS.ACTIVE }];
        const initialConfigs = [{ projectId: 'PRJ-EXISTING', regularHoursPerDay: 8 }];
        await idb.batchUpdate('projects', initialProjects);
        await idb.batchUpdate('projectPayrollConfigs', initialConfigs);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-EXISTING');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-EXISTING');

        const initialCore = {
            settings: { companyName: 'Original Co' },
            positions: [],
            employees: [{ id: 'EMP-ORIGINAL', name: 'Original Worker' }],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        const backup = makeValidProjectBackup();

        const result = await applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async () => true,
            _faultInjection: 'during_pointer_save'
        });

        expect(result).toBe(false);

        const currentProjects = await idb.getAll('projects');
        expect(currentProjects).toHaveLength(1);
        expect(currentProjects[0].id).toBe('PRJ-EXISTING');

        const currentConfigs = await idb.getAll('projectPayrollConfigs');
        expect(currentConfigs).toHaveLength(1);
        expect(currentConfigs[0].projectId).toBe('PRJ-EXISTING');

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-EXISTING');
    });

    test('rollback failure in canonical applyBackupData propagates critical failure', async () => {
        const initialCore = { settings: {}, employees: [] };
        const backup = makeValidProjectBackup();

        // When throwOnError is true and rollback fails, composite error is thrown
        await expect(applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async (opts) => {
                if (opts?.clearFirst) return false;
                return true;
            },
            _faultInjection: 'after_core_save',
            throwOnError: true
        })).rejects.toThrow(/applyBackupData failed.*Rollback failed/);

        // When throwOnError is false, returns false gracefully
        const res = await applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async (opts) => {
                if (opts?.clearFirst) return false;
                return true;
            },
            _faultInjection: 'after_core_save',
            throwOnError: false
        });
        expect(res).toBe(false);
    });

    test('canonical applyBackupData success restores two projects, config, and pointers', async () => {
        const initialCore = {
            settings: { companyName: 'Old Co' },
            employees: [],
            positions: [],
            leaders: [],
            attendance: {},
            tempAssignments: [],
            dayHoursConfig: {}
        };

        const backup = makeValidProjectBackup();
        backup.data.projectPayrollConfigs.push({
            projectId: PRJ_2,
            regularHoursPerDay: 8,
            overtimeFactor: 1.5
        });

        const result = await applyBackupData(backup, {
            state: initialCore,
            idb,
            storage: localStorage,
            saveCore: async () => true
        });

        expect(result).toBe(true);

        const currentProjects = await idb.getAll('projects');
        expect(currentProjects).toHaveLength(2);
        expect(currentProjects[0].id).toBe(PRJ_1);
        expect(currentProjects[1].id).toBe(PRJ_2);

        const currentConfigs = await idb.getAll('projectPayrollConfigs');
        expect(currentConfigs).toHaveLength(2);

        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe(PRJ_1);
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe(PRJ_1);
        expect(initialCore.settings.companyName).toBe('Constructora Alfa');
        expect(initialCore.employees).toHaveLength(2);
    });
});

describe('F1.9 S2 Project Restore — (7) P2P Staged Backup Preservation on Failed Restore', () => {
    beforeEach(() => {
        setProjectsEnabled(true);
    });

    afterEach(() => {
        setProjectsEnabled(false);
    });

    test('staged P2P backup remains in staging until real canonical restore succeeds', async () => {
        const {
            stageBackup,
            getStagedBackup,
            removeStagedBackup,
            reviewAndRestoreSaBackup,
            BACKUP_KIND,
            SA_BACKUP_SCHEMA
        } = await import('actual/features/p2p/P2PBackupBridge.js');

        const transferId = 'xfer-test-failure-retention';

        // 1. Failing backup payload with orphan payroll config
        const failingPayload = {
            version: '1.0.0',
            companyName: 'Failing P2P Co',
            data: {
                settings: { companyName: 'Failing P2P Co' },
                projects: [
                    { id: PRJ_1, name: 'Obra Alfa', status: PROJECT_STATUS.ACTIVE, createdAt: 1000 }
                ],
                projectPayrollConfigs: [
                    { projectId: 'PRJ-ORPHAN-P2P', regularHoursPerDay: 8 }
                ],
                projectBackup: {
                    version: 1,
                    projectsEnabled: true,
                    defaultProjectId: PRJ_1,
                    activeProjectId: PRJ_1,
                    projectIds: [PRJ_1]
                }
            }
        };
        const failingBytes = new TextEncoder().encode(JSON.stringify(failingPayload));

        stageBackup({
            transferId,
            sha256: 'a'.repeat(64),
            kind: BACKUP_KIND,
            schema: SA_BACKUP_SCHEMA,
            size: failingBytes.byteLength,
            bytes: failingBytes,
            sourceApp: 'sa',
            peerName: 'SA Remoto'
        });

        expect(getStagedBackup(transferId)).toBeTruthy();

        const originalLocation = window.location;
        delete window.location;
        window.location = { reload: jest.fn() };

        let modalCallbacks = null;
        const showModalSpy = jest.spyOn(RestoreUI, 'showComparisonModal').mockImplementation(
            (_data, _state, callbacks) => {
                modalCallbacks = callbacks;
            }
        );

        try {
            // Attempt restore with failing backup
            const res = await reviewAndRestoreSaBackup(transferId, { nonblocking: true });
            expect(res.opened).toBe(true);

            // Wait for FileReader in loadBackupFromFile
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(showModalSpy).toHaveBeenCalled();
            expect(modalCallbacks).toBeTruthy();

            // Trigger onLocalRestore — canonical applyBackupData fails due to orphan config
            await modalCallbacks.onLocalRestore();

            // The staged backup MUST REMAIN in staging because restore failed!
            const stagedAfterFailure = getStagedBackup(transferId);
            expect(stagedAfterFailure).toBeTruthy();
            expect(stagedAfterFailure.transferId).toBe(transferId);

            // 2. Peer delivers corrected valid backup
            removeStagedBackup(transferId);
            const validPayload = makeValidProjectBackup();
            const validBytes = new TextEncoder().encode(JSON.stringify(validPayload));
            stageBackup({
                transferId,
                sha256: 'b'.repeat(64),
                kind: BACKUP_KIND,
                schema: SA_BACKUP_SCHEMA,
                size: validBytes.byteLength,
                bytes: validBytes,
                sourceApp: 'sa',
                peerName: 'SA Remoto'
            });

            // Trigger retry via reviewAndRestoreSaBackup
            const retryRes = await reviewAndRestoreSaBackup(transferId, { nonblocking: true });
            expect(retryRes.opened).toBe(true);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Execute canonical restore which now succeeds
            await modalCallbacks.onLocalRestore();

            // Staged backup is now removed upon successful canonical restore!
            expect(getStagedBackup(transferId)).toBeNull();
        } finally {
            showModalSpy.mockRestore();
            window.location = originalLocation;
            removeStagedBackup(transferId);
        }
    });
});
