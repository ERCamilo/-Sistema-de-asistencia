import fs from 'node:fs';
import path from 'node:path';
import {
    ATTENDANCE_SUBMISSION_SCHEMA,
    ATTENDANCE_SUBMISSION_INBOX,
    AttendanceSubmissionInboxStore,
    AttendanceSubmissionReplayConflictError,
    attendanceSubmissionBodyHash,
    validateAttendanceSubmission
} from '../modules/services/AttendanceSubmissionInboxStore.js';

const STORE_PATH = path.resolve(
    __dirname,
    '../modules/services/AttendanceSubmissionInboxStore.js'
);

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
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
        this.updates.push(name);
        const key = value.key ?? value.submissionId ?? value.eventId;
        this.store(name).set(key, JSON.parse(JSON.stringify(value)));
    }
}

const SA_PROJECT = 'PRJ-EJEMPLO-0001';
const SUBMISSION_ID = '123e4567-e89b-42d3-a456-426614174000';

function row(overrides = {}) {
    return {
        miniLocalId: 'mini-u1',
        number: '001',
        name: 'Ana',
        normalHours: 8,
        overtimeHours: 0,
        status: 'present',
        ...overrides
    };
}

function submission(overrides = {}) {
    return {
        schema: 'attendance-submission/v1',
        submissionId: SUBMISSION_ID,
        saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-principal' },
        deviceId: 'phone-1',
        rosterVersion: 'roster-3',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate: '2026-09-06',
        rows: [row()],
        ...overrides
    };
}

function raw(overrides = {}) {
    return JSON.stringify(submission(overrides));
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
}

