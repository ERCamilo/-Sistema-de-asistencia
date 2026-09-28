/**
 * H1 — un cierre schema 2 sin obra puede llegar a una obra por dos caminos:
 *   - promoción en la nube (mismo id, identityKind promoted-legacy), o
 *   - copia de la recuperación financiera (id nuevo, recovery.sourceId).
 * Ambos a la vez duplicarían la nómina. Las barreras son fail-closed:
 *   G1 la nube no promueve si ya existe una copia en cualquier obra;
 *   G2 la copia no sube si el original ya fue promovido (lectura transaccional,
 *      con reintento por concurrencia optimista como Firestore);
 *   G3 el almacén local rechaza importar el camino contrario al que ya tiene.
 * La nube es un Firestore en memoria; el repositorio y el almacén son reales.
 */
import 'fake-indexeddb/auto';
import * as firebase from '../modules/data/firebase.js';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    PayrollClosureRepository,
    _payrollClosureRepositoryInternals as repo
} from '../modules/features/payroll/PayrollClosureRepository.js';
import { PayrollClosureStore, PayrollClosureConflictError } from '../modules/features/payroll/PayrollClosureStore.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot, promoteLegacyPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { planFinancialRecovery } from '../modules/features/projects/ProjectFinancialRecovery.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const DEFAULT = 'PRJ-DEFAULT';
const OTHER = 'PRJ-OTHER';
const clone = value => JSON.parse(JSON.stringify(value));

function legacyClosure() {
    const options = { periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 100,
        rows: [{ _employeeId: 'e', _number: '1', _employeeName: 'Ana', _brutoOriginal: 1000, _loans: 100, monto: 900 }] };
    return buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
}

function recoveryCopy(legacy, target) {
    const projects = [{ id: DEFAULT, status: 'active' }, { id: OTHER, status: 'active' }];
    const plan = planFinancialRecovery({
        employees: [{ id: 'e', name: 'Ana', projectId: target, loans: [] }],
        projects, payrollClosures: [legacy], employeeIds: ['e'], targetProjectId: target, timestamp: 500
    });
    expect(plan.closures).toHaveLength(1);
    return plan.closures[0];
}

// Firestore en memoria con concurrencia optimista: si un documento leído cambia
// antes del commit, la transacción se reintenta (como el SDK web).
function installCloud() {
    const docs = new Map();
    const versions = new Map();
    const hooks = { beforeCommit: null };
    const path = ref => ref.path;
    const put = (key, data) => { docs.set(key, clone(data)); versions.set(key, (versions.get(key) || 0) + 1); };
    firebase.collection.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    firebase.doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    firebase.where.mockImplementation((field, op, value) => ({ field, op, value }));
    firebase.orderBy.mockImplementation(() => ({ type: 'orderBy' }));
    firebase.limit.mockImplementation(() => ({ type: 'limit' }));
    firebase.documentId.mockImplementation(() => '__name__');
    firebase.query.mockImplementation((ref, ...constraints) => ({ ...ref, constraints }));
    const read = key => {
        const data = docs.get(key);
        return { id: key.split('/').pop(), exists: () => data !== undefined, data: () => (data ? clone(data) : null) };
    };
    const nested = (data, field) => field.split('.').reduce((value, part) => value?.[part], data);
    firebase.getDoc.mockImplementation(async ref => read(path(ref)));
    firebase.getDocs.mockImplementation(async ref => {
        const items = [...docs.entries()].filter(([key, data]) => key.startsWith(`${ref.path}/`)
            && (ref.constraints || []).every(c => !c.field || nested(data, c.field) === c.value))
            .map(([key]) => read(key));
        return { docs: items, forEach: cb => items.forEach(cb) };
    });
    firebase.runTransaction.mockImplementation(async (_db, operation) => {
        for (let attempt = 0; attempt < 5; attempt++) {
            const seen = new Map();
            const writes = [];
            const result = await operation({
                get: async ref => { seen.set(path(ref), versions.get(path(ref)) || 0); return read(path(ref)); },
                set: (ref, data) => writes.push([path(ref), data])
            });
            const hook = hooks.beforeCommit;
            hooks.beforeCommit = null;
            if (hook) await hook();
            if ([...seen].some(([key, version]) => (versions.get(key) || 0) !== version)) continue;
            writes.forEach(([key, data]) => put(key, data));
            return result;
        }
        throw new Error('transaction retries exhausted');
    });
    return { docs, hooks, put, key: id => `users/user-1/payrollClosures/${id}` };
}

