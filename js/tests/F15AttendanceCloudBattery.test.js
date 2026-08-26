/**
 * F1.5 slice 2 — CLOUD daily-doc ownership battery (ADR-008 final leg).
 *
 * Real FirebaseService + MainSyncStore + EntityProjectMigration driven over
 * a FakeFirestore harness built on the globally-mocked firebase-data jest.fns
 * (merge:true semantics simulated key-wise), plus real-IDB prototypes wired
 * into the mock-mapped singleton (same technique as F14IsolationBattery /
 * F15AttendanceViewBattery).
 *
 * Contract under test: an OUTGOING daily payload carries ONLY the sender's
 * effective-scope records (+ that scope's tombstones); foreign records are
 * never part of the payload, so the shared day doc preserves them byte-intact
 * (Firestore merge:true never deletes absent record keys). Flag OFF ⇒ the
 * whole pipeline behaves exactly as before.
 */

import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const PERSISTENT_IDB = globalThis.indexedDB;
jest.setTimeout(120000);

const DATE = '2026-06-15';
const UID = 'u-test';

class FakeCloud {
    constructor() { this.docs = new Map(); this.versions = new Map(); }
    versionOf(k) { return this.versions.get(k) || 0; }
    _applySet(k, inc) {
        const next = JSON.parse(JSON.stringify(this.docs.get(k) || {}));
        const patch = JSON.parse(JSON.stringify(inc));
        if (patch.records) next.records = { ...(next.records || {}), ...patch.records };
        for (const [f, v] of Object.entries(patch)) if (f !== 'records') next[f] = v;
        this.docs.set(k, next);
        this.versions.set(k, this.versionOf(k) + 1);
    }
    install(fbd) {
        fbd.doc.mockImplementation((_db, ...segs) => ({ segs }));
        fbd.getDoc.mockImplementation(async ref => {
            const hit = this.docs.get(ref.segs.join('/'));
            if (!hit) return { exists: () => false, data: () => null };
            return { exists: () => true, data: () => JSON.parse(JSON.stringify(hit)) };
        });
        // setDoc({merge:true}): top-level fields replace; `records` merges
        // KEY-WISE — a record absent from the payload survives untouched.
        fbd.setDoc.mockImplementation(async (ref, data) => {
            this._applySet(ref.segs.join('/'), data);
        });
        // F1.5 micro-closure: saveDailyAttendance flushes through a Firestore
        // TRANSACTION when the projects flag is ON. Real SDK semantics:
        // buffered writes, optimistic read validation at commit, transparent
        // re-run of the update function on conflict.
        fbd.runTransaction.mockImplementation(async (_db, operation) => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const reads = [];
                const writes = [];
                await operation({
                    get: async ref => {
                        const k = ref.segs.join('/');
                        reads.push([k, this.versionOf(k)]);
                        const hit = this.docs.get(k);
                        return hit
                            ? { exists: () => true, data: () => JSON.parse(JSON.stringify(hit)) }
                            : { exists: () => false, data: () => null };
                    },
                    set: (ref, data) => writes.push([ref.segs.join('/'), data])
                });
                if (!reads.some(([k, seen]) => this.versionOf(k) !== seen)) {
                    for (const [k, d] of writes) this._applySet(k, d);
                    return;
                }
            }
            throw new Error('FakeCloud.runTransaction: exhausted retries');
        });
        fbd.writeBatch.mockImplementation(() => {
            const ops = [];
            return {
                set: (ref, data) => ops.push([ref, data]),
                commit: async () => { for (const [r, d] of ops) await fbd.setDoc(r, d); }
            };
        });
        fbd.getDocs.mockResolvedValue({ forEach() {}, docs: [] });
    }
    seedDay(dateKey, records) {
        this.docs.set(`users/${UID}/attendance/${dateKey}`, { records: JSON.parse(JSON.stringify(records)) });
    }
    dayDoc(dateKey) {
        return this.docs.get(`users/${UID}/attendance/${dateKey}`)?.records || {};
    }
}

