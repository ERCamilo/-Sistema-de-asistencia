/**
 * F3.4 — Fixture/contract lock for `attendance-submission/v1`.
 *
 * Pure contract test: inline canonical fixtures only, no fixture file, no
 * runtime wiring. Locks the exact envelope/row keys, identity rule, pending
 * authority, partial semantics, idempotency scope and transport neutrality
 * documented in docs/fase-3/F3.4-attendance-submission.md.
 */

import {
    ATTENDANCE_SUBMISSION_SCHEMA,
    ATTENDANCE_SUBMISSION_INBOX,
    ATTENDANCE_SUBMISSION_ENVELOPE_KEYS,
    ATTENDANCE_SUBMISSION_ROW_KEYS,
    AttendanceSubmissionInboxStore,
    attendanceSubmissionBodyHash,
    attendanceSubmissionKey,
    normalizeAttendanceSubmissionId,
    validateAttendanceSubmission
} from '../modules/services/AttendanceSubmissionInboxStore.js';

const SA_PROJECT = 'PRJ-EJEMPLO-0001';
const SUBMISSION_ID = '123e4567-e89b-42d3-a456-426614174000';

const MINIMAL = {
    schema: 'attendance-submission/v1',
    submissionId: SUBMISSION_ID,
    saProjectId: SA_PROJECT,
    scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-principal' },
    deviceId: 'phone-1',
    rosterVersion: 'roster-3',
    capturedAt: '2026-09-07T12:00:00.000Z',
    workDate: '2026-09-06',
    rows: [
        {
            miniLocalId: 'mini-u1',
            number: '001',
            name: 'Ana',
            normalHours: 8,
            overtimeHours: 0,
            status: 'present'
        }
    ]
};

const FULL = {
    schema: 'attendance-submission/v1',
    submissionId: '223e4567-e89b-42d3-a456-426614174001',
    saProjectId: SA_PROJECT,
    scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-principal' },
    deviceId: 'phone-1',
    rosterVersion: 'roster-3',
    capturedAt: '2026-09-07T12:00:00.000Z',
    workDate: '2026-09-06',
    rows: [
        {
            miniLocalId: 'mini-u1',
            number: '001',
            name: 'Ana',
            normalHours: 7.5,
            overtimeHours: 0.5,
            status: 'present',
            saEmployeeId: 'EMP-001'
        }
    ],
    clientSequence: 7,
    excludedCount: 2,
    errorSummary: { unparsedFragments: 2, codes: ['UNPARSED_LINE'] }
};

const REQUIRED_ENVELOPE_KEYS = [
    'schema',
    'submissionId',
    'saProjectId',
    'scope',
    'deviceId',
    'rosterVersion',
    'capturedAt',
    'workDate',
    'rows'
];

const REQUIRED_ROW_KEYS = [
    'miniLocalId',
    'number',
    'name',
    'normalHours',
    'overtimeHours',
    'status'
];

// Keys that must never travel in F3.4 v1 (private / F3.3 / legacy / transport).
const BANNED_ROW_KEYS = [
    'position',
    'groupId',
    'leaderId',
    'group',
    'leader',
    'sueldo',
    'salary',
    'loans',
    'advances',
    'photo',
    'phone',
    'email',
    'deletedAt',
    'customSalary',
    'positionSalaries',
    'hours',
    'sourceEmployeeId',
    'id'
];

class MemoryDB {
    constructor() {
        this.stores = new Map();
    }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) {
        return this.store(name).get(key);
    }
    async getAll(name) {
        return [...this.store(name).values()];
    }
    async update(name, value) {
        this.store(name).set(value.key, JSON.parse(JSON.stringify(value)));
    }
}

