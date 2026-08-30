import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { buildPayrollClosure, promoteLegacyPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
import { PayrollClosureStore } from '../modules/features/payroll/PayrollClosureStore.js';

const A = 'PRJ-A-B22';
const B = 'PRJ-B-B22';
const DEFAULT = 'PRJ-DEFAULT-B22';

function row(id, number) {
    return { id: 1, _employeeId: id, _employeeName: 'Ada', _number: number, _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 0, monto: 1000 };
}
function fingerprint(projectId, rows) {
    return JSON.stringify({ projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: rows.map(r => ({ employeeId: r._employeeId, employeeNumber: r._number, employeeName: r._employeeName, employeePosition: '', leaderRefs: [], gross: 1000, bonuses: 0, deductions: 0, loans: 0, net: 1000, bonusDetails: [], deductionDetails: [], loanDetails: [] })).sort((a,b)=>a.employeeNumber.localeCompare(b.employeeNumber)) });
}
function closure(projectId, overrides = {}) {
    const rows = overrides.rows || [row(`emp-${projectId}`, '1')];
    const fp = overrides.fingerprint || fingerprint(projectId, rows);
    return buildPayrollClosure({ projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows, fingerprint: fp, closedAt: overrides.closedAt ?? 100, ...overrides });
}
class MemoryDBB22 {
    constructor() { this.records = new Map(); this.outbox = []; this.delayMs = 0; }
    async get(_, id) {
        if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
        const v = this.records.get(String(id));
        return v ? JSON.parse(JSON.stringify(v)) : undefined;
    }
    async query(_, indexName, value) {
        if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
        const vals = [...this.records.values()].filter(item => item[indexName] === value);
        return vals.map(v => JSON.parse(JSON.stringify(v)));
    }
    async getPageByIndex(_, indexName, options = {}) {
        if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
        let values = [...this.records.values()];
        if (indexName === 'projectClosedAtId') {
            const pid = options.lowerBound?.[0];
            values = values.filter(v => v.projectId === pid);
            values.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) {
                const [, cAt, cId] = options.upperBound;
                values = values.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId));
            }
        } else if (indexName === 'projectStatusClosedAtId') {
            const [pid, status] = options.lowerBound || [];
            values = values.filter(v => v.projectId === pid && v.status === status);
            values.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) {
                const [, , cAt, cId] = options.upperBound;
                values = values.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId));
            }
        } else if (indexName === 'statusClosedAtId' && options.prefix !== undefined) {
            values = values.filter(item => item.status === options.prefix);
            values.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.cursor) values = values.filter(item => item.closedAt < options.cursor.closedAt || (item.closedAt === options.cursor.closedAt && item.id < options.cursor.id));
        } else if (indexName === 'closedAtId') {
            values.sort((l, r) => r.closedAt - l.closedAt || r.id.localeCompare(l.id));
            if (options.upperOpen && options.upperBound) {
                const [cAt, cId] = options.upperBound;
                values = values.filter(v => v.closedAt < cAt || (v.closedAt === cAt && v.id < cId));
            }
        }
        return values.slice(0, options.limit).map(v => JSON.parse(JSON.stringify(v)));
    }
    async getAll(storeName) {
        if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
        if (storeName === 'mainSyncOutbox') return this.outbox.map(v => JSON.parse(JSON.stringify(v)));
        return [];
    }
    async atomicMutate(_, id, mutator) {
        const existing = await this.get(_, id);
        const result = mutator(existing);
        if (result.write) this.records.set(String(result.value.id), JSON.parse(JSON.stringify({ ...result.value, periodKey: `${result.value.periodStart}:${result.value.periodEnd}` })));
        return JSON.parse(JSON.stringify(result.value));
    }
}

