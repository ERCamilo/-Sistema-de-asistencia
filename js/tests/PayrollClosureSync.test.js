import {
    auth,
    getDocs,
    getDoc,
    limit as firestoreLimit,
    onSnapshot,
    runTransaction,
    startAfter,
    where
} from '../modules/data/firebase.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import { buildPayrollClosure, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { PayrollClosureConflictError } from '../modules/features/payroll/PayrollClosureStore.js';
import { PayrollClosureRepository } from '../modules/features/payroll/PayrollClosureRepository.js';
import { _payrollClosureRepositoryInternals } from '../modules/features/payroll/PayrollClosureRepository.js';
import { PayrollClosureSync } from '../modules/features/payroll/PayrollClosureSync.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import fs from 'fs';
import path from 'path';

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const FIRESTORE_INDEXES = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../firestore.indexes.json'),
    'utf8'
));

function closure(fingerprint, overrides = {}) {
    return buildPayrollClosure({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        rows: [{
            id: 1,
            _employeeId: 'employee-1',
            _employeeName: 'Ada',
            _number: '1',
            _brutoOriginal: 1000,
            monto: 1000
        }],
        fingerprint,
        closedAt: 100,
        ...overrides
    });
}

function docSnapshot(value) {
    return {
        id: value?.id,
        exists: () => Boolean(value),
        data: () => value
    };
}

describe('PayrollClosureRepository', () => {
    beforeEach(() => {
        auth.currentUser = { uid: 'user-1' };
        runTransaction.mockReset();
        getDocs.mockReset();
        getDoc.mockReset();
        firestoreLimit.mockClear();
        onSnapshot.mockReset();
        startAfter.mockClear();
        where.mockClear();
    });

    afterEach(() => {
        delete auth.currentUser;
    });

    test('creates a dedicated immutable document and makes an exact retry a no-op', async () => {
        let remote = null;
        const set = jest.fn((_ref, value) => { remote = JSON.parse(JSON.stringify(value)); });
        runTransaction.mockImplementation(async (_db, operation) => operation({
            get: jest.fn(async () => docSnapshot(remote)),
            set
        }));
        const original = closure('cloud-idempotent');

        await expect(PayrollClosureRepository.saveOne(original)).resolves.toMatchObject({
            written: true,
            closure: { id: original.id }
        });
        await expect(PayrollClosureRepository.saveOne(original)).resolves.toMatchObject({
            written: false,
            closure: { id: original.id }
        });
        expect(set).toHaveBeenCalledTimes(1);
    });

    test('preserves the first void audit and rejects different canonical content', async () => {
        const original = closure('cloud-conflict');
        let remote = voidPayrollClosure(original, { voidedAt: 200, voidedBy: 'first' });
        const set = jest.fn((_ref, value) => { remote = value; });
        runTransaction.mockImplementation(async (_db, operation) => operation({
            get: jest.fn(async () => docSnapshot(remote)),
            set
        }));

        await expect(PayrollClosureRepository.saveOne(
            voidPayrollClosure(original, { voidedAt: 300, voidedBy: 'second' })
        )).resolves.toMatchObject({
            written: false,
            closure: { voidedBy: 'first' }
        });
        await expect(PayrollClosureRepository.saveOne({
            ...original,
            totals: { ...original.totals, net: 999 }
        })).rejects.toBeInstanceOf(PayrollClosureConflictError);
        expect(set).not.toHaveBeenCalled();
    });

    test('does not conflict when Firestore-shaped detail keys arrive in a different order', async () => {
        const original = closure('cloud-canonical-details', {
            adjustments: {
                bonuses: [{ employeeId: 'employee-1', detail: { concept: 'Attendance', amount: 50 } }],
                deductions: []
            }
        });
        let remote = JSON.parse(JSON.stringify(original));
        remote.adjustments = {
            deductions: [],
            bonuses: [{ detail: { amount: 50, concept: 'Attendance' }, employeeId: 'employee-1' }]
        };
        const set = jest.fn((_ref, value) => { remote = value; });
        runTransaction.mockImplementation(async (_db, operation) => operation({
            get: jest.fn(async () => docSnapshot(remote)),
            set
        }));

        await expect(PayrollClosureRepository.saveOne(original)).resolves.toMatchObject({
            written: false,
            closure: { id: original.id }
        });
        expect(set).not.toHaveBeenCalled();
    });

    test('fails instead of silently dropping a write when the session disappears', async () => {
        delete auth.currentUser;
        await expect(PayrollClosureRepository.saveOne(closure('no-session')))
            .rejects.toThrow('sesión');
        expect(runTransaction).not.toHaveBeenCalled();
    });

    test('paginates at ten summaries without eagerly returning closure detail', async () => {
        const first = closure('remote-page-1', { closedAt: 300 });
        const second = closure('remote-page-2', { closedAt: 200 });
        getDocs.mockResolvedValue({
            docs: [first, second].map(value => docSnapshot(value))
        });

        await expect(PayrollClosureRepository.loadPage({ limit: 2 })).resolves.toEqual({
            items: [
                expect.not.objectContaining({ rows: expect.anything() }),
                expect.not.objectContaining({ rows: expect.anything() })
            ],
            nextCursor: { closedAt: 200, id: second.id }
        });
        expect(firestoreLimit).toHaveBeenCalledWith(2);
    });

    test('fetches detail and exact-period records only on targeted requests', async () => {
        const original = closure('targeted-detail');
        getDoc.mockResolvedValue(docSnapshot(original));
        getDocs.mockResolvedValue({ docs: [docSnapshot(original)] });

        await expect(PayrollClosureRepository.loadById(original.id)).resolves.toEqual(original);
        await expect(PayrollClosureRepository.loadByPeriod(
            original.periodStart,
            original.periodEnd
        )).resolves.toEqual([original]);
        expect(where).toHaveBeenCalledWith('periodStart', '==', original.periodStart);
        expect(where).toHaveBeenCalledWith('periodEnd', '==', original.periodEnd);
    });

    test('declares the composite index used by filtered cursor pages', () => {
        expect(FIRESTORE_INDEXES.indexes).toContainEqual(expect.objectContaining({
            collectionGroup: 'payrollClosures',
            fields: expect.arrayContaining([
                { fieldPath: 'status', order: 'ASCENDING' },
                { fieldPath: 'closedAt', order: 'DESCENDING' },
                { fieldPath: '__name__', order: 'DESCENDING' }
            ])
        }));
    });
});

