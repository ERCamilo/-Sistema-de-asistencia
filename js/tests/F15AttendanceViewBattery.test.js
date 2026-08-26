/**
 * F1.5 slice 1 — end-to-end attendance isolation battery over the REAL
 * persistence stack (same technique as F14IsolationBattery: real
 * IndexedDBService prototypes wired into the mock-mapped singleton, one
 * fake-indexeddb universe + shared localStorage across phases).
 *
 * Fresh-module-per-phase: jest.resetModules() between phases while the SAME
 * IDB universe + localStorage persist ⇒ each phase is a faithful reload.
 * Contract cases covered here: A+B same date survive raw; switch A→B→A ×3
 * shows only that project's records; tombstone keeps deletedAt+projectId
 * through save→load→inflate; pruner never eats another project's day;
 * flag OFF keeps legacy whole-day behavior.
 */

import 'fake-indexeddb/auto';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const PERSISTENT_IDB = globalThis.indexedDB;
jest.setTimeout(120000);

const DATE = '2026-06-15';

async function freshGraph(dbName) {
    jest.resetModules();
    globalThis.indexedDB = PERSISTENT_IDB;
    const [realIdb, mockIdb, flags, storeMod, projMod, defMod, ctxMod, appState, attUi, persSvc] =
        await Promise.all([
            import('actual/services/IndexedDBService.js'),
            import('../modules/services/IndexedDBService.js'),
            import('actual/config/FeatureFlags.js'),
            import('actual/features/projects/ProjectStore.js'),
            import('actual/features/projects/Project.js'),
            import('actual/features/projects/DefaultProject.js'),
            import('actual/features/projects/ProjectContext.js'),
            import('../modules/core/AppState.js'),
            import('../modules/ui/AttendanceUI.js'),
            import('../modules/services/PersistenceService.js')
        ]);
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
        loadAll: () => persSvc.loadApplicationData(),
        pruneCache: () => persSvc.pruneAttendanceCache(),
        state: appState.state,
        calcStats: () => {
            appState.stateManager.markAttendanceDirty();
            return appState.calculateStats();
        },
        filteredDay: () => attUi.getFilteredEmployeesForDay().map(e => e.id),
        totalsRowHtml: dates => attUi.WeekViewTotalsRow(dates)
    };
}

const emp = (id, number, name, extra = {}) =>
    ({ id, key: id, number, name, positions: [], active: true, hireDate: '2026-01-01', updatedAt: 1, ...extra });

const rec = (empId, dateKey, hours, extra = {}) =>
    ({ key: `${empId}-${dateKey}`, employeeId: empId, date: dateKey, present: true, hoursWorked: hours, overtimeHours: 0, isHoliday: false, selectedPosition: null, multiPosition: false, positionHours: [], notes: '', updatedAt: 10, ...extra });

async function seedSharedWorld(g) {
    g.setFlag(true);
    await g.ensureDefault();
    await g.store.create(g.Project.create({ name: 'Obra A' }));
    await g.store.create(g.Project.create({ name: 'Obra B' }));
    const projects = await g.store.listAll();
    const projA = projects.find(p => p.name === 'Obra A');
    const projB = projects.find(p => p.name === 'Obra B');
    await g.db.batchUpdate('employees', [
        emp('E-A', '1', 'Juan', { projectId: projA.id }),
        emp('E-B', '2', 'Pedro', { projectId: projB.id }),
        emp('E-D', '3', 'Legacy') // legacy ⇒ default
    ]);
    // Same date, three owners: A-tagged, B-tagged, legacy unstamped (= default).
    await g.db.batchUpdate('attendance', [
        rec('E-A', DATE, 8, { projectId: projA.id }),
        rec('E-B', DATE, 9, { projectId: projB.id }),
        rec('E-D', DATE, 8)
    ]);
    return { projA, projB };
}

function hydrateGlobalState(g, employees) {
    return g.db.getAll('attendance').then(raw => {
        const map = {};
        raw.forEach(r => { map[`${r.employeeId}-${r.date}`] = r; });
        g.state.attendance = map;
        g.state.employees = employees;
        g.state.settings = { regularHoursPerDay: 8, holidays: [] };
        g.state.selectedDate = new Date(`${DATE}T12:00:00`);
        return raw;
    });
}

