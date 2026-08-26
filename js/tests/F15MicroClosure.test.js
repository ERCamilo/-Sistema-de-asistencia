/**
 * F1.5 MICRO-CLOSURE — two authorized items (Direction):
 *
 * ITEM 1 — TRUE two-client cloud concurrency: two INDEPENDENT client paths
 * (separate module graphs = two devices) share ONE fake cloud backing store,
 * each completing its REMOTE READ phase before EITHER performs its WRITE
 * phase (read-barrier in the fake). Required outcome: both edits conserved.
 *   - Same-scope race (the teeth): both clients carry the full day map in
 *     scope; the loser's stale base rebuild clobbers the winner's key unless
 *     the connected write path runs as a Firestore transaction.
 *   - Cross-scope race: documented PASS-as-is (outgoing scoped payloads never
 *     carried the foreign key — F1.5 slice 2 contract).
 *
 * ITEM 2 — Legacy tombstone effective-project edge: a tombstone inherits the
 * EFFECTIVE project of the record it deletes (own projectId ?? DEFAULT),
 * NEVER the activeProjectId alone.
 */

import 'fake-indexeddb/auto';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const PERSISTENT_IDB = globalThis.indexedDB;
jest.setTimeout(120000);

const DATE = '2026-06-15';
const UID = 'u-test';
const DEF = 'PRJ-RACE-DEFAULT';
const PA = 'PRJ-RACE-A';
const PB = 'PRJ-RACE-B';

const dayKey = () => `users/${UID}/attendance/${DATE}`;

class RaceCloud {
    constructor() {
        this.docs = new Map();
        this.versions = new Map();
        this._gate = null;
        this.barrierConsumed = false;
    }
    versionOf(k) { return this.versions.get(k) || 0; }
    _snap(k) {
        const hit = this.docs.get(k);
        return hit
            ? { exists: () => true, data: () => JSON.parse(JSON.stringify(hit)) }
            : { exists: () => false, data: () => null };
    }
    /** Park the first `readers` reads of docKey until ALL arrive, then hand
     * everyone the SAME pre-write state — the Direction table, moment 1. */
    armBarrier(docKey, readers = 2) {
        let release;
        const opened = new Promise(r => { release = r; });
        this._gate = { key: docKey, remaining: readers, parked: [], release };
        return opened;
    }
    async _read(k) {
        const g = this._gate;
        if (g && k === g.key && g.remaining > 0) {
            if (this.versionOf(k) !== 0) throw new Error('barrier engaged AFTER a write — harness bug');
            g.remaining -= 1;
            if (g.remaining === 0) {
                this.barrierConsumed = true;
                const result = this._snap(k);
                g.parked.forEach(res => res(result));
                this._gate = null;
                g.release();
                return result;
            }
            return new Promise(res => g.parked.push(res));
        }
        return this._snap(k);
    }
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
        fbd.getDoc.mockImplementation(async ref => this._read(ref.segs.join('/')));
        fbd.setDoc.mockImplementation(async (ref, data) => this._applySet(ref.segs.join('/'), data));
        // Real Firestore transaction semantics: buffered writes, optimistic
        // read validation at commit, transparent re-run on conflict.
        fbd.runTransaction.mockImplementation(async (_db, operation) => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const reads = [];
                const writes = [];
                await operation({
                    get: async ref => {
                        const k = ref.segs.join('/');
                        reads.push([k, this.versionOf(k)]);
                        return this._read(k);
                    },
                    set: (ref, data) => writes.push([ref.segs.join('/'), data])
                });
                if (!reads.some(([k, seen]) => this.versionOf(k) !== seen)) {
                    for (const [k, d] of writes) this._applySet(k, d);
                    return;
                }
            }
            throw new Error('RaceCloud.runTransaction: exhausted retries');
        });
        fbd.writeBatch.mockImplementation(() => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }));
        fbd.getDocs.mockResolvedValue({ forEach() {}, docs: [] });
    }
    seedDay(records) {
        this.docs.set(dayKey(), { records: JSON.parse(JSON.stringify(records)) });
    }
    dayDoc() {
        return this.docs.get(dayKey())?.records || {};
    }
}

/** Two-device graph: NO local IDB needed — the connected daily path only
 * touches the cloud seam + explicit scope. Separate module registries make
 * genuinely independent client instances. */
