import {
    auth,
    getDocs,
    limit as firestoreLimit,
    onSnapshot,
    runTransaction,
    startAfter
} from '../modules/data/firebase.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import { buildPayrollClosure, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { PayrollClosureConflictError } from '../modules/features/payroll/PayrollClosureStore.js';
import { PayrollClosureRepository } from '../modules/features/payroll/PayrollClosureRepository.js';
import { PayrollClosureSync } from '../modules/features/payroll/PayrollClosureSync.js';
import fs from 'fs';
import path from 'path';

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

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
        firestoreLimit.mockClear();
        onSnapshot.mockReset();
        startAfter.mockClear();
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

    test('fails instead of silently dropping a write when the session disappears', async () => {
        delete auth.currentUser;
        await expect(PayrollClosureRepository.saveOne(closure('no-session')))
            .rejects.toThrow('sesión');
        expect(runTransaction).not.toHaveBeenCalled();
    });

    test('paginates deterministically without exposing a false extra item', async () => {
        const first = closure('remote-page-1', { closedAt: 300 });
        const second = closure('remote-page-2', { closedAt: 200 });
        const extra = closure('remote-page-3', { closedAt: 100 });
        getDocs.mockResolvedValue({
            docs: [first, second, extra].map(value => docSnapshot(value))
        });

        await expect(PayrollClosureRepository.loadPage({ limit: 2 })).resolves.toEqual({
            items: [first, second],
            nextCursor: { closedAt: 200, id: second.id }
        });
        expect(firestoreLimit).toHaveBeenCalledWith(3);
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

    test('persists locally before enqueueing and imports a remote page idempotently', async () => {
        const first = closure('sync-first');
        const second = closure('sync-second', { closedAt: 200 });
        const localStore = {
            save: jest.fn(async value => value)
        };
        const remoteRepository = {
            loadPage: jest.fn().mockResolvedValue({ items: [second], nextCursor: null })
        };
        const enqueue = jest.spyOn(MainSyncStore, 'enqueuePayrollClosure').mockResolvedValue(undefined);
        const sync = new PayrollClosureSync({ localStore, remoteRepository, outbox: MainSyncStore });

        await sync.record(first);
        expect(localStore.save.mock.invocationCallOrder[0])
            .toBeLessThan(enqueue.mock.invocationCallOrder[0]);
        await expect(sync.pullPage({ limit: 10 })).resolves.toMatchObject({
            imported: 1,
            conflicts: []
        });
        expect(localStore.save).toHaveBeenLastCalledWith(second);
    });

    test('restarts the live listener on every authentication transition', () => {
        expect(APP_SOURCE).toMatch(/onAuthStateChanged[\s\S]*PayrollClosureLiveSync\.stop\(\)/);
        expect(APP_SOURCE).toMatch(/if \(user\)[\s\S]*PayrollClosureLiveSync\.start\(/);
    });
});