describe('Payroll closure outbox and pull sync', () => {
    let outbox;

    beforeEach(() => {
        outbox = [];
        indexedDBService.getAll.mockImplementation(async store =>
            store === 'mainSyncOutbox' ? JSON.parse(JSON.stringify(outbox)) : []
        );
        indexedDBService.update.mockImplementation(async (store, value) => {
            if (store !== 'mainSyncOutbox') return value.id;
            const saved = { ...JSON.parse(JSON.stringify(value)), key: value.key || outbox.length + 1 };
            const index = outbox.findIndex(item => item.key === saved.key);
            if (index >= 0) outbox[index] = saved;
            else outbox.push(saved);
            return saved.key;
        });
        indexedDBService.delete.mockImplementation(async (_store, key) => {
            outbox = outbox.filter(item => item.key !== key);
        });
        indexedDBService.acquireLease.mockResolvedValue(true);
        indexedDBService.renewLease.mockResolvedValue(true);
        indexedDBService.releaseLease.mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('coalesces pending writes by closure id and flushes the newest status', async () => {
        const original = closure('outbox');
        const voided = voidPayrollClosure(original, { voidedAt: 200, voidedBy: 'operator' });
        await MainSyncStore.enqueuePayrollClosure(original);
        await MainSyncStore.enqueuePayrollClosure(voided);
        expect(outbox).toHaveLength(1);
        expect(outbox[0]).toMatchObject({
            kind: 'payrollClosure',
            closureId: original.id,
            closure: { status: 'voided' }
        });

        const savePayrollClosure = jest.fn().mockResolvedValue(undefined);
        await MainSyncStore.flush({
            hasSession: () => true,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            savePayrollClosure,
            onCloudResult: jest.fn()
        });
        expect(savePayrollClosure).toHaveBeenCalledWith(expect.objectContaining({
            id: original.id,
            status: 'voided'
        }));
        expect(outbox).toHaveLength(0);
    });

    test('uploads bundle employee payment state before publishing its closure', async () => {
        const original = closure('bundle-order');
        outbox.push({
            key: `payroll:${original.id}`,
            kind: 'payrollClosureBundle',
            closureId: original.id,
            closure: original,
            employees: [{ id: 'employee-1', loans: [{ payments: [{ id: 'payment-1' }] }] }],
            schemaVersion: 3,
            status: 'pending'
        });
        const calls = [];
        await MainSyncStore.flush({
            hasSession: () => true,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            savePayrollEmployees: jest.fn(async () => { calls.push('employees'); }),
            savePayrollClosure: jest.fn(async () => { calls.push('closure'); }),
            onCloudResult: jest.fn()
        });

        expect(calls).toEqual(['employees', 'closure']);
        expect(outbox).toHaveLength(0);
    });

    test('retains a payroll bundle and never publishes the closure when employee upload fails', async () => {
        const original = closure('bundle-retry');
        outbox.push({
            key: `payroll:${original.id}`,
            kind: 'payrollClosureBundle',
            closureId: original.id,
            closure: original,
            employees: [{ id: 'employee-1' }],
            schemaVersion: 3,
            status: 'pending'
        });
        const savePayrollClosure = jest.fn();
        await MainSyncStore.flush({
            hasSession: () => true,
            isApplyingRemote: () => false,
            isPaused: () => false,
            cloudWatermark: () => 0,
            savePayrollEmployees: jest.fn().mockRejectedValue(new Error('offline')),
            savePayrollClosure,
            onCloudResult: jest.fn()
        });

        expect(savePayrollClosure).not.toHaveBeenCalled();
        expect(outbox).toHaveLength(1);
        expect(outbox[0]).toMatchObject({ status: 'pending', attempts: 1 });
    });

    test('records atomically, pages summaries, and imports only targeted detail or periods', async () => {
        const first = closure('sync-first');
        const second = closure('sync-second', { closedAt: 200 });
        const localStore = {
            save: jest.fn(async value => value),
            saveWithEmployees: jest.fn(async value => value)
        };
        const remoteRepository = {
            loadPage: jest.fn().mockResolvedValue({ items: [{ id: second.id }], nextCursor: null }),
            loadById: jest.fn().mockResolvedValue(second),
            loadByPeriod: jest.fn().mockResolvedValue([second])
        };
        const sync = new PayrollClosureSync({ localStore, remoteRepository, outbox: MainSyncStore });

        await sync.record(first, {
            employees: [{ id: 'employee-1' }],
            schemaVersion: 3,
            queuedAt: 123
        });
        expect(localStore.saveWithEmployees).toHaveBeenCalledWith(
            first,
            [{ id: 'employee-1' }],
            { enqueueCloud: true, schemaVersion: 3, queuedAt: 123 }
        );
        await expect(sync.pullPage({ limit: 10 })).resolves.toEqual({
            items: [{ id: second.id }],
            nextCursor: null
        });
        expect(localStore.save).not.toHaveBeenCalled();
        await expect(sync.pullDetail(second.id)).resolves.toEqual(second);
        expect(localStore.save).toHaveBeenLastCalledWith(second);
        await expect(sync.pullPeriod(second.periodStart, second.periodEnd)).resolves.toMatchObject({
            imported: 1,
            conflicts: []
        });
    });

    test('scans remote cursor pages until a date-filtered history page is filled', async () => {
        const outside = closure('outside-period', {
            periodStart: '2026-06-01',
            periodEnd: '2026-06-15',
            closedAt: 300
        });
        const matching = closure('matching-period', {
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            closedAt: 200
        });
        const remoteRepository = {
            loadPage: jest.fn()
                .mockResolvedValueOnce({
                    items: [outside],
                    nextCursor: { closedAt: outside.closedAt, id: outside.id }
                })
                .mockResolvedValueOnce({ items: [matching], nextCursor: null })
        };
        const sync = new PayrollClosureSync({
            localStore: { save: jest.fn(async value => value) },
            remoteRepository,
            outbox: MainSyncStore
        });

        await expect(sync.pullPage({
            limit: 10,
            periodStart: '2026-08-10',
            periodEnd: '2026-08-31'
        })).resolves.toEqual({ items: [matching], nextCursor: null });
        expect(remoteRepository.loadPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
            cursor: { closedAt: outside.closedAt, id: outside.id }
        }));
    });

    test('does not hydrate closure history or start a broad listener at login', () => {
        expect(APP_SOURCE).not.toContain('PayrollClosureLiveSync.start(');
        expect(APP_SOURCE).not.toContain('PayrollClosureLiveSync.stop(');
    });
});

