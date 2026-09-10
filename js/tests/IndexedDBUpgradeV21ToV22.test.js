import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

function openV21(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 21);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            db.createObjectStore('employees', { keyPath: 'id' });
            db.createObjectStore('attendance', { keyPath: 'key' });
            db.createObjectStore('settings', { keyPath: 'key' });
            db.createObjectStore('projects', { keyPath: 'id' });
            db.createObjectStore('projectPayrollConfigs', { keyPath: 'projectId' });
            const inbox = db.createObjectStore('attendanceSubmissionInbox', { keyPath: 'key' });
            inbox.createIndex('status', 'status', { unique: false });
            inbox.createIndex('saProjectId', 'saProjectId', { unique: false });
            inbox.createIndex('workDate', 'workDate', { unique: false });
            inbox.createIndex('receivedAt', 'receivedAt', { unique: false });
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['employees', 'attendanceSubmissionInbox'], 'readwrite');
            tx.objectStore('employees').put({ id: 'EMP-21', name: 'Ana' });
            tx.objectStore('attendanceSubmissionInbox').put({
                key: 'PRJ-1|SUB-1', saProjectId: 'PRJ-1', submissionId: 'SUB-1',
                status: 'pending', workDate: '2026-09-10', receivedAt: 1
            });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

describe('IndexedDBService upgrade v21 → v22', () => {
    test('preserves v21 data and creates isolated Mini consolidation store', async () => {
        const dbName = `test-upg-v21-v22-${Date.now()}-${Math.random()}`;
        await openV21(dbName);
        const svc = new IndexedDBService(dbName);
        await svc.init();
        expect(svc.db.version).toBe(22);
        expect(svc.db.objectStoreNames.contains('miniAttendanceConsolidations')).toBe(true);
        await expect(svc.get('employees', 'EMP-21')).resolves.toEqual({ id: 'EMP-21', name: 'Ana' });
        await expect(svc.get('attendanceSubmissionInbox', 'PRJ-1|SUB-1')).resolves.toMatchObject({ submissionId: 'SUB-1', status: 'pending' });

        const tx = svc.db.transaction('miniAttendanceConsolidations', 'readonly');
        const store = tx.objectStore('miniAttendanceConsolidations');
        expect(store.keyPath).toBe('key');
        for (const index of ['saProjectId', 'status', 'updatedAt', 'projectStatus']) {
            expect(store.indexNames.contains(index)).toBe(true);
        }
        const record = { key: 'PRJ-1|CONS-1', consolidationId: 'CONS-1', saProjectId: 'PRJ-1', status: 'resolving', updatedAt: 2 };
        await svc.update('miniAttendanceConsolidations', record);
        await expect(svc.get('miniAttendanceConsolidations', record.key)).resolves.toEqual(record);
        svc.db.close();
    });
});
