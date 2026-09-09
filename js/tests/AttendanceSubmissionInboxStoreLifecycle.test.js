import {
    ATTENDANCE_SUBMISSION_INBOX,
    AttendanceSubmissionInboxStore,
    attendanceSubmissionKey
} from '../modules/services/AttendanceSubmissionInboxStore.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
        this.deleted = [];
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
    async delete(name, key) {
        this.deleted.push({ name, key });
        return this.store(name).delete(key);
    }
}

const SA_PROJECT = 'PRJ-EJEMPLO-0001';
const SUBMISSION_ID_1 = '123e4567-e89b-42d3-a456-426614174001';
const SUBMISSION_ID_2 = '123e4567-e89b-42d3-a456-426614174002';

function validEnvelope(id, date = '2026-09-06', project = SA_PROJECT) {
    return {
        schema: 'attendance-submission/v1',
        submissionId: id,
        saProjectId: project,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-1' },
        deviceId: 'phone-1',
        rosterVersion: 'roster-1',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate: date,
        rows: [
            {
                miniLocalId: 'm1',
                number: '001',
                name: 'Ana',
                normalHours: 8,
                overtimeHours: 0,
                status: 'present',
                saEmployeeId: 'EMP-001'
            }
        ]
    };
}

describe('AttendanceSubmissionInboxStore lifecycle and filtering', () => {
    test('importSubmission accepts an object and imports it into inbox', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 12345 });
        const envelope = validEnvelope(SUBMISSION_ID_1);

        const result = await store.importSubmission(envelope, { expectedSaProjectId: SA_PROJECT });
        expect(result.outcome).toBe('imported');
        expect(result.record.key).toBe(attendanceSubmissionKey(SA_PROJECT, SUBMISSION_ID_1));
        expect(result.record.status).toBe('pending');
        expect(result.record.receivedAt).toBe(12345);
        expect(result.record.sourceSnapshot).toEqual(envelope);
    });

    test('list with filtering by project, date, and status', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });

        await store.importSubmission(validEnvelope(SUBMISSION_ID_1, '2026-09-06', SA_PROJECT), { expectedSaProjectId: SA_PROJECT });
        await store.importSubmission(validEnvelope(SUBMISSION_ID_2, '2026-09-07', SA_PROJECT), { expectedSaProjectId: SA_PROJECT });

        const all = await store.list();
        expect(all.length).toBe(2);

        const date1 = await store.list({ workDate: '2026-09-06' });
        expect(date1.length).toBe(1);
        expect(date1[0].submissionId).toBe(SUBMISSION_ID_1);

        const proj = await store.listByProject(SA_PROJECT);
        expect(proj.length).toBe(2);

        const empty = await store.list({ saProjectId: 'PRJ-OTHER' });
        expect(empty.length).toBe(0);
    });

    test('updateStatus updates draft status while preserving original provenance and snapshot', async () => {
        const db = new MemoryDB();
        let currentTime = 1000;
        const store = new AttendanceSubmissionInboxStore({ db, now: () => currentTime });
        const envelope = validEnvelope(SUBMISSION_ID_1);
        await store.importSubmission(envelope, { expectedSaProjectId: SA_PROJECT });

        currentTime = 2000;
        const updated = await store.updateStatus(SA_PROJECT, SUBMISSION_ID_1, 'reviewed', {
            blockers: ['manual_check'],
            metadata: { reviewer: 'supervisor' }
        });

        expect(updated.status).toBe('reviewed');
        expect(updated.updatedAt).toBe(2000);
        expect(updated.receivedAt).toBe(1000);
        expect(updated.blockers).toEqual(['manual_check']);
        expect(updated.metadata.reviewer).toBe('supervisor');
        expect(updated.sourceSnapshot).toEqual(envelope);

        const fetched = await store.get(SA_PROJECT, SUBMISSION_ID_1);
        expect(fetched.status).toBe('reviewed');
    });

    test('delete removes draft from inbox store', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db });
        await store.importSubmission(validEnvelope(SUBMISSION_ID_1), { expectedSaProjectId: SA_PROJECT });

        const before = await store.get(SA_PROJECT, SUBMISSION_ID_1);
        expect(before).toBeTruthy();

        const success = await store.delete(SA_PROJECT, SUBMISSION_ID_1);
        expect(success).toBe(true);

        const after = await store.get(SA_PROJECT, SUBMISSION_ID_1);
        expect(after).toBeFalsy();
    });
});