describe('Payroll closure B3.3 scoped seams', () => {
    const A = 'PRJ-B33-A';
    const B = 'PRJ-B33-B';
    const scopeA = { projectId: A, defaultProjectId: A };

    beforeEach(() => {
        auth.currentUser = { uid: 'user-1' };
        localStorage.setItem('asistencia_default_project_id', A);
        setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: A });
        getDocs.mockReset(); getDoc.mockReset(); runTransaction.mockReset(); where.mockClear();
    });

    afterEach(() => {
        setProjectsEnabled(false); resetEntityScope(); localStorage.clear(); delete auth.currentUser;
    });

    test('scopes page queries and promotes default legacy rows before returning summaries', async () => {
        const native = { ...closure('native-b33'), schemaVersion: 3, projectId: A };
        const legacy = closure('legacy-b33', { supersedesId: 'previous-b33' });
        const set = jest.fn();
        getDocs.mockResolvedValueOnce({ docs: [docSnapshot(native)] })
            .mockResolvedValueOnce({ docs: [docSnapshot(legacy)] });
        runTransaction.mockImplementation(async (_db, operation) => operation({ get: jest.fn(async () => docSnapshot(legacy)), set }));

        const page = await _payrollClosureRepositoryInternals.loadPageScoped({ limit: 10 }, scopeA);
        expect(page.items).toHaveLength(2);
        expect(page.items.every(item => !item.rows)).toBe(true);
        expect(where).toHaveBeenCalledWith('projectId', '==', A);
        expect(set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ schemaVersion: 3, projectId: A, identityKind: 'promoted-legacy', id: legacy.id, fingerprint: legacy.fingerprint, rows: legacy.rows, totals: legacy.totals, supersedesId: legacy.supersedesId }));
    });

    test('period queries never discover schema2 for a non-default project', async () => {
        const scopeB = { projectId: B, defaultProjectId: A };
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: A });
        getDocs.mockResolvedValue({ docs: [docSnapshot(closure('hidden-b33'))] });
        await expect(_payrollClosureRepositoryInternals.loadByPeriodScoped(
            '2026-08-01', '2026-08-15', scopeB
        )).resolves.toEqual([]);
        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(where).toHaveBeenCalledWith('projectId', '==', B);
        expect(where).not.toHaveBeenCalledWith('schemaVersion', '==', 2);
    });

    test('repository detail rejects stale completion while public Sync remains gated', async () => {
        const save = jest.fn();
        const nativeA = { ...closure('detail-a-b33'), schemaVersion: 3, projectId: A };
        getDoc.mockResolvedValue(docSnapshot({ ...nativeA, projectId: B })); await expect(_payrollClosureRepositoryInternals.loadByIdScoped('cross-owner-b33', scopeA)).resolves.toBeNull();
        let resolveDetail;
        getDoc.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve; }));
        const pending = _payrollClosureRepositoryInternals.loadByIdScoped('stale-b33', scopeA);
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: A });
        resolveDetail(docSnapshot(nativeA));
        await expect(pending).rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_STALE_READ' });
        expect(save).not.toHaveBeenCalled();

        const sync = new PayrollClosureSync({
            localStore: { save, saveWithEmployees: jest.fn() },
            remoteRepository: { loadById: jest.fn() }
        });
        await expect(sync.pullDetail('cross-owner-b33')).rejects.toMatchObject({
            code: 'TANDA_B_BLOCKED_WHEN_SCOPED'
        });
        expect(save).not.toHaveBeenCalled();
    });
});