describe('AttendanceSubmissionInboxStore', () => {
    test('imports a normal submission as pending only with receivedAt and bodyHash', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const result = await store.importJSON(raw(), {
            expectedSaProjectId: SA_PROJECT,
            expectedRosterVersion: 'roster-3'
        });

        expect(ATTENDANCE_SUBMISSION_SCHEMA).toBe('attendance-submission/v1');
        expect(ATTENDANCE_SUBMISSION_INBOX).toBe('attendanceSubmissionInbox');
        expect(result.outcome).toBe('imported');
        expect(result.record).toMatchObject({
            saProjectId: SA_PROJECT,
            submissionId: SUBMISSION_ID,
            status: 'pending',
            receivedAt: 100,
            workDate: '2026-09-06',
            rosterVersion: 'roster-3',
            blockers: []
        });
        expect(typeof result.record.bodyHash).toBe('string');
        expect(result.record.bodyHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
        expect(result.record.bodyHash).toBe(
            attendanceSubmissionBodyHash(result.record.sourceSnapshot)
        );
        expect(Object.isFrozen(result.record.sourceSnapshot)).toBe(true);
        expect(await store.list()).toHaveLength(1);
        const fetched = await store.get(SA_PROJECT, SUBMISSION_ID);
        expect(fetched.submissionId).toBe(SUBMISSION_ID);
    });

    test('accepts a valid partial capture without inferring absent workers', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 7 });
        const result = await store.importJSON(
            raw({
                excludedCount: 2,
                errorSummary: { unparsedFragments: 2, codes: ['UNPARSED_LINE'] }
            }),
            { expectedSaProjectId: SA_PROJECT }
        );

        expect(result.outcome).toBe('imported');
        expect(result.record.status).toBe('pending');
        expect(result.record.blockers).toEqual([]);
        expect(result.record.sourceSnapshot.excludedCount).toBe(2);
        expect(result.record.sourceSnapshot.errorSummary).toEqual({
            unparsedFragments: 2,
            codes: ['UNPARSED_LINE']
        });
        // Partial means exactly what was captured: one row, nothing inferred.
        expect(result.record.sourceSnapshot.rows).toHaveLength(1);
    });

    test('stale roster stays pending with blocker and zero attendance writes', async () => {
        const db = new MemoryDB();
        db.store('attendance').set('sentinel', { hoursWorked: 8 });
        const store = new AttendanceSubmissionInboxStore({ db });
        const result = await store.importJSON(raw(), {
            expectedSaProjectId: SA_PROJECT,
            expectedRosterVersion: 'roster-4'
        });

        expect(result.outcome).toBe('imported');
        expect(result.record.status).toBe('pending');
        expect(result.record.blockers).toEqual(['stale_roster']);
        expect(db.updates).toEqual(['attendanceSubmissionInbox']);
        expect(db.store('attendance').get('sentinel')).toEqual({ hoursWorked: 8 });
        expect(await store.list()).toHaveLength(1);
    });

    test('project mismatch is a hard reject before any store mutation', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        await expect(
            store.importJSON(raw({ saProjectId: 'PRJ-A' }), {
                expectedSaProjectId: 'PRJ-B'
            })
        ).rejects.toThrow(/mismatch/);
        expect(db.updates).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    test('same key plus same body is a duplicate without a second write', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const first = await store.importJSON(raw(), {
            expectedSaProjectId: SA_PROJECT
        });
        const second = await store.importJSON(raw(), {
            expectedSaProjectId: SA_PROJECT
        });

        expect(first.outcome).toBe('imported');
        expect(second.outcome).toBe('duplicate');
        expect(second.record.bodyHash).toBe(first.record.bodyHash);
        expect(await store.list()).toHaveLength(1);
        expect(db.updates).toEqual(['attendanceSubmissionInbox']);
    });

    test('same key plus different body is a replay conflict without overwrite', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        await store.importJSON(raw(), { expectedSaProjectId: SA_PROJECT });

        await expect(
            store.importJSON(
                raw({ rows: [row({ normalHours: 7, overtimeHours: 1 })] }),
                { expectedSaProjectId: SA_PROJECT }
            )
        ).rejects.toBeInstanceOf(AttendanceSubmissionReplayConflictError);
        const kept = await store.get(SA_PROJECT, SUBMISSION_ID);
        expect(kept.sourceSnapshot.rows[0].normalHours).toBe(8);
        expect(kept.sourceSnapshot.rows[0].overtimeHours).toBe(0);
        expect(db.updates).toEqual(['attendanceSubmissionInbox']);
    });

    test('malformed UUID, ISO, date, hours and IDs fail closed', async () => {
        const attempts = [
            submission({ submissionId: 'not-a-uuid' }),
            submission({ submissionId: '   ' }),
            submission({ capturedAt: '2026-09-07' }),
            submission({ capturedAt: '2026-09-07T12:00:00+02:00' }),
            submission({ capturedAt: 'not-a-date' }),
            submission({ workDate: '06-09-2026' }),
            submission({ workDate: '2026-02-30' }),
            submission({ workDate: '2026-13-01' }),
            submission({ workDate: '2026-09-06T00:00:00.000Z' }),
            submission({ rows: [row({ normalHours: -1 })] }),
            submission({ rows: [row({ normalHours: Number.POSITIVE_INFINITY })] }),
            submission({ rows: [row({ overtimeHours: -2 })] }),
            submission({ rows: [row({ normalHours: 0, overtimeHours: 0 })] }),
            submission({ rows: [row({ normalHours: 20, overtimeHours: 5 })] }),
            submission({ rows: [row({ status: 'absent' })] }),
            submission({ saProjectId: 'has space' }),
            submission({ saProjectId: '' }),
            submission({ saProjectId: 'x'.repeat(129) }),
            submission({ saProjectId: 'bad\u0001id' }),
            submission({ rows: [row({ miniLocalId: '   ' })] }),
            submission({ rows: [row({ saEmployeeId: 'bad id' })] }),
            submission({ clientSequence: 0 }),
            submission({ clientSequence: 1.5 }),
            submission({ excludedCount: -1 }),
            submission({ excludedCount: 1.5 }),
            submission({
                errorSummary: { unparsedFragments: -1, codes: [] }
            }),
            submission({
                errorSummary: { unparsedFragments: 1, codes: 'UNPARSED_LINE' }
            }),
            submission({
                errorSummary: { unparsedFragments: 1, codes: [123] }
            }),
            submission({ rows: [] }),
            submission({ scope: undefined })
        ];

        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        for (const value of attempts) {
            await expect(
                store.importJSON(JSON.stringify(value), {
                    expectedSaProjectId: SA_PROJECT
                })
            ).rejects.toThrow();
        }
        // Also: missing expectedSaProjectId and malformed raw JSON fail closed.
        await expect(store.importJSON(raw(), {})).rejects.toThrow();
        await expect(store.importJSON('{not-json', {
            expectedSaProjectId: SA_PROJECT
        })).rejects.toThrow();
        expect(db.updates).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    test('unknown sibling and row keys are rejected exactly', async () => {
        const base = submission();
        const attempts = [
            { ...base, version: 1 },
            { ...base, checksum: 'fnv1a32:00000000' },
            { ...base, token: 'must-not-enter-SA' },
            submission({ rows: [row({ position: 'Ayudante' })] }),
            submission({ rows: [row({ groupId: 'g1' })] }),
            submission({ rows: [row({ leaderId: 'l1' })] }),
            submission({ rows: [{ ...row(), hours: 8 }] }),
            submission({ rows: [{ ...row(), sueldo: '2500' }] }),
            submission({
                scope: { ownerUid: 'o', siteId: 's', sourceId: 'm', extra: 'x' }
            }),
            submission({
                errorSummary: { unparsedFragments: 0, codes: [], extra: true }
            })
        ];

        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        for (const value of attempts) {
            await expect(
                store.importJSON(JSON.stringify(value), {
                    expectedSaProjectId: SA_PROJECT
                })
            ).rejects.toThrow();
        }
        expect(validateAttendanceSubmission(base, SA_PROJECT).schema).toBe(
            'attendance-submission/v1'
        );
        expect(db.updates).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    test('one row per employee: duplicate miniLocalId or saEmployeeId rejects', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });

        await expect(
            store.importJSON(
                raw({
                    rows: [
                        row({ miniLocalId: 'dup', saEmployeeId: 'EMP-001' }),
                        row({
                            miniLocalId: 'dup',
                            number: '002',
                            name: 'Luis',
                            saEmployeeId: 'EMP-002'
                        })
                    ]
                }),
                { expectedSaProjectId: SA_PROJECT }
            )
        ).rejects.toThrow(/miniLocalId.*duplic/i);

        await expect(
            store.importJSON(
                raw({
                    submissionId: '223e4567-e89b-42d3-a456-426614174001',
                    rows: [
                        row({ miniLocalId: 'mini-a', saEmployeeId: 'EMP-009' }),
                        row({
                            miniLocalId: 'mini-b',
                            number: '002',
                            name: 'Luis',
                            saEmployeeId: 'EMP-009'
                        })
                    ]
                }),
                { expectedSaProjectId: SA_PROJECT }
            )
        ).rejects.toThrow(/saEmployeeId.*duplic/i);

        expect(db.updates).toEqual([]);
        expect(await store.list()).toEqual([]);
    });

    test('number and name are display snapshots, never identity', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        const result = await store.importJSON(
            raw({
                rows: [
                    row({
                        miniLocalId: 'mini-a',
                        number: '001',
                        name: 'Ana',
                        saEmployeeId: 'EMP-001'
                    }),
                    row({
                        miniLocalId: 'mini-b',
                        number: '001',
                        name: 'Ana',
                        normalHours: 4,
                        overtimeHours: 2,
                        saEmployeeId: 'EMP-002'
                    })
                ]
            }),
            { expectedSaProjectId: SA_PROJECT }
        );

        expect(result.outcome).toBe('imported');
        expect(result.record.sourceSnapshot.rows).toHaveLength(2);

        const db2 = new MemoryDB();
        const store2 = new AttendanceSubmissionInboxStore({ db: db2 });
        const noJoin = await store2.importJSON(
            raw({
                submissionId: '323e4567-e89b-42d3-a456-426614174002',
                rows: [
                    row({ miniLocalId: 'mini-a', number: '007', name: 'Same' }),
                    row({
                        miniLocalId: 'mini-b',
                        number: '007',
                        name: 'Same',
                        normalHours: 6,
                        overtimeHours: 0
                    })
                ]
            }),
            { expectedSaProjectId: SA_PROJECT }
        );
        expect(noJoin.outcome).toBe('imported');
        expect('saEmployeeId' in noJoin.record.sourceSnapshot.rows[0]).toBe(false);
    });

    test('rejections never mutate any store, including canonical attendance', async () => {
        const db = new MemoryDB();
        db.store('attendance').set('sentinel', { hoursWorked: 8 });
        const store = new AttendanceSubmissionInboxStore({ db });
        const bad = [
            raw({ saProjectId: 'PRJ-OTHER' }),
            raw({ submissionId: 'bad-uuid' }),
            JSON.stringify({ ...submission(), checksum: 'x' }),
            raw({
                submissionId: '423e4567-e89b-42d3-a456-426614174003',
                rows: [row({ miniLocalId: 'x' }), row({ miniLocalId: 'x' })]
            })
        ];
        for (const payload of bad) {
            await expect(
                store.importJSON(payload, { expectedSaProjectId: SA_PROJECT })
            ).rejects.toThrow();
        }
        expect(db.updates).toEqual([]);
        expect(await store.list()).toEqual([]);
        expect(db.store('attendance').get('sentinel')).toEqual({ hoursWorked: 8 });
    });

    test('no attendance write path or runtime import exists in the inbox module', () => {
        const source = fs.readFileSync(STORE_PATH, 'utf8');
        const codeOnly = stripComments(source);

        expect(codeOnly).not.toMatch(/^\s*import\s/m);
        expect(codeOnly).not.toMatch(/\brequire\s*\(/);
        expect(codeOnly).not.toMatch(/\bstate\b/);
        expect(codeOnly).not.toMatch(/['"]attendance['"]/);
        expect(codeOnly).not.toMatch(/\bfirebase\b/i);
        expect(codeOnly).not.toMatch(/\bapply\b/i);
        expect(ATTENDANCE_SUBMISSION_INBOX).not.toBe('attendance');
        expect(ATTENDANCE_SUBMISSION_INBOX).not.toBe('miniAttendanceInbox');
    });
});
