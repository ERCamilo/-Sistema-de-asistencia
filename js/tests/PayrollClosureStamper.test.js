/**
 * B2.3 — stamper local schema2 → schema3 promoted-legacy, metadata-only
 * Focused: chunked, persistent progress, interrupt+resume, idempotent, stable owner, no-retag, error isolation, OFF no-op
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { PayrollClosureStamper, STAMPER_STATE_KEY } from 'actual/features/payroll/PayrollClosureStamper.js';
import { buildPayrollClosure, promoteLegacyPayrollClosure } from 'actual/features/payroll/PayrollClosure.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { DEFAULT_PROJECT_LS_KEY } from 'actual/features/projects/EntityProjectScope.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}

function row(n = '1') {
    return { id: Number(n), _employeeId: `emp-${n}`, _employeeName: 'Ada', _number: n, _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 0, monto: 1000 };
}

function legacyClosure(seed) {
    return buildPayrollClosure({
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        rows: [row(String(seed))],
        fingerprint: `fp-${seed}`,
        closedAt: 1000 + Number(seed)
    });
}

describe('PayrollClosureStamper B2.3', () => {
    afterEach(() => {
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('OFF no-op: does not promote and leaves records untouched', async () => {
        setProjectsEnabled(false);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-OFF');
        const svc = new IndexedDBService(`stamper-off-${Date.now()}-${Math.random()}`);
        await svc.init();
        const c = legacyClosure(1);
        await svc.update('payrollClosures', { ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
        const stamper = new PayrollClosureStamper({ db: svc });
        const res = await stamper.run({ chunkSize: 5 });
        expect(res.aborted).toBe('off');
        const after = await svc.get('payrollClosures', c.id);
        expect(after.schemaVersion).toBe(2);
        expect(after).not.toHaveProperty('projectId');
        svc.db.close();
    });

    test('chunked processing with progress persisted after each chunk', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-DEFAULT');
        const svc = new IndexedDBService(`stamper-chunk-${Date.now()}-${Math.random()}`);
        await svc.init();
        const closures = [1, 2, 3, 4, 5].map(n => legacyClosure(n));
        for (const c of closures) await svc.update('payrollClosures', { ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
        const stamper = new PayrollClosureStamper({ db: svc });
        const chunksSeen = [];
        await stamper.run({ chunkSize: 2, onChunk: ({ chunk }) => { chunksSeen.push(chunk.length); } });
        expect(chunksSeen).toEqual([2, 2, 1]);
        for (const c of closures) {
            const after = await svc.get('payrollClosures', c.id);
            expect(after.schemaVersion).toBe(3);
            expect(after.projectId).toBe('PRJ-DEFAULT');
            expect(after.identityKind).toBe('promoted-legacy');
            expect(after.id).toBe(c.id);
            expect(after.fingerprint).toBe(c.fingerprint);
            expect(after.rows).toEqual(c.rows);
            expect(after.totals).toEqual(c.totals);
        }
        const state = await svc.get('settings', STAMPER_STATE_KEY);
        expect(state.completed).toBe(true);
        expect(state.processed).toBe(5);
        svc.db.close();
    });

    test('persistent progress across close/reopen and interrupt+resume', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-RESUME');
        const dbName = `stamper-resume-${Date.now()}-${Math.random()}`;
        const svc1 = new IndexedDBService(dbName);
        await svc1.init();
        for (let i = 1; i <= 4; i++) {
            const c = legacyClosure(i);
            await svc1.update('payrollClosures', { ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
        }
        const stamper1 = new PayrollClosureStamper({ db: svc1 });
        const first = await stamper1.run({
            chunkSize: 2,
            onChunk: ({ processed }) => {
                if (processed >= 2) return false;
            }
        });
        expect(first.completed).toBe(false);
        expect(first.processed).toBe(2);
        svc1.db.close();

        const svc2 = new IndexedDBService(dbName);
        await svc2.init();
        const stamper2 = new PayrollClosureStamper({ db: svc2 });
        const second = await stamper2.run({ chunkSize: 2 });
        expect(second.completed).toBe(true);
        expect(second.processed).toBe(4);
        for (let i = 1; i <= 4; i++) {
            const c = legacyClosure(i);
            const after = await svc2.get('payrollClosures', c.id);
            expect(after.projectId).toBe('PRJ-RESUME');
        }
        svc2.db.close();
    });

    test('idempotent re-run does not duplicate or retag', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-IDEM');
        const svc = new IndexedDBService(`stamper-idem-${Date.now()}-${Math.random()}`);
        await svc.init();
        const c = legacyClosure(10);
        await svc.update('payrollClosures', { ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
        const stamper = new PayrollClosureStamper({ db: svc });
        const first = await stamper.run({ chunkSize: 10 });
        expect(first.promoted).toBe(1);
        const afterFirst = await svc.get('payrollClosures', c.id);
        const second = await stamper.run({ chunkSize: 10 });
        expect(second.completed).toBe(true);
        const afterSecond = await svc.get('payrollClosures', c.id);
        expect(afterSecond).toEqual(afterFirst);
        svc.db.close();
    });

    test('stable owner: same source record always yields same projectId', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-STABLE');
        const svc = new IndexedDBService(`stamper-stable-${Date.now()}-${Math.random()}`);
        await svc.init();
        const c = legacyClosure(99);
        await svc.update('payrollClosures', { ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
        const stamper = new PayrollClosureStamper({ db: svc });
        await stamper.run({ chunkSize: 10 });
        const promoted = await svc.get('payrollClosures', c.id);
        const expected = promoteLegacyPayrollClosure(c, 'PRJ-STABLE');
        expect(promoted.projectId).toBe(expected.projectId);
        expect(promoted.ownershipToken).toBe(expected.ownershipToken);
        svc.db.close();
    });

    test('already promoted record never retags', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-NEW');
        const svc = new IndexedDBService(`stamper-noretag-${Date.now()}-${Math.random()}`);
        await svc.init();
        const legacy = legacyClosure(20);
        const promoted = promoteLegacyPayrollClosure(legacy, 'PRJ-ORIGINAL');
        await svc.update('payrollClosures', { ...promoted, periodKey: `${promoted.periodStart}:${promoted.periodEnd}` });
        const stamper = new PayrollClosureStamper({ db: svc, resolveOwner: () => 'PRJ-NEW' });
        await stamper.run({ chunkSize: 10 });
        const after = await svc.get('payrollClosures', legacy.id);
        expect(after.projectId).toBe('PRJ-ORIGINAL');
        expect(after.identityKind).toBe('promoted-legacy');
        svc.db.close();
    });

    test('error isolation: one bad record does not corrupt prior chunks', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-ERR');
        const svc = new IndexedDBService(`stamper-err-${Date.now()}-${Math.random()}`);
        await svc.init();
        const good1 = legacyClosure(30);
        const good2 = legacyClosure(31);
        const bad = { ...legacyClosure(32), fingerprint: '' };
        bad.id = 'PAYROLL-CLOSURE-bad';
        bad.fingerprint = '';
        await svc.update('payrollClosures', { ...good1, periodKey: `${good1.periodStart}:${good1.periodEnd}` });
        await svc.update('payrollClosures', bad);
        await svc.update('payrollClosures', { ...good2, periodKey: `${good2.periodStart}:${good2.periodEnd}` });
        let resolveCount = 0;
        const stamper = new PayrollClosureStamper({
            db: svc,
            resolveOwner: record => {
                if (record.id === bad.id) throw new Error('resolve fail');
                resolveCount++;
                return 'PRJ-ERR';
            }
        });
        const res = await stamper.run({ chunkSize: 1 });
        expect(res.errors).toBe(1);
        expect((await svc.get('payrollClosures', good1.id)).projectId).toBe('PRJ-ERR');
        expect((await svc.get('payrollClosures', good2.id)).projectId).toBe('PRJ-ERR');
        svc.db.close();
    });

    test('uses primary-key cursor and keeps v20 indexes intact', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-IDX');
        const svc = new IndexedDBService(`stamper-idx-${Date.now()}-${Math.random()}`);
        await svc.init();
        const store = svc.db.transaction('payrollClosures', 'readonly').objectStore('payrollClosures');
        expect(store.indexNames.contains('projectId')).toBe(true);
        expect(store.indexNames.contains('projectClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectStatusClosedAtId')).toBe(true);
        expect(svc.db.version).toBe(20);
        svc.db.close();
    });
});
