/**
 * F1.4 — End-to-end isolation battery over the REAL persistence stack
 * (fake-indexeddb/auto + real IndexedDBService prototypes wired into the
 * mock-mapped singleton, exactly like EmployeeTombstoneSurvival).
 *
 * Fresh-module-per-phase technique: jest.resetModules() rebuilds the whole
 * graph between phases while the SAME fake-indexeddb universe + localStorage
 * persist ⇒ each phase is a faithful "app reload". The first fake-indexeddb
 * factory is pinned below because resetModules would otherwise build a new,
 * EMPTY database universe.
 */

import 'fake-indexeddb/auto';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const PERSISTENT_IDB = globalThis.indexedDB;
jest.setTimeout(120000);

async function freshGraph(dbName) {
    jest.resetModules();
    globalThis.indexedDB = PERSISTENT_IDB;
    const [realIdb, mockIdb, flags, storeMod, projMod, defMod, ctxMod, bootMod, migMod, persSvc, appState, incMerge] =
        await Promise.all([
            import('actual/services/IndexedDBService.js'),
            import('../modules/services/IndexedDBService.js'),
            import('actual/config/FeatureFlags.js'),
            import('actual/features/projects/ProjectStore.js'),
            import('actual/features/projects/Project.js'),
            import('actual/features/projects/DefaultProject.js'),
            import('actual/features/projects/ProjectContext.js'),
            import('actual/features/projects/ProjectsBoot.js'),
            import('actual/features/projects/EntityProjectMigration.js'),
            import('../modules/services/PersistenceService.js'),
            import('../modules/core/AppState.js'),
            import('../modules/services/EmployeesIncomingMerge.js')
        ]);
    // Install real runtime code onto the singleton every consumer imports.
    const svc = mockIdb.indexedDBService;
    const real = new realIdb.IndexedDBService(dbName);
    Object.assign(svc, { dbName: real.dbName, version: real.version, db: null, isInitialized: false });
    for (const name of Object.getOwnPropertyNames(realIdb.IndexedDBService.prototype)) {
        if (name !== 'constructor') svc[name] = realIdb.IndexedDBService.prototype[name];
    }
    return {
        db: svc,
        setFlag: enabled => flags.setProjectsEnabled(enabled),
        store: storeMod.projectStore,
        Project: projMod.Project,
        ensureDefault: () => defMod.defaultProjectService.ensureDefaultProject(),
        setActiveProject: id => ctxMod.setActiveProjectId(id),
        getScope: ctxMod.getEntityScope,
        peekScope: ctxMod.peekEntityScope,
        inScope: ctxMod.entityInScope,
        boot: bootMod.initProjectsInfrastructure,
        migrate: migMod.migrateEntityProjectStamps,
        MARKER: migMod.PROJECT_STAMP_MARKER_KEY,
        loadAll: () => persSvc.loadApplicationData(),
        state: appState.state,
        mergeIncoming: incMerge.mergeIncomingEmployees,
        resetBaseline: incMerge.resetIncomingMergeBaseline,
        marker: () => JSON.parse(localStorage.getItem(migMod.PROJECT_STAMP_MARKER_KEY))
    };
}

const emp = (id, number, name, extra = {}) =>
    ({ id, key: id, number, name, positions: [], active: true, updatedAt: 1, ...extra });

const pos = (id, name, extra = {}) =>
    ({ id, name, color: '#ccc', active: true, updatedAt: 1, ...extra });

const lead = (id, name, extra = {}) =>
    ({ id, number: id, name, active: true, updatedAt: 1, ...extra });

const idsOf = records => records.map(r => r.id).sort();

/** Production list pipeline: merge keeps state clean of tombstones, scope filters ownership. */
const listView = (g, records, scope) =>
    g.mergeIncoming(records, []).filter(e => !Number.isFinite(e?.deletedAt)).filter(e => g.inScope(e, scope));