async function lightClient(dbName, cloud) {
    jest.resetModules();
    globalThis.indexedDB = PERSISTENT_IDB;
    const [flags, fbd, fsMod] = await Promise.all([
        import('actual/config/FeatureFlags.js'),
        import('../data/firebase.js'),
        import('actual/services/FirebaseService.js')
    ]);
    cloud.install(fbd);
    fbd.auth.currentUser = { uid: UID };
    flags.setProjectsEnabled(true); // connected scoped world ⇒ transactional path
    return { name: dbName, firebase: fsMod.default, fbd };
}

/** Full graph (real-IDB project stores) for the tombstone effective-project item. */
async function projectGraph(dbName) {
    jest.resetModules();
    globalThis.indexedDB = PERSISTENT_IDB;
    const [realIdb, mockIdb, flags, storeMod, projMod, defMod, ctxMod, fbd, fsMod, writerMod] = await Promise.all([
        import('actual/services/IndexedDBService.js'),
        import('../modules/services/IndexedDBService.js'),
        import('actual/config/FeatureFlags.js'),
        import('actual/features/projects/ProjectStore.js'),
        import('actual/features/projects/Project.js'),
        import('actual/features/projects/DefaultProject.js'),
        import('actual/features/projects/ProjectContext.js'),
        import('../data/firebase.js'),
        import('actual/services/FirebaseService.js'),
        import('actual/features/attendance/AttendanceRecordWriter.js')
    ]);
    const svc = mockIdb.indexedDBService;
    const real = new realIdb.IndexedDBService(dbName);
    Object.assign(svc, { dbName: real.dbName, version: real.version, db: null, isInitialized: false });
    for (const name of Object.getOwnPropertyNames(realIdb.IndexedDBService.prototype)) {
        if (name !== 'constructor') svc[name] = realIdb.IndexedDBService.prototype[name];
    }
    const cloud = new RaceCloud();
    cloud.install(fbd);
    fbd.auth.currentUser = { uid: UID };
    return {
        db: svc,
        cloud,
        fbd,
        firebase: fsMod.default,
        tombstoneWrite: writerMod.tombstoneAttendanceWrite,
        setFlag: enabled => flags.setProjectsEnabled(enabled),
        ensureDefault: () => defMod.defaultProjectService.ensureDefaultProject(),
        createProject: name => storeMod.projectStore.create(projMod.Project.create({ name })),
        listProjects: () => storeMod.projectStore.listAll(),
        setActiveProject: id => ctxMod.setActiveProjectId(id),
        getScope: ctxMod.getEntityScope,
        inScope: ctxMod.entityInScope
    };
}

const rec = (empId, hours, updatedAt, projectId) => {
    const r = {
        employeeId: empId, date: DATE, present: true, hoursWorked: hours,
        overtimeHours: 0, isHoliday: false, selectedPosition: null, multiPosition: false,
        positionHours: [], notes: '', updatedAt
    };
    if (projectId !== undefined) r.projectId = projectId;
    return r;
};

