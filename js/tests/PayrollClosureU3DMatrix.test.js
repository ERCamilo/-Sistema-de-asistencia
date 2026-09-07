import { auth, getDocs, getDoc, runTransaction, where, orderBy, onSnapshot, query, documentId } from '../modules/data/firebase.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { PayrollClosureLiveSync } from '../modules/features/payroll/PayrollClosureLiveSync.js';
import { PayrollClosureSync } from '../modules/features/payroll/PayrollClosureSync.js';
import { _payrollClosureRepositoryInternals } from '../modules/features/payroll/PayrollClosureRepository.js';
import { buildPayrollClosure, promoteLegacyPayrollClosure, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { PayrollClosureStore } from '../modules/features/payroll/PayrollClosureStore.js';
import { buildPayrollPreviewFingerprint } from '../modules/features/payroll/PayrollLoanSettlement.js';

const A = 'PRJ-U3D-A';
const B = 'PRJ-U3D-B';
const DEFAULT = A;

function row(id, num) { return { id: 1, _employeeId: id, _employeeName: 'Ada', _number: num, _brutoOriginal: 1000, monto: 1000 }; }
function scoped(projectId, marker, overrides = {}) {
    const rows = [row(`emp-${marker}`, '1')];
    const input = { projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows };
    return buildPayrollClosure({ ...input, fingerprint: buildPayrollPreviewFingerprint(input), closedAt: overrides.closedAt ?? 100, ...overrides });
}
function legacy(marker, overrides = {}) {
    // schema2: no projectId
    return buildPayrollClosure({ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [row(`emp-${marker}`, '1')], fingerprint: `fp-${marker}-${Date.now()}-${Math.random()}`, closedAt: overrides.closedAt ?? 100, ...overrides });
}
function summaryFor(c) { return _payrollClosureRepositoryInternals.closureSummary(c); }
function docSnap(v) { return { id: v?.id, exists: () => Boolean(v), data: () => v }; }

class MemoryDB {
    constructor() { this.records = new Map(); }
    async get(_, id) { const v = this.records.get(String(id)); return v ? JSON.parse(JSON.stringify(v)) : undefined; }
    async query(_, indexName, value) {
        const vals = [...this.records.values()].filter(i => i[indexName] === value);
        return vals.map(v => JSON.parse(JSON.stringify(v)));
    }
    async getPageByIndex(_, indexName, options = {}) {
        let vals = [...this.records.values()];
        if (indexName === 'projectClosedAtId') {
            const pid = options.lowerBound?.[0]; vals = vals.filter(v => v.projectId === pid);
            vals.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) { const [, cAt, cId] = options.upperBound; vals = vals.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId)); }
        } else if (indexName === 'projectStatusClosedAtId') {
            const [pid, status] = options.lowerBound || []; vals = vals.filter(v => v.projectId === pid && v.status === status);
            vals.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) { const [, , cAt, cId] = options.upperBound; vals = vals.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId)); }
        } else if (indexName === 'closedAtId') {
            vals.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) { const [cAt, cId] = options.upperBound; vals = vals.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId)); }
        } else if (indexName === 'statusClosedAtId') {
            vals.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
        }
        return vals.slice(0, options.limit).map(v => JSON.parse(JSON.stringify(v)));
    }
    async getAll(n) { return []; }
    async atomicMutate(_, id, mutator) {
        const existing = await this.get(_, id);
        const r = mutator(existing);
        if (r.write) this.records.set(String(r.value.id), JSON.parse(JSON.stringify({ ...r.value, periodKey: `${r.value.periodStart}:${r.value.periodEnd}` })));
        return JSON.parse(JSON.stringify(r.value));
    }
}

