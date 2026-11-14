/**
 * Independent closure challenge for #296-#301.
 * New adversarial interleavings; exercises production services + real IndexedDB.
 * Synthetic fixtures only. This does NOT claim production OAuth or deployed rules.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { auth } from '../../../../js/modules/data/firebase.js';
import { setProjectsEnabled } from '../../../../js/modules/config/FeatureFlags.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../../../../js/modules/features/projects/ProjectCatalogSync.js';
import { createDefaultConfig } from '../../../../js/modules/features/payroll/ProjectPayrollConfig.js';
import { putConfig, getConfig } from '../../../../js/modules/features/payroll/ProjectPayrollConfigStore.js';
import {
    setActivePayrollConfig, getActivePayrollSettings, updateActiveDayHours,
    refreshActivePayrollSettings, resetActivePayrollSettingsForTests
} from '../../../../js/modules/features/payroll/ActivePayrollSettings.js';
import {
    projectContext, ProjectContextService, getEntityScope, ACTIVE_PROJECT_LS_KEY
} from '../../../../js/modules/features/projects/ProjectContext.js';
import {
    replaceEntityScope, resetEntityScope, peekEntityScope, getScopedEmployees
} from '../../../../js/modules/features/projects/EntityProjectScope.js';
import {
    markDetachedRestore, getDetachedRestore, clearDetachedRestore,
    isDetachedRestoreSyncBlocked, DETACHED_RESTORE_LS_KEY
} from '../../../../js/modules/services/DetachedRestoreGuard.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
const project = (id, name = id, updatedAt = 1) =>
    ({ id, name, createdAt: 1, updatedAt, status: 'active', schemaVersion: 1 });
const config = (id, hours, updatedAt = 1, extra = {}) =>
    ({ ...createDefaultConfig(id), regularHoursPerDay: hours, updatedAt, ...extra });
const snapshot = rows => ({ forEach: callback => rows.forEach(row =>
    callback({ id: row.id, data: () => row })) });
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};
const read = records => async () => snapshot(records);
const noWrite = async () => {};

describe('Independent closure challenge: Multiobra R1-R6', () => {
    let idb, originalStore, originalDefaults;
    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        resetEntityScope();
        resetActivePayrollSettingsForTests();
        clearDetachedRestore();
        stopProjectCatalogLiveSync();
        auth.currentUser = { uid: 'TEST-A' };
        originalStore = projectContext.store;
        originalDefaults = projectContext.defaults;
        idb = new IndexedDBService('sa-independent-closure-' + Math.random());
        await idb.init();
    });
    afterEach(() => {
        stopProjectCatalogLiveSync();
        projectContext.store = originalStore;
        projectContext.defaults = originalDefaults;
        auth.currentUser = null;
        resetEntityScope();
        resetActivePayrollSettingsForTests();
        clearDetachedRestore();
        localStorage.clear();
        idb.db?.close();
        jest.restoreAllMocks();
    });

    test('R1: A->B->A must not allow the first A session to leak data into the new A session', async () => {
        const oldReached = deferred(), oldRelease = deferred();
        const oldA = syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: noWrite,
            readDocs: async () => {
                oldReached.resolve();
                await oldRelease.promise;
                return snapshot([project('STALE-A')]);
            }
        });
        await oldReached.promise;
        stopProjectCatalogLiveSync();
        auth.currentUser = { uid: 'TEST-B' };
        await syncProjectCatalog({
            uid: 'TEST-B', idb, writeDoc: noWrite,
            readDocs: read([project('B-ONLY')])
        });
        stopProjectCatalogLiveSync();
        auth.currentUser = { uid: 'TEST-A' };
        await syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: noWrite,
            readDocs: read([project('FRESH-A')])
        });
        oldRelease.resolve();
        await oldA;
        expect(await idb.get('projects', 'STALE-A')).toBeFalsy();
        expect(await idb.get('projects', 'FRESH-A')).toMatchObject({ id: 'FRESH-A' });
    });

    test('R1: disabling projects while a remote read is in flight must suppress all side effects', async () => {
        const reached = deferred(), release = deferred(), writes = jest.fn();
        const pending = syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: writes,
            readDocs: async () => {
                reached.resolve(); await release.promise;
                return snapshot([project('SHOULD-NOT-APPEAR')]);
            }
        });
        await reached.promise;
        setProjectsEnabled(false);
        release.resolve();
        await pending;
        expect(await idb.get('projects', 'SHOULD-NOT-APPEAR')).toBeFalsy();
        expect(writes).not.toHaveBeenCalled();
        setProjectsEnabled(true);
    });

    test('R2: a delayed cloud response must preserve a whole newer multi-field local payroll edit', async () => {
        await idb.update('projects', project('O'));
        await idb.update('projectPayrollConfigs', config('O', 8, 1));
        const reached = deferred(), release = deferred();
        const pending = syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: noWrite,
            readDocs: async () => {
                reached.resolve(); await release.promise;
                return snapshot([{ ...project('O'), payrollConfig: config('O', 9, 50,
                    { holidays: ['2026-11-01'], payPeriod: 21 }) }]);
            }
        });
        await reached.promise;
        await idb.update('projectPayrollConfigs', config('O', 10, 100,
            { holidays: ['2026-11-02'], payPeriod: 7, dayHours: { '2026-11-03': 9 } }));
        release.resolve();
        await pending;
        const saved = await idb.get('projectPayrollConfigs', 'O');
        expect(saved).toMatchObject({
            regularHoursPerDay: 10, holidays: ['2026-11-02'], payPeriod: 7,
            dayHours: { '2026-11-03': 9 }, updatedAt: 100
        });
    });

    test('R2: newer remote project identity must not roll back independent newer local payroll config', async () => {
        await idb.update('projects', project('O', 'Locally named', 1));
        await idb.update('projectPayrollConfigs', config('O', 10, 200,
            { holidays: ['2026-11-02'] }));
        await syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: noWrite,
            readDocs: read([{ ...project('O', 'Remote renamed', 150),
                payrollConfig: config('O', 7, 100, { holidays: [] }) }])
        });
        expect(await idb.get('projects', 'O')).toMatchObject({ name: 'Remote renamed' });
        expect(await idb.get('projectPayrollConfigs', 'O')).toMatchObject({
            regularHoursPerDay: 10, holidays: ['2026-11-02']
        });
    });

    test('R3: a restore marker created AFTER the cloud request starts must stop its commit', async () => {
        await idb.update('projects', project('RESTORED'));
        const reached = deferred(), release = deferred(), writes = jest.fn();
        const pending = syncProjectCatalog({
            uid: 'TEST-A', idb, writeDoc: writes,
            readDocs: async () => {
                reached.resolve(); await release.promise;
                return snapshot([project('CLOUD')]);
            }
        });
        await reached.promise;
        expect(markDetachedRestore({ previousUid: 'TEST-A' })).toBe(true);
        release.resolve();
        await pending;
        expect(await idb.get('projects', 'RESTORED')).toBeTruthy();
        expect(await idb.get('projects', 'CLOUD')).toBeFalsy();
        expect(writes).not.toHaveBeenCalled();
        expect(isDetachedRestoreSyncBlocked()).toBe(true);
    });

    test('R3: corrupt restore marker must fail closed and preserve the existing catalog', async () => {
        await idb.update('projects', project('BACKUP'));
        localStorage.setItem(DETACHED_RESTORE_LS_KEY, '{not valid JSON');
        const reads = jest.fn(read([])), writes = jest.fn();
        expect(getDetachedRestore()).toMatchObject({ unreadable: true });
        await syncProjectCatalog({ uid: 'TEST-A', idb, readDocs: reads, writeDoc: writes });
        expect(reads).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
        expect(await idb.get('projects', 'BACKUP')).toBeTruthy();
    });

    test('R4: an obsolete refresh for the active project cannot overwrite a more recent local setting', async () => {
        const previous = config('O', 8, 10);
        const latest = config('O', 10, 20);
        replaceEntityScope({ enabled: true, projectId: 'O', defaultProjectId: 'O' });
        setActivePayrollConfig(previous, { render: false });
        const reached = deferred(), release = deferred();
        const pending = refreshActivePayrollSettings({
            render: false,
            store: { getConfig: async () => {
                reached.resolve(); await release.promise;
                return previous;
            } }
        });
        await reached.promise;
        setActivePayrollConfig(latest, { render: false });
        release.resolve();
        await pending;
        expect(getActivePayrollSettings({ settings: { regularHoursPerDay: 6 } })
            .regularHoursPerDay).toBe(10);
    });

    test('R4: unrelated project config event while the project switches must not contaminate the active view', () => {
        const a = config('A', 9, 10);
        const b = config('B', 6, 99);
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        setActivePayrollConfig(a, { render: false });
        replaceEntityScope({ enabled: true, projectId: 'B', defaultProjectId: 'A' });
        setActivePayrollConfig(b, { render: false });
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        setActivePayrollConfig(a, { render: false });
        window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: { config: b } }));
        expect(getActivePayrollSettings({ settings: { regularHoursPerDay: 8 } })
            .regularHoursPerDay).toBe(9);
    });

    test('R5: two simultaneous +0.5h gestures on the same day commit +1.0h durably', async () => {
        const date = '2026-11-03';
        const initial = config('O', 8, 1, { dayHours: { [date]: 8 }, seeded: true });
        await idb.update('projectPayrollConfigs', initial);
        replaceEntityScope({ enabled: true, projectId: 'O', defaultProjectId: 'O' });
        setActivePayrollConfig(initial, { render: false });
        const store = {
            getConfig: id => getConfig(id, { idb }),
            putConfig: value => putConfig(value, { idb })
        };
        const [ok1, ok2] = await Promise.all([
            updateActiveDayHours({ [date]: 8.5 }, { store, delta: 0.5 }),
            updateActiveDayHours({ [date]: 8.5 }, { store, delta: 0.5 })
        ]);
        const saved = await getConfig('O', { idb });
        expect([ok1, ok2]).toEqual([true, true]);
        expect(saved.dayHours[date]).toBe(9);
        expect(saved.seeded).not.toBe(true);
        expect(getActivePayrollSettings({ settings: { regularHoursPerDay: 5 } })
            .regularHoursPerDay).toBe(8);
    });

    test('R5: two edits to different days must retain both days and unrelated holidays', async () => {
        const d1 = '2026-11-04', d2 = '2026-11-05';
        const initial = config('O', 8, 1, {
            dayHours: { [d1]: 8, [d2]: 8 }, holidays: ['2026-11-06'], seeded: true
        });
        await idb.update('projectPayrollConfigs', initial);
        replaceEntityScope({ enabled: true, projectId: 'O', defaultProjectId: 'O' });
        setActivePayrollConfig(initial, { render: false });
        const store = {
            getConfig: id => getConfig(id, { idb }),
            putConfig: value => putConfig(value, { idb })
        };
        await Promise.all([
            updateActiveDayHours({ [d1]: 9 }, { store }),
            updateActiveDayHours({ [d2]: 10 }, { store })
        ]);
        const saved = await getConfig('O', { idb });
        expect(saved.dayHours).toMatchObject({ [d1]: 9, [d2]: 10 });
        expect(saved.holidays).toContain('2026-11-06');
        expect(saved.seeded).not.toBe(true);
    });

    test('R6: three out-of-order project selections must leave only the last project active', async () => {
        const a = deferred(), b = deferred();
        const context = new ProjectContextService({
            store: { get: async id => {
                if (id === 'A') await a.promise;
                if (id === 'B') await b.promise;
                return project(id);
            } }
        });
        const pA = context.setActiveProjectId('A');
        const pB = context.setActiveProjectId('B');
        const pC = context.setActiveProjectId('C');
        await pC;
        b.resolve(); await pB;
        a.resolve(); await pA;
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('C');
        expect(peekEntityScope().projectId).toBe('C');
        expect(getScopedEmployees({ employees: [
            { id: 'A1', projectId: 'A' }, { id: 'B1', projectId: 'B' }, { id: 'C1', projectId: 'C' }
        ] }).map(row => row.id)).toEqual(['C1']);
    });

    test('R6: an older pending default resolution cannot reset a later explicit project selection', async () => {
        const reached = deferred(), release = deferred();
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'A');
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        projectContext.store = { get: async id => project(id) };
        projectContext.defaults = { ensureDefaultProject: async () => {
            reached.resolve(); await release.promise;
            return project('A');
        } };
        const previous = getEntityScope();
        await reached.promise;
        await projectContext.setActiveProjectId('C');
        release.resolve();
        await previous;
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('C');
        expect(peekEntityScope().projectId).toBe('C');
    });
});