async function freshGraph(dbName, cloudIn = null) {
    jest.resetModules();
    globalThis.indexedDB = PERSISTENT_IDB;
    const [realIdb, mockIdb, flags, storeMod, projMod, defMod, ctxMod, migMod, polMod,
        fbd, fsMod, msMod, mergeMod, writerMod] = await Promise.all([
        import('actual/services/IndexedDBService.js'),
        import('../modules/services/IndexedDBService.js'),
        import('actual/config/FeatureFlags.js'),
        import('actual/features/projects/ProjectStore.js'),
        import('actual/features/projects/Project.js'),
        import('actual/features/projects/DefaultProject.js'),
        import('actual/features/projects/ProjectContext.js'),
        import('actual/features/projects/EntityProjectMigration.js'),
        import('actual/services/AttendanceRetentionPolicy.js'),
        import('../data/firebase.js'), // the SAME mock instances the real service imports
        import('actual/services/FirebaseService.js'), // REAL FirebaseService
        import('actual/services/MainSyncStore.js'),
        import('actual/features/attendance/AttendanceMerge.js'),
        import('actual/features/attendance/AttendanceRecordWriter.js')
    ]);
    const svc = mockIdb.indexedDBService;
    const real = new realIdb.IndexedDBService(dbName);
    Object.assign(svc, { dbName: real.dbName, version: real.version, db: null, isInitialized: false });
    for (const name of Object.getOwnPropertyNames(realIdb.IndexedDBService.prototype)) {
        if (name !== 'constructor') svc[name] = realIdb.IndexedDBService.prototype[name];
    }
    const cloud = cloudIn || new FakeCloud();
    cloud.install(fbd);
    fbd.auth.currentUser = { uid: UID };
    return {
        db: svc,
        cloud,
        fbd,
        firebase: fsMod.default,
        outbox: msMod.MainSyncStore,
        migrate: migMod.migrateEntityProjectStamps,
        MARKER: migMod.PROJECT_STAMP_MARKER_KEY,
        marker: () => JSON.parse(localStorage.getItem(migMod.PROJECT_STAMP_MARKER_KEY)),
        merge: mergeMod.mergeAttendanceRecords,
        tombstoneWrite: writerMod.tombstoneAttendanceWrite,
        planEviction: polMod.planAttendanceEviction,
        setFlag: enabled => flags.setProjectsEnabled(enabled),
        ensureDefault: () => defMod.defaultProjectService.ensureDefaultProject(),
        createProject: name => storeMod.projectStore.create(projMod.Project.create({ name })),
        listProjects: () => storeMod.projectStore.listAll(),
        setActiveProject: id => ctxMod.setActiveProjectId(id),
        getScope: ctxMod.getEntityScope,
        peekScope: ctxMod.peekEntityScope,
        inScope: ctxMod.entityInScope
    };
}

async function seedWorld(g) {
    g.setFlag(true);
    const def = await g.ensureDefault();
    const projA = await g.createProject('Obra A');
    const projB = await g.createProject('Obra B');
    return { def, projA, projB };
}

const scopeOf = (projectId, defaultProjectId) =>
    ({ enabled: true, projectId, defaultProjectId });

const rec = (empId, dateKey, hours, updatedAt, projectId) => {
    const r = {
        employeeId: empId, date: dateKey, present: true, hoursWorked: hours,
        overtimeHours: 0, isHoliday: false, selectedPosition: null, multiPosition: false,
        positionHours: [], notes: '', updatedAt
    };
    if (projectId !== undefined) r.projectId = projectId;
    return r;
};