async function waitFor(pred, tries = 100, delayMs = 20) {
    for (let i = 0; i < tries; i++) {
        if (await pred()) return true;
        await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
}

describe('F1.4 end-to-end isolation battery (M2 stamping + A/B isolation)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        delete window.currentUser;
        delete globalThis.createFirebaseSnapshot;
        localStorage.clear();
    });

    test('S1: legacy unstamped seed resolves to default project; invisible under project B; re-run stamps nothing', async () => {
        const g = await freshGraph('f14-battery-s1');
        g.setFlag(true);
        const def = await g.ensureDefault();
        await g.store.create(g.Project.create({ name: 'Obra B' }));
        await g.db.batchUpdate('employees', [emp('E-JUAN', '12', 'Juan')]);
        await g.db.batchUpdate('positions', [pos('P-1', 'Albañil')]);
        await g.db.batchUpdate('leaders', [lead('L-1', 'Capataz')]);

        const res = await g.migrate();
        expect(res.skipped).toBe(false);
        expect(res.backup).toBe('unavailable'); // sin sesión Firebase en este entorno
        expect(res.stamped).toBe(3);
        expect(res.perStore.employees).toEqual({ scanned: 1, stamped: 1 });

        const all = [
            ...(await g.db.getAll('employees')),
            ...(await g.db.getAll('positions')),
            ...(await g.db.getAll('leaders'))
        ];
        all.forEach(r => expect(r.projectId).toBe(def.id));

        const scopeDef = await g.getScope();
        expect(scopeDef.projectId).toBe(def.id);
        all.forEach(r => expect(g.inScope(r, scopeDef)).toBe(true));

        const projB = (await g.store.listAll()).find(p => p.id !== def.id);
        await g.setActiveProject(projB.id);
        const scopeB = await g.getScope();
        all.forEach(r => expect(g.inScope(r, scopeB)).toBe(false));

        const rerun = await g.migrate();
        expect(rerun.stamped).toBe(0);
        expect(idsOf(await g.db.getAll('employees'))).toEqual(['E-JUAN']);
    });

    test('S1b: cloud snapshot attempted only with session; failure degrades to unavailable and proceeds', async () => {
        const g = await freshGraph('f14-battery-s1b');
        g.setFlag(true);
        await g.ensureDefault();
        window.currentUser = { uid: 'u1' };
        globalThis.createFirebaseSnapshot = async () => 'snap-pre';
        await g.db.batchUpdate('employees', [emp('E-BK', '30', 'Backup')]);
        expect((await g.migrate()).backup).toBe('ok');

        localStorage.removeItem(g.MARKER);
        await g.db.batchUpdate('employees', [emp('E-BK2', '31', 'Backup2')]);
        globalThis.createFirebaseSnapshot = async () => { throw new Error('offline'); };
        const failed = await g.migrate();
        expect(failed.backup).toBe('unavailable');
        expect(failed.stamped).toBe(1); // proceeded despite backup failure
    });

    test('S2: #12 coexists across A/B; repeated switches never mix lists; edits stay scoped', async () => {
        const DB = 'f14-battery-s2';
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            await g.ensureDefault();
            const projA = await g.store.create(g.Project.create({ name: 'Obra A' }));
            const projB = await g.store.create(g.Project.create({ name: 'Obra B' }));
            await g.db.batchUpdate('employees', [emp('E-A', '12', 'Juan'), emp('E-B', '12', 'Pedro')]);
            await g.migrate(); // both land in default first
            await g.db.batchUpdate('employees', [
                emp('E-A', '12', 'Juan', { projectId: projA.id, phone: '111', updatedAt: 2 }),
                emp('E-B', '12', 'Pedro', { projectId: projB.id, phone: '222', updatedAt: 2 })
            ]);
        }
        // Three switches, each through a full reload: lists must never mix.
        for (const which of ['A', 'B', 'A']) {
            const g = await freshGraph(DB);
            g.setFlag(true);
            const target = (await g.store.listAll()).find(p => p.name === `Obra ${which}`);
            await g.setActiveProject(target.id);
            const view = await (async () => {
                const scope = await g.getScope();
                return listView(g, await g.db.getAll('employees'), scope);
            })();
            expect(idsOf(view)).toEqual([which === 'A' ? 'E-A' : 'E-B']);
        }
        // Edit Juan under A; after reload his edit shows in A and NEVER leaks into B.
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            const projA = (await g.store.listAll()).find(p => p.name === 'Obra A');
            await g.setActiveProject(projA.id);
            const juan = (await g.db.getAll('employees')).find(e => e.id === 'E-A');
            juan.phone = '999-EDIT';
            juan.updatedAt = 3;
            await g.db.batchUpdate('employees', [juan]);

            const h = await freshGraph(DB);
            h.setFlag(true);
            const projs = await h.store.listAll();
            await h.setActiveProject(projs.find(p => p.name === 'Obra A').id);
            let scope = await h.getScope();
            let viewA = listView(h, await h.db.getAll('employees'), scope);
            expect(viewA.find(e => e.id === 'E-A').phone).toBe('999-EDIT');

            await h.setActiveProject(projs.find(p => p.name === 'Obra B').id);
            scope = await h.getScope();
            const viewB = listView(h, await h.db.getAll('employees'), scope);
            expect(idsOf(viewB)).toEqual(['E-B']);
            expect(viewB[0].phone).toBe('222'); // untouched by A-side edit
        }
    });

    test('S3: tombstone in A hides him everywhere; H-01 holds WITH projectId; Pedro in B unaffected', async () => {
        const DB = 'f14-battery-s3';
        const T = Date.now() - 60_000;
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            await g.ensureDefault();
            const projA = await g.store.create(g.Project.create({ name: 'Obra A' }));
            const projB = await g.store.create(g.Project.create({ name: 'Obra B' }));
            await g.db.batchUpdate('employees', [
                emp('E-A', '12', 'Juan', { projectId: projA.id, phone: '111' }),
                emp('E-B', '12', 'Pedro', { projectId: projB.id, phone: '222' })
            ]);
            // Delete in A: tombstone keeps the owner stamp.
            await g.db.batchUpdate('employees', [
                emp('E-A', '12', 'Juan', { projectId: projA.id, phone: '111', active: false, deletedAt: T })
            ]);
        }
        const g = await freshGraph(DB); // reload + inflate through loadApplicationData
        g.setFlag(true);
        const projA = (await g.store.listAll()).find(p => p.name === 'Obra A');
        const projB = (await g.store.listAll()).find(p => p.name === 'Obra B');

        const raw = await g.db.getAll('employees');
        const rawJuan = raw.find(e => e.id === 'E-A');
        expect(rawJuan.deletedAt).toBe(T);
        expect(rawJuan.projectId).toBe(projA.id);

        expect(await g.loadAll()).toBe(true);
        const loaded = g.state.employees.find(e => e.id === 'E-A');
        expect(loaded.deletedAt).toBe(T);          // H-01 protection...
        expect(loaded.projectId).toBe(projA.id);   // ...WITH projectId present

        await g.setActiveProject(projA.id);
        let scope = await g.getScope();
        expect(listView(g, g.state.employees, scope).map(e => e.id)).not.toContain('E-A');

        await g.setActiveProject(projB.id);
        scope = await g.getScope();
        const viewB = listView(g, g.state.employees, scope);
        expect(idsOf(viewB)).toEqual(['E-B']);
        expect(viewB[0].deletedAt).toBeUndefined(); // Pedro cross-safe
        expect(viewB[0].phone).toBe('222');
    });

    test('S4: incoming cloud payload keeps its own projectId; B-view sees it, active A view does not', async () => {
        const g = await freshGraph('f14-battery-s4');
        g.setFlag(true);
        await g.ensureDefault();
        const projA = await g.store.create(g.Project.create({ name: 'Obra A' }));
        const projB = await g.store.create(g.Project.create({ name: 'Obra B' }));
        await g.db.batchUpdate('employees', [
            emp('E-A', '12', 'Juan', { projectId: projA.id }),
            emp('E-B', '12', 'Pedro', { projectId: projB.id, phone: '222', updatedAt: 10 })
        ]);
        await g.setActiveProject(projA.id); // active context = A

        const incoming = [
            emp('E-B', '12', 'Pedro', { projectId: projB.id, phone: '222-NEW', updatedAt: 20 }),
            emp('E-B2', '13', 'Nora', { projectId: projB.id }) // alta remota para B
        ];
        const merged = g.mergeIncoming(await g.db.getAll('employees'), incoming);
        g.resetBaseline();

        const mergedPedro = merged.find(e => e.id === 'E-B');
        expect(mergedPedro.projectId).toBe(projB.id); // payload's own stamp preserved
        expect(mergedPedro.phone).toBe('222-NEW');
        expect(merged.find(e => e.id === 'E-B2').projectId).toBe(projB.id);

        const scopeA = await g.getScope();
        expect(idsOf(listView(g, merged, scopeA))).toEqual(['E-A']);

        await g.setActiveProject(projB.id);
        const scopeB = await g.getScope();
        expect(idsOf(listView(g, merged, scopeB))).toEqual(['E-B', 'E-B2']);
        expect(listView(g, merged, scopeB).find(e => e.id === 'E-B').phone).toBe('222-NEW');
    });

    test('S5: interrupted run resumes without double-work; totals consistent; ids stable', async () => {
        const DB = 'f14-battery-s5';
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            const def = await g.ensureDefault();
            await g.db.batchUpdate('employees', [emp('E-1', '1', 'Uno'), emp('E-2', '2', 'Dos')]);
            // P-1 pre-stamped: simulates an earlier pass killed before its marker.
            await g.db.batchUpdate('positions', [pos('P-1', 'Uno', { projectId: def.id }), pos('P-2', 'Dos')]);
            await g.db.batchUpdate('leaders', [lead('L-1', 'A'), lead('L-2', 'B'), lead('L-3', 'C')]);

            const partial = await g.migrate({ stores: ['employees'] });
            expect(partial.stamped).toBe(2);
            expect(g.marker().done).toEqual({ employees: true, positions: false, leaders: false });
        }
        const g = await freshGraph(DB);
        g.setFlag(true);
        const def = (await g.store.listAll()).find(p => p.name === 'Mi obra');

        const res = await g.migrate();
        expect(res.perStore.employees).toBeUndefined(); // completed store skipped on resume
        expect(res.perStore.positions).toEqual({ scanned: 2, stamped: 1 }); // no double-work
        expect(res.perStore.leaders).toEqual({ scanned: 3, stamped: 3 });

        let totalStamped = 0;
        Object.values(res.perStore).forEach(s => { totalStamped += s.stamped; });
        expect(totalStamped + 2).toBe(6); // full-world expectation

        const check = [];
        for (const store of ['employees', 'positions', 'leaders']) {
            const records = await g.db.getAll(store);
            records.forEach(r => expect(r.projectId).toBe(def.id));
            check.push(...records);
        }
        expect(idsOf(check.filter(r => r.id.startsWith('E')))).toEqual(['E-1', 'E-2']);
        expect(new Set(check.map(r => r.id)).size).toBe(check.length); // zero duplicates
    });

    test('S6: flag OFF ⇒ strict no-op and legacy parity (lists unfiltered)', async () => {
        const g = await freshGraph('f14-battery-s6');
        g.setFlag(false);
        await g.db.batchUpdate('employees', [
            emp('E-X', '1', 'X', { projectId: 'PRJ-OTRO-X' }),
            emp('E-Y', '2', 'Y', { projectId: 'PRJ-OTRO-Y' })
        ]);

        expect(await g.migrate()).toEqual({ skipped: true });
        const raw = await g.db.getAll('employees');
        expect(raw.find(e => e.id === 'E-X').projectId).toBe('PRJ-OTRO-X'); // untouched
        expect(localStorage.getItem(g.MARKER)).toBeNull();

        const scope = g.peekScope();
        expect(scope.enabled).toBe(false);
        raw.forEach(r => expect(g.inScope(r, scope)).toBe(true)); // legacy parity
    });

    test('boot hook: initProjectsInfrastructure fires M2 fire-and-forget when scope enabled', async () => {
        const g = await freshGraph('f14-battery-hook');
        g.setFlag(true);
        const def = await g.ensureDefault();
        await g.db.batchUpdate('employees', [emp('E-HOOK', '7', 'Hook')]);

        await g.boot(); // must NOT throw nor block; migration runs in background
        const done = await waitFor(async () =>
            ((await g.db.getAll('employees'))[0]?.projectId) === def.id);
        expect(done).toBe(true);
        expect(g.marker().done.employees).toBe(true);
    });
});
