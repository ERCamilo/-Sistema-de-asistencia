/**
 * B2.2-MC1 — REAL IndexedDB upgrades to v20
 * Proves the upgrade is real for existing v17 and v19 DBs:
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

function openV17WithLegacyData(dbName, { employee, settings, project, payrollClosure }) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 17);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore('employees', { keyPath: 'id' });
            db.createObjectStore('settings', { keyPath: 'key' });
            db.createObjectStore('projects', { keyPath: 'id' });
            const closureStore = db.createObjectStore('payrollClosures', { keyPath: 'id' });
            closureStore.createIndex('periodKey', 'periodKey', { unique: false });
            closureStore.createIndex('closedAtId', ['closedAt', 'id'], { unique: false });
            closureStore.createIndex('statusClosedAtId', ['status', 'closedAt', 'id'], { unique: false });
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['employees', 'settings', 'projects', 'payrollClosures'], 'readwrite');
            tx.objectStore('employees').put(employee);
            tx.objectStore('settings').put(settings);
            tx.objectStore('projects').put(project);
            tx.objectStore('payrollClosures').put(payrollClosure);
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

        const svc = new IndexedDBService(dbName, 20);
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

    test('upgrade path: v17 data survives through v20 and gains project payroll schema', async () => {
        const dbName = `test-upg-v17-v20-${Date.now()}-${Math.random()}`;
        const employee = { id: 'EMP-V17', number: 17, name: 'Legacy employee', active: true };
        const settings = { key: 'app', regularHoursPerDay: 8, companyName: 'Legacy company' };
        const project = { id: 'PRJ-V17', name: 'Legacy project', status: 'active', createdAt: 17 };
        const payrollClosure = {
            id: 'PAYROLL-CLOSURE-V17',
            periodStart: '2026-07-01',
            periodEnd: '2026-07-15',
            periodKey: '2026-07-01:2026-07-15',
            status: 'closed',
            closedAt: 17,
            rows: [{ _employeeId: employee.id, monto: 800 }]
        };
        await openV17WithLegacyData(dbName, { employee, settings, project, payrollClosure });

        const svc = new IndexedDBService(dbName, 20);
        await svc.init();

        expect(svc.db.version).toBe(20);
        await expect(svc.get('employees', employee.id)).resolves.toEqual(employee);
        await expect(svc.get('settings', settings.key)).resolves.toEqual(settings);
        await expect(svc.get('projects', project.id)).resolves.toEqual(project);
        await expect(svc.get('payrollClosures', payrollClosure.id)).resolves.toEqual(payrollClosure);
        expect(svc.db.objectStoreNames.contains('projectPayrollConfigs')).toBe(true);

        const configStore = svc.db.transaction('projectPayrollConfigs', 'readonly').objectStore('projectPayrollConfigs');
        expect(configStore.keyPath).toBe('projectId');

        const closureStore = svc.db.transaction('payrollClosures', 'readonly').objectStore('payrollClosures');
        expect(closureStore.indexNames.contains('projectId')).toBe(true);
        expect(closureStore.indexNames.contains('projectClosedAtId')).toBe(true);
        expect(closureStore.indexNames.contains('projectStatusClosedAtId')).toBe(true);
        svc.db.close();
    });

    test('fresh v20 install creates both composite indexes', async () => {
        const dbName = `test-fresh-v20-${Date.now()}-${Math.random()}`;
        const svc = new IndexedDBService(dbName, 20);
        await svc.init();
        expect(svc.db.version).toBe(20);
        const store = svc.db.transaction('payrollClosures', 'readonly').objectStore('payrollClosures');
        expect(store.indexNames.contains('projectClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectStatusClosedAtId')).toBe(true);
        expect(store.indexNames.contains('projectId')).toBe(true);
        svc.db.close();
    });
});
