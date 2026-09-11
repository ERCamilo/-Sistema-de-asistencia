import { AttendanceSubmissionInboxStore, hasActualAttendance, isZeroAttendanceSubmission } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { requestMiniAttendance, ATTENDANCE_RESPONSE_SCHEMA } from '../modules/features/p2p/P2PAttendanceBridge.js';

class MemoryDB {
    constructor() { this.stores = new Map(); this.updates = []; }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key) || null; }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.updates.push(name); const key = value.key ?? value.submissionId ?? value.eventId; this.store(name).set(key, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const PROJECT = 'PRJ-META2';
const id = n => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, '0')}`;

function presentRow({ miniLocalId = 'm1', saEmployeeId = 'E1', number = '1', name = 'Juan', normalHours = 8, overtimeHours = 0, rosterStatus = 'active' } = {}) {
    return { miniLocalId, saEmployeeId, number, name, normalHours, overtimeHours, status: 'present', rosterStatus };
}
function unmarkedRow({ miniLocalId = 'm1', saEmployeeId = 'E1', number = '1', name = 'Juan', rosterStatus = 'active' } = {}) {
    return { miniLocalId, saEmployeeId, number, name, normalHours: 0, overtimeHours: 0, status: 'unmarked', rosterStatus };
}
function envelope({ submissionId, capturedAt, workDate = '2026-09-10', deviceId = 'MINI-A', rows, sourceId = 'mini-a' }) {
    return {
        schema: 'attendance-submission/v1',
        submissionId,
        saProjectId: PROJECT,
        scope: { ownerUid: 'o', siteId: 's', sourceId },
        deviceId,
        rosterVersion: 'r1',
        capturedAt,
        workDate,
        coverageMode: 'linked-roster-full',
        rows
    };
}

describe('Meta2 — zero attendance is ignored, never a new version', () => {
    test('whole zero report returns ignored and persists nothing', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const zero = envelope({ submissionId: id(11), capturedAt: '2026-09-10T08:00:00.000Z', rows: [unmarkedRow()] });
        expect(hasActualAttendance(zero)).toBe(false);
        expect(isZeroAttendanceSubmission(zero)).toBe(true);
        const result = await store.importSubmission(zero, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toMatch(/ignored/);
        expect(result.reason).toMatch(/zero-attendance/);
        expect(await store.list()).toHaveLength(0);
        expect(await store.listVersionGroups()).toHaveLength(0);
        expect(db.updates).toEqual([]);
    });

    test('zero incoming newer than current does not create Actual nor bump updateCount', async () => {
        const db = new MemoryDB();
        let now = 100;
        const store = new AttendanceSubmissionInboxStore({ db, now: () => now++ });
        await store.importSubmission(envelope({ submissionId: id(21), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        const zeroNewer = envelope({ submissionId: id(22), capturedAt: '2026-09-10T10:00:00.000Z', rows: [unmarkedRow()] });
        const result = await store.importSubmission(zeroNewer, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toMatch(/ignored/);
        const all = await store.list();
        expect(all).toHaveLength(1);
        expect(all[0].submissionId).toBe(id(21));
        const [group] = await store.listVersionGroups();
        expect(group.updateCount).toBe(0);
        expect(group.current.submissionId).toBe(id(21));
    });

    test('partial capture with one present row is actionable (missing row not inferred as 0h)', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const partial = envelope({ submissionId: id(31), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow({ saEmployeeId: 'E1' })] });
        const result = await store.importSubmission(partial, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toBe('imported');
        expect(result.record.sourceSnapshot.rows).toHaveLength(1);
    });

    test('legacy persisted zero series excluded from visible/actionable counts', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        await store.importSubmission(envelope({ submissionId: id(41), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        // Simulate legacy zero series written before Meta2 (bypass guard).
        const legacyZero = {
            key: `${encodeURIComponent(PROJECT)}|${encodeURIComponent(id(42))}`,
            saProjectId: PROJECT,
            submissionId: id(42),
            status: 'pending',
            receivedAt: 200,
            workDate: '2026-09-10',
            rosterVersion: 'r1',
            blockers: [],
            bodyHash: 'fnv1a32:00000000',
            sourceSnapshot: envelope({ submissionId: id(42), capturedAt: '2026-09-10T09:00:00.000Z', deviceId: 'MINI-ZERO', rows: [unmarkedRow()] }),
            versioning: { seriesKey: `${PROJECT}|MINI-ZERO|2026-09-10`, role: 'original', isCurrent: true, updateCount: 0, semanticHash: 'x', originalSubmissionId: id(42), currentSubmissionId: id(42), diffFromOriginal: { changed: false } }
        };
        await db.update('attendanceSubmissionInbox', legacyZero);
        expect(await store.list()).toHaveLength(2);
        const groups = await store.listVersionGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0].current.submissionId).toBe(id(41));
    });

    test('stale ordering and replay protections preserved for zero/duplicate paths', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const first = envelope({ submissionId: id(51), capturedAt: '2026-09-10T10:00:00.000Z', rows: [presentRow()] });
        await store.importSubmission(first, { expectedSaProjectId: PROJECT });
        const stale = envelope({ submissionId: id(52), capturedAt: '2026-09-10T09:00:00.000Z', rows: [presentRow({ normalHours: 4, overtimeHours: 0 })] });
        const staleResult = await store.importSubmission(stale, { expectedSaProjectId: PROJECT });
        expect(staleResult.outcome).toBe('stale-version');
        expect(await store.list()).toHaveLength(1);
        const dup = await store.importSubmission(first, { expectedSaProjectId: PROJECT });
        expect(dup.outcome).toBe('duplicate');
        await expect(store.importSubmission({ ...first, rows: [presentRow({ normalHours: 4, overtimeHours: 0 })] }, { expectedSaProjectId: PROJECT })).rejects.toThrow(/replayed with different content/);
    });
});

describe('Meta2 — semantic duplicate does not create Actual', () => {
    test('identical later capture returns unchanged, keeps only Original', async () => {
        const db = new MemoryDB();
        let now = 100;
        const store = new AttendanceSubmissionInboxStore({ db, now: () => now++ });
        await store.importSubmission(envelope({ submissionId: id(61), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        const identical = envelope({ submissionId: id(62), capturedAt: '2026-09-10T10:00:00.000Z', rows: [presentRow()] });
        const result = await store.importSubmission(identical, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toMatch(/unchanged|semantic-duplicate/);
        const all = await store.list();
        expect(all).toHaveLength(1);
        expect(all[0].submissionId).toBe(id(61));
        expect(all[0].versioning.role).toBe('original');
        expect(all[0].versioning.updateCount).toBe(0);
        const [group] = await store.listVersionGroups();
        expect(group.original.submissionId).toBe(id(61));
        expect(group.current.submissionId).toBe(id(61));
        expect(group.updateCount).toBe(0);
    });

    test('change-after-identical creates Actual normally', async () => {
        const db = new MemoryDB();
        let now = 100;
        const store = new AttendanceSubmissionInboxStore({ db, now: () => now++ });
        await store.importSubmission(envelope({ submissionId: id(71), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow({ normalHours: 8, overtimeHours: 0 })] }), { expectedSaProjectId: PROJECT });
        const identical = envelope({ submissionId: id(72), capturedAt: '2026-09-10T09:00:00.000Z', rows: [presentRow({ normalHours: 8, overtimeHours: 0 })] });
        const unchanged = await store.importSubmission(identical, { expectedSaProjectId: PROJECT });
        expect(unchanged.outcome).toMatch(/unchanged|semantic-duplicate/);
        const changed = envelope({ submissionId: id(73), capturedAt: '2026-09-10T10:00:00.000Z', rows: [presentRow({ normalHours: 8, overtimeHours: 2 })] });
        const updated = await store.importSubmission(changed, { expectedSaProjectId: PROJECT });
        expect(updated.outcome).toBe('updated-version');
        const all = await store.list();
        expect(all).toHaveLength(2);
        const [group] = await store.listVersionGroups();
        expect(group.original.submissionId).toBe(id(71));
        expect(group.current.submissionId).toBe(id(73));
        expect(group.updateCount).toBe(1);
        expect(group.diff.changed).toBe(true);
    });

    test('revert-after-change differs from previous so creates Actual normally', async () => {
        const db = new MemoryDB();
        let now = 100;
        const store = new AttendanceSubmissionInboxStore({ db, now: () => now++ });
        await store.importSubmission(envelope({ submissionId: id(81), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow({ normalHours: 8 })] }), { expectedSaProjectId: PROJECT });
        await store.importSubmission(envelope({ submissionId: id(82), capturedAt: '2026-09-10T09:00:00.000Z', rows: [presentRow({ normalHours: 6, overtimeHours: 4 })] }), { expectedSaProjectId: PROJECT });
        // Revert to original hours (8h) — equal to original but different from previous (10h).
        const revert = envelope({ submissionId: id(83), capturedAt: '2026-09-10T10:00:00.000Z', rows: [presentRow({ normalHours: 8 })] });
        const result = await store.importSubmission(revert, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toBe('updated-version');
        const all = await store.list();
        expect(all).toHaveLength(2);
        const ids = all.map(x => x.submissionId).sort();
        expect(ids).toEqual([id(81), id(83)].sort());
        const [group] = await store.listVersionGroups();
        expect(group.original.submissionId).toBe(id(81));
        expect(group.current.submissionId).toBe(id(83));
        expect(group.updateCount).toBe(2);
    });

    test('display-only transmission changes (submissionId/capturedAt) do not create Actual', async () => {
        const db = new MemoryDB();
        const store = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const a = envelope({ submissionId: id(91), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow({ number: '001', name: 'Ana' })] });
        await store.importSubmission(a, { expectedSaProjectId: PROJECT });
        // Same semantic attendance, different number/name snapshots still count as same? No — number/name are part of semantic hash, so change creates Actual.
        // But pure transmission identity (submissionId/capturedAt) alone must not.
        const b = envelope({ submissionId: id(92), capturedAt: '2026-09-10T09:00:00.000Z', rows: [presentRow({ number: '001', name: 'Ana' })] });
        const result = await store.importSubmission(b, { expectedSaProjectId: PROJECT });
        expect(result.outcome).toMatch(/unchanged|semantic-duplicate/);
        expect(await store.list()).toHaveLength(1);
    });
});

describe('Meta2 — per-day grouping preserves source series + version choice', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => { document.body.replaceChildren(); });

    async function seedTwoSourcesSameDay() {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        const a1 = envelope({ submissionId: id(1), capturedAt: '2026-09-10T08:00:00.000Z', workDate: '2026-09-10', deviceId: 'MINI-A', sourceId: 'mini-a', rows: [presentRow({ normalHours: 8 })] });
        const b1 = envelope({ submissionId: id(2), capturedAt: '2026-09-10T08:30:00.000Z', workDate: '2026-09-10', deviceId: 'MINI-B', sourceId: 'mini-b', rows: [presentRow({ normalHours: 7 })] });
        const c1 = envelope({ submissionId: id(3), capturedAt: '2026-09-11T08:00:00.000Z', workDate: '2026-09-11', deviceId: 'MINI-A', sourceId: 'mini-a', rows: [presentRow({ normalHours: 8 })] });
        await inboxStore.importSubmission(a1, { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-a', sourcePeerName: 'Mini A' } });
        await inboxStore.importSubmission(b1, { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-b', sourcePeerName: 'Mini B' } });
        await inboxStore.importSubmission(c1, { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-a', sourcePeerName: 'Mini A' } });
        // Second version for MINI-A same day (different hours) → Original + Actual.
        const a2 = envelope({ submissionId: id(4), capturedAt: '2026-09-10T10:00:00.000Z', workDate: '2026-09-10', deviceId: 'MINI-A', sourceId: 'mini-a', rows: [presentRow({ normalHours: 6, overtimeHours: 2 })] });
        await inboxStore.importSubmission(a2, { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-a', sourcePeerName: 'Mini A' } });
        return { db, inboxStore };
    }

    test('different Mini/source series same workDate share one date section', async () => {
        const { inboxStore } = await seedTwoSourcesSameDay();
        const modal = new MiniAttendanceImportModal({ saProjectId: PROJECT, proposedDate: '2026-09-10', inboxStore, importMode: 'connected' });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        const sections = host.querySelectorAll('[data-mini-date-section]');
        expect(sections.length).toBe(2);
        const day10 = host.querySelector('[data-mini-date-section="2026-09-10"]');
        expect(day10).not.toBeNull();
        expect(day10.querySelector('[data-mini-date-title="2026-09-10"]')?.textContent).toMatch(/2 fuentes/);
        // Both series preserved inside the same date section.
        const cards = day10.querySelectorAll('[data-mini-draft-item]');
        expect(cards.length).toBe(2);
        const day11 = host.querySelector('[data-mini-date-section="2026-09-11"]');
        expect(day11.querySelectorAll('[data-mini-draft-item]').length).toBe(1);
    });

    test('Original/Actual choice preserved inside date section', async () => {
        const { inboxStore } = await seedTwoSourcesSameDay();
        const modal = new MiniAttendanceImportModal({ saProjectId: PROJECT, proposedDate: '2026-09-10', inboxStore, importMode: 'connected' });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        const day10 = host.querySelector('[data-mini-date-section="2026-09-10"]');
        // MINI-A series has Original + Actual → version radios present.
        const versionChoices = day10.querySelectorAll('[data-mini-version-choices]');
        expect(versionChoices.length).toBe(1);
        const radios = versionChoices[0].querySelectorAll('input[type="radio"]');
        expect(radios.length).toBe(2);
        expect([...radios].map(r => r.value).sort()).toEqual([id(1), id(4)].sort());
    });

    test('zero series excluded from date sections and counts', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        await inboxStore.importSubmission(envelope({ submissionId: id(5), capturedAt: '2026-09-10T08:00:00.000Z', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        const zero = envelope({ submissionId: id(6), capturedAt: '2026-09-10T09:00:00.000Z', deviceId: 'MINI-Z', rows: [unmarkedRow()] });
        const ignored = await inboxStore.importSubmission(zero, { expectedSaProjectId: PROJECT });
        expect(ignored.outcome).toMatch(/ignored/);
        const modal = new MiniAttendanceImportModal({ saProjectId: PROJECT, inboxStore, importMode: 'connected' });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        expect(modal.getVersionGroups()).toHaveLength(1);
        expect(host.querySelectorAll('[data-mini-draft-item]').length).toBe(1);
        expect(host.querySelector('[data-mini-action="open-connected-inbox"]')?.textContent || host.textContent).not.toContain(id(6));
    });
});

describe('Meta2 — select-all toggle chooses current by default', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => { document.body.replaceChildren(); });

    async function seedSelectable() {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db, now: () => 100 });
        await inboxStore.importSubmission(envelope({ submissionId: id(1), capturedAt: '2026-09-10T08:00:00.000Z', workDate: '2026-09-10', deviceId: 'MINI-A', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        await inboxStore.importSubmission(envelope({ submissionId: id(2), capturedAt: '2026-09-10T08:30:00.000Z', workDate: '2026-09-10', deviceId: 'MINI-B', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        const third = id(3);
        await inboxStore.importSubmission(envelope({ submissionId: third, capturedAt: '2026-09-11T08:00:00.000Z', workDate: '2026-09-11', deviceId: 'MINI-A', rows: [presentRow()] }), { expectedSaProjectId: PROJECT });
        await inboxStore.updateStatus(PROJECT, third, 'incorporated', { metadata: { incorporatedAt: 999 } });
        return inboxStore;
    }

    test('toggle selects all visible eligible as current, then deselects', async () => {
        const inboxStore = await seedSelectable();
        const modal = new MiniAttendanceImportModal({ saProjectId: PROJECT, inboxStore, importMode: 'connected' });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        expect(host.querySelector('[data-mini-select-all]')).not.toBeNull();
        expect(host.querySelector('[data-mini-select-all]').textContent).toBe('Seleccionar todo');
        expect(modal.getSelectableVisibleGroups()).toHaveLength(2);
        host.querySelector('[data-mini-select-all]').click();
        expect(host.querySelector('[data-mini-select-all]').textContent).toBe('Deseleccionar todo');
        // Both eligible series selected by current version.
        expect(modal.selectedDraftIds.has(id(1))).toBe(true);
        expect(modal.selectedDraftIds.has(id(2))).toBe(true);
        expect(modal.selectedDraftIds.has(id(3))).toBe(false);
        const selected = modal.getSelectedSourceDrafts();
        expect(selected).toHaveLength(2);
        // Selection chooses current version by default.
        const groups = modal.getSelectableVisibleGroups();
        for (const group of groups) {
            expect(modal.selectedDraftIds.has(group.current.submissionId)).toBe(true);
        }
        host.querySelector('[data-mini-select-all]').click();
        expect(modal.selectedDraftIds.size).toBe(0);
        expect(host.querySelector('[data-mini-select-all]').textContent).toBe('Seleccionar todo');
    });

    test('toggle respects status filter and skips incorporated', async () => {
        const inboxStore = await seedSelectable();
        const modal = new MiniAttendanceImportModal({ saProjectId: PROJECT, inboxStore, importMode: 'connected' });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        modal.setDraftStatusFilter('incorporated');
        const toggle = host.querySelector('[data-mini-select-all]');
        expect(toggle.disabled).toBe(true);
        modal.setDraftStatusFilter('not-incorporated');
        expect(host.querySelector('[data-mini-select-all]').disabled).toBe(false);
        host.querySelector('[data-mini-select-all]').click();
        expect(modal.selectedDraftIds.has(id(3))).toBe(false);
    });
});

describe('Meta2 — bridge counters and messages', () => {
    class FakeChannel {
        constructor() { this.listeners = new Set(); this.sent = []; }
        addEventListener(t, fn) { if (t === 'message') this.listeners.add(fn); }
        removeEventListener(t, fn) { if (t === 'message') this.listeners.delete(fn); }
        send(d) { this.sent.push(d); }
        receive(d) { const e = { data: typeof d === 'string' ? d : JSON.stringify(d) }; for (const fn of this.listeners) fn(e); }
        close() {}
    }
    function mockEnv(submissions) {
        const channel = new FakeChannel();
        const identityStore = {
            getSelf: async () => ({ deviceId: 'sa-1', appType: 'sa', displayName: 'SA' }),
            getPeer: async peerId => ({ peerId, peerApp: 'mini', displayName: 'Mini 1', linkToken: 't' }),
            listPeers: async () => [{ peerId: 'peer-mini-1', peerApp: 'mini', displayName: 'Mini 1', linkToken: 't' }]
        };
        const p2pCore = {
            makeIdentityStore: () => identityStore,
            deriveTrustedRoute: async () => ({ room: 'r', proof: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }),
            SignalingClient: function () { return { connect: async () => {}, close: () => {} }; },
            isChannelAuthenticated: () => true,
            createRtcSession: async ({ onChannel }) => { setTimeout(() => onChannel?.(channel), 0); return { channel, close: () => channel.close() }; }
        };
        const p2pPairing = {
            attachTrusted: (ch, { onAuthenticated }) => {
                setTimeout(() => { onAuthenticated?.(); ch.receive({ schema: 'attendance-ready/v1' }); setTimeout(() => { const req = JSON.parse(ch.sent[ch.sent.length - 1]); ch.receive({ schema: ATTENDANCE_RESPONSE_SCHEMA, requestId: req.requestId, saProjectId: req.saProjectId, ok: true, fromDate: req.fromDate, toDate: req.toDate, submissions }); }, 5); }, 0);
                return { detach: () => {} };
            }
        };
        return { identityStore, p2pCore, p2pPairing };
    }

    test('zero report via P2P counts as ignored, not new', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        const zero = envelope({ submissionId: id(71), capturedAt: '2026-09-06T12:00:00.000Z', workDate: '2026-09-06', rows: [unmarkedRow()] });
        const env = mockEnv([zero]);
        const result = await requestMiniAttendance({ miniId: 'peer-mini-1', date: '2026-09-06', groupingMode: 'day', saProjectId: PROJECT, inboxStore, identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing });
        expect(result.importedCount).toBe(0);
        expect(result.ignoredCount).toBe(1);
        expect(result.message).toContain('0 nuevos');
        expect(result.message).not.toContain('1 nuevos');
        expect(result.message).toMatch(/ignorados/);
        expect(await inboxStore.list()).toHaveLength(0);
    });

    test('semantic duplicate via P2P counts as unchanged, not new', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        // Same seriesKey: P2P imports carry sourcePeerId, so seed with same metadata.
        const first = envelope({ submissionId: id(72), capturedAt: '2026-09-06T12:00:00.000Z', workDate: '2026-09-06', deviceId: 'MINI-A', rows: [presentRow()] });
        await inboxStore.importSubmission(first, { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-mini-1', sourcePeerName: 'Mini 1' } });
        const identical = envelope({ submissionId: id(73), capturedAt: '2026-09-06T13:00:00.000Z', workDate: '2026-09-06', deviceId: 'MINI-A', rows: [presentRow()] });
        const env = mockEnv([identical]);
        const result = await requestMiniAttendance({ miniId: 'peer-mini-1', date: '2026-09-06', groupingMode: 'day', saProjectId: PROJECT, inboxStore, identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing });
        expect(result.importedCount).toBe(0);
        expect(result.unchangedCount).toBe(1);
        expect(result.message).toContain('0 nuevos');
        expect(await inboxStore.list()).toHaveLength(1);
    });

    test('updated version via P2P counts as new (imported)', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        await inboxStore.importSubmission(envelope({ submissionId: id(74), capturedAt: '2026-09-06T12:00:00.000Z', workDate: '2026-09-06', deviceId: 'MINI-A', rows: [presentRow({ normalHours: 8, overtimeHours: 0 })] }), { expectedSaProjectId: PROJECT, metadata: { sourcePeerId: 'peer-mini-1', sourcePeerName: 'Mini 1' } });
        const changed = envelope({ submissionId: id(75), capturedAt: '2026-09-06T13:00:00.000Z', workDate: '2026-09-06', deviceId: 'MINI-A', rows: [presentRow({ normalHours: 8, overtimeHours: 2 })] });
        const env = mockEnv([changed]);
        const result = await requestMiniAttendance({ miniId: 'peer-mini-1', date: '2026-09-06', groupingMode: 'day', saProjectId: PROJECT, inboxStore, identityStore: env.identityStore, p2pCore: env.p2pCore, p2pPairing: env.p2pPairing });
        expect(result.importedCount).toBe(1);
        expect(result.ignoredCount).toBe(0);
        expect(result.message).toContain('1 nuevos');
    });
});
