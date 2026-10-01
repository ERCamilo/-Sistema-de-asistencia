import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceConsolidationStore } from '../modules/services/MiniAttendanceConsolidationStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key); }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.store(name).set(value.key ?? value.submissionId, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const SA_PROJECT = 'PRJ-OBRA-UI';
const SA_SCOPE = Object.freeze({ enabled: true, projectId: SA_PROJECT, defaultProjectId: SA_PROJECT });
const wait = () => new Promise(resolve => setTimeout(resolve, 15));

function buildSubmission({ id, workDate, deviceId = 'phone-1', sourceId = deviceId, rows = [], coverageMode = null }) {
    return {
        schema: 'attendance-submission/v1', submissionId: id, saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId }, deviceId,
        rosterVersion: 'roster-1', capturedAt: '2026-09-10T12:00:00.000Z', workDate,
        ...(coverageMode ? { coverageMode } : {}),
        rows
    };
}

function makeModal({
    db, employees, positions, attendance, applyPlan,
    aliasStore = null, actorUid = 'owner-sa', confirmIgnore = null
}) {
    return new MiniAttendanceImportModal({
        saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
        inboxStore: new AttendanceSubmissionInboxStore({ db }),
        consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
        employees, positions, attendance, applyPlan, importMode: 'connected',
        aliasStore, actorUid, confirmIgnore
    });
}

import { createMiniAttendanceDraftFromConsolidatedDay, createMiniAttendanceConflictPlan } from '../modules/features/attendance/MiniAttendanceDraft.js';