describe('attendance-submission/v1 fixture — frozen F3.4 contract', () => {
    test('schema and store are new literals, distinct from mini-attendance/v1', () => {
        expect(ATTENDANCE_SUBMISSION_SCHEMA).toBe('attendance-submission/v1');
        expect(ATTENDANCE_SUBMISSION_SCHEMA).not.toBe('mini-attendance/v1');
        expect(ATTENDANCE_SUBMISSION_INBOX).toBe('attendanceSubmissionInbox');
        expect(ATTENDANCE_SUBMISSION_INBOX).not.toBe('miniAttendanceInbox');
        expect([...ATTENDANCE_SUBMISSION_ENVELOPE_KEYS].sort()).toEqual(
            [
                'schema',
                'submissionId',
                'saProjectId',
                'scope',
                'deviceId',
                'rosterVersion',
                'capturedAt',
                'workDate',
                'rows',
                'clientSequence',
                'excludedCount',
                'errorSummary'
            ].sort()
        );
        expect([...ATTENDANCE_SUBMISSION_ROW_KEYS].sort()).toEqual(
            [
                'miniLocalId',
                'number',
                'name',
                'normalHours',
                'overtimeHours',
                'status',
                'saEmployeeId'
            ].sort()
        );
    });

    test('canonical minimal and full fixtures validate frozen and immutable', () => {
        const minimal = validateAttendanceSubmission(
            JSON.parse(JSON.stringify(MINIMAL)),
            SA_PROJECT
        );
        const full = validateAttendanceSubmission(
            JSON.parse(JSON.stringify(FULL)),
            SA_PROJECT
        );

        expect(Object.isFrozen(minimal)).toBe(true);
        expect(Object.isFrozen(full)).toBe(true);
        for (const key of REQUIRED_ENVELOPE_KEYS) {
            expect(minimal).toHaveProperty(key);
        }
        expect(Object.keys(minimal).every(k => REQUIRED_ENVELOPE_KEYS.includes(k))).toBe(
            true
        );
        expect([...Object.keys(full)].sort()).toEqual(
            [...ATTENDANCE_SUBMISSION_ENVELOPE_KEYS].sort()
        );
        for (const key of REQUIRED_ROW_KEYS) {
            expect(minimal.rows[0]).toHaveProperty(key);
        }
        expect(full.rows[0]).toHaveProperty('saEmployeeId');
        expect('saEmployeeId' in minimal.rows[0]).toBe(false);
        // Store-assigned fields never belong on the wire.
        for (const banned of ['status', 'receivedAt', 'blockers', 'bodyHash', 'key']) {
            if (banned === 'status') continue; // rows carry status:present on the wire
            expect(minimal).not.toHaveProperty(banned);
            expect(full).not.toHaveProperty(banned);
        }
        expect(full.clientSequence).toBe(7);
        expect(full.excludedCount).toBe(2);
        expect(full.errorSummary).toEqual({
            unparsedFragments: 2,
            codes: ['UNPARSED_LINE']
        });
    });

    test('no sibling version or checksum: unknown keys fail closed', () => {
        for (const extra of [{ version: 1 }, { checksum: 'fnv1a32:00000000' }, { token: 'x' }]) {
            expect(() =>
                validateAttendanceSubmission({ ...MINIMAL, ...extra }, SA_PROJECT)
            ).toThrow();
        }
        expect(() =>
            validateAttendanceSubmission(
                { ...MINIMAL, schema: 'attendance-submission/v2' },
                SA_PROJECT
            )
        ).toThrow();
        expect(() =>
            validateAttendanceSubmission(
                { ...MINIMAL, schema: 'mini-attendance/v1' },
                SA_PROJECT
            )
        ).toThrow();
        for (const banned of BANNED_ROW_KEYS) {
            expect(() =>
                validateAttendanceSubmission(
                    {
                        ...MINIMAL,
                        rows: [{ ...MINIMAL.rows[0], [banned]: 'x' }]
                    },
                    SA_PROJECT
                )
            ).toThrow();
        }
    });

    test('identity: canonical SA IDs; number/name are display snapshots only', () => {
        expect(normalizeAttendanceSubmissionId(SA_PROJECT)).toBe(SA_PROJECT);
        expect(normalizeAttendanceSubmissionId('has space')).toBe('');
        expect(normalizeAttendanceSubmissionId('')).toBe('');
        expect(normalizeAttendanceSubmissionId('x'.repeat(129))).toBe('');
        expect(normalizeAttendanceSubmissionId('bad\u0001id')).toBe('');

        // Same number/name with distinct local + SA identities is legal.
        const both = validateAttendanceSubmission(
            {
                ...MINIMAL,
                rows: [
                    {
                        miniLocalId: 'mini-a',
                        number: '001',
                        name: 'Ana',
                        normalHours: 8,
                        overtimeHours: 0,
                        status: 'present',
                        saEmployeeId: 'EMP-001'
                    },
                    {
                        miniLocalId: 'mini-b',
                        number: '001',
                        name: 'Ana',
                        normalHours: 8,
                        overtimeHours: 0,
                        status: 'present',
                        saEmployeeId: 'EMP-002'
                    }
                ]
            },
            SA_PROJECT
        );
        expect(both.rows).toHaveLength(2);

        // Duplicate miniLocalId and duplicate saEmployeeId both reject.
        expect(() =>
            validateAttendanceSubmission(
                {
                    ...MINIMAL,
                    rows: [
                        { ...MINIMAL.rows[0], miniLocalId: 'dup' },
                        {
                            ...MINIMAL.rows[0],
                            miniLocalId: 'dup',
                            number: '002',
                            name: 'Luis'
                        }
                    ]
                },
                SA_PROJECT
            )
        ).toThrow(/miniLocalId/i);
        expect(() =>
            validateAttendanceSubmission(
                {
                    ...MINIMAL,
                    rows: [
                        { ...MINIMAL.rows[0], miniLocalId: 'a', saEmployeeId: 'EMP-X' },
                        {
                            ...MINIMAL.rows[0],
                            miniLocalId: 'b',
                            number: '002',
                            name: 'Luis',
                            saEmployeeId: 'EMP-X'
                        }
                    ]
                },
                SA_PROJECT
            )
        ).toThrow(/saEmployeeId/i);
    });

    test('scope is audit-only: siteId never acts as project authority', () => {
        const otherSite = validateAttendanceSubmission(
            {
                ...MINIMAL,
                scope: { ownerUid: 'owner-1', siteId: 'completely-other-site', sourceId: 'm' }
            },
            SA_PROJECT
        );
        expect(otherSite.scope.siteId).toBe('completely-other-site');
        expect(otherSite.saProjectId).toBe(SA_PROJECT);
        // Project authority comes only from explicit expectedSaProjectId.
        expect(() =>
            validateAttendanceSubmission(MINIMAL, 'PRJ-DIFFERENT')
        ).toThrow(/mismatch/);
    });

    test('time fields: strict ISO capturedAt and calendar workDate; split hours rule', () => {
        expect(() =>
            validateAttendanceSubmission({ ...MINIMAL, capturedAt: '2026-09-06' }, SA_PROJECT)
        ).toThrow();
        expect(() =>
            validateAttendanceSubmission({ ...MINIMAL, workDate: '06-09-2026' }, SA_PROJECT)
        ).toThrow();
        expect(() =>
            validateAttendanceSubmission({ ...MINIMAL, workDate: '2026-02-30' }, SA_PROJECT)
        ).toThrow();

        const validSums = [
            [8, 0],
            [0, 8],
            [7.5, 0.5],
            [0.5, 0],
            [12, 12]
        ];
        for (const [normalHours, overtimeHours] of validSums) {
            const ok = validateAttendanceSubmission(
                {
                    ...MINIMAL,
                    rows: [{ ...MINIMAL.rows[0], normalHours, overtimeHours }]
                },
                SA_PROJECT
            );
            expect(ok.rows[0].normalHours + ok.rows[0].overtimeHours).toBeLessThanOrEqual(24);
        }
        const invalidSums = [
            [0, 0],
            [-1, 0],
            [0, -1],
            [20, 5],
            [Number.NaN, 0],
            [Number.POSITIVE_INFINITY, 0]
        ];
        for (const [normalHours, overtimeHours] of invalidSums) {
            expect(() =>
                validateAttendanceSubmission(
                    {
                        ...MINIMAL,
                        rows: [{ ...MINIMAL.rows[0], normalHours, overtimeHours }]
                    },
                    SA_PROJECT
                )
            ).toThrow();
        }
    });

    test('partial semantics: excludedCount/errorSummary are audit hints, never absents', () => {
        const partial = validateAttendanceSubmission(
            {
                ...MINIMAL,
                excludedCount: 3,
                errorSummary: { unparsedFragments: 3, codes: ['A', 'B'] }
            },
            SA_PROJECT
        );
        expect(partial.excludedCount).toBe(3);
        expect(partial.rows).toHaveLength(1);
        expect(() =>
            validateAttendanceSubmission({ ...MINIMAL, excludedCount: -1 }, SA_PROJECT)
        ).toThrow();
        expect(() =>
            validateAttendanceSubmission(
                {
                    ...MINIMAL,
                    errorSummary: { unparsedFragments: 0, codes: [], extra: 1 }
                },
                SA_PROJECT
            )
        ).toThrow();
    });

    test('transport neutrality and idempotency scope: bare JSON, stable hash, composite key', async () => {
        // Bare JSON body round-trips; wrapped envelopes do not validate.
        const wire = JSON.stringify(MINIMAL);
        const back = validateAttendanceSubmission(JSON.parse(wire), SA_PROJECT);
        expect(back.submissionId).toBe(SUBMISSION_ID);
        expect(() =>
            validateAttendanceSubmission({ data: MINIMAL }, SA_PROJECT)
        ).toThrow();

        // Key order on the wire does not change the replay hash.
        const reordered = {
            rows: MINIMAL.rows,
            workDate: MINIMAL.workDate,
            capturedAt: MINIMAL.capturedAt,
            rosterVersion: MINIMAL.rosterVersion,
            deviceId: MINIMAL.deviceId,
            scope: MINIMAL.scope,
            saProjectId: MINIMAL.saProjectId,
            submissionId: MINIMAL.submissionId,
            schema: MINIMAL.schema
        };
        expect(attendanceSubmissionBodyHash(validateAttendanceSubmission(reordered, SA_PROJECT))).toBe(
            attendanceSubmissionBodyHash(back)
        );

        // Idempotency scope is the composite (saProjectId, submissionId).
        expect(attendanceSubmissionKey('PRJ-A', SUBMISSION_ID)).not.toBe(
            attendanceSubmissionKey('PRJ-B', SUBMISSION_ID)
        );

        // The inbox stores pending only; stale is a blocker, not a reject.
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 42 });
        const imported = await store.importJSON(wire, {
            expectedSaProjectId: SA_PROJECT,
            expectedRosterVersion: 'roster-9'
        });
        expect(imported.record.status).toBe('pending');
        expect(imported.record.blockers).toEqual(['stale_roster']);
        expect(imported.record.receivedAt).toBe(42);
    });
});