describe('B2.2 project-scoped closure reads', () => {
    beforeEach(() => { localStorage.clear(); resetEntityScope(); setProjectsEnabled(true); replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT }); });
    afterEach(() => { localStorage.clear(); resetEntityScope(); setProjectsEnabled(false); });

    test('same-period A/B isolated via project-aware indexes (getByPeriod, getById)', async () => {
        const db = new MemoryDBB22();
        const store = new PayrollClosureStore({ db });
        const cA = closure(A, { closedAt: 100, rows: [row('emp-a', '10')] });
        const cB = closure(B, { closedAt: 101, rows: [row('emp-b', '10')] });
        db.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        db.records.set(cB.id, { ...cB, periodKey: '2026-08-01:2026-08-15' });
        const periodA = await store.getByPeriod('2026-08-01', '2026-08-15');
        expect(periodA.map(x => x.id)).toEqual([cA.id]);
        await expect(store.getById(cB.id)).resolves.toBeNull();
        await expect(store.getById(cA.id)).resolves.toMatchObject({ projectId: A });
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const periodB = await store.getByPeriod('2026-08-01', '2026-08-15');
        expect(periodB.map(x => x.id)).toEqual([cB.id]);
    });

    test('paginated cursor isolation does not leak B into A pages (same period/status/date)', async () => {
        const db = new MemoryDBB22();
        const store = new PayrollClosureStore({ db });
        const cA1 = closure(A, { closedAt: 300, rows: [row('emp-a1', '1')] });
        const cA2 = closure(A, { closedAt: 200, rows: [row('emp-a2', '2')] });
        const cB1 = closure(B, { closedAt: 300, rows: [row('emp-b1', '1')] });
        const cB2 = closure(B, { closedAt: 200, rows: [row('emp-b2', '2')] });
        for (const c of [cA1, cA2, cB1, cB2]) db.records.set(c.id, { ...c, periodKey: '2026-08-01:2026-08-15' });
        const p1 = await store.listPage({ limit: 1, status: 'closed' });
        expect(p1.items.map(i => i.id)).toEqual([cA1.id]);
        const p2 = await store.listPage({ limit: 1, status: 'closed', cursor: p1.nextCursor });
        expect(p2.items.map(i => i.id)).toEqual([cA2.id]);
        expect(p2.nextCursor).toBeNull();
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const pb1 = await store.listPage({ limit: 1, status: 'closed' });
        expect(pb1.items.map(i => i.id)).toEqual([cB1.id]);
    });

    test('getSyncStates authorizes via scoped lookup (B states never contaminate A)', async () => {
        const db = new MemoryDBB22();
        const store = new PayrollClosureStore({ db });
        const cA = closure(A, { closedAt: 100, rows: [row('emp-a', '1')] });
        const cB = closure(B, { closedAt: 100, rows: [row('emp-b', '1')] });
        db.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        db.records.set(cB.id, { ...cB, periodKey: '2026-08-01:2026-08-15' });
        db.outbox = [
            { closureId: cA.id, kind: 'payrollClosureBundle', status: 'pending' },
            { closureId: cB.id, kind: 'payrollClosureBundle', status: 'pending' }
        ];
        const statesA = await store.getSyncStates([cA.id, cB.id]);
        expect(statesA[cA.id]).toBe('pending');
        expect(statesA[cB.id]).toBe('synced');
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const statesB = await store.getSyncStates([cA.id, cB.id]);
        expect(statesB[cB.id]).toBe('pending');
        expect(statesB[cA.id]).toBe('synced');
    });

    test('async stale completion rejected if project switches before await resolves', async () => {
        const db = new MemoryDBB22();
        db.delayMs = 30;
        const store = new PayrollClosureStore({ db });
        const cA = closure(A, { closedAt: 100, rows: [row('emp-a', '1')] });
        db.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        const pending = store.getById(cA.id);
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        await expect(pending).rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_STALE_READ' });
    });

    test('promoted-legacy reads by canonical owner without reinterpreting historical identity', async () => {
        const db = new MemoryDBB22();
        const store = new PayrollClosureStore({ db });
        const legacy = buildPayrollClosure({ periodStart: '2026-08-01', periodEnd: '2026-08-15', rows: [row('emp-1', '1')], fingerprint: 'historical-fp', closedAt: 100 });
        const promoted = promoteLegacyPayrollClosure(legacy, A);
        db.records.set(promoted.id, { ...promoted, periodKey: '2026-08-01:2026-08-15' });
        await expect(store.getById(promoted.id)).resolves.toMatchObject({ projectId: A, id: legacy.id });
        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        await expect(store.getById(promoted.id)).resolves.toBeNull();
    });

    test('OFF exact legacy behavior preserved (no isolation)', async () => {
        setProjectsEnabled(false);
        resetEntityScope();
        const db = new MemoryDBB22();
        const store = new PayrollClosureStore({ db });
        const cA = closure(A, { closedAt: 100, rows: [row('emp-a', '1')] });
        const cB = closure(B, { closedAt: 101, rows: [row('emp-b', '1')] });
        db.records.set(cA.id, { ...cA, periodKey: '2026-08-01:2026-08-15' });
        db.records.set(cB.id, { ...cB, periodKey: '2026-08-01:2026-08-15' });
        const period = await store.getByPeriod('2026-08-01', '2026-08-15');
        expect(period.map(x => x.id).sort()).toEqual([cA.id, cB.id].sort());
        await expect(store.getById(cB.id)).resolves.toMatchObject({ projectId: B });
        const page = await store.listPage({ limit: 20 });
        expect(page.items.length).toBe(2);
    });
});