const employees = [
    { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
    { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
    { id: 'EMP-009', number: '009', name: 'Inactivo', active: false, positions: ['pos-1'], projectId: SA_PROJECT }
];
const positions = [{ id: 'pos-1', name: 'Albañil' }];
const item = (id, employeeId, date, normalHours, overtimeHours = 0, extra = {}) => ({
    id, saEmployeeId: employeeId, workDate: date, status: 'resolved', normalHours, overtimeHours,
    displayNumber: employeeId.slice(-3), displayName: employeeId, sourceStatus: 'present',
    sources: [{ deviceId: 'mini-a', submissionId: 'sub-1' }], ...extra
});

describe('createMiniAttendanceDraftFromConsolidatedDay', () => {
    const date = '2026-09-06';

    test('rows arrive linked, keep Mini normal/extra and provenance; date already confirmed', () => {
        const draft = createMiniAttendanceDraftFromConsolidatedDay({
            date, employees, items: [item('i1', 'EMP-001', date, 8, 2), item('x', 'EMP-002', '2026-09-07', 8)]
        });
        expect(draft.origin).toBe('connected');
        expect(draft.confirmedDate).toBe(date);
        expect(draft.dateBlockers).toEqual([]);
        expect(draft.rows).toHaveLength(1);
        expect(draft.rows[0].match).toMatchObject({ status: 'remembered_match', employeeId: 'EMP-001', requiresConfirmation: false });
        expect(draft.rows[0].allocation).toEqual({ normalHours: 8, overtimeHours: 2 });
        const plan = createMiniAttendanceConflictPlan(draft, {});
        expect(plan.rows[0].sources[0].deviceId).toBe('mini-a');
        expect(plan.rows[0].imported).toMatchObject({ normalHours: 8, overtimeHours: 2 });
    });

    test('0h only enters when SA has attendance that day; ignored items never enter', () => {
        const attendance = { [`EMP-002-${date}`]: { employeeId: 'EMP-002', date, present: true, hoursWorked: 8 } };
        const draft = createMiniAttendanceDraftFromConsolidatedDay({
            date, employees, attendance, items: [
                item('a', 'EMP-001', date, 0, 0, { sourceStatus: 'unmarked' }),
                item('b', 'EMP-002', date, 0, 0, { sourceStatus: 'unmarked' }),
                item('c', 'EMP-001', date, 8, 0, { excluded: true })
            ]
        });
        expect(draft.rows.map(row => row.match.employeeId)).toEqual(['EMP-002']);
        expect(draft.rows[0].allocation).toEqual({ normalHours: 0, overtimeHours: 0 });
    });

    test('Mini en 0 y SA en 0 (registro de ausencia) no entra a revisión', () => {
        const attendance = {
            [`EMP-001-${date}`]: { employeeId: 'EMP-001', date, present: false, hoursWorked: 0, overtimeHours: 0 },
            [`EMP-002-${date}`]: { employeeId: 'EMP-002', date, present: true, hoursWorked: 0, overtimeHours: 2 }
        };
        const draft = createMiniAttendanceDraftFromConsolidatedDay({
            date, employees, attendance, items: [
                item('a', 'EMP-001', date, 0, 0, { sourceStatus: 'absent' }),
                item('b', 'EMP-002', date, 0, 0, { sourceStatus: 'unmarked' })
            ]
        });
        // EMP-001: 0 contra 0 se resuelve solo; EMP-002: SA tiene 2h extra, se revisa.
        expect(draft.rows.map(row => row.match.employeeId)).toEqual(['EMP-002']);
    });

    test('an inactive or missing employee is never dropped: it asks for a decision', () => {
        const draft = createMiniAttendanceDraftFromConsolidatedDay({
            date, employees, items: [item('a', 'EMP-009', date, 8), item('b', 'EMP-404', date, 8)]
        });
        expect(draft.rows).toHaveLength(2);
        expect(draft.rows[0].blockers).toContain('inactive_employee');
        expect(draft.rows[1].blockers).toContain('employee_unmatched');
        expect(draft.hasBlockingIssues).toBe(true);
    });
});

describe('Conectados → conciliación por día', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    function consolidation() {
        return {
            saProjectId: SA_PROJECT, workDates: ['2026-09-06', '2026-09-07', '2026-09-08'],
            items: [
                item('d1', 'EMP-001', '2026-09-06', 8),
                item('d2', 'EMP-002', '2026-09-07', 0, 0, { sourceStatus: 'unmarked' }),
                item('d3', 'EMP-002', '2026-09-08', 8)
            ]
        };
    }

    test('walks the days in order, skips days with nothing to change and resumes after the applied ones', async () => {
        const db = new MemoryDB();
        const applied = [];
        const applyPlan = jest.fn(async plan => { applied.push(plan.date); return { appliedCount: plan.writes.length, keptCount: 0 }; });
        const store = new MiniAttendanceConsolidationStore({ db, now: () => 1000 });
        const record = await store.saveConsolidated({ ...consolidation(), consolidationId: 'c-1', schema: 'mini-attendance-consolidated/v1', revision: 1 }, { sourceDrafts: [] }).catch(() => null);
        const modal = makeModal({ db, employees, positions, attendance: {}, applyPlan });
        modal.mount(host);
        modal.activeConsolidationId = record?.consolidationId || null;
        modal.beginConnectedDayReview(consolidation());

        expect(modal.connectedReviewDate()).toBe('2026-09-06');
        host.querySelector('[data-mini-action="accept-automatic"]').click();
        host.querySelector('[data-mini-action="apply"]').click();
        await wait();
        // 07/09 only has «sin asistencia» without SA attendance: nothing to review.
        expect(host.querySelector('[data-mini-action="next-connected-day"]').textContent).toBe('Siguiente día (queda 1)');
        host.querySelector('[data-mini-action="next-connected-day"]').click();
        expect(modal.connectedReviewDate()).toBe('2026-09-08');
        expect(modal.connectedReview.skippedDates.has('2026-09-07')).toBe(true);
        expect(applied).toEqual(['2026-09-06']);

        // Closing now and resuming later starts after the applied day.
        const resumed = makeModal({ db, employees, positions, attendance: {}, applyPlan });
        resumed.mount(host);
        resumed.beginConnectedDayReview(consolidation(), { appliedDates: ['2026-09-06'] });
        expect(resumed.connectedReviewDate()).toBe('2026-09-08');
        expect(resumed.reviewStepSubtitle('x')).toBe('Conectados · Día 3 de 3 · 08/09/2026');
    });

    test('«Volver» leaves the reconciliation for the inbox without applying anything', async () => {
        const db = new MemoryDB();
        const applyPlan = jest.fn();
        const modal = makeModal({ db, employees, positions, attendance: {}, applyPlan });
        modal.mount(host);
        modal.beginConnectedDayReview(consolidation());
        host.querySelector('[data-mini-action="back-review"]').click();
        await wait();
        expect(modal.connectedView).toBe('inbox');
        expect(modal.connectedReview).toBeNull();
        expect(applyPlan).not.toHaveBeenCalled();
    });
});
