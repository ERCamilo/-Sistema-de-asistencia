
/** 360 acceptance matrix. Assertions describe required behavior, including known failures. */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { auth } from '../../modules/data/firebase.js';
import { setProjectsEnabled } from '../../modules/config/FeatureFlags.js';
import { syncProjectCatalog, stopProjectCatalogLiveSync } from '../../modules/features/projects/ProjectCatalogSync.js';
import { markDetachedRestore, isDetachedRestoreSyncBlocked, runDetachedRestoreLoginGate, DETACHED_RESTORE_LS_KEY } from '../../modules/services/DetachedRestoreGuard.js';
import { createDefaultConfig } from '../../modules/features/payroll/ProjectPayrollConfig.js';
import * as configStore from '../../modules/features/payroll/ProjectPayrollConfigStore.js';
import * as active from '../../modules/features/payroll/ActivePayrollSettings.js';
import { replaceEntityScope, resetEntityScope, peekEntityScope } from '../../modules/features/projects/EntityProjectScope.js';
import { ProjectContextService, ACTIVE_PROJECT_LS_KEY } from '../../modules/features/projects/ProjectContext.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
const project = (id, updatedAt = 1) => ({ id, name: 'Synthetic ' + id, status: 'active', createdAt: 1, updatedAt, schemaVersion: 1 });
const config = (id, updatedAt = 1) => ({ ...createDefaultConfig(id), regularHoursPerDay: 8, updatedAt });
const snapshot = records => ({ forEach: fn => records.forEach(x => fn({ id: x.id, data: () => x })) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('Multiobra 360: boundary, error and concurrency matrix', () => {
    let db, releases, flights;
    beforeEach(async () => {
        localStorage.clear(); resetEntityScope(); active.resetActivePayrollSettingsForTests();
        setProjectsEnabled(true); auth.currentUser = { uid: 'AUDIT-A' };
        db = new IndexedDBService('multiobra-360-' + Math.random()); await db.init();
        releases = []; flights = [];
    });
    afterEach(async () => {
        releases.forEach(d => d.resolve());
        await Promise.allSettled(flights);
        stopProjectCatalogLiveSync(); db.db.close(); localStorage.clear();
        resetEntityScope(); active.resetActivePayrollSettingsForTests(); auth.currentUser = null; jest.restoreAllMocks();
    });
    const gate = () => { const d = deferred(); releases.push(d); return d; };
    const launch = options => {
        const p = syncProjectCatalog({ uid: 'AUDIT-A', idb: db, writeDoc: async () => {}, ...options });
        flights.push(p); return p;
    };

    test.each(['logout', 'other-account', 'flag-disabled'])('R1 pending read is invalidated by %s', async transition => {
        const reached = gate(), release = gate();
        const p = launch({ readDocs: async () => { reached.resolve(); await release.promise; return snapshot([project('FOREIGN')]); } });
        await reached.promise; stopProjectCatalogLiveSync();
        if (transition === 'flag-disabled') setProjectsEnabled(false);
        else auth.currentUser = transition === 'logout' ? null : { uid: 'AUDIT-B' };
        release.resolve(); await p;
        expect(await db.get('projects', 'FOREIGN')).toBeFalsy();
    });
    test('R1 CONTROL no uid does not read or write', async () => {
        const readDocs = jest.fn(), writeDoc = jest.fn();
        expect(await launch({ uid: null, readDocs, writeDoc })).toBeNull();
        expect(readDocs).not.toHaveBeenCalled(); expect(writeDoc).not.toHaveBeenCalled();
    });
    test('R1 CONTROL network rejection leaves the local catalog intact and permits retry', async () => {
        await db.update('projects', project('LOCAL'));
        expect(await launch({ readDocs: async () => { throw Error('synthetic network failure'); } })).toBeNull();
        expect(await db.get('projects', 'LOCAL')).toMatchObject({ id: 'LOCAL' });
        const result = await launch({ readDocs: async () => snapshot([project('REMOTE')]) });
        expect(result.received).toBe(1);
    });

    test.each([
        ['regularHoursPerDay', 9, 10],
        ['dayHours', { '2026-10-24': 9 }, { '2026-10-24': 10 }],
        ['payPeriod', { periodStart: '2026-10-01', periodLength: 7 }, { periodStart: '2026-10-15', periodLength: 21 }]
    ])('R2 latest local %s survives a stale remote apply', async (field, remoteValue, latestValue) => {
        await db.update('projects', project('A')); await db.update('projectPayrollConfigs', config('A'));
        const reached = gate(), release = gate(), get = db.get.bind(db);
        db.get = async (store, id) => {
            const value = await get(store, id);
            if (store === 'projectPayrollConfigs') { reached.resolve(); await release.promise; }
            return value;
        };
        const p = launch({ readDocs: async () => snapshot([{ ...project('A'), payrollConfig: { ...config('A', 50), [field]: remoteValue } }]) });
        await Promise.race([reached.promise, p]);
        await db.update('projectPayrollConfigs', { ...config('A', 100), [field]: latestValue });
        release.resolve(); await p;
        expect(await get('projectPayrollConfigs', 'A')).toMatchObject({ [field]: latestValue, updatedAt: 100 });
    });
    test.each(['closed', 'archived'])('R2 CONTROL a newer local %s status survives an older remote identity', async status => {
        await db.update('projects', { ...project('A', 100), status, closedAt: 99, ...(status === 'archived' ? { archivedAt: 100 } : {}) });
        await launch({ readDocs: async () => snapshot([project('A', 50)]) });
        expect(await db.get('projects', 'A')).toMatchObject({ status, updatedAt: 100 });
    });

    test.each(['valid', 'unreadable'])('R3 %s restore marker blocks automatic publication', async marker => {
        await db.update('projects', project('RESTORED'));
        if (marker === 'valid') markDetachedRestore({ previousUid: 'AUDIT-A' });
        else localStorage.setItem(DETACHED_RESTORE_LS_KEY, '{broken');
        expect(isDetachedRestoreSyncBlocked()).toBe(true);
        const writes = jest.fn();
        await launch({ readDocs: async () => snapshot([]), writeDoc: writes });
        expect(writes).not.toHaveBeenCalled();
    });
    test('R3 a restore marker appearing while reading also blocks incoming records', async () => {
        const reached = gate(), release = gate();
        const p = launch({ readDocs: async () => { reached.resolve(); await release.promise; return snapshot([project('REMOTE')]); } });
        await reached.promise; markDetachedRestore(); release.resolve(); await p;
        expect(await db.get('projects', 'REMOTE')).toBeFalsy();
    });
    test.each(['logout', 'cloud', null])('R3 CONTROL choice %s never calls the upload operation', async choice => {
        markDetachedRestore();
        const upload = jest.fn(), logout = jest.fn();
        const result = await runDetachedRestoreLoginGate({ user: auth.currentUser, ask: async () => choice, upload, logout, useCloud: async () => ({ ok: true }) });
        expect(upload).not.toHaveBeenCalled(); expect(result.proceed).toBe(false);
        if (choice !== 'cloud') expect(logout).toHaveBeenCalledTimes(1);
    });
    test('R3 CONTROL failed authorized upload retains the pending decision', async () => {
        markDetachedRestore(); const logout = jest.fn();
        const result = await runDetachedRestoreLoginGate({ user: auth.currentUser, ask: async () => 'upload', upload: async () => { throw Error('synthetic disk failure'); }, logout });
        expect(result).toMatchObject({ proceed: false, ok: false });
        expect(logout).toHaveBeenCalledTimes(1); expect(isDetachedRestoreSyncBlocked()).toBe(true);
    });

    test.each([
        ['regularHoursPerDay', 9, 6, 8],
        ['payPeriod', { periodLength: 21 }, { periodLength: 7 }, { periodLength: 15 }],
        ['holidays', ['2026-10-24'], ['2026-10-01'], []],
        ['dayHours', { '2026-10-24': 9 }, { '2026-10-24': 6 }, { '2026-10-24': 8 }]
    ])('R4 inactive event cannot displace active %s', (field, own, other, legacy) => {
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        active.setActivePayrollConfig({ ...config('A'), [field]: own }, { render: false });
        window.dispatchEvent(new CustomEvent('payroll-config:changed', { detail: { source: 'catalog-sync', config: { ...config('B'), [field]: other } } }));
        const result = field === 'dayHours' ? active.getActiveDayHours({ dayHoursConfig: legacy }) : active.getActivePayrollSettings({ settings: { [field]: legacy } })[field];
        expect(result).toEqual(own);
    });
    test('R4 CONTROL disabled projects use legacy values even with cached config', () => {
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        active.setActivePayrollConfig({ ...config('A'), regularHoursPerDay: 9 });
        setProjectsEnabled(false);
        expect(active.getActivePayrollSettings({ settings: { regularHoursPerDay: 8 } }).regularHoursPerDay).toBe(8);
    });

    test.each([0, 0.5, 24])('R5 explicit seed edit to %sh survives older non-seed data', async hours => {
        jest.spyOn(Date, 'now').mockReturnValue(100);
        await db.update('projects', project('A'));
        const seeded = { ...config('A'), seeded: true, dayHours: { '2026-10-24': 8 } };
        await db.update('projectPayrollConfigs', seeded);
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' }); active.setActivePayrollConfig(seeded);
        const store = { getConfig: id => configStore.getConfig(id, { idb: db }), putConfig: c => configStore.putConfig(c, { idb: db }) };
        await active.updateActiveDayHours({ '2026-10-24': hours }, { store });
        expect(await db.get('projectPayrollConfigs', 'A')).toMatchObject({ dayHours: { '2026-10-24': hours }, updatedAt: 100 });
        await launch({ readDocs: async () => snapshot([{ ...project('A'), payrollConfig: { ...config('A', 50), dayHours: { '2026-10-24': 8 } } }]) });
        expect(await db.get('projectPayrollConfigs', 'A')).toMatchObject({ dayHours: { '2026-10-24': hours }, updatedAt: 100 });
    });
    test('R5 CONTROL an explicitly edited non-seed config is newer and publishes its hours', async () => {
        await db.update('projects', project('A'));
        await db.update('projectPayrollConfigs', { ...config('A', 100), dayHours: { '2026-10-24': 10 } });
        const writes = jest.fn();
        await launch({ readDocs: async () => snapshot([{ ...project('A'), payrollConfig: config('A', 50) }]), writeDoc: writes });
        expect(writes).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ payrollConfig: expect.objectContaining({ dayHours: { '2026-10-24': 10 } }) }), { merge: true });
    });

    test.each(['missing', 'closed', 'archived'])('R6 CONTROL invalid selection %s preserves the active scope and preference', async status => {
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'A');
        replaceEntityScope({ enabled: true, projectId: 'A', defaultProjectId: 'A' });
        const context = new ProjectContextService({ store: { get: async () => status === 'missing' ? null : { ...project('B'), status } } });
        await expect(context.setActiveProjectId('B')).rejects.toThrow();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('A'); expect(peekEntityScope().projectId).toBe('A');
    });
    test('R6 CONTROL idempotent selection emits no change event', async () => {
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'A');
        const context = new ProjectContextService({ store: { get: async () => project('A') } }), observer = jest.fn();
        context.subscribe(observer); await context.setActiveProjectId('A'); expect(observer).not.toHaveBeenCalled();
    });
});
