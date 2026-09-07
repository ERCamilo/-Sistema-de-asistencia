/**
 * F1.6-A2 — ProjectPayrollConfig: versioned local store per canonical projectId
 * TDD scenarios: seed idempotent, A/B isolation, A→B→A reload, flag OFF parity,
 * canonical vs active distinction. Real IndexedDB via fake-indexeddb, no mocks.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { getConfig, putConfig, ensureDefaultSeed, listAll } from 'actual/features/payroll/ProjectPayrollConfigStore.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}

const DB_PREFIX = 'a2-payroll-config-';

function legacySettings(overrides = {}) {
    return {
        regularHoursPerDay: 8,
        overtimeFactor: 1.5,
        holidayFactor: 2,
        holidays: ['2026-05-01'],
        payPeriod: { periodStart: '2026-05-01', periodLength: 21, payDay: '2026-05-22' },
        defaultDeductionPercentage: 2,
        payrollDefaults: { version: 2, deductions: [], bonuses: [] },
        ...overrides
    };
}

describe('A2 ProjectPayrollConfig — local versioned store per canonical projectId', () => {
    beforeEach(() => {
        localStorage.clear();
        setProjectsEnabled(false);
        jest.resetModules(); // keep flag reading fresh
    });
    afterEach(() => {
        localStorage.clear();
        setProjectsEnabled(false);
    });

    test('seed idempotent: re-running seed does NOT overwrite already-created config', async () => {
        setProjectsEnabled(true);
        const svc = new IndexedDBService(`${DB_PREFIX}seed-idempotent`);
        const proj = 'PRJ-DEFAULT-A2';
        const firstLegacy = legacySettings({ regularHoursPerDay: 9, overtimeFactor: 1.8, holidays: ['2026-05-01'] });
        const r1 = await ensureDefaultSeed(proj, firstLegacy, { idb: svc });
        expect(r1.seeded).toBe(true);
        const cfg1 = await getConfig(proj, { idb: svc });
        expect(cfg1).not.toBeNull();
        expect(cfg1.regularHoursPerDay).toBe(9);
        expect(cfg1.overtimeFactor).toBe(1.8);
        expect(cfg1.holidays).toEqual(['2026-05-01']);
        const updatedAt1 = cfg1.updatedAt;

        // Wait a tick so Date.now would differ if overwritten
        await new Promise(r => setTimeout(r, 5));
        const secondLegacy = legacySettings({ regularHoursPerDay: 6, overtimeFactor: 3, holidays: ['2026-12-25'] });
        const r2 = await ensureDefaultSeed(proj, secondLegacy, { idb: svc });
        expect(r2.skipped).toBe(true);
        expect(r2.reason).toBe('already-exists');
        const cfg2 = await getConfig(proj, { idb: svc });
        expect(cfg2.regularHoursPerDay).toBe(9); // not overwritten
        expect(cfg2.overtimeFactor).toBe(1.8);
        expect(cfg2.holidays).toEqual(['2026-05-01']);
        expect(cfg2.updatedAt).toBe(updatedAt1);
    });

    test('A and B keep totally different configs without cross-contamination', async () => {
        setProjectsEnabled(true);
        const svc = new IndexedDBService(`${DB_PREFIX}ab-isolation`);
        const PRJ_A = 'PRJ-A-A2';
        const PRJ_B = 'PRJ-B-A2';

        await ensureDefaultSeed(PRJ_A, legacySettings({ regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: ['2026-01-01'], defaultDeductionPercentage: 2, payPeriod: { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-16' } }), { idb: svc });
        await ensureDefaultSeed(PRJ_B, legacySettings({ regularHoursPerDay: 6, overtimeFactor: 2, holidayFactor: 3, holidays: ['2026-12-25'], defaultDeductionPercentage: 10, payPeriod: { periodStart: '2026-02-01', periodLength: 21, payDay: '2026-02-22' } }), { idb: svc });

        // Overwrite B with explicit different factor to prove isolation
        const cfgB = await getConfig(PRJ_B, { idb: svc });
        cfgB.overtimeFactor = 2.5;
        cfgB.holidays = ['2026-12-25', '2026-12-31'];
        await putConfig(cfgB, { idb: svc });

        const a = await getConfig(PRJ_A, { idb: svc });
        const b = await getConfig(PRJ_B, { idb: svc });
        expect(a.regularHoursPerDay).toBe(8);
        expect(b.regularHoursPerDay).toBe(6);
        expect(a.overtimeFactor).toBe(1.5);
        expect(b.overtimeFactor).toBe(2.5);
        expect(a.holidays).toEqual(['2026-01-01']);
        expect(b.holidays).toEqual(['2026-12-25', '2026-12-31']);
        expect(a.payPeriod.periodLength).toBe(15);
        expect(b.payPeriod.periodLength).toBe(21);
        expect(a.defaultDeductionPercentage).toBe(2);
        expect(b.defaultDeductionPercentage).toBe(10);
    });

    test('A→B→A + reload must recover correct config per project', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}reload`;
        const svc1 = new IndexedDBService(dbName);
        const PRJ_A = 'PRJ-A-RELOAD';
        const PRJ_B = 'PRJ-B-RELOAD';

        await ensureDefaultSeed(PRJ_A, legacySettings({ regularHoursPerDay: 8, overtimeFactor: 1.5 }), { idb: svc1 });
        await ensureDefaultSeed(PRJ_B, legacySettings({ regularHoursPerDay: 7, overtimeFactor: 2.2 }), { idb: svc1 });

        // Mutate A via put
        const cfgA = await getConfig(PRJ_A, { idb: svc1 });
        cfgA.holidayFactor = 3.3;
        cfgA.payPeriod = { periodStart: '2026-06-01', periodLength: 15, payDay: '2026-06-16' };
        await putConfig(cfgA, { idb: svc1 });
        const cfgB = await getConfig(PRJ_B, { idb: svc1 });
        cfgB.holidayFactor = 2.2;
        await putConfig(cfgB, { idb: svc1 });

        // Simulate reload: close and reopen same DB name
        try { svc1.db?.close(); } catch (_) {}
        // Small delay to let fake-indexeddb release
        await new Promise(r => setTimeout(r, 10));
        const svc2 = new IndexedDBService(dbName);
        const a2 = await getConfig(PRJ_A, { idb: svc2 });
        const b2 = await getConfig(PRJ_B, { idb: svc2 });
        expect(a2).not.toBeNull();
        expect(b2).not.toBeNull();
        expect(a2.holidayFactor).toBe(3.3);
        expect(a2.payPeriod.periodStart).toBe('2026-06-01');
        expect(b2.holidayFactor).toBe(2.2);
        expect(a2.regularHoursPerDay).toBe(8);
        expect(b2.regularHoursPerDay).toBe(7);
        // Simulate A→B→A switching check
        expect(a2.projectId).toBe(PRJ_A);
        expect(b2.projectId).toBe(PRJ_B);
        const all = await listAll({ idb: svc2 });
        expect(all.map(c => c.projectId).sort()).toEqual([PRJ_A, PRJ_B].sort());
    });

    test('flag OFF: original settings unchanged, store not written (no dual-write)', async () => {
        setProjectsEnabled(false);
        const svc = new IndexedDBService(`${DB_PREFIX}flag-off`);
        const proj = 'PRJ-FLAG-OFF';
        const legacy = legacySettings({ regularHoursPerDay: 8, overtimeFactor: 1.5 });
        // Seed should be skipped when flag OFF
        const r = await ensureDefaultSeed(proj, legacy, { idb: svc });
        expect(r.skipped).toBe(true);
        expect(r.reason).toBe('flag-off');
        const cfg = await getConfig(proj, { idb: svc });
        expect(cfg).toBeNull();
        // Legacy object must be unchanged (seed didn't mutate it)
        expect(legacy.regularHoursPerDay).toBe(8);
        expect(legacy.overtimeFactor).toBe(1.5);
        // Also verify atomic seed with flag OFF never writes even if called twice
        const r2 = await ensureDefaultSeed(proj, legacySettings({ regularHoursPerDay: 12 }), { idb: svc });
        expect(r2.skipped).toBe(true);
        expect(await getConfig(proj, { idb: svc })).toBeNull();
    });

    test('canonical vs active distinction: only canonical seeds, active does not leak', async () => {
        setProjectsEnabled(true);
        const svc = new IndexedDBService(`${DB_PREFIX}canonical-active`);
        const canonicalId = 'PRJ-CANON-A2';
        const activeId = 'PRJ-ACTIVE-A2';
        // Seed canonical only
        await ensureDefaultSeed(canonicalId, legacySettings({ regularHoursPerDay: 9 }), { idb: svc });
        // Active should have no config
        expect(await getConfig(canonicalId, { idb: svc })).not.toBeNull();
        expect(await getConfig(activeId, { idb: svc })).toBeNull();

        // Put distinct config into active to prove no contamination
        const activeCfg = createDefaultConfig(activeId, legacySettings({ regularHoursPerDay: 5, overtimeFactor: 3 }));
        await putConfig(activeCfg, { idb: svc });
        const canonAfter = await getConfig(canonicalId, { idb: svc });
        const activeAfter = await getConfig(activeId, { idb: svc });
        expect(canonAfter.regularHoursPerDay).toBe(9);
        expect(activeAfter.regularHoursPerDay).toBe(5);
        expect(canonAfter.projectId).toBe(canonicalId);
        expect(activeAfter.projectId).toBe(activeId);
    });

    test('invalid projectIds are rejected (legacy-unresolved never persists)', async () => {
        setProjectsEnabled(true);
        const svc = new IndexedDBService(`${DB_PREFIX}invalid-id`);
        const r1 = await ensureDefaultSeed('legacy-unresolved:num:12', legacySettings(), { idb: svc });
        expect(r1.skipped).toBe(true);
        expect(r1.reason).toBe('invalid-id');
        expect(await getConfig('legacy-unresolved:num:12', { idb: svc })).toBeNull();
        const r2 = await ensureDefaultSeed('', legacySettings(), { idb: svc });
        expect(r2.skipped).toBe(true);
        await expect(putConfig({ projectId: 'legacy-unresolved:abc', regularHoursPerDay: 8 }, { idb: svc })).rejects.toThrow();
        await expect(putConfig({ projectId: '', regularHoursPerDay: 8 }, { idb: svc })).rejects.toThrow();
    });

    test('createDefaultConfig copies all required fields atomically from legacy', async () => {
        const proj = 'PRJ-FIELDS-A2';
        const legacy = {
            regularHoursPerDay: 7,
            overtimeFactor: 1.7,
            holidayFactor: 2.2,
            holidays: ['2026-08-23', '2026-08-23', 'bad-date'],
            payPeriod: { periodStart: '2026-08-01', periodLength: 15, payDay: '2026-08-16' },
            defaultDeductionPercentage: 3.5,
            payrollDefaults: { deductions: [{ id: 'd1', type: 'percentage', value: 5, name: 'Test', scope: 'global' }], bonuses: [] }
        };
        const cfg = createDefaultConfig(proj, legacy);
        expect(cfg.projectId).toBe(proj);
        expect(cfg.regularHoursPerDay).toBe(7);
        expect(cfg.overtimeFactor).toBe(1.7);
        expect(cfg.holidayFactor).toBe(2.2);
        expect(cfg.holidays).toEqual(['2026-08-23']); // deduped, invalid filtered
        expect(cfg.payPeriod).toEqual({ periodStart: '2026-08-01', periodLength: 15, payDay: '2026-08-16' });
        expect(cfg.defaultDeductionPercentage).toBe(3.5);
        expect(cfg.payrollDefaults.deductions).toHaveLength(1);
        expect(cfg.payrollDefaults.version).toBe(2);
        expect(cfg.schemaVersion).toBe(1);
        expect(typeof cfg.updatedAt).toBe('number');
        // Never partially initialized: every required field present
        for (const k of ['regularHoursPerDay','overtimeFactor','holidayFactor','holidays','payPeriod','defaultDeductionPercentage','payrollDefaults','schemaVersion','updatedAt','projectId']) {
            expect(cfg).toHaveProperty(k);
        }
    });
});
