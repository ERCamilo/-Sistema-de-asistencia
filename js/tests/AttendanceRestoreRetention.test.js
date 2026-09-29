import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedDB from '../modules/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { pruneAttendanceCache } from '../modules/services/PersistenceService.js';
import { planAttendanceEviction, attendanceRetentionStart } from '../modules/services/AttendanceRetentionPolicy.js';
import { createAttendanceCachePruner } from '../modules/services/AttendanceCachePruner.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

// A backup can be the only copy of history older than the local cache window.
const NOW = new Date('2026-09-27T12:00:00').getTime();
const OLD = '2025-08-25';
const RECENT = '2026-09-10';
const record = (employeeId, date) => ({ employeeId, date, present: true, hoursWorked: 8, overtimeHours: 0,
    positionHours: [], updatedAt: NOW - 400 * 86400000, deletedAt: null });

describe('restored attendance older than the cache window', () => {
    test('attendance model keeps the Mini audit only when present', () => {
        const audit = { source: 'mini', differenceHours: 0 };
        expect(new Attendance({ ...record('e1', RECENT), miniImportAudit: audit }).toJSON().miniImportAudit).toEqual(audit);
        expect(new Attendance(record('e1', RECENT)).toJSON()).not.toHaveProperty('miniImportAudit');
    });

    test('policy keeps durable restore-protected keys and flagged records', () => {
        const attendance = { a: record('e1', OLD), b: record('e2', OLD), c: { ...record('e3', OLD), recoveryProtected: true } };
        const plan = planAttendanceEviction(attendance, { now: NOW, protectedRecordKeys: new Set(['a']) });
        expect(Object.keys(plan.kept)).toEqual(['a', 'c']);
        expect(plan.evictKeys).toEqual(['b']);
    });

    test('pruner reads protected record keys; old callers keep their behavior', async () => {
        let attendance = { a: record('e1', OLD), b: record('e2', OLD) };
        const deps = { readAttendance: () => attendance, writeAttendance: next => { attendance = next; },
            getProtectedDateKeys: async () => new Set(), deleteRecords: jest.fn().mockResolvedValue(1), now: () => NOW };
        await createAttendanceCachePruner({ ...deps, getProtectedRecordKeys: async () => new Set(['a']) }).prune();
        expect(deps.deleteRecords).toHaveBeenCalledWith(['b']);
        expect(Object.keys(attendance)).toEqual(['a']);
        await createAttendanceCachePruner(deps).prune();
        expect(deps.deleteRecords).toHaveBeenLastCalledWith(['a']);
    });

    describe('startup pruning after a real atomic restore', () => {
        let db, previous;
        beforeEach(async () => {
            jest.useFakeTimers({ now: NOW });
            previous = stateManager.getState().attendance;
            db = new IndexedDBService('restore-retention-' + Math.random());
            await db.init();
            mockedDB.getAttendanceRecoveryProtectedKeys.mockImplementation(() => db.getAttendanceRecoveryProtectedKeys());
            mockedDB.batchDelete.mockImplementation((store, keys) => db.batchDelete(store, keys));
        });
        afterEach(() => {
            mockedDB.getAttendanceRecoveryProtectedKeys.mockReset();
            mockedDB.getAttendanceRecoveryProtectedKeys.mockResolvedValue(new Set());
            mockedDB.batchDelete.mockReset();
            mockedDB.batchDelete.mockResolvedValue(0);
            stateManager.getState().attendance = previous;
            db.db.close();
            jest.useRealTimers();
        });

        async function reloadAndPrune() {
            // Same inflation as loadApplicationData: the model drops per-record markers.
            const loaded = await db.loadFullState();
            stateManager.getState().attendance = Object.fromEntries(Object.entries(loaded.attendance)
                .map(([key, value]) => [key, new Attendance(value)]));
            return pruneAttendanceCache();
        }

        test('restored history survives the reload; ordinary old cache leaves memory but stays in IndexedDB', async () => {
            const miniImportAudit = { source: 'mini', original: { normalHours: 7, overtimeHours: 0, totalHours: 7 },
                applied: { normalHours: 8, overtimeHours: 0, totalHours: 8 }, differenceHours: 1 };
            const restored = { ['e1-' + OLD]: { ...record('e1', OLD), miniImportAudit }, ['e1-' + RECENT]: record('e1', RECENT) };
            const cutoff = attendanceRetentionStart(NOW);
            // Options as PersistenceService.saveToIndexedDB builds them for FILE/FULL imports.
            await db.saveState({ employees: [], positions: [], leaders: [], attendance: restored, settings: { companyName: 'X' } }, {
                clearFirst: true, recoveryProtectionCreatedAt: NOW,
                recoveryProtectedAttendanceKeys: Object.keys(restored).filter(key => restored[key].date < cutoff)
            });
            await db.update('attendance', { key: 'e9-' + OLD, ...record('e9', OLD) });

            const result = await reloadAndPrune();

            expect(result.evicted).toBe(1);
            // Retention only releases memory: without a session the device may hold the only copy.
            expect(mockedDB.batchDelete).not.toHaveBeenCalled();
            expect((await db.getAll('attendance')).map(item => item.key).sort()).toEqual(['e1-' + OLD, 'e1-' + RECENT, 'e9-' + OLD]);
            expect(Object.keys(stateManager.getState().attendance).sort()).toEqual(['e1-' + OLD, 'e1-' + RECENT]);
            // A later ordinary save keeps the durable list and never drops the evicted local copy.
            await db.saveState({ employees: [], positions: [], leaders: [], attendance: stateManager.getState().attendance, settings: {} }, {});
            expect(await db.get('attendance', 'e9-' + OLD)).toMatchObject({ employeeId: 'e9', date: OLD });
            // The next start protects the restored history again and only releases the ordinary cache.
            expect((await reloadAndPrune()).evicted).toBe(1);
            expect(Object.keys(stateManager.getState().attendance).sort()).toEqual(['e1-' + OLD, 'e1-' + RECENT]);
            // The Mini audit survives the model round-trip and the ordinary save.
            expect(await db.get('attendance', 'e1-' + OLD)).toMatchObject({ hoursWorked: 8, present: true, miniImportAudit });
            expect(await db.get('attendance', 'e1-' + RECENT)).not.toHaveProperty('miniImportAudit');
        });
    });
});
