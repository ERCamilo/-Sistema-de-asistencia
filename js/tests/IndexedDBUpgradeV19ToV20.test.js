/**
 * B2.2-MC1 — REAL IndexedDB upgrade v19 → v20
 * Proves the MC1 fix makes the upgrade real for existing v19 DBs:
 *  - v19 DB with closures (without composite indexes) upgrades to v20
 *    preserving records and creating projectClosedAtId/projectStatusClosedAtId
 *  - fresh v20 install creates both composite indexes
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { PayrollClosureStore } from 'actual/features/payroll/PayrollClosureStore.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot } from 'actual/features/payroll/PayrollClosure.js';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const A = 'PRJ-A-UPG';
const B = 'PRJ-B-UPG';
const DEFAULT = 'PRJ-DEFAULT-UPG';

function row(id, number) {
    return { id: 1, _employeeId: id, _employeeName: 'Ada', _number: number, _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 0, monto: 1000 };
}
function closure(projectId, closedAt) {
    const rows = [row(`emp-${projectId}-${closedAt}`, `${closedAt}`)];
    const fingerprint = JSON.stringify(buildPayrollClosureSnapshot({ projectId, periodStart: '2026-08-01', periodEnd: '2026-08-15', rows }));
    return buildPayrollClosure({
        projectId,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        rows,
        fingerprint,
        closedAt
    });
}

function openV19WithClosures(dbName, closures) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 19);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('payrollClosures')) {
                const store = db.createObjectStore('payrollClosures', { keyPath: 'id' });
                store.createIndex('periodKey', 'periodKey', { unique: false });
                store.createIndex('closedAtId', ['closedAt', 'id'], { unique: false });
                store.createIndex('statusClosedAtId', ['status', 'closedAt', 'id'], { unique: false });
                store.createIndex('projectId', 'projectId', { unique: false });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['payrollClosures'], 'readwrite');
            const store = tx.objectStore('payrollClosures');
            for (const c of closures) store.put({ ...c, periodKey: `${c.periodStart}:${c.periodEnd}` });
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

describe('IndexedDBService upgrade v19 → v20 (real)', () => {
    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('upgrade path: v19 DB with closures upgrades to v20, records intact, composite indexes exist, scoped reads isolate A/B', async () => {
        const dbName = `test-upg-v19-v20-${Date.now()}-${Math.random()}`;
        const cA1 = closure(A, 100);
        const cA2 = closure(A, 200);
        const cB1 = closure(B, 150);
        await openV19WithClosures(dbName, [cA1, cA2, cB1]);

        const svc = new IndexedDBService(dbName);
        await svc.init();
        expect(svc.db.version).toBe(20);
        const store = svc.db.transaction('payrollClosures', 'readonly').objectStore('payrollClosures');
        expect(store.indexNames.contains('projectId')).toBe(true);
        expect(store.indexNames.contains('periodKey')).toBe(true);
        expect(store.indexNames.contains('closedAtId')).toBe(true);
        expect(store.indexNames.contains('statusClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectStatusClosedAtId')).toBe(true);
        await expect(svc.get('payrollClosures', cA1.id)).resolves.toMatchObject({ projectId: A });
        await expect(svc.get('payrollClosures', cB1.id)).resolves.toMatchObject({ projectId: B });

        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
        const pStore = new PayrollClosureStore({ db: svc });
        const pageA = await pStore.listPage({ limit: 10, status: 'closed' });
        expect(pageA.items.map(i => i.projectId).every(pid => pid === A)).toBe(true);
        expect(pageA.items.map(i => i.id)).toEqual(expect.arrayContaining([cA1.id, cA2.id]));
        expect(pageA.items.map(i => i.id)).not.toEqual(expect.arrayContaining([cB1.id]));
        await expect(pStore.getById(cB1.id)).resolves.toBeNull();
        await expect(pStore.getById(cA1.id)).resolves.toMatchObject({ projectId: A });

        replaceEntityScope({ enabled: true, projectId: B, defaultProjectId: DEFAULT });
        const pageB = await pStore.listPage({ limit: 10, status: 'closed' });
        expect(pageB.items.map(i => i.id)).toEqual([cB1.id]);
        await expect(pStore.getById(cA1.id)).resolves.toBeNull();

        svc.db.close();
    });

    test('fresh v20 install creates both composite indexes', async () => {
        const dbName = `test-fresh-v20-${Date.now()}-${Math.random()}`;
        const svc = new IndexedDBService(dbName);
        await svc.init();
        expect(svc.db.version).toBe(20);
        const store = svc.db.transaction('payrollClosures', 'readonly').objectStore('payrollClosures');
        expect(store.indexNames.contains('projectClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectStatusClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectId')).toBe(true);
        svc.db.close();
    });
});
