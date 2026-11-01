import {
    ATTENDANCE_SUBMISSION_ROW_KEYS,
    validateAttendanceSubmission
} from '../modules/services/AttendanceSubmissionInboxStore.js';
import { consolidateAttendanceSubmissions } from '../modules/features/attendance/AttendanceConsolidation.js';

const SA_PROJECT = 'PRJ-EJEMPLO-0001';
const SUBMISSION_ID = '123e4567-e89b-42d3-a456-426614174000';

function row(overrides = {}) {
    return {
        miniLocalId: 'mini-u9',
        number: '9',
        name: 'Pedro Nuevo',
        normalHours: 8,
        overtimeHours: 0,
        status: 'present',
        positionName: 'Albañil',
        dailySalary: 1500,
        ...overrides
    };
}

function submission(rows) {
    return {
        schema: 'attendance-submission/v1',
        submissionId: SUBMISSION_ID,
        saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-principal' },
        deviceId: 'phone-1',
        rosterVersion: 'roster-3',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate: '2026-09-06',
        rows
    };
}

describe('attendance-submission/v1 — employee profile (Mini >= salary + day position)', () => {
    test('dailySalary is an allowed optional row key', () => {
        expect(ATTENDANCE_SUBMISSION_ROW_KEYS).toContain('dailySalary');
    });

    test('a row with dailySalary and positionName validates and keeps both', () => {
        const valid = validateAttendanceSubmission(JSON.parse(JSON.stringify(submission([row({ dailySalary: 1800.5 })]))), SA_PROJECT);
        expect(valid.rows[0].dailySalary).toBe(1800.5);
        expect(valid.rows[0].positionName).toBe('Albañil');
    });

    test('rows without dailySalary keep validating (older Minis)', () => {
        const { dailySalary, ...legacy } = row();
        const valid = validateAttendanceSubmission(submission([legacy]), SA_PROJECT);
        expect('dailySalary' in valid.rows[0]).toBe(false);
    });

    test.each([0, -5, '1500', null, Number.NaN, 10000001])('rejects invalid dailySalary %p', bad => {
        expect(() => validateAttendanceSubmission(submission([row({ dailySalary: bad })]), SA_PROJECT)).toThrow(/dailySalary must be/);
    });

    test('other unknown row keys are still rejected', () => {
        expect(() => validateAttendanceSubmission(submission([row({ phone: '809' })]), SA_PROJECT)).toThrow(/unsafe field "phone"/);
    });

    test('an unlinked row carries the profile so SA can create or link the employee', () => {
        const result = consolidateAttendanceSubmissions([submission([row()])]);
        const [item] = result.items;
        expect(item.status).toBe('identity_conflict');
        expect(item.sources[0].dailySalary).toBe(1500);
        expect(item.sources[0].positionName).toBe('Albañil');
    });
});
