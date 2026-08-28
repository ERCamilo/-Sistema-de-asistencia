/**
 * Source-contract manifest: every object store the schema creates + DB version.
 * Regex/readFileSync contract (moduleNameMapper intercepts IndexedDBService.js
 * at runtime — established pattern, see IndexedDBUpgradeResilienceTests).
 * employeePhotos is declared in EmployeePhotoCache.js via ensureEmployeePhotoStore(db).
 *
 * Renamed from IndexedDBSchemaV16Manifest.test.js (F1.1): version-pinned names
 * forced a rename on every schema bump; the manifest is now version-agnostic.
 */

import fs from 'fs';
import path from 'path';

const IDB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'), 'utf8'
);
const PHOTO_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/EmployeePhotoCache.js'), 'utf8'
);

const EXPECTED_STORES = {
    employees: 'id',
    positions: 'id',
    leaders: 'id',
    attendance: 'key',
    settings: 'key',
    sync_queue: 'id',
    pettyCashReceipts: 'txId',
    pettyCashProjects: 'id',
    pettyCashPeriods: 'id',
    pettyCashMovements: 'id',
    pettyCashOutbox: 'key',
    pettyCashMirrorOutbox: 'id',
    mainSyncOutbox: 'key',
    syncLocks: 'name',
    miniAttendanceAliases: 'aliasId',
    miniAttendanceAliasAudit: 'auditId',
    miniAttendanceInbox: 'eventId',
    payrollClosures: 'id',
    projects: 'id',
    projectPayrollConfigs: 'projectId'
};

const AUTO_INCREMENT_STORES = ['sync_queue', 'pettyCashOutbox', 'mainSyncOutbox'];

describe('IndexedDB schema v18 manifest (source contract)', () => {
    test('opens database version 18', () => {
        expect(IDB_SRC).toMatch(/version\s*=\s*18/);
    });

    test('creates exactly every known store with its current keyPath', () => {
        const found = {};
        const storeRegex = /createObjectStore\(\s*['"]([A-Za-z_]+)['"]\s*,\s*\{\s*keyPath:\s*['"]([A-Za-z_]+)['"]/g;
        let match;
        while ((match = storeRegex.exec(IDB_SRC)) !== null) {
            found[match[1]] = match[2];
        }

        expect(Object.keys(found).sort()).toEqual(Object.keys(EXPECTED_STORES).sort());
        for (const [store, keyPath] of Object.entries(EXPECTED_STORES)) {
            expect(found[store]).toBe(keyPath);
        }
    });

    test.each(AUTO_INCREMENT_STORES)('outbox/queue store %s keeps autoIncrement', store => {
        const block = IDB_SRC.match(new RegExp(`${store}['"][\\s\\S]{0,250}`));
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/autoIncrement:\s*true/);
    });

    test('employeePhotos store is declared by its cache helper and wired into the upgrade', () => {
        expect(IDB_SRC).toMatch(/ensureEmployeePhotoStore\(db\)/);
        expect(PHOTO_SRC).toMatch(/STORE_NAME\s*=\s*'employeePhotos'/);
        expect(PHOTO_SRC)
            .toMatch(/createObjectStore\(\s*STORE_NAME\s*,\s*\{\s*keyPath:\s*'employeeId'\s*\}/);
    });
});
