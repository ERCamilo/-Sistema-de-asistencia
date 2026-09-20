import 'fake-indexeddb/auto';
import { IndexedDBService, ATTENDANCE_RECOVERY_PROTECTION_KEY } from 'actual/services/IndexedDBService.js';
import { planAttendanceEviction } from '../modules/services/AttendanceRetentionPolicy.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

describe('FULL restore durable recovery protection R06', () => {
    test('Attendance inflation preserves local recovery metadata but cloud JSON omits it', () => {
        const lastAccessed = new Date('2026-09-20T00:00:00Z').getTime();
        const record = new Attendance({
            employeeId: 'emp-restored',
            date: '2025-08-25',
            present: true,
            hoursWorked: 8,
            lastAccessed,
            recoveryProtected: true
        });

        expect(record.lastAccessed).toBe(lastAccessed);
        expect(record.recoveryProtected).toBe(true);
        expect(record.toJSON().lastAccessed).toBeUndefined();
        expect(record.toJSON().recoveryProtected).toBeUndefined();

        const plan = planAttendanceEviction({ [record.key]: record }, {
            now: new Date('2030-09-20T00:00:00Z').getTime()
        });
        expect(plan.kept[record.key]).toBeDefined();
    });

    test('recovery-protected historical record survives years while ordinary old cache remains evictable', () => {
        const now = new Date('2030-09-20T00:00:00Z').getTime();
        const protectedKey = 'emp-restored-2025-08-25';
        const ordinaryKey = 'emp-ordinary-2025-08-25';
        const plan = planAttendanceEviction({
            [protectedKey]: {
                employeeId: 'emp-restored',
                date: '2025-08-25',
                present: true,
                recoveryProtected: true
            },
            [ordinaryKey]: {
                employeeId: 'emp-ordinary',
                date: '2025-08-25',
                present: true
            }
        }, { now });

        expect(plan.kept[protectedKey]).toBeDefined();
        expect(plan.evictKeys).toContain(ordinaryKey);
    });

    test('ordinary save preserves FULL recovery protection from auxiliary metadata without mutating source state', async () => {
        const db = new IndexedDBService('test-full-recovery-protection-r06-' + Math.random());
        await db.init();

        const key = 'emp-old-2025-08-25';
        const initialState = {
            employees: [{ id: 'emp-old', number: '1', name: 'Old', positions: [], loans: [], active: true }],
            positions: [],
            leaders: [],
            attendance: {
                [key]: { employeeId: 'emp-old', date: '2025-08-25', present: true, hoursWorked: 8 }
            },
            settings: { regularHoursPerDay: 8 }
        };

        await db.saveState(initialState, {
            clearFirst: true,
            recoveryProtectionCreatedAt: new Date('2026-09-20T00:00:00Z').getTime(),
            recoveryProtectedAttendanceKeys: [key]
        });

        expect(initialState.attendance[key].recoveryProtected).toBeUndefined();

        let durable = await db.get('attendance', key);
        expect(durable.recoveryProtected).toBe(true);

        const meta = await db.get('settings', ATTENDANCE_RECOVERY_PROTECTION_KEY);
        expect(meta.recordKeys).toEqual([key]);

        // Simulate a normal save before any restart: in-memory source still has
        // no internal recovery flag. Metadata must restore it on the durable row.
        initialState.attendance[key].hoursWorked = 9;
        await db.saveState(initialState);

        durable = await db.get('attendance', key);
        expect(durable.hoursWorked).toBe(9);
        expect(durable.recoveryProtected).toBe(true);

        const metaAfterSave = await db.get('settings', ATTENDANCE_RECOVERY_PROTECTION_KEY);
        expect(metaAfterSave.recordKeys).toEqual([key]);

        db.db.close();
    });
});
