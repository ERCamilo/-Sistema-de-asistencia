const fs = require('fs');
const path = require('path');
const read = relative => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const IDB = read('../modules/services/IndexedDBService.js');
const PERSISTENCE = read('../modules/services/PersistenceService.js');
const EMPLOYEES = read('../modules/features/employees/EmployeesList.js');
const POSITIONS = read('../modules/features/employees/PositionsList.js');
describe('twelve-month attendance retention wiring', () => {
    test('IndexedDB exposes an atomic batch delete', () => {
        const method = IDB.match(/async batchDelete\([\s\S]*?\n    }/i)?.[0] || '';
        expect(method).toContain("transaction([storeName], 'readwrite')");
        expect(method).toContain('keys.forEach(key => store.delete(key))');
        expect(method).toContain('transaction.onabort');
    });
    test('Persistence protects unconfirmed outbox dates and deletes attendance only', () => {
        const wiring = PERSISTENCE.match(/createAttendanceCachePruner\(\{[\s\S]*?\n}\);/)?.[0] || '';
        expect(wiring).toContain('MainSyncStore.getUnconfirmedDailyDateKeys()');
        expect(wiring).toContain("indexedDBService.batchDelete('attendance', keys)");
        expect(wiring).not.toMatch(/employees|leaders|positions|settings|pettyCash/);
    });
    test('startup applies retention after outbox rehydration without triggering a save', () => {
        const start = PERSISTENCE.indexOf('export async function loadApplicationData(');
        const end = PERSISTENCE.indexOf('export async function loadDemoDataIntoDB(', start);
        const load = PERSISTENCE.slice(start, end);
        const seed = load.indexOf('_seedMainSyncOutboxFromLegacyDeletes()');
        const prune = load.indexOf('await pruneAttendanceCache()');
        const validate = load.indexOf('await validateDataIntegrity()');
        expect(seed).toBeGreaterThan(-1);
        expect(prune).toBeGreaterThan(seed);
        expect(validate).toBeGreaterThan(prune);
        expect(load.slice(seed, validate)).not.toContain('saveApplicationData(');
    });

    test('destructive employee and position checks load complete history first', () => {
        expect(EMPLOYEES).toMatch(/export async function deleteEmployeeHandler[\s\S]*?await ensureAllAttendanceHistory\(\)/);
        expect(POSITIONS).toMatch(/export async function deletePosition[\s\S]*?await ensureAllAttendanceHistory\(\)/);
        expect(PERSISTENCE).toMatch(/export function ensureAllAttendanceHistory\(\)/);
    });
});
