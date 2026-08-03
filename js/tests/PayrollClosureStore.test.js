import fs from 'fs';
import path from 'path';
import { buildPayrollClosure, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import {
    PayrollClosureConflictError,
    PayrollClosureStore
} from '../modules/features/payroll/PayrollClosureStore.js';

const IDB_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'),
    'utf8'
);

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
            _bonuses: 0,
            _deductions: 0,
            _loans: 0,
            monto: 1000
        }],
        fingerprint,
        closedAt: 100,
        ...overrides
    });
}

class MemoryDB {
    constructor() {
        this.records = new Map();
        this.employeeRecords = new Map();
        this.outboxRecords = new Map();
        this.mutationQueue = Promise.resolve();
    }

    async get(_storeName, id) {
        const value = this.records.get(id);
        return value ? JSON.parse(JSON.stringify(value)) : undefined;
    }

    async update(_storeName, value) {
        this.records.set(value.id, JSON.parse(JSON.stringify(value)));
        return value.id;
    }

    async atomicMutate(_storeName, id, mutator) {
        const operation = this.mutationQueue.then(async () => {
            const existing = await this.get(_storeName, id);
            const result = mutator(existing);
            if (result.write) await this.update(_storeName, result.value);
            return JSON.parse(JSON.stringify(result.value));
        });
        this.mutationQueue = operation.catch(() => {});
        return operation;
    }

    async atomicMutateWithBatches(_storeName, id, mutator, batches = []) {
        const operation = this.mutationQueue.then(async () => {
            const existing = await this.get(_storeName, id);
            const result = mutator(existing);
            if (result.write) {
                await this.update(_storeName, result.value);
                for (const batch of batches) {
                    for (const value of batch.records || []) {
                        if (batch.storeName === 'employees') {
                            this.employeeRecords.set(value.id, JSON.parse(JSON.stringify(value)));
                        }
                        if (batch.storeName === 'mainSyncOutbox') {
                            this.outboxRecords.set(value.key, JSON.parse(JSON.stringify(value)));
                        }
                    }
                }
            }
            return JSON.parse(JSON.stringify(result.value));
        });
        this.mutationQueue = operation.catch(() => {});
        return operation;
    }

    async query(_storeName, indexName, value) {
        return [...this.records.values()]
            .filter(item => item[indexName] === value)
            .map(item => JSON.parse(JSON.stringify(item)));
    }

    async getPageByIndex(_storeName, indexName, options = {}) {
        let values = [...this.records.values()];
        if (indexName === 'statusClosedAtId' && options.prefix !== undefined) {
            values = values.filter(item => item.status === options.prefix);
        }
        values.sort((left, right) => right.closedAt - left.closedAt || right.id.localeCompare(left.id));
        if (options.cursor) {
            values = values.filter(item => item.closedAt < options.cursor.closedAt ||
                (item.closedAt === options.cursor.closedAt && item.id < options.cursor.id));
        }
        return values.slice(0, options.limit).map(item => JSON.parse(JSON.stringify(item)));
    }

    async getAll(storeName) {
        if (storeName !== 'mainSyncOutbox') return [];
        return [
            { kind: 'payrollClosure', closureId: 'pending-id', status: 'pending' },
            { kind: 'payrollClosure', closureId: 'dead-id', status: 'dead' }
        ];
    }
}