async function waitFor(pred, tries = 200, delayMs = 10) {
    for (let i = 0; i < tries; i++) {
        if (await pred()) return true;
        await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
    delete window.currentUser;
    delete globalThis.createFirebaseSnapshot;
    localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────
// THE DIVERGENCE SCENARIO (Direction's critical case)
// ─────────────────────────────────────────────────────────────────────
describe('F1.5 cloud battery — divergence scenario', () => {
    test('stale foreign copy in B payload can NOT restore old state: final doc {Juan:10, Pedro:9}', async () => {
        const g = await freshGraph('f15c-divergence');
        const { def, projA, projB } = await seedWorld(g);

        // Shared day doc: {Juan-A:8h, Pedro-B:8h} (both uploaded earlier).
        g.cloud.seedDay(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 8, 1000, projA.id),
            [`P-${DATE}`]: rec('P', DATE, 8, 1000, projB.id)
        });

        // Context A (fresh read) saves Juan=10h.
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 10, 2000, projA.id)
        }, { scope: scopeOf(projA.id, def.id) });
        expect(g.cloud.dayDoc(DATE)[`J-${DATE}`].hoursWorked).toBe(10);
        expect(g.cloud.dayDoc(DATE)[`P-${DATE}`].hoursWorked).toBe(8);

        // Context B still holds a STALE copy of Juan — and B's clock is SKEWED
        // ahead, so the stale copy carries a HIGHER updatedAt (5000) than the
        // remote truth (2000). LWW alone would resurrect 8h; scoped ownership
        // must keep the foreign record OUT of B's payload entirely.
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 8, 5000, projA.id), // stale foreign, skewed clock
            [`P-${DATE}`]: rec('P', DATE, 9, 3000, projB.id)
        }, { scope: scopeOf(projB.id, def.id) });

        const finalDoc = g.cloud.dayDoc(DATE);
        expect(finalDoc[`J-${DATE}`].hoursWorked).toBe(10); // NOT restored to 8
        expect(finalDoc[`J-${DATE}`].updatedAt).toBe(2000); // byte-intact
        expect(finalDoc[`P-${DATE}`].hoursWorked).toBe(9);
    });
});