describe('H1: copia de recuperación vs promoción en la nube', () => {
    let cloud;

    beforeEach(() => {
        firebase.auth.currentUser = { uid: 'user-1' };
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        cloud = installCloud();
    });

    afterEach(() => {
        setProjectsEnabled(false);
        resetEntityScope();
        delete firebase.auth.currentUser;
        jest.restoreAllMocks();
    });

    const scope = { projectId: DEFAULT, defaultProjectId: DEFAULT };

    test('G2: la copia no sube si otro dispositivo ya promovió el original', async () => {
        const legacy = legacyClosure();
        cloud.put(cloud.key(legacy.id), promoteLegacyPayrollClosure(legacy, DEFAULT));
        const copy = recoveryCopy(legacy, DEFAULT);

        await expect(PayrollClosureRepository.saveRecoveredClosure(copy))
            .rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_RECOVERY_CONFLICT', sourceId: legacy.id });
        expect(cloud.docs.has(cloud.key(copy.id))).toBe(false);
    });

    test('G2: la promoción que llega durante la subida hace reintentar y la copia se rechaza', async () => {
        const legacy = legacyClosure();
        cloud.put(cloud.key(legacy.id), legacy);
        const copy = recoveryCopy(legacy, OTHER);
        cloud.hooks.beforeCommit = async () => { cloud.put(cloud.key(legacy.id), promoteLegacyPayrollClosure(legacy, DEFAULT)); };

        await expect(PayrollClosureRepository.saveRecoveredClosure(copy))
            .rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_RECOVERY_CONFLICT' });
        expect(cloud.docs.has(cloud.key(copy.id))).toBe(false);
        expect(cloud.docs.get(cloud.key(legacy.id)).identityKind).toBe('promoted-legacy');
    });

    test('G1: con una copia en otra obra, la obra por defecto no promueve el original', async () => {
        const legacy = legacyClosure();
        cloud.put(cloud.key(legacy.id), legacy);
        const copy = recoveryCopy(legacy, OTHER);
        await PayrollClosureRepository.saveRecoveredClosure(copy);

        await expect(repo.promoteLegacyCloudClosure(legacy, scope)).resolves.toBeNull();
        expect(cloud.docs.get(cloud.key(legacy.id))).toEqual(legacy);   // sigue schema 2, sin obra
        const page = await repo.loadPageScoped({ limit: 10 }, scope);
        expect(page.items.map(item => item.id)).not.toContain(legacy.id);
    });

    test('copia en la misma obra: la promoción devuelve la copia y el reintento de subida es idempotente', async () => {
        const legacy = legacyClosure();
        cloud.put(cloud.key(legacy.id), legacy);
        const copy = recoveryCopy(legacy, DEFAULT);
        await PayrollClosureRepository.saveRecoveredClosure(copy);
        await expect(PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: false });

        await expect(repo.promoteLegacyCloudClosure(legacy, scope)).resolves.toMatchObject({ id: copy.id });
        expect(cloud.docs.get(cloud.key(legacy.id)).schemaVersion).toBe(2);
        // original + copia + cerrojo M1 (payrollClosureClaims/<origen>)
        expect([...cloud.docs.keys()]).toHaveLength(3);
        expect(cloud.docs.get(`users/user-1/payrollClosureClaims/${legacy.id}`)).toMatchObject({ kind: 'recovery-copy', targetId: copy.id });
    });

    test('un v3 de una obra borrada sigue siendo recuperable (la barrera solo mira promociones)', async () => {
        const options = { projectId: 'PRJ-BORRADA', periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 100,
            rows: [{ _employeeId: 'e', _number: '1', _employeeName: 'Ana', _brutoOriginal: 1000, monto: 1000 }] };
        const orphan = buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
        cloud.put(cloud.key(orphan.id), orphan);
        const copy = recoveryCopy(orphan, DEFAULT);
        await expect(PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: true });
    });
});

describe('H1: el almacén local no admite ambos caminos', () => {
    let db, store;

    beforeEach(async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        db = new IndexedDBService('h1-local-' + Math.random());
        await db.init();
        store = new PayrollClosureStore({ db });
    });

    afterEach(() => {
        setProjectsEnabled(false);
        resetEntityScope();
        db.db.close();
    });

    test('G3: con solo la copia local (p. ej. restaurada de un respaldo), el promovido remoto queda en conflicto', async () => {
        const legacy = legacyClosure();
        const copy = recoveryCopy(legacy, DEFAULT);
        await db.update('payrollClosures', copy);
        const before = await db.getAll('payrollClosures');

        await expect(store.importRemote(promoteLegacyPayrollClosure(legacy, DEFAULT), { scope: { projectId: DEFAULT } }))
            .rejects.toBeInstanceOf(PayrollClosureConflictError);
        expect(await db.getAll('payrollClosures')).toEqual(before);
    });

    test('G3: con el promovido local, la copia remota queda en conflicto', async () => {
        const legacy = legacyClosure();
        const promoted = promoteLegacyPayrollClosure(legacy, DEFAULT);
        await db.update('payrollClosures', promoted);
        const copy = recoveryCopy(legacy, DEFAULT);

        await expect(store.importRemote(copy, { scope: { projectId: DEFAULT } }))
            .rejects.toBeInstanceOf(PayrollClosureConflictError);
        expect(await db.getAll('payrollClosures')).toEqual([promoted]);
    });

    test('sin el otro camino, promovido y copia se importan y el reintento es idempotente', async () => {
        const legacy = legacyClosure();
        await store.importRemote(promoteLegacyPayrollClosure(legacy, DEFAULT), { scope: { projectId: DEFAULT } });
        await store.importRemote(promoteLegacyPayrollClosure(legacy, DEFAULT), { scope: { projectId: DEFAULT } });
        expect(await db.getAll('payrollClosures')).toHaveLength(1);
    });
});

test('la cola principal dead-letterea el conflicto de recuperación sin reintentos', async () => {
    const { nextEntryState } = await import('../modules/services/SyncErrorClassifier.js');
    const { recoverySourcePromotedError } = await import('../modules/features/payroll/PayrollClosureRepository.js');
    expect(nextEntryState({ attempts: 0 }, recoverySourcePromotedError('legacy-1'), 5)).toMatchObject({ status: 'dead', attempts: 1 });
});