describe('PayrollClosureStore', () => {
    test('schema creates an indexed payroll closure store and includes it in backup round trips', () => {
        expect(IDB_SOURCE).toMatch(/version\s*=\s*15/);
        const block = IDB_SOURCE.match(/payrollClosures['"][\s\S]{0,900}/)?.[0] || '';
        expect(block).toMatch(/keyPath:\s*['"]id['"]/);
        expect(block).toContain("createIndex('periodKey'");
        expect(block).toContain("createIndex('closedAtId'");
        expect(block).toMatch(/createIndex\(\s*['"]statusClosedAtId['"]/);
        expect(IDB_SOURCE).toMatch(/payrollClosures:\s*await this\.getAll\(['"]payrollClosures['"]\)/);
        expect(IDB_SOURCE).toMatch(/batchUpdate\(['"]payrollClosures['"],\s*data\.payrollClosures\)/);
        expect(IDB_SOURCE).toMatch(/async atomicMutate\(/);
        expect(IDB_SOURCE).toMatch(/async atomicMutateWithBatches\(/);
    });

    test('idempotently preserves the first audit metadata for the same closure', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const first = closure('same', { closedAt: 100, closedBy: 'first' });
        const retry = closure('same', { closedAt: 200, closedBy: 'second' });

        await expect(store.save(first)).resolves.toEqual(expect.objectContaining({ closedBy: 'first' }));
        await expect(store.save(retry)).resolves.toEqual(expect.objectContaining({
            closedAt: 100,
            closedBy: 'first'
        }));
        expect(db.records.size).toBe(1);
    });

    test('rejects different canonical content under the same identity', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('collision');
        await store.save(original);

        await expect(store.save({
            ...original,
            totals: { ...original.totals, net: 999 }
        })).rejects.toBeInstanceOf(PayrollClosureConflictError);
    });

    test('persists voiding but does not let a stale closed write revive it', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('void-me');
        await store.save(original);
        const voided = voidPayrollClosure(original, { voidedAt: 300, voidedBy: 'operator' });
        await store.save(voided);

        await expect(store.save(original)).resolves.toMatchObject({ status: 'voided' });
        await expect(store.getById(original.id)).resolves.toMatchObject({
            status: 'voided',
            voidedBy: 'operator'
        });
    });

    test('commits the closure and affected employees in the same local operation', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('with-employees');
        const employees = [{ id: 'employee-1', name: 'Ada', loans: [] }];

        await store.saveWithEmployees(original, employees);

        expect(db.records.get(original.id)).toMatchObject({ id: original.id });
        expect(db.employeeRecords.get('employee-1')).toEqual(employees[0]);
    });

    test('atomically persists a deterministic payroll bundle and coalesces close to undo', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('durable-bundle');
        const employee = { id: 'employee-1', name: 'Ada', loans: [{ payments: [] }] };

        await store.saveWithEmployees(original, [employee], {
            enqueueCloud: true,
            queuedAt: 100,
            schemaVersion: 3
        });
        const voided = voidPayrollClosure(original, { voidedAt: 200, voidedBy: 'operator' });
        const restored = { ...employee, loans: [{ payments: [{ id: 'payment-1', voided: true }] }] };
        await store.saveWithEmployees(voided, [restored], {
            enqueueCloud: true,
            queuedAt: 200,
            schemaVersion: 3
        });

        expect(db.outboxRecords.size).toBe(1);
        expect([...db.outboxRecords.values()][0]).toMatchObject({
            key: `payroll:${original.id}`,
            kind: 'payrollClosureBundle',
            closureId: original.id,
            schemaVersion: 3,
            closure: { status: 'voided' },
            employees: [restored],
            status: 'pending'
        });
        expect(db.employeeRecords.get('employee-1')).toEqual(restored);
    });

    test('rejects cloud bundling without an explicitly supported employee schema', async () => {
        const store = new PayrollClosureStore({ db: new MemoryDB() });
        await expect(store.saveWithEmployees(closure('legacy-schema'), [], {
            enqueueCloud: true,
            schemaVersion: 1
        })).rejects.toThrow(/schema/i);
    });

    test('an idempotent closure retry does not rewrite related employees', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('stable-related-records');
        await store.saveWithEmployees(original, [{ id: 'employee-1', name: 'Ada' }]);
        await store.saveWithEmployees(original, [{ id: 'employee-1', name: 'Stale copy' }]);

        expect(db.employeeRecords.get('employee-1')).toEqual({ id: 'employee-1', name: 'Ada' });
    });

    test('serializes concurrent voids and preserves the first audit actor', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const original = closure('concurrent-void');
        await store.save(original);

        await Promise.all([
            store.save(voidPayrollClosure(original, { voidedAt: 300, voidedBy: 'operator-a' })),
            store.save(voidPayrollClosure(original, { voidedAt: 301, voidedBy: 'operator-b' }))
        ]);

        await expect(store.getById(original.id)).resolves.toMatchObject({
            status: 'voided',
            voidedAt: 300,
            voidedBy: 'operator-a'
        });
    });

    test('lists pages newest first and filters by business status', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const first = closure('first', { closedAt: 100 });
        const second = closure('second', { closedAt: 200 });
        const third = voidPayrollClosure(closure('third', { closedAt: 300 }), { voidedAt: 400 });
        await store.save(first);
        await store.save(second);
        await store.save(third);

        const pageOne = await store.listPage({ limit: 1, status: 'closed' });
        const pageTwo = await store.listPage({ limit: 1, status: 'closed', cursor: pageOne.nextCursor });

        expect(pageOne.items.map(item => item.id)).toEqual([second.id]);
        expect(pageTwo.items.map(item => item.id)).toEqual([first.id]);
        expect(pageTwo.nextCursor).toBeNull();
        await expect(store.getActiveByPeriod('2026-08-01', '2026-08-15'))
            .resolves.toEqual(expect.arrayContaining([
                expect.objectContaining({ id: first.id }),
                expect.objectContaining({ id: second.id })
            ]));
        await expect(store.getByPeriod('2026-08-01', '2026-08-15'))
            .resolves.toEqual(expect.arrayContaining([
                expect.objectContaining({ id: first.id }),
                expect.objectContaining({ id: second.id }),
                expect.objectContaining({ id: third.id, status: 'voided' })
            ]));
    });

    test('filters pages by overlapping payroll period and exposes local sync state', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const july = closure('july', {
            periodStart: '2026-07-01', periodEnd: '2026-07-15', closedAt: 100
        });
        const august = closure('august', {
            periodStart: '2026-08-01', periodEnd: '2026-08-15', closedAt: 200
        });
        await store.save(july);
        await store.save(august);

        await expect(store.listPage({
            limit: 20,
            periodStart: '2026-08-10',
            periodEnd: '2026-08-31'
        })).resolves.toMatchObject({ items: [{ id: august.id }], nextCursor: null });
        await expect(store.getSyncStates(['pending-id', 'dead-id', 'synced-id']))
            .resolves.toEqual({
                'pending-id': 'pending',
                'dead-id': 'dead',
                'synced-id': 'synced'
            });
    });
});