describe('F1.5 cloud battery — contract matrix S1-S9', () => {
    test('S1+S2: A+B coexist in one day doc; editing A leaves B byte-equivalent', async () => {
        const g = await freshGraph('f15c-s1s2');
        const { def, projA, projB } = await seedWorld(g);
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 8, 1000, projA.id)
        }, { scope: scopeOf(projA.id, def.id) });
        await g.firebase.saveDailyAttendance(DATE, {
            [`P-${DATE}`]: rec('P', DATE, 9, 1100, projB.id)
        }, { scope: scopeOf(projB.id, def.id) });
        const coexist = g.cloud.dayDoc(DATE);
        expect(Object.keys(coexist).sort()).toEqual([`J-${DATE}`, `P-${DATE}`]);

        const bBefore = JSON.parse(JSON.stringify(coexist[`P-${DATE}`]));
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 11, 2000, projA.id),
            [`P-${DATE}`]: rec('P', DATE, 1, 999, projB.id) // stale B copy rides along
        }, { scope: scopeOf(projA.id, def.id) });
        const after = g.cloud.dayDoc(DATE);
        expect(after[`J-${DATE}`].hoursWorked).toBe(11);
        expect(after[`P-${DATE}`]).toEqual(bBefore); // byte-equivalent
    });

    test('S3+S8: deleting (tombstoning) A removes nothing of B; tombstone keeps employeeId+date+projectId', async () => {
        const g = await freshGraph('f15c-s3s8');
        const { def, projA, projB } = await seedWorld(g);
        g.cloud.seedDay(DATE, {
            [`J-${DATE}`]: rec('J', DATE, 8, 1000, projA.id),
            [`P-${DATE}`]: rec('P', DATE, 9, 1000, projB.id)
        });
        const T = Date.now() - 60_000;
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: g.tombstoneWrite(rec('J', DATE, 8, 1000, projA.id), T)
        }, { scope: scopeOf(projA.id, def.id) });

        const doc = g.cloud.dayDoc(DATE);
        expect(doc[`P-${DATE}`].present).toBe(true); // B untouched
        expect(doc[`P-${DATE}`].hoursWorked).toBe(9);
        const tomb = doc[`J-${DATE}`];
        expect(tomb.present).toBe(false);
        expect(tomb.deletedAt).toBe(T);
        expect(tomb.employeeId).toBe('J');       // S8
        expect(tomb.date).toBe(DATE);
        expect(tomb.projectId).toBe(projA.id);
    });

    test('S4: legacy record without projectId belongs to default and IS uploaded under default scope', async () => {
        const g = await freshGraph('f15c-s4');
        const { def } = await seedWorld(g);
        await g.firebase.saveDailyAttendance(DATE, {
            [`L-${DATE}`]: rec('L', DATE, 8, 500) // unstamped ⇒ default
        }, { scope: scopeOf(def.id, def.id) });
        expect(g.cloud.dayDoc(DATE)[`L-${DATE}`]).toBeDefined();
        expect(g.cloud.dayDoc(DATE)[`L-${DATE}`].employeeId).toBe('L');

        // …and is EXCLUDED from another project's payload (not theirs).
        const projA = (await g.listProjects()).find(p => p.name === 'Obra A');
        await g.firebase.saveDailyAttendance(DATE, {
            [`L-${DATE}`]: rec('L', DATE, 8, 500),
            [`X-${DATE}`]: rec('X', DATE, 6, 501, projA.id)
        }, { scope: scopeOf(projA.id, def.id) });
        expect(g.cloud.dayDoc(DATE)[`L-${DATE}`].updatedAt).toBe(500); // survived intact
    });

    test('S5: A→B→A with reloads — each view recovers only its own records from the shared doc', async () => {
        const DB = 'f15c-s5';
        const sharedCloud = new FakeCloud(); // the cloud survives "reloads"; IDB+LS too
        const { projA, projB } = await (async () => {
            const g = await freshGraph(DB, sharedCloud);
            return seedWorld(g);
        })();
        {
            const g = await freshGraph(DB, sharedCloud);
            sharedCloud.seedDay(DATE, {
                [`J-${DATE}`]: rec('J', DATE, 8, 1000, projA.id),
                [`P-${DATE}`]: rec('P', DATE, 9, 1000, projB.id)
            });
        }
        for (const which of ['A', 'B', 'A']) {
            const g = await freshGraph(DB, sharedCloud);
            g.setFlag(true);
            const target = (await g.listProjects()).find(p => p.name === `Obra ${which}`);
            await g.setActiveProject(target.id);
            const scope = await g.getScope();
            const downloaded = Object.values(g.cloud.dayDoc(DATE)); // what a range download delivers
            const view = downloaded.filter(r => g.inScope(r, scope));
            expect(view.map(r => r.employeeId)).toEqual([which === 'A' ? 'J' : 'P']);
        }
    });

    test('S6: incoming sync of B while A is active stores as B — never re-tagged', async () => {
        const g = await freshGraph('f15c-s6');
        const { def, projA, projB } = await seedWorld(g);
        await g.setActiveProject(projA.id);
        const scopeA = await g.getScope();

        // Zonal-style incoming payload for B lands through the standard merge.
        const local = { [`J-${DATE}`]: rec('J', DATE, 8, 1000, projA.id) };
        const incoming = { [`P-${DATE}`]: rec('P', DATE, 9, 2000, projB.id) };
        const merged = g.merge(local, incoming);
        expect(merged[`P-${DATE}`].projectId).toBe(projB.id); // own tag preserved

        // Persisted while A active; raw storage keeps B's ownership.
        await g.db.batchUpdate('attendance', [{ key: `P-${DATE}`, ...merged[`P-${DATE}`] }]);
        const raw = (await g.db.getAll('attendance')).find(r => r.employeeId === 'P');
        expect(raw.projectId).toBe(projB.id);
        expect(g.inScope(raw, scopeA)).toBe(false); // visible only under B
        expect(scopeA.defaultProjectId).toBe(def.id);
    });

    test('S7: retention/pruner never kills live foreign-project data (scope ON)', async () => {
        const g = await freshGraph('f15c-s7');
        const { def, projA } = await seedWorld(g);
        const OLD = '2024-01-01'; // far outside the retention window
        const attendance = {
            [`EA-${OLD}`]: rec('EA', OLD, 8, 1, projA.id),   // own + expired
            [`EB-${OLD}`]: rec('EB', OLD, 8, 1, 'PRJ-B-X')   // foreign + expired
        };
        const plan = g.planEviction(attendance, {
            now: new Date('2026-08-01').getTime(),
            scope: { enabled: true, projectId: projA.id, defaultProjectId: def.id }
        });
        expect(plan.evictKeys).toEqual([`EA-${OLD}`]);
        expect(plan.kept[`EB-${OLD}`].projectId).toBe('PRJ-B-X'); // foreign survives
    });

    test('S9: flag OFF ⇒ whole pipeline behaves exactly as before (parity controls)', async () => {
        const g = await freshGraph('f15c-s9');
        g.setFlag(false);
        const mixed = {
            [`J-${DATE}`]: rec('J', DATE, 8, 1000, 'PRJ-A-Y'),
            [`P-${DATE}`]: rec('P', DATE, 9, 1000, 'PRJ-B-Y')
        };
        await g.firebase.saveDailyAttendance(DATE, JSON.parse(JSON.stringify(mixed)));
        const lastSet = g.fbd.setDoc.mock.calls[g.fbd.setDoc.mock.calls.length - 1];
        expect(lastSet[1].records).toEqual(mixed); // NOTHING filtered out

        // syncHistory batches every day unfiltered under OFF.
        const history = {
            'e1': { employeeId: 'E1', date: '2026-05-01', present: true, hoursWorked: 8, updatedAt: 1, projectId: 'PRX' },
            'e2': { employeeId: 'E2', date: '2026-05-02', present: true, hoursWorked: 7, updatedAt: 1, projectId: 'PRY' }
        };
        await g.firebase.syncHistory(history);
        const daySets = g.fbd.writeBatch.mock.results.length > 0;
        expect(daySets).toBe(true);
        const docMay = g.cloud.dayDoc('2026-05-01');
        expect(docMay['e1']).toBeDefined();
        expect(docMay['e1'].projectId).toBe('PRX');
        expect(g.cloud.dayDoc('2026-05-02')['e2'].projectId).toBe('PRY');
    });
});

