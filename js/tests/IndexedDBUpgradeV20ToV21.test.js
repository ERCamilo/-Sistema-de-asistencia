/**
 * IndexedDBService upgrade v20 → v21 (real fake-indexeddb runtime)
 *
 * Verifies:
 * - Existing v20 database preserves all records and stores when upgrading to v21.
 * - attendanceSubmissionInbox object store is created with keyPath 'key'
 *   and non-unique indexes: status, saProjectId, workDate, receivedAt.
 * - attendanceSubmissionInbox can store and retrieve attendance-submission/v1 records.
 * - Fresh v21 install creates attendanceSubmissionInbox with all indexes.
 */
import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

function openV20WithLegacyData(dbName, data = {}) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 20);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const empStore = db.createObjectStore('employees', { keyPath: 'id' });
            empStore.createIndex('number', 'number', { unique: false });
            empStore.createIndex('active', 'active', { unique: false });
            empStore.createIndex('name', 'name', { unique: false });

            const attStore = db.createObjectStore('attendance', { keyPath: 'key' });
            attStore.createIndex('employeeId', 'employeeId', { unique: false });
            attStore.createIndex('date', 'date', { unique: false });

            db.createObjectStore('settings', { keyPath: 'key' });
            db.createObjectStore('projects', { keyPath: 'id' });
            db.createObjectStore('projectPayrollConfigs', { keyPath: 'projectId' });

            const closureStore = db.createObjectStore('payrollClosures', { keyPath: 'id' });
            closureStore.createIndex('projectId', 'projectId', { unique: false });
            closureStore.createIndex('projectClosedAtId', ['projectId', 'closedAt', 'id'], { unique: false });
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['employees', 'attendance', 'settings', 'projects'], 'readwrite');
            if (data.employee) tx.objectStore('employees').put(data.employee);
            if (data.attendance) tx.objectStore('attendance').put(data.attendance);
            if (data.settings) tx.objectStore('settings').put(data.settings);
            if (data.project) tx.objectStore('projects').put(data.project);
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

describe('IndexedDBService upgrade v20 → v21 (real)', () => {
    test('upgrade path: v20 DB upgrades to v21, all data intact, attendanceSubmissionInbox created', async () => {
        const dbName = `test-upg-v20-v21-${Date.now()}-${Math.random()}`;
        const employee = { id: 'EMP-V20', number: '10', name: 'Carlos Gomez', active: true };
        const attendance = { key: 'EMP-V20-2026-09-08', employeeId: 'EMP-V20', date: '2026-09-08', hoursWorked: 8 };
        const settings = { key: 'app', regularHoursPerDay: 8 };
        const project = { id: 'PRJ-V20', name: 'Edificio Central', status: 'active', createdAt: 12345 };

        await openV20WithLegacyData(dbName, { employee, attendance, settings, project });

        const svc = new IndexedDBService(dbName);
        await svc.init();

        expect(svc.db.version).toBe(21);
        expect(svc.db.objectStoreNames.contains('attendanceSubmissionInbox')).toBe(true);

        // Verify existing data survives
        await expect(svc.get('employees', employee.id)).resolves.toEqual(employee);
        await expect(svc.get('attendance', attendance.key)).resolves.toEqual(attendance);
        await expect(svc.get('settings', settings.key)).resolves.toEqual(settings);
        await expect(svc.get('projects', project.id)).resolves.toEqual(project);

        // Verify attendanceSubmissionInbox schema and indexes
        const tx = svc.db.transaction('attendanceSubmissionInbox', 'readonly');
        const store = tx.objectStore('attendanceSubmissionInbox');
        expect(store.keyPath).toBe('key');
        expect(store.indexNames.contains('status')).toBe(true);
        expect(store.indexNames.contains('saProjectId')).toBe(true);
        expect(store.indexNames.contains('workDate')).toBe(true);
        expect(store.indexNames.contains('receivedAt')).toBe(true);

        // Verify read/write roundtrip on the new store
        const inboxRecord = {
            key: 'PRJ-V20|sub-1',
            saProjectId: 'PRJ-V20',
            submissionId: 'sub-1',
            status: 'pending',
            receivedAt: 1725800000000,
            workDate: '2026-09-08',
            rosterVersion: 'roster-v1',
            blockers: [],
            bodyHash: 'fnv1a32:12345678',
            sourceSnapshot: { schema: 'attendance-submission/v1', submissionId: 'sub-1' }
        };
        await svc.update('attendanceSubmissionInbox', inboxRecord);
        await expect(svc.get('attendanceSubmissionInbox', inboxRecord.key)).resolves.toEqual(inboxRecord);

        svc.db.close();
    });

    test('fresh v21 install creates attendanceSubmissionInbox with all indexes', async () => {
        const dbName = `test-fresh-v21-${Date.now()}-${Math.random()}`;
        const svc = new IndexedDBService(dbName);
        await svc.init();

        expect(svc.db.version).toBe(21);
        expect(svc.db.objectStoreNames.contains('attendanceSubmissionInbox')).toBe(true);

        const tx = svc.db.transaction('attendanceSubmissionInbox', 'readonly');
        const store = tx.objectStore('attendanceSubmissionInbox');
        expect(store.keyPath).toBe('key');
        expect(store.indexNames.contains('status')).toBe(true);
        expect(store.indexNames.contains('saProjectId')).toBe(true);
        expect(store.indexNames.contains('workDate')).toBe(true);
        expect(store.indexNames.contains('receivedAt')).toBe(true);

        svc.db.close();
    });
});
