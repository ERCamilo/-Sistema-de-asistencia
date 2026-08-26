/**
 * F1.4/G — REAL IndexedDB upgrade characterization: a database created and
 * seeded manually at version 16 (legacy stores only, no `projects`) must
 * upgrade through the REAL IndexedDBService (requests v17) creating the
 * `projects` store WITHOUT losing or corrupting any legacy record.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const DB_NAME = 'attendance-app-db-upgrade-v16-v17';

const SEED = {
    employee: { id: 'EMP-legacy-0001', key: 'EMP-legacy-0001', number: 7, name: 'Legacy Ana', active: true, positions: [], updatedAt: 1000 },
    position: { id: 'POS-legacy-0001', name: 'Albañil' },
    leader: { id: 'LEAD-legacy-0001', number: 3, name: 'Legacy Lead' },
    attendance: { key: 'EMP-legacy-0001-2026-01-02', employeeId: 'EMP-legacy-0001', date: '2026-01-02', present: true, hoursWorked: 8 },
    setting: { key: 'app', regularHoursPerDay: 8 }
};

/** Opens the db manually at v16 with the legacy store layout (pre-F1.1). */
function openV16WithLegacyStores(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 16);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const emp = db.createObjectStore('employees', { keyPath: 'id' });
            emp.createIndex('number', 'number', { unique: false });
            emp.createIndex('active', 'active', { unique: false });
            emp.createIndex('name', 'name', { unique: false });
            const pos = db.createObjectStore('positions', { keyPath: 'id' });
            pos.createIndex('name', 'name', { unique: false });
            const lead = db.createObjectStore('leaders', { keyPath: 'id' });
            lead.createIndex('number', 'number', { unique: false });
            const att = db.createObjectStore('attendance', { keyPath: 'key' });
            att.createIndex('employeeId', 'employeeId', { unique: false });
            att.createIndex('date', 'date', { unique: false });
            att.createIndex('employeeDate', ['employeeId', 'date'], { unique: true });
            db.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function putAll(db, entries) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(entries), 'readwrite');
        for (const [storeName, records] of Object.entries(entries)) {
            for (const record of records) tx.objectStore(storeName).put(record);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

describe('IndexedDBService upgrade v16 → v17 (real)', () => {
    test('creates the projects store and keeps ALL legacy seeded records intact/readable', async () => {
        const legacyDb = await openV16WithLegacyStores(DB_NAME);
        expect(legacyDb.objectStoreNames.contains('projects')).toBe(false);
        await putAll(legacyDb, {
            employees: [SEED.employee],
            positions: [SEED.position],
            leaders: [SEED.leader],
            attendance: [SEED.attendance],
            settings: [SEED.setting]
        });
        legacyDb.close();

        // Upgrade path under test: REAL service requests v17 over the v16 db.
        const svc = new IndexedDBService(DB_NAME); // default constructor version = 17
        await svc.init();

        expect(svc.db.objectStoreNames.contains('projects')).toBe(true);

        await expect(svc.get('employees', SEED.employee.id)).resolves.toEqual(SEED.employee);
        await expect(svc.get('positions', SEED.position.id)).resolves.toEqual(SEED.position);
        await expect(svc.get('leaders', SEED.leader.id)).resolves.toEqual(SEED.leader);
        await expect(svc.get('attendance', SEED.attendance.key)).resolves.toEqual(SEED.attendance);
        await expect(svc.get('settings', 'app')).resolves.toEqual(SEED.setting);

        // The new store is immediately usable (write + read round-trip).
        const project = { id: 'PRJ-upg-0000', name: 'Post-upgrade', status: 'active', schemaVersion: 1 };
        await svc.update('projects', project);
        await expect(svc.get('projects', project.id)).resolves.toEqual(project);
    });
});