describe('F1.5 cloud battery — concurrency/retry (outbox serialization)', () => {
    test('overlapping saves same dateKey: second write does not erase the first; scope travels in the entry', async () => {
        const g = await freshGraph('f15c-conc');
        const { def, projA, projB } = await seedWorld(g);
        const scopeA = scopeOf(projA.id, def.id);
        const scopeB = scopeOf(projB.id, def.id);

        await g.outbox.enqueueDaily(DATE, { [`J-${DATE}`]: rec('J', DATE, 10, 2000, projA.id) }, scopeA);
        const stored = (await g.db.getAll('mainSyncOutbox')).find(e => e.kind === 'daily');
        expect(stored.scope).toEqual(scopeA); // sender scope stamped at ENQUEUE time

        const calls = [];
        let releaseFirst;
        const gate = new Promise(r => { releaseFirst = r; });
        const guards = {
            hasSession: () => true,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            saveMirror: async () => {},
            saveEntities: async () => {},
            saveSettings: async () => {},
            saveDaily: async (dateKey, records, scope) => {
                calls.push({ dateKey, records, scope });
                if (calls.length === 1) await gate; // hold the FIRST upload in flight
                await g.firebase.saveDailyAttendance(dateKey, records, { scope });
            },
            deleteEntity: async () => {},
            onCloudResult: () => {}
        };

        const flush1 = g.outbox.flush(guards);
        await waitFor(() => calls.length === 1); // first upload started, blocked
        await g.outbox.enqueueDaily(DATE, { [`P-${DATE}`]: rec('P', DATE, 9, 3000, projB.id) }, scopeB);
        const flush2Blocked = await g.outbox.flush(guards); // _flushing guard ⇒ no-op
        expect(flush2Blocked).toBeUndefined();
        releaseFirst();
        await flush1;

        await g.outbox.flush(guards); // drain the remaining (B) entry
        await waitFor(() => calls.length >= 2);

        expect(calls[0].scope).toEqual(scopeA);
        expect(calls[calls.length - 1].scope).toEqual(scopeB);
        const finalDoc = g.cloud.dayDoc(DATE);
        expect(finalDoc[`J-${DATE}`].hoursWorked).toBe(10); // first write survived
        expect(finalDoc[`P-${DATE}`].hoursWorked).toBe(9);  // second write applied
    });
});