beforeEach(() => localStorage.clear());
afterEach(() => {
    delete window.currentUser;
    delete globalThis.createFirebaseSnapshot;
    localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────
// ITEM 1 — TRUE two-client concurrency over ONE shared cloud
// ─────────────────────────────────────────────────────────────────────
describe('F1.5 micro-closure — TRUE two-client cloud concurrency', () => {
    test('SAME scope race: both edits conserved {Juan:10, Pedro:9}', async () => {
        const cloud = new RaceCloud();
        cloud.seedDay({
            [`J-${DATE}`]: rec('J', 8, 1000, DEF),
            [`P-${DATE}`]: rec('P', 8, 1000, DEF)
        });
        cloud.armBarrier(dayKey(), 2);
        const a = await lightClient('mc-race-a', cloud);
        const b = await lightClient('mc-race-b', cloud);
        const scope = { enabled: true, projectId: DEF, defaultProjectId: DEF };

        // Moment 2: each device prepares ITS edit on its full local day map.
        // Moments 1+3+4: both reads completed pre-write via the barrier, then
        // both writes land. Required: {A-Juan:10, B-Pedro:9} — no lost update.
        await Promise.all([
            a.firebase.saveDailyAttendance(DATE, {
                [`J-${DATE}`]: rec('J', 10, 2000, DEF),
                [`P-${DATE}`]: rec('P', 8, 1000, DEF)
            }, { scope }),
            b.firebase.saveDailyAttendance(DATE, {
                [`J-${DATE}`]: rec('J', 8, 1000, DEF),
                [`P-${DATE}`]: rec('P', 9, 3000, DEF)
            }, { scope })
        ]);

        expect(cloud.barrierConsumed).toBe(true); // the race really happened
        const doc = cloud.dayDoc();
        expect(doc[`J-${DATE}`].hoursWorked).toBe(10);
        expect(doc[`J-${DATE}`].updatedAt).toBe(2000);
        expect(doc[`P-${DATE}`].hoursWorked).toBe(9);
        expect(doc[`P-${DATE}`].updatedAt).toBe(3000);
        expect(a.fbd.runTransaction).toHaveBeenCalled(); // connected path is transactional
    });

    test('CROSS scope race (documentation): scoped payloads already conserve both edits', async () => {
        const cloud = new RaceCloud();
        cloud.seedDay({
            [`J-${DATE}`]: rec('J', 8, 1000, PA),
            [`P-${DATE}`]: rec('P', 8, 1000, PB)
        });
        cloud.armBarrier(dayKey(), 2);
        const a = await lightClient('mc-xs-a', cloud);
        const b = await lightClient('mc-xs-b', cloud);

        await Promise.all([
            a.firebase.saveDailyAttendance(DATE, {
                [`J-${DATE}`]: rec('J', 10, 2000, PA)
            }, { scope: { enabled: true, projectId: PA, defaultProjectId: DEF } }),
            b.firebase.saveDailyAttendance(DATE, {
                [`P-${DATE}`]: rec('P', 9, 3000, PB)
            }, { scope: { enabled: true, projectId: PB, defaultProjectId: DEF } })
        ]);

        const doc = cloud.dayDoc();
        expect(doc[`J-${DATE}`].hoursWorked).toBe(10);
        expect(doc[`P-${DATE}`].hoursWorked).toBe(9);
    });
});

// ─────────────────────────────────────────────────────────────────────
// ITEM 2 — legacy tombstone effective-project edge
// ─────────────────────────────────────────────────────────────────────
describe('F1.5 micro-closure — legacy tombstone inherits EFFECTIVE project', () => {
    async function world(dbName) {
        const g = await projectGraph(dbName);
        g.setFlag(true);
        const def = await g.ensureDefault();
        const projB = await g.createProject('Obra B');
        await g.setActiveProject(projB.id);
        const scopeB = await g.getScope();
        return { g, def, projB, scopeB };
    }

    test('deleting LEGACY Juan while B is active tags the tombstone DEFAULT (not B)', async () => {
        const { g, def, projB } = await world('mc-tomb-unit');
        const legacy = rec('J', 8, 1000); // NO projectId
        const t = g.tombstoneWrite(legacy, 5555);
        expect(t.present).toBe(false);
        expect(t.deletedAt).toBe(5555);
        expect(t.projectId).toBe(def.id);          // frozen rule — was projB.id before
        expect(g.inScope(t, await g.getScope())).toBe(false); // NOT visible under B
        expect(projB.id).not.toBe(def.id);
    });

    test('sync keeps the DEFAULT tag into the daily doc; B-scoped uploads leave it intact', async () => {
        const { g, def, projB, scopeB } = await world('mc-tomb-cloud');
        const t = g.tombstoneWrite(rec('J', 8, 1000), 5555);

        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: t
        }, { scope: { enabled: true, projectId: def.id, defaultProjectId: def.id } });
        let doc = g.cloud.dayDoc();
        expect(doc[`J-${DATE}`]).toMatchObject({ present: false, deletedAt: 5555, projectId: def.id });

        // B writes its own day carrying the foreign tombstone along: excluded.
        await g.firebase.saveDailyAttendance(DATE, {
            [`J-${DATE}`]: t,
            [`P-${DATE}`]: rec('P', 9, 6000, projB.id)
        }, { scope: scopeB });
        doc = g.cloud.dayDoc();
        expect(doc[`P-${DATE}`].hoursWorked).toBe(9);
        expect(doc[`J-${DATE}`]).toMatchObject({ deletedAt: 5555, projectId: def.id, updatedAt: 5555 });
    });

    test('explicit-project record keeps its OWN tag (never re-labeled)', async () => {
        const { g } = await world('mc-tomb-explicit');
        const owned = g.tombstoneWrite(rec('J', 8, 1000, PA), 42);
        expect(owned.projectId).toBe(PA);
    });

    test('flag OFF ⇒ writer adds NO projectId (legacy parity byte-exact)', async () => {
        const g = await projectGraph('mc-tomb-off');
        g.setFlag(false);
        await g.getScope();
        const t = g.tombstoneWrite(rec('J', 8, 1000), 7);
        expect(Object.prototype.hasOwnProperty.call(t, 'projectId')).toBe(false);
        expect(t.deletedAt).toBe(7);
        expect(t.present).toBe(false);
    });
});