describe('F1.5 attendance e2e battery (real IDB + LS)', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => { delete window.currentUser; localStorage.clear(); });

    test('switch A→B→A ×3 over the SAME IDB+LS: each view sees only its records; raw state stays complete', async () => {
        const DB = 'f15-battery-switch';
        {
            const g = await freshGraph(DB);
            await seedSharedWorld(g);
        }
        for (const which of ['A', 'B', 'A']) {
            const g = await freshGraph(DB);
            g.setFlag(true);
            const target = (await g.store.listAll()).find(p => p.name === `Obra ${which}`);
            await g.setActiveProject(target.id);
            const scope = await g.getScope();
            expect(scope.projectId).toBe(target.id);

            await hydrateGlobalState(g, await g.db.getAll('employees'));

            expect(Object.keys(g.state.attendance).length).toBe(3); // raw stays COMPLETE
            expect(g.filteredDay()).toEqual([which === 'A' ? 'E-A' : 'E-B']);

            const stats = g.calcStats();
            expect(stats.present).toBe(1);
            expect(stats.totalHours).toBe(which === 'A' ? 8 : 9);

            const html = g.totalsRowHtml([DATE]);
            if (which === 'A') {
                expect(html).toContain('>1</div>');
                expect(html).toContain('8.0h');
                expect(html).not.toContain('9.0h');
            } else {
                expect(html).toContain('>1</div>');
                expect(html).toContain('9.0h');
                expect(html).not.toContain('8.0h');
            }
        }
    });

    test('tombstone co-survival: deletedAt AND projectId survive save→load→inflate', async () => {
        const DB = 'f15-battery-tombstone';
        const T = Date.now() - 60_000;
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            await g.ensureDefault();
            await g.db.batchUpdate('employees', [emp('E-T', '9', 'Tomb')]);
            await g.db.batchUpdate('positions', [{ id: 'P-1', name: 'Oficio', color: '#ccc', active: true, updatedAt: 1 }]);
            await g.db.batchUpdate('attendance', [
                rec('E-T', DATE, 8, { projectId: 'PRJ-KEEP-1', present: false, deletedAt: T })
            ]);
        }
        const g = await freshGraph(DB);
        g.setFlag(true);
        expect(await g.loadAll()).toBe(true);
        const loaded = g.state.attendance[`E-T-${DATE}`];
        expect(loaded).toBeDefined();
        expect(loaded.deletedAt).toBe(T);
        expect(loaded.projectId).toBe('PRJ-KEEP-1');
    });

    test('pruner under active scope removes only own-project expired records from IDB', async () => {
        const DB = 'f15-battery-prune';
        const OLD = '2024-01-01';
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            await g.ensureDefault();
            const projA = await g.store.create(g.Project.create({ name: 'Obra A' }));
            const projB = await g.store.create(g.Project.create({ name: 'Obra B' }));
            await g.db.batchUpdate('attendance', [
                rec('EA', OLD, 8, { projectId: projA.id }),
                rec('EB', OLD, 8, { projectId: projB.id }),
                rec('EF', OLD, 8) // legacy ⇒ default ('Mi obra') ≠ active A
            ]);
            await g.setActiveProject(projA.id);
            await g.getScope(); // prime the synchronous snapshot used by the wiring

            g.state.attendance = {
                [`EA-${OLD}`]: rec('EA', OLD, 8, { projectId: projA.id }),
                [`EB-${OLD}`]: rec('EB', OLD, 8, { projectId: projB.id }),
                [`EF-${OLD}`]: rec('EF', OLD, 8)
            };

            const res = await g.pruneCache();
            expect(res.evicted).toBe(1); // only EA (own project, expired)
            const remaining = (await g.db.getAll('attendance')).map(r => r.employeeId).sort();
            expect(remaining).toEqual(['EB', 'EF']); // foreign + legacy survive
        }
    });

    test('flag OFF ⇒ pruner keeps legacy whole-day behavior and views stay unfiltered', async () => {
        const DB = 'f15-battery-off';
        const OLD = '2024-01-01';
        const g = await freshGraph(DB);
        g.setFlag(false);
        await g.db.batchUpdate('attendance', [
            rec('EA', OLD, 8, { projectId: 'PRJ-X' }),
            rec('EB', OLD, 8, { projectId: 'PRJ-Y' })
        ]);
        g.state.attendance = {
            [`EA-${OLD}`]: rec('EA', OLD, 8, { projectId: 'PRJ-X' }),
            [`EB-${OLD}`]: rec('EB', OLD, 8, { projectId: 'PRJ-Y' })
        };
        const res = await g.pruneCache();
        expect(res.evicted).toBe(2); // whole-day parity: both evicted regardless of tag
        expect((await g.db.getAll('attendance')).length).toBe(0);

        // Views: scope disabled ⇒ zero filtering (fail-open parity).
        g.state.attendance = {
            'E-A-x': rec('E-A', DATE, 8, { projectId: 'PRJ-A-VIEW' }),
            'E-B-x': rec('E-B', DATE, 9, { projectId: 'PRJ-B-VIEW' })
        };
        g.state.employees = [emp('E-A', '1', 'Juan'), emp('E-B', '2', 'Pedro')];
        g.state.selectedDate = new Date(`${DATE}T12:00:00`);
        expect(g.filteredDay().sort()).toEqual(['E-A', 'E-B']);
        expect(g.peekScope().enabled).toBe(false);
    });
});