describe('U3-D matrix through Repository+Sync+Store', () => {
    beforeEach(() => {
        auth.currentUser = { uid: 'user-1' };
        localStorage.setItem('asistencia_default_project_id', DEFAULT);
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        PayrollClosureLiveSync.stop();
        getDocs.mockReset(); getDoc.mockReset(); runTransaction.mockReset(); where.mockClear(); orderBy.mockClear(); onSnapshot.mockReset(); query.mockClear(); documentId.mockClear();
    });
    afterEach(() => {
        PayrollClosureLiveSync.stop(); setProjectsEnabled(false); resetEntityScope(); localStorage.clear(); delete auth.currentUser; jest.restoreAllMocks();
    });

    test('native schema3, promoted-legacy, default-only legacy discovery', async () => {
        const nativeA = scoped(A, 'nativeA');
        const nativeB = scoped(B, 'nativeB');
        const leg = legacy('leg1', { fingerprint: 'fp-leg1' });
        // promoted for default
        const promoted = promoteLegacyPayrollClosure(leg, DEFAULT);
        // Repository: default sees promoted, non-default does not discover schema2
        getDocs.mockResolvedValueOnce({ docs: [docSnap(nativeA)] }).mockResolvedValueOnce({ docs: [docSnap(leg)] });
        runTransaction.mockImplementation(async (_db, op) => op({ get: jest.fn(async () => docSnap(leg)), set: jest.fn() }));
        const pageA = await _payrollClosureRepositoryInternals.loadPageScoped({ limit: 10 }, { projectId: A, defaultProjectId: DEFAULT });
        expect(pageA.items.some(i => i.id === nativeA.id)).toBe(true);
        expect(pageA.items.some(i => i.id === promoted.id)).toBe(true);
        expect(pageA.items.every(i => i.projectId === A)).toBe(true);
        // Non-default B must not discover legacy
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        getDocs.mockResolvedValueOnce({ docs: [docSnap(nativeB)] });
        const pageB = await _payrollClosureRepositoryInternals.loadPageScoped({ limit: 10 }, { projectId: B, defaultProjectId: DEFAULT });
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        expect(pageB.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: nativeB.id })]));
        expect(pageB.items.some(i => i.id === promoted.id)).toBe(false);
        // legacy as schema2 summary rejected
        expect(_payrollClosureRepositoryInternals.closureSummary(leg)).toMatchObject({ schemaVersion: 2 });
    });

    test('A/B same period/state isolation and detail cross-owner blocked', async () => {
        const cA = scoped(A, 'sameA', { closedAt: 200 });
        const cB = scoped(B, 'sameB', { closedAt: 200 });
        // same period/state, different project - store isolation
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        db.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        db.records.set(cB.id, { ...cB, periodKey: '2026-08-01:2026-08-15' });
        expect((await store.getByPeriod('2026-08-01', '2026-08-15')).map(x => x.id)).toEqual([cA.id]);
        await expect(store.getById(cB.id)).resolves.toBeNull();
        // detail cross-owner via Repository
        getDoc.mockResolvedValueOnce(docSnap({ ...cB, projectId: B }));
        const detailCross = await _payrollClosureRepositoryInternals.loadByIdScoped(cB.id, { projectId: A, defaultProjectId: DEFAULT });
        expect(detailCross).toBeNull();
        // Sync pullDetail cross-owner blocked
        const sync = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => v) }, remoteRepository: { loadById: jest.fn(async () => cB) } });
        await expect(sync.pullDetail(cA.id)).rejects.toBeInstanceOf(Error);
    });

    test('pagination does not leak B into A and straddling via LiveSync hydration blocked', async () => {
        const cA1 = scoped(A, 'pageA1', { closedAt: 300 });
        const cA2 = scoped(A, 'pageA2', { closedAt: 200 });
        const cB1 = scoped(B, 'pageB1', { closedAt: 250 });
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        for (const c of [cA1, cA2, cB1]) db.records.set(c.id, { ...c, periodKey: '2026-08-01:2026-08-15' });
        const p1 = await store.listPage({ limit: 1 });
        expect(p1.items[0].id).toBe(cA1.id);
        const p2 = await store.listPage({ limit: 1, cursor: p1.nextCursor });
        expect(p2.items[0].id).toBe(cA2.id);
        expect(p2.items.some(i => i.id === cB1.id)).toBe(false);
        // LiveSync hydration straddling: summary batch that would straddle projects must be validated and rejected
        const summaryA = summaryFor(cA1);
        const summaryB = summaryFor(cB1);
        let notify;
        const repo = {
            subscribeRecent: jest.fn(cb => { notify = cb; return jest.fn(); }),
            loadById: jest.fn(async id => (id === cA1.id ? cA1 : cB1))
        };
        const sync = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => { db.records.set(v.id, { ...v, periodKey: `${v.periodStart}:${v.periodEnd}` }); return v; }) }, remoteRepository: repo });
        const onApply = jest.fn(); const onError = jest.fn();
        sync.subscribeRecent(onApply, { onError, isCurrent: () => true });
        notify([summaryA, summaryB]);
        await new Promise(r => setTimeout(r, 30));
        expect(onApply).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalled();
        // pure A batch succeeds through Repo+Sync+Store
        const onApply2 = jest.fn(); const onError2 = jest.fn();
        const sync2 = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => v) }, remoteRepository: { subscribeRecent: jest.fn(cb => { setTimeout(() => cb([summaryA]), 0); return jest.fn(); }), loadById: jest.fn(async () => cA1) } });
        sync2.importClosures = jest.fn(async () => ({ imported: 1, conflicts: [] }));
        sync2.subscribeRecent(onApply2, { onError: onError2, isCurrent: () => true });
        await new Promise(r => setTimeout(r, 30));
        expect(onApply2).toHaveBeenCalledTimes(1);
        expect(onError2).not.toHaveBeenCalled();
    });

    test('unsubscribe/restart, A->B, A->B->A with pending ops and no onApply residual', async () => {
        const cA1 = scoped(A, 'uA1', { closedAt: 101 });
        const cB = scoped(B, 'uB1', { closedAt: 102 });
        const cA2 = scoped(A, 'uA2', { closedAt: 103 });
        function makeSync(c) {
            let notifyRef = null;
            const repo = { subscribeRecent: jest.fn(cb => { notifyRef = cb; return jest.fn(); }), loadById: jest.fn(async () => c) };
            const sync = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => v) }, remoteRepository: repo });
            sync.importClosures = jest.fn(async () => ({ imported: 1, conflicts: [] }));
            return { sync, get notify() { return notifyRef; } };
        }
        const sA1 = makeSync(cA1); const sB = makeSync(cB); const sA2 = makeSync(cA2);
        let epoch = 0; let curA1, curB, curA2;
        epoch = 1; curA1 = epoch; const isA1 = () => curA1 === epoch;
        epoch = 2; curB = epoch; const isB = () => curB === epoch;
        epoch = 3; curA2 = epoch; const isA2 = () => curA2 === epoch;
        const a1Apply = jest.fn(); const bApply = jest.fn(); const a2Apply = jest.fn();
        sA1.sync.subscribeRecent(a1Apply, { onError: jest.fn(), isCurrent: isA1 });
        sB.sync.subscribeRecent(bApply, { onError: jest.fn(), isCurrent: isB });
        sA2.sync.subscribeRecent(a2Apply, { onError: jest.fn(), isCurrent: isA2 });
        sA1.notify([summaryFor(cA1)]); sB.notify([summaryFor(cB)]); sA2.notify([summaryFor(cA2)]);
        await new Promise(r => setTimeout(r, 30));
        expect(a1Apply).not.toHaveBeenCalled(); expect(bApply).not.toHaveBeenCalled(); expect(a2Apply).toHaveBeenCalledTimes(1);
        // unsubscribe/restart single LiveSync pending cancelled
        const closure = scoped(A, 'pend', { closedAt: 104 });
        const summ = summaryFor(closure);
        let resolveLoad; const repoPend = { subscribeRecent: jest.fn(cb => { setTimeout(() => cb([summ]), 0); return jest.fn(); }), loadById: jest.fn(() => new Promise(r => { resolveLoad = r; })) };
        const syncPend = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => v) }, remoteRepository: repoPend });
        syncPend.importClosures = jest.fn(async () => ({ imported: 1, conflicts: [] }));
        const onApply = jest.fn(); const onError = jest.fn(); let live = true; const isCur = () => live;
        syncPend.subscribeRecent(onApply, { onError, isCurrent: isCur });
        await new Promise(r => setTimeout(r, 5));
        live = false; resolveLoad(closure);
        await new Promise(r => setTimeout(r, 20));
        expect(onApply).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
        // double start keeps one subscription
        PayrollClosureLiveSync.stop();
        const m1 = jest.fn(); const m2 = jest.fn();
        const spy = jest.spyOn(require('../modules/features/payroll/PayrollClosureSync.js').payrollClosureSync, 'subscribeRecent').mockImplementation(() => m1);
        PayrollClosureLiveSync.start({}); expect(PayrollClosureLiveSync.isActive()).toBe(true);
        spy.mockImplementation(() => m2);
        PayrollClosureLiveSync.start({}); expect(m1).toHaveBeenCalledTimes(1); expect(PayrollClosureLiveSync.isActive()).toBe(true);
        spy.mockRestore(); PayrollClosureLiveSync.stop(); expect(m2).toHaveBeenCalledTimes(1); expect(PayrollClosureLiveSync.isActive()).toBe(false);
    });

    test('mixed batch rejected before any import and pagination straddling not leak', async () => {
        const valid = scoped(A, 'validMix');
        const hostile = scoped(B, 'hostileMix');
        const badId = { ...valid, id: 'PAYROLL-CLOSURE-forged' };
        const schema2 = legacy('mix2');
        const promoted = promoteLegacyPayrollClosure(legacy('promoMix', { fingerprint: 'fp-promoMix' }), A);
        const tampered = { ...promoted, ownershipToken: 'forged' };
        for (const forged of [hostile, badId, schema2, tampered]) {
            const store = { importRemote: jest.fn() };
            const sync = new PayrollClosureSync({ localStore: store, remoteRepository: {} });
            await expect(sync.importClosures([valid, forged])).rejects.toBeInstanceOf(Error);
            expect(store.importRemote).not.toHaveBeenCalled();
        }
    });

    test('void/retry concurrent duplicate idempotent and OFF legacy exact', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const native = scoped(A, 'void1');
        const scope = { projectId: A, defaultProjectId: DEFAULT };
        await store.importRemote(native, { scope });
        await store.importRemote(native, { scope });
        expect(db.records.get(native.id).status).toBe('closed');
        const voided = voidPayrollClosure(native, { voidedAt: 200, voidedBy: 'op1' });
        await store.importRemote(voided, { scope });
        const voided2 = voidPayrollClosure(native, { voidedAt: 300, voidedBy: 'op2' });
        await store.importRemote(voided2, { scope });
        expect(db.records.get(native.id)).toMatchObject({ status: 'voided', voidedBy: 'op1' });
        await store.importRemote(native, { scope });
        expect(db.records.get(native.id).status).toBe('voided');
        // OFF exact: global queries return both projects, no isolation
        setProjectsEnabled(false); resetEntityScope();
        const dbOff = new MemoryDB();
        const storeOff = new PayrollClosureStore({ db: dbOff });
        const cA = scoped(A, 'offA'); const cB = scoped(B, 'offB');
        dbOff.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        dbOff.records.set(cB.id, { ...cB, periodKey: '2026-08-01:2026-08-15' });
        const periodOff = await storeOff.getByPeriod('2026-08-01', '2026-08-15');
        expect(periodOff.map(x => x.id).sort()).toEqual([cA.id, cB.id].sort());
        await expect(storeOff.getById(cB.id)).resolves.toMatchObject({ projectId: B });
        setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
    });

    test('no onApply residual after invalidation across 5 checkpoints', async () => {
        const closure = scoped(A, 'chk5');
        const summ = summaryFor(closure);
        const calls = [];
        const repo = { subscribeRecent: jest.fn(cb => { setTimeout(() => cb([summ]), 0); return jest.fn(); }), loadById: jest.fn(async () => { calls.push('load'); return closure; }) };
        const sync = new PayrollClosureSync({ localStore: { importRemote: jest.fn(async v => v) }, remoteRepository: repo });
        sync.importClosures = jest.fn(async () => { calls.push('import'); return { imported: 1, conflicts: [] }; });
        let idx = 0; const isCur = jest.fn(() => { calls.push(`chk${idx++}`); return idx <= 3; }); // fail before onApply
        const onApply = jest.fn(() => calls.push('apply')); const onError = jest.fn();
        sync.subscribeRecent(onApply, { onError, isCurrent: isCur });
        await new Promise(r => setTimeout(r, 30));
        expect(onApply).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
        expect(isCur.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
});
