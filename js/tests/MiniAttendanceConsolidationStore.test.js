import {
    MiniAttendanceConsolidationStore,
    MINI_ATTENDANCE_CONSOLIDATIONS_STORE
} from '../modules/services/MiniAttendanceConsolidationStore.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) { return this.store(name).get(key) || null; }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) {
        this.store(name).set(value.key, JSON.parse(JSON.stringify(value)));
        return value.key;
    }
}

const PROJECT = 'PRJ-1';
const CONSOLIDATION = 'CONS-1';
const sourceDrafts = [
    { submissionId: 'SUB-A', bodyHash: 'hash-a', workDate: '2026-09-10', receivedAt: 1,
      sourceSnapshot: { deviceId: 'mini-a' } },
    { submissionId: 'SUB-B', bodyHash: 'hash-b', workDate: '2026-09-10', receivedAt: 2,
      sourceSnapshot: { deviceId: 'mini-b' } }
];

function progress(completedDays = []) {
    return {
        schema: 'mini-attendance-consolidation-progress/v1',
        saProjectId: PROJECT,
        sourceSubmissionIds: ['SUB-A', 'SUB-B'],
        workDates: ['2026-09-10', '2026-09-11'],
        completedDays,
        items: [{ id: 'item-1', status: 'resolved', normalHours: 8, overtimeHours: 0 }]
    };
}

function consolidated() {
    return {
        schema: 'mini-attendance-consolidated/v1',
        consolidationId: CONSOLIDATION,
        revision: 1,
        status: 'mini_consolidated',
        saProjectId: PROJECT,
        sourceSubmissionIds: ['SUB-A', 'SUB-B'],
        workDates: ['2026-09-10', '2026-09-11'],
        completedDays: ['2026-09-10', '2026-09-11'],
        devices: ['mini-a', 'mini-b'],
        contributingSubmissions: [],
        items: [{ id: 'item-1', status: 'resolved', normalHours: 8, overtimeHours: 0, totalHours: 8 }],
        summary: { totalItems: 1, resolvedCount: 1, hoursConflictCount: 0, unresolvedIdentityCount: 0, submissionsCount: 2 },
        createdAt: 100,
        updatedAt: 100
    };
}

describe('MiniAttendanceConsolidationStore', () => {
    test('persists day progress independently from raw attendance inbox', async () => {
        let now = 1000;
        const db = new MemoryDB();
        const store = new MiniAttendanceConsolidationStore({ db, now: () => now });
        const saved = await store.saveProgress({ consolidationId: CONSOLIDATION, snapshot: progress(['2026-09-10']), sourceDrafts });
        expect(saved.status).toBe('resolving');
        expect(saved.completedDays).toEqual(['2026-09-10']);
        expect(saved.sourceRefs.map(ref => ref.bodyHash)).toEqual(['hash-a', 'hash-b']);
        expect(db.stores.has('attendanceSubmissionInbox')).toBe(false);
        expect(db.store(MINI_ATTENDANCE_CONSOLIDATIONS_STORE).size).toBe(1);

        now = 2000;
        const resumed = await store.saveProgress({ consolidationId: CONSOLIDATION, snapshot: progress(['2026-09-10', '2026-09-11']) });
        expect(resumed.createdAt).toBe(1000);
        expect(resumed.updatedAt).toBe(2000);
        expect(resumed.sourceRefs).toHaveLength(2);
    });

    test('promotes progress to consolidated version and keeps source provenance', async () => {
        let now = 1000;
        const db = new MemoryDB();
        const store = new MiniAttendanceConsolidationStore({ db, now: () => now });
        await store.saveProgress({ consolidationId: CONSOLIDATION, snapshot: progress(['2026-09-10', '2026-09-11']), sourceDrafts });
        now = 3000;
        const saved = await store.saveConsolidated(consolidated());
        expect(saved.status).toBe('mini_consolidated');
        expect(saved.createdAt).toBe(1000);
        expect(saved.updatedAt).toBe(3000);
        expect(saved.sourceRefs.map(ref => ref.submissionId)).toEqual(['SUB-A', 'SUB-B']);
        expect(saved.items[0].totalHours).toBe(8);
    });

    test('discard is soft and raw sources remain untouched/rebuildable', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceConsolidationStore({ db, now: () => 4000 });
        await store.saveProgress({ consolidationId: CONSOLIDATION, snapshot: progress(), sourceDrafts });
        const discarded = await store.discard(PROJECT, CONSOLIDATION, 'rebuild');
        expect(discarded.status).toBe('discarded');
        expect(discarded.discardReason).toBe('rebuild');
        expect(await store.list({ saProjectId: PROJECT })).toHaveLength(0);
        expect(await store.list({ saProjectId: PROJECT, includeDiscarded: true })).toHaveLength(1);
        expect(db.stores.has('attendanceSubmissionInbox')).toBe(false);
    });

    test('status transitions keep immutable consolidation identity', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceConsolidationStore({ db, now: () => 5000 });
        await store.saveConsolidated(consolidated(), { sourceDrafts });
        const updated = await store.updateStatus(PROJECT, CONSOLIDATION, 'comparing_sa', { note: 'continue' });
        expect(updated.consolidationId).toBe(CONSOLIDATION);
        expect(updated.saProjectId).toBe(PROJECT);
        expect(updated.status).toBe('comparing_sa');
        expect(updated.note).toBe('continue');
        await expect(store.updateStatus(PROJECT, CONSOLIDATION, 'unknown')).rejects.toThrow(/Invalid/);
    });
});
