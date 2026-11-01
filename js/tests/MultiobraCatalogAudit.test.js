
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { auth } from '../modules/data/firebase.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../modules/features/projects/ProjectCatalogSync.js';
import { markDetachedRestore, isDetachedRestoreSyncBlocked, runDetachedRestoreLoginGate } from '../modules/services/DetachedRestoreGuard.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import * as configStore from '../modules/features/payroll/ProjectPayrollConfigStore.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { setActivePayrollConfig, updateActiveDayHours, resetActivePayrollSettingsForTests } from '../modules/features/payroll/ActivePayrollSettings.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
const obra = (id, updatedAt = 1) => ({ id, name: 'Synthetic ' + id, status: 'active', createdAt: 1, updatedAt, schemaVersion: 1 });
const snapshot = records => ({ forEach: fn => records.forEach(x => fn({ id: x.id, data: () => x })) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cfg = (id, hours, updatedAt) => ({ ...createDefaultConfig(id), regularHoursPerDay: hours, updatedAt });

// Acceptance tests intentionally fail on the audited base. Real production
// service + real IDB repository; only transport/auth and scheduling are injected.
// No sleeps, network requests, user data or implementation fixes.
describe('Multiobra acceptance audit: catalog, sessions and local conflicts', () => {
    let db;
    let gates;
    beforeEach(async () => {
        localStorage.clear();
        resetEntityScope();
        resetActivePayrollSettingsForTests();
        setProjectsEnabled(true);
        auth.currentUser = { uid: 'AUDIT-A' };
        gates = [];
        db = new IndexedDBService('multiobra-audit-' + Math.random());
        await db.init();
    });
    const gate = () => { const d = deferred(); gates.push(d); return d; };
    afterEach(() => {
        gates.forEach(d => d.resolve());
        stopProjectCatalogLiveSync();
        db.db.close();
        localStorage.clear();
        resetEntityScope();
        resetActivePayrollSettingsForTests();
        auth.currentUser = null;
        jest.restoreAllMocks();
    });

    test('CONTROL: same-account remote projects and newer config are received', async () => {
        await db.update('projects', obra('O'));
        await db.update('projectPayrollConfigs', cfg('O', 8, 1));
        const result = await syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: jest.fn(),
            readDocs: async () => snapshot([{ ...obra('O'), payrollConfig: cfg('O', 9, 50) }, obra('NEW')])
        });
        expect(result.received).toBe(1);
        expect(await db.get('projects', 'NEW')).toMatchObject({ id: 'NEW' });
        expect(await db.get('projectPayrollConfigs', 'O')).toMatchObject({ regularHoursPerDay: 9, updatedAt: 50 });
    });

    test('R1: response from A must not modify the dataset after switching to B', async () => {
        const requested = gate(), release = gate();
        const pending = syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => { requested.resolve(); await release.promise; return snapshot([obra('A-ONLY')]); }
        });
        await requested.promise;
        stopProjectCatalogLiveSync();
        auth.currentUser = { uid: 'AUDIT-B' };
        await db.update('projects', obra('B-ONLY'));
        release.resolve();
        await pending;
        expect(await db.get('projects', 'B-ONLY')).toMatchObject({ id: 'B-ONLY' });
        expect(await db.get('projects', 'A-ONLY')).toBeFalsy();
    });

    test('R1: B must perform its own read instead of reusing the in-flight A request', async () => {
        const requested = gate(), release = gate();
        const pendingA = syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => { requested.resolve(); await release.promise; return snapshot([]); }
        });
        await requested.promise;
        stopProjectCatalogLiveSync();
        auth.currentUser = { uid: 'AUDIT-B' };
        const readB = jest.fn(async () => snapshot([obra('B-ONLY')]));
        const pendingB = syncProjectCatalog({ uid: 'AUDIT-B', idb: db, readDocs: readB, writeDoc: async () => {} });
        release.resolve();
        await Promise.all([pendingA, pendingB]);
        expect(readB).toHaveBeenCalledTimes(1);
        expect(await db.get('projects', 'B-ONLY')).toMatchObject({ id: 'B-ONLY' });
    });

    test('R2: remote config must not overwrite a newer edit committed after its local read', async () => {
        await db.update('projects', obra('O'));
        await db.update('projectPayrollConfigs', cfg('O', 8, 1));
        const reached = gate(), release = gate(), realGet = db.get.bind(db);
        db.get = async (store, id) => {
            const record = await realGet(store, id);
            if (store === 'projectPayrollConfigs' && id === 'O') { reached.resolve(); await release.promise; }
            return record;
        };
        const pending = syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => snapshot([{ ...obra('O'), payrollConfig: cfg('O', 9, 50) }])
        });
        // A corrected transactional implementation can finish without invoking
        // the non-atomic get hook; the test then checks a subsequent local edit.
        await Promise.race([reached.promise, pending]);
        await db.update('projectPayrollConfigs', cfg('O', 10, 100));
        release.resolve();
        await pending;
        expect(await realGet('projectPayrollConfigs', 'O')).toMatchObject({ regularHoursPerDay: 10, updatedAt: 100 });
    });

    test('R2: a remote identity snapshot must not undo a newer local project rename', async () => {
        await db.update('projects', { ...obra('O'), name: 'Initial' });
        const reached = gate(), release = gate(), realGetAll = db.getAll.bind(db);
        let first = true;
        db.getAll = async store => {
            const records = await realGetAll(store);
            if (store === 'projects' && first) { first = false; reached.resolve(); await release.promise; }
            return records;
        };
        const pending = syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => snapshot([{ ...obra('O', 50), name: 'Remote old' }])
        });
        await Promise.race([reached.promise, pending]);
        await db.update('projects', { ...obra('O', 100), name: 'Local newest' });
        release.resolve();
        await pending;
        expect(await db.get('projects', 'O')).toMatchObject({ name: 'Local newest', updatedAt: 100 });
    });

    test('R3: detached restore awaiting a choice must not publish the restored catalog', async () => {
        await db.update('projects', obra('RESTORED'));
        markDetachedRestore({ previousUid: 'AUDIT-A' });
        expect(isDetachedRestoreSyncBlocked()).toBe(true);
        const writes = jest.fn();
        await syncProjectCatalog({ uid: 'AUDIT-A', idb: db, readDocs: async () => snapshot([]), writeDoc: writes });
        expect(writes).not.toHaveBeenCalled();
        expect(isDetachedRestoreSyncBlocked()).toBe(true);
    });

    test('CONTROL: explicit upload decision permits catalog publication and clears the marker', async () => {
        await db.update('projects', obra('RESTORED'));
        markDetachedRestore({ previousUid: 'AUDIT-A' });
        const writes = jest.fn(async () => {});
        const result = await runDetachedRestoreLoginGate({
            user: auth.currentUser, ask: async () => 'upload', logout: jest.fn(),
            upload: async () => {
                expect(isDetachedRestoreSyncBlocked()).toBe(false);
                await syncProjectCatalog({ uid: 'AUDIT-A', idb: db, readDocs: async () => snapshot([]), writeDoc: writes });
                return { ok: true };
            }
        });
        expect(result).toMatchObject({ proceed: true, ok: true });
        expect(writes).toHaveBeenCalled();
        expect(isDetachedRestoreSyncBlocked()).toBe(false);
    });

    test('R5: user-edited day hours must survive an older non-seed cloud config', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(100);
        await db.update('projects', obra('O'));
        const seeded = { ...cfg('O', 8, 1), seeded: true, dayHours: { '2026-09-30': 8 } };
        await db.update('projectPayrollConfigs', seeded);
        replaceEntityScope({ enabled: true, projectId: 'O', defaultProjectId: 'O' });
        setActivePayrollConfig(seeded, { render: false });
        const store = {
            getConfig: id => configStore.getConfig(id, { idb: db }),
            putConfig: c => configStore.putConfig(c, { idb: db })
        };
        expect(await updateActiveDayHours({ '2026-09-30': 10 }, { store })).toBe(true);
        expect(await db.get('projectPayrollConfigs', 'O')).toMatchObject({ updatedAt: 100, dayHours: { '2026-09-30': 10 } });
        await syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => snapshot([{ ...obra('O'), payrollConfig: { ...cfg('O', 8, 50), dayHours: { '2026-09-30': 8 } } }])
        });
        expect(await db.get('projectPayrollConfigs', 'O')).toMatchObject({ dayHours: { '2026-09-30': 10 }, updatedAt: 100 });
    });

    test('CONTROL: a genuine untouched seed yields to an older real cloud config', async () => {
        await db.update('projects', obra('O'));
        await db.update('projectPayrollConfigs', { ...cfg('O', 8, 100), seeded: true });
        await syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => snapshot([{ ...obra('O'), payrollConfig: cfg('O', 9, 50) }])
        });
        expect(await db.get('projectPayrollConfigs', 'O')).toMatchObject({ regularHoursPerDay: 9, updatedAt: 50 });
    });
    test('R4: receiving configs for A and B must retain the active A payroll view', async () => {
        const activeModule = require('../modules/features/payroll/ActivePayrollSettings.js');
        await db.update('projects', obra('A'));
        await db.update('projects', obra('B'));
        await db.update('projectPayrollConfigs', cfg('A', 8, 1));
        await db.update('projectPayrollConfigs', cfg('B', 8, 1));
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        setActivePayrollConfig(cfg('A', 8, 1), { render: false });
        await syncProjectCatalog({
            uid: 'AUDIT-A', idb: db, writeDoc: async () => {},
            readDocs: async () => snapshot([
                { ...obra('A'), payrollConfig: cfg('A', 9, 50) },
                { ...obra('B'), payrollConfig: cfg('B', 6, 50) }
            ])
        });
        expect(await db.get('projectPayrollConfigs', 'A')).toMatchObject({ regularHoursPerDay: 9 });
        expect(await db.get('projectPayrollConfigs', 'B')).toMatchObject({ regularHoursPerDay: 6 });
        expect(activeModule.getActivePayrollSettings({ settings: { regularHoursPerDay: 8 } }).regularHoursPerDay).toBe(9);
    });

});
