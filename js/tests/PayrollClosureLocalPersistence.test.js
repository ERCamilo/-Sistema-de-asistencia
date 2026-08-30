import fs from 'fs';
import path from 'path';
import {
    buildPayrollClosure,
    buildPayrollClosureId,
    promoteLegacyPayrollClosure,
    voidPayrollClosure,
    PAYROLL_CLOSURE_IDENTITY_KIND
} from '../modules/features/payroll/PayrollClosure.js';
import { buildPayrollPreviewFingerprint } from '../modules/features/payroll/PayrollLoanSettlement.js';
import {
    PayrollClosureConflictError,
    PayrollClosureStore
} from '../modules/features/payroll/PayrollClosureStore.js';

const IDB_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'),
    'utf8'
);

function row(id = 'emp-1', number = '1') {
    return {
        id: 1,
        _employeeId: id,
        _employeeName: 'Ada',
        _number: number,
        _brutoOriginal: 1000,
        _bonuses: 0,
        _deductions: 0,
        _loans: 0,
        monto: 1000
    };
}

function fingerprintFor(projectId, rows) {
    return buildPayrollPreviewFingerprint({
        projectId,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        rows
    });
}

class MemoryDB {
    constructor() {
        this.records = new Map();
        this.mutationQueue = Promise.resolve();
    }
    async get(_, id) {
        const v = this.records.get(String(id));
        return v ? JSON.parse(JSON.stringify(v)) : undefined;
    }
    async update(_, value) {
        this.records.set(String(value.id), JSON.parse(JSON.stringify(value)));
    }
    async atomicMutate(_, id, mutator) {
        const op = this.mutationQueue.then(async () => {
            const existing = await this.get(_, id);
            const result = mutator(existing);
            if (result.write) await this.update(_, result.value);
            return JSON.parse(JSON.stringify(result.value));
        });
        this.mutationQueue = op.catch(() => {});
        return op;
    }
    async atomicMutateWithBatches(_, id, mutator) {
        return this.atomicMutate(_, id, mutator);
    }
    async query(_, indexName, value) {
        return [...this.records.values()]
            .filter(item => item[indexName] === value)
            .map(v => JSON.parse(JSON.stringify(v)));
    }
    async getPageByIndex() { return []; }
    async getAll() { return []; }
}

describe('B2.1 local project-aware closure persistence', () => {
    test('IndexedDB evolution: version 19 and projectId index present, no data migration', () => {
        expect(IDB_SOURCE).toMatch(/version\s*=\s*19/);
        const block = IDB_SOURCE.match(/payrollClosures[\s\S]{0,1200}/)?.[0] || '';
        expect(block).toMatch(/createIndex\(\s*['"]projectId['"]/);
        // keep original indexes
        expect(block).toContain("createIndex('periodKey'");
        expect(block).toContain("createIndex('closedAtId'");
        expect(block).toMatch(/createIndex\(\s*['"]statusClosedAtId['"]/);
        // no mass stamper or legacy migration in B2.1
        expect(IDB_SOURCE).not.toMatch(/migrateLegacyPayrollClosures.*B2\.1/);
    });

    test('A and B can persist independent closures, same period, without collision', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const rowsA = [row('emp-a1', '1')];
        const rowsB = [row('emp-b1', '1')];
        const fpA = fingerprintFor('project-a', rowsA);
        const fpB = fingerprintFor('project-b', rowsB);
        const closureA = buildPayrollClosure({
            projectId: 'project-a',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: rowsA,
            fingerprint: fpA,
            closedAt: 100
        });
        const closureB = buildPayrollClosure({
            projectId: 'project-b',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: rowsB,
            fingerprint: fpB,
            closedAt: 101
        });
        expect(closureA.id).not.toBe(closureB.id);
        await store.save(closureA);
        await store.save(closureB);
        expect(db.records.size).toBe(2);
        await expect(store.getById(closureA.id)).resolves.toMatchObject({ projectId: 'project-a' });
        await expect(store.getById(closureB.id)).resolves.toMatchObject({ projectId: 'project-b' });
        // same period coexistence preserved
        expect((await store.getById(closureA.id)).periodStart).toBe('2026-08-01');
        expect((await store.getById(closureB.id)).periodStart).toBe('2026-08-01');
    });

    test('local write/merge cannot replace or alter B closure (content/void ownership)', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const rowsA = [row('emp-a1', '1')];
        const fpA = fingerprintFor('project-a', rowsA);
        const closureA = buildPayrollClosure({
            projectId: 'project-a',
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: rowsA,
            fingerprint: fpA,
            closedAt: 100
        });
        await store.save(closureA);
        // attempt to overwrite with same id but different project
        const retagged = { ...closureA, projectId: 'project-b' };
        await expect(store.save(retagged)).rejects.toBeInstanceOf(PayrollClosureConflictError);
        await expect(store.getById(closureA.id)).resolves.toMatchObject({ projectId: 'project-a' });

        // void ownership: retagged void must fail
        const voidRetagged = { ...closureA, projectId: 'project-b', id: buildPayrollClosureId(closureA.fingerprint, null, 'project-b') };
        expect(() => voidPayrollClosure(voidRetagged)).toThrow();
        // valid void of A succeeds and preserves ownership
        const voidedA = voidPayrollClosure(closureA, { voidedAt: 200, voidedBy: 'op-a' });
        await store.save(voidedA);
        await expect(store.getById(closureA.id)).resolves.toMatchObject({ status: 'voided', projectId: 'project-a' });
        // stale closed write cannot revive
        await expect(store.save(closureA)).resolves.toMatchObject({ status: 'voided' });
    });

    test('OFF path remains byte-identical legacy behavior', () => {
        const fp = buildPayrollPreviewFingerprint({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [row()]
        });
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [row()],
            fingerprint: 'preview-fingerprint'
        });
        expect(legacy.schemaVersion).toBe(2);
        expect(legacy).not.toHaveProperty('projectId');
        expect(legacy).not.toHaveProperty('identityKind');
        expect(legacy).not.toHaveProperty('ownershipToken');
        expect(legacy.id).toBe('PAYROLL-CLOSURE-1gpn0v27ta2h5');
        expect(JSON.parse(fp)).not.toHaveProperty('projectId');
    });

    test('promoted-legacy persistence round-trips preserve exact stored shape', async () => {
        const db = new MemoryDB();
        const store = new PayrollClosureStore({ db });
        const legacy = buildPayrollClosure({
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            rows: [row()],
            fingerprint: 'historical-fingerprint',
            closedAt: 1234,
            closedBy: 'operator-1'
        });
        const promoted = promoteLegacyPayrollClosure(legacy, 'project-a');
        expect(promoted.identityKind).toBe(PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY);
        expect(promoted.id).toBe(legacy.id);
        await store.save(promoted);
        const loaded = await store.getById(promoted.id);
        const { periodKey, ...loadedCore } = loaded;
        expect(loadedCore).toEqual(promoted);
        expect(periodKey).toBe('2026-08-01:2026-08-15');
        // idempotent same-owner retry is no-op (strip periodKey for comparison)
        const retry = promoteLegacyPayrollClosure(promoted, 'project-a');
        const savedRetry = await store.save(retry);
        const { periodKey: _rk, ...retryCore } = savedRetry;
        expect(retryCore).toEqual(promoted);
        expect(db.records.size).toBe(1);
        // cross-project retag must be rejected
        expect(() => promoteLegacyPayrollClosure(promoted, 'project-b')).toThrow();
        const cross = { ...promoted, projectId: 'project-b' };
        await expect(store.save(cross)).rejects.toBeInstanceOf(PayrollClosureConflictError);
    });
});
