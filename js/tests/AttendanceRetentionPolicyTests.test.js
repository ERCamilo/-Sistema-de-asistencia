import { planAttendanceEviction, attendanceRetentionStart, ATTENDANCE_RETENTION_MONTHS, HISTORICAL_ACCESS_RETENTION_MS } from '../modules/services/AttendanceRetentionPolicy.js';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-20T12:00:00').getTime();
function record(date, overrides = {}) {
    return { employeeId: 'e1', date, updatedAt: NOW - 100 * DAY, ...overrides };
}
describe('AttendanceRetentionPolicy', () => {
    test('uses a rolling twelve-month cutoff with calendar-day clamping', () => {
        expect(ATTENDANCE_RETENTION_MONTHS).toBe(12);
        expect(attendanceRetentionStart(NOW)).toBe('2025-07-20');
        expect(attendanceRetentionStart(new Date('2024-02-29T12:00:00').getTime())).toBe('2023-02-28');
    });
    test('keeps the cutoff day and newer attendance, evicting older inactive records', () => {
        const attendance = {
            recent: record('2026-07-01'),
            cutoff: record('2025-07-20'),
            old: record('2025-07-19')
        };

        const plan = planAttendanceEviction(attendance, { now: NOW });

        expect(Object.keys(plan.kept)).toEqual(['recent', 'cutoff']);
        expect(plan.evictKeys).toEqual(['old']);
        expect(plan.cutoffDate).toBe('2025-07-20');
    });

    test('keeps an old historical range for thirty days after explicit access', () => {
        const attendance = {
            recentlyViewed: record('2024-01-10', { lastAccessed: NOW - 29 * DAY }),
            staleView: record('2024-01-11', { lastAccessed: NOW - 31 * DAY })
        };

        const plan = planAttendanceEviction(attendance, { now: NOW });

        expect(HISTORICAL_ACCESS_RETENTION_MS).toBe(30 * DAY);
        expect(plan.kept.recentlyViewed).toBeDefined();
        expect(plan.evictKeys).toEqual(['staleView']);
    });

    test('never evicts dates with pending or dead daily outbox entries', () => {
        const attendance = {
            pending: record('2024-01-10'),
            dead: record('2024-01-11'),
            confirmed: record('2024-01-12')
        };

        const plan = planAttendanceEviction(attendance, {
            now: NOW,
            protectedDateKeys: new Set(['2024-01-10', '2024-01-11'])
        });

        expect(Object.keys(plan.kept)).toEqual(['pending', 'dead']);
        expect(plan.evictKeys).toEqual(['confirmed']);
    });

    test('protects required tombstones and allows confirmed expired tombstones to leave cache', () => {
        const attendance = {
            required: record('2024-01-10', { deletedAt: NOW - 59 * DAY }),
            expired: record('2024-01-11', { deletedAt: NOW - 61 * DAY })
        };

        const plan = planAttendanceEviction(attendance, { now: NOW });

        expect(plan.kept.required).toBeDefined();
        expect(plan.evictKeys).toEqual(['expired']);
    });

    test('keeps malformed records conservatively instead of risking data loss', () => {
        const attendance = {
            noDate: { employeeId: 'e1' },
            badDate: record('not-a-date')
        };

        const plan = planAttendanceEviction(attendance, { now: NOW });

        expect(Object.keys(plan.kept)).toEqual(['noDate', 'badDate']);
        expect(plan.evictKeys).toEqual([]);
    });
});