describe('F1.5 cloud battery — M2 attendance migration extension', () => {
    test('legacy unstamped attendance stamps to default idempotently; resumable per-store; flag OFF skipped', async () => {
        const DB = 'f15c-m2';
        const att = n => ({
            key: `E${n}-${DATE}`, employeeId: `E${n}`, date: DATE, present: true,
            hoursWorked: 8, updatedAt: 1
        });
        {
            const g = await freshGraph(DB);
            g.setFlag(true);
            const def = await g.ensureDefault();
            await g.db.batchUpdate('employees', [{ id: 'E1', key: 'E1', number: '1', name: 'Uno', positions: [], active: true, updatedAt: 1 }]);
            await g.db.batchUpdate('attendance', [att(1), att(2)]);

            const partial = await g.migrate({ stores: ['employees'] }); // interrupt before attendance
            expect(partial.stamped).toBe(1);

            const res = await g.migrate(); // resumes: only attendance left
            expect(res.perStore.employees).toBeUndefined();
            expect(res.perStore.attendance).toEqual({ scanned: 2, stamped: 2 });
            const raw = await g.db.getAll('attendance');
            raw.forEach(r => expect(r.projectId).toBe(def.id));
            expect(raw.every(r => r.key === `${r.employeeId}-${r.date}`)).toBe(true); // keyPath intact

            const rerun = await g.migrate();
            expect(rerun.stamped).toBe(0); // idempotent
            expect(g.marker().done.attendance).toBe(true);
        }
        {
            const g = await freshGraph(DB);
            g.setFlag(false);
            const markerBefore = localStorage.getItem(g.MARKER);
            await g.db.batchUpdate('attendance', [att(3)]);
            expect(await g.migrate()).toEqual({ skipped: true });
            expect(localStorage.getItem(g.MARKER)).toBe(markerBefore); // OFF run touches nothing
            const raw = await g.db.getAll('attendance');
            expect(raw.find(r => r.employeeId === 'E3').projectId).toBeUndefined();
        }
    });
});

describe('F1.5 cloud battery — app.js zonal totals surface (single minimal edit)', () => {
    const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

    test('window.updateWeekTotals filters day attendance through entityInScope', () => {
        const start = APP_SRC.indexOf('window.updateWeekTotals = function');
        expect(start).toBeGreaterThan(-1);
        const end = APP_SRC.indexOf('\n};', start);
        const block = APP_SRC.slice(start, end);
        expect(block).toMatch(/entityInScope\(a\)/);
        expect(block).toMatch(/a\.present\s*&&\s*entityInScope\(a\)/);
    });

    test('app.js imports entityInScope from ProjectContext (only new dependency)', () => {
        expect(APP_SRC).toMatch(/import\s*\{[^}]*entityInScope[^}]*\}\s*from\s*'\.\.?\/modules\/features\/projects\/ProjectContext\.js'/);
    });
});
