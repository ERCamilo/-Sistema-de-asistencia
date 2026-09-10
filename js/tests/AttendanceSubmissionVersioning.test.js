import {
    attendanceSubmissionSemanticHash,
    attendanceSubmissionSeriesKey,
    diffAttendanceSubmissionSnapshots
} from '../modules/features/attendance/AttendanceSubmissionVersioning.js';

const base = (rows, extra = {}) => ({
    schema: 'attendance-submission/v1', submissionId: extra.submissionId || 'sub-a',
    saProjectId: 'PRJ-1', deviceId: 'MINI-A', workDate: '2026-09-10',
    coverageMode: 'linked-roster-full', rows
});
const row = (id, hours, extra = {}) => ({
    miniLocalId: `m-${id}`, saEmployeeId: id, number: extra.number || id,
    name: extra.name || id, normalHours: Math.min(hours, 8), overtimeHours: Math.max(0, hours - 8),
    status: hours > 0 ? 'present' : 'unmarked', rosterStatus: extra.rosterStatus || 'active'
});

describe('AttendanceSubmissionVersioning', () => {
    test('series key is project + Mini device + day', () => {
        expect(attendanceSubmissionSeriesKey(base([row('E1', 8)]))).toBe('PRJ-1|MINI-A|2026-09-10');
    });
    test('semantic hash ignores transmission identity but detects attendance changes', () => {
        const a = base([row('E1', 8)], { submissionId: 'a' });
        const b = { ...a, submissionId: 'b', capturedAt: 'later' };
        const c = base([row('E1', 16)], { submissionId: 'c' });
        expect(attendanceSubmissionSemanticHash(a)).toBe(attendanceSubmissionSemanticHash(b));
        expect(attendanceSubmissionSemanticHash(a)).not.toBe(attendanceSubmissionSemanticHash(c));
    });
    test('summarizes hours, added/removed attendance and roster activation with details', () => {
        const a = base([row('E1', 8, { name: 'Juan' }), row('E2', 8, { name: 'Pedro' }), row('E3', 0, { name: 'Lucas', rosterStatus: 'paused' })]);
        const b = base([row('E1', 9, { name: 'Juan' }), row('E2', 0, { name: 'Pedro' }), row('E3', 1, { name: 'Lucas', rosterStatus: 'active' }), row('E4', 8, { name: 'Maria' })]);
        const diff = diffAttendanceSubmissionSnapshots(a, b);
        expect(diff.summary).toMatchObject({ hoursChanged: 1, attendanceAdded: 2, attendanceRemoved: 1, activated: 1, employeesAdded: 1 });
        expect(diff.details.find(x => x.saEmployeeId === 'E1')).toMatchObject({ deltaHours: 1, types: ['hours_changed'] });
        expect(diff.details.find(x => x.saEmployeeId === 'E2').types).toContain('attendance_removed');
        expect(diff.details.find(x => x.saEmployeeId === 'E3').types).toEqual(expect.arrayContaining(['attendance_added', 'activated']));
    });
});
