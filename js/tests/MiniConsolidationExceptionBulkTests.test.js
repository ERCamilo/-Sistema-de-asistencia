import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceConsolidationStore } from '../modules/services/MiniAttendanceConsolidationStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import {
    createMultiDayAttendanceResolver,
    isSafeBulkSaConflict
} from '../modules/features/attendance/MultiDayAttendanceResolver.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key); }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.store(name).set(value.key ?? value.submissionId, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const SA_PROJECT = 'PRJ-OBRA-EXC';
const SA_SCOPE = Object.freeze({ enabled: true, projectId: SA_PROJECT, defaultProjectId: SA_PROJECT });
const wait = () => new Promise(resolve => setTimeout(resolve, 15));

function buildSubmission({ id, workDate, deviceId = 'mini-a', sourceId = null, rows = [] }) {
    return {
        schema: 'attendance-submission/v1', submissionId: id, saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: sourceId || deviceId }, deviceId,
        rosterVersion: 'roster-1', capturedAt: '2026-09-10T12:00:00.000Z', workDate, rows
    };
}

function baseEmployees() {
    return [
        { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
        { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
        { id: 'EMP-003', number: '003', name: 'David López', active: true, positions: ['pos-1', 'pos-2'], projectId: SA_PROJECT }
    ];
}

function basePositions() {
    return [{ id: 'pos-1', name: 'Albañil' }, { id: 'pos-2', name: 'Fierrero' }];
}

function makeModal({ db, employees, positions, attendance, applyPlan }) {
    return new MiniAttendanceImportModal({
        saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
        inboxStore: new AttendanceSubmissionInboxStore({ db }),
        consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
        employees, positions, attendance, applyPlan, importMode: 'connected'
    });
}

function rowNumbers(host) {
    return [...host.querySelectorAll('.mini-consolidation-row .mini-row-number')]
        .map(el => (el.textContent || '').trim());
}

describe('SAFE bulk predicate — only plain two-way hours conflicts', () => {
    const employees = baseEmployees();
    const saProjectId = SA_PROJECT;
    const date = '2026-09-06';

    function safeItem() {
        return {
            id: `consolidated:${saProjectId}:EMP-001:${date}`,
            saProjectId, saEmployeeId: 'EMP-001', workDate: date,
            status: 'resolved', conflictType: null, conflictReasons: [],
            displayNumber: '001', displayName: 'Ana Pérez',
            normalHours: 8, overtimeHours: 0, totalHours: 8,
            sourceStatus: 'present', rosterStatus: 'active',
            sources: [{ deviceId: 'mini-a', status: 'present', rosterStatus: 'active', normalHours: 8, overtimeHours: 0 }],
            blockers: []
        };
    }

    function safeRow() {
        return {
            key: `EMP-001-${date}`, employeeId: 'EMP-001',
            isIdentical: false,
            decision: { action: 'keep_existing', acknowledged: false },
            blockers: ['decision_unacknowledged'],
            employeePositionIds: ['pos-1'],
            positionAllocations: [{ positionId: 'pos-1', normalHours: 8, overtimeHours: 0 }],
            existing: { record: { hoursWorked: 9, overtimeHours: 0 }, breakdown: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] }
        };
    }

    test('accepts a plain single-position present-hours conflict, including the safe keep-current default', () => {
        expect(isSafeBulkSaConflict(safeItem(), safeRow(), employees)).toBe(true);
        const defaulted = {
            ...safeRow(),
            decision: { action: 'keep_existing', acknowledged: true, defaulted: true },
            blockers: []
        };
        expect(isSafeBulkSaConflict(safeItem(), defaulted, employees)).toBe(true);
    });

    test('rejects identity, position, paused, missing and multi-choice cases', () => {
        const item = safeItem();
        const row = safeRow();
        // Identity: no employee / unresolved status
        expect(isSafeBulkSaConflict({ ...item, saEmployeeId: null, status: 'identity_conflict' }, row, employees)).toBe(false);
        // Position choice: multi-position employee
        expect(isSafeBulkSaConflict(item, { ...row, employeePositionIds: ['pos-1', 'pos-2'], positionAllocations: [] }, employees)).toBe(false);
        // Position blocker beyond the simple hours choice
        expect(isSafeBulkSaConflict(item, { ...row, blockers: ['decision_unacknowledged', 'target_position_required'] }, employees)).toBe(false);
        // Paused roster status
        expect(isSafeBulkSaConflict({ ...item, rosterStatus: 'paused' }, row, employees)).toBe(false);
        // Missing/not-reported source
        expect(isSafeBulkSaConflict(
            { ...item, sources: [{ deviceId: 'mini-a', status: 'present', missingRoster: true }] },
            row, employees
        )).toBe(false);
        expect(isSafeBulkSaConflict({ ...item, sourceStatus: 'unmarked', normalHours: 0, overtimeHours: 0 }, row, employees)).toBe(false);
        // Roster-status differences across sources
        expect(isSafeBulkSaConflict(
            { ...item, sources: [{ deviceId: 'a', status: 'present', rosterStatus: 'active' }, { deviceId: 'b', status: 'present', rosterStatus: 'paused' }] },
            row, employees
        )).toBe(false);
        // Multi-breakdown existing (collapse choice)
        expect(isSafeBulkSaConflict(item, {
            ...row,
            existing: { record: { hoursWorked: 9 }, breakdown: [{ positionId: 'pos-1', hours: 4 }, { positionId: 'pos-2', hours: 5 }] }
        }, employees)).toBe(false);
        // Inactive employee (reactivation case)
        const inactiveEmployees = employees.map(e => (e.id === 'EMP-001' ? { ...e, active: false } : e));
        expect(isSafeBulkSaConflict(item, row, inactiveEmployees)).toBe(false);
        // Already resolved / identical
        expect(isSafeBulkSaConflict(item, { ...row, isIdentical: true, decision: { action: 'keep_existing', acknowledged: true }, blockers: [] }, employees)).toBe(false);
        // Residual Mini conflict reasons (more than a two-way choice)
        expect(isSafeBulkSaConflict({ ...item, conflictReasons: ['hours_conflict'] }, row, employees)).toBe(false);
    });
});

describe('resolver day bulk — current day only, through canonical decisions', () => {
    test('resolves only safe pending rows on the given day and persists without direct attendance writes', () => {
        const employees = baseEmployees();
        const positions = basePositions();
        const date1 = '2026-09-06';
        const date2 = '2026-09-07';
        const attendance = {
            [`EMP-001-${date1}`]: { employeeId: 'EMP-001', date: date1, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] },
            [`EMP-003-${date1}`]: { employeeId: 'EMP-003', date: date1, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] },
            [`EMP-001-${date2}`]: { employeeId: 'EMP-001', date: date2, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] }
        };
        const consolidation = {
            saProjectId: SA_PROJECT, workDates: [date1, date2], devices: [], contributingSubmissions: [],
            items: [
                { id: `a1:${date1}`, saProjectId: SA_PROJECT, saEmployeeId: 'EMP-001', workDate: date1, status: 'resolved', sourceStatus: 'present', rosterStatus: 'active', normalHours: 8, overtimeHours: 0, sources: [] },
                { id: `a3:${date1}`, saProjectId: SA_PROJECT, saEmployeeId: 'EMP-003', workDate: date1, status: 'resolved', sourceStatus: 'present', rosterStatus: 'active', normalHours: 8, overtimeHours: 0, sources: [] },
                { id: `a1:${date2}`, saProjectId: SA_PROJECT, saEmployeeId: 'EMP-001', workDate: date2, status: 'resolved', sourceStatus: 'present', rosterStatus: 'active', normalHours: 8, overtimeHours: 0, sources: [] }
            ]
        };
        const resolver = createMultiDayAttendanceResolver({
            consolidation, employees, attendance, positions,
            saProjectId: SA_PROJECT, entityScope: SA_SCOPE, stage: 'sa', applyPlan: jest.fn()
        });
        expect(resolver.getDayState(date1).status).toBe('stage_b_conflict');
        expect(resolver.getDayState(date2).status).toBe('ready');

        const result = resolver.resolveDaySafeBulkConflicts(date1, 'use_imported');
        expect(result).toMatchObject({ date: date1, action: 'use_imported', resolvedCount: 1 });
        expect(result.skippedCount).toBe(1);

        // Safe single-position row is acknowledged; multi-position row stays pending.
        const day1 = resolver.getDayState(date1);
        const emp1 = day1.conflictPlan.rows.find(r => r.employeeId === 'EMP-001');
        const emp3 = day1.conflictPlan.rows.find(r => r.employeeId === 'EMP-003');
        expect(emp1.decision).toMatchObject({ action: 'use_imported', acknowledged: true });
        expect(emp1.blockers).toHaveLength(0);
        expect(emp3.decision.acknowledged).toBe(false);
        expect(emp3.blockers).toContain('decision_unacknowledged');

        // Other day untouched.
        const day2 = resolver.getDayState(date2);
        expect(day2.conflictPlan.rows.find(r => r.employeeId === 'EMP-001').decision).toMatchObject({ action: 'keep_existing', acknowledged: true, defaulted: true });

        // Canonical writer bypass check: injected attendance untouched until applyDay.
        expect(attendance[`EMP-001-${date1}`].hoursWorked).toBe(9);
    });
});

describe('MiniAttendanceImportModal — exception-first day review + SA bulk', () => {
    let host;
    let employees;
    let positions;
    let attendance;
    let applyPlan;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
        employees = baseEmployees();
        positions = basePositions();
        attendance = {};
        applyPlan = jest.fn(async plan => ({
            date: plan.date, appliedCount: plan.writes.length,
            writtenKeys: plan.writes.map(w => w.key), keptCount: plan.keptKeys.length, keptKeys: [...plan.keptKeys]
        }));
    });

    afterEach(() => document.body.replaceChildren());

    test('Mini stage shows pending first and collapses resolved behind Mostrar/Ocultar', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const date = '2026-09-06';
        const a = '11111111-1111-4111-8111-111111111111';
        const b = '22222222-2222-4222-8222-222222222222';
        // EMP-001 agrees (resolved), EMP-002 disagrees (pending), EMP-003 agrees (resolved).
        await inbox.importSubmission(buildSubmission({
            id: a, workDate: date, deviceId: 'mini-a', rows: [
                { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' },
                { miniLocalId: 'a3', number: '003', name: 'David', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-003' }
            ]
        }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({
            id: b, workDate: date, deviceId: 'mini-b', rows: [
                { miniLocalId: 'b1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'b2', number: '002', name: 'Carlos', normalHours: 4, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' },
                { miniLocalId: 'b3', number: '003', name: 'David', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-003' }
            ]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();

        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 1');
        // Collapsed by default: only the pending row is visible behind the toggle.
        expect(rowNumbers(host)).toEqual(['#002']);
        const toggle = host.querySelector('[data-mini-action="toggle-resolved-rows"]');
        expect(toggle).not.toBeNull();
        expect(toggle.textContent).toContain('2 resueltos');
        expect(toggle.textContent).toContain('Mostrar');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();
        expect(host.querySelector('[data-mini-action="toggle-resolved-rows"]').textContent).toContain('Ocultar');
        // Exception-first order with numeric order preserved inside each subset.
        expect(rowNumbers(host)).toEqual(['#002', '#001', '#003']);
        // Same shell, same day pagination, resolver data untouched.
        expect(host.querySelector('[data-mini-consolidation-skeleton]')).not.toBeNull();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 1');
        expect(modal.multiDayResolver.items).toHaveLength(3);

        host.querySelector('[data-mini-action="toggle-resolved-rows"]').click();
        expect(rowNumbers(host)).toEqual(['#002']);
        expect(host.querySelector('[data-mini-action="toggle-resolved-rows"]').textContent).toContain('Mostrar');
    });

    test('explicitly chosen Mini rows stay visible until the day is confirmed', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const date = '2026-09-06';
        const a = '55555555-5555-4555-8555-555555555555';
        const b = '66666666-6666-4666-8666-666666666666';
        await inbox.importSubmission(buildSubmission({
            id: a, workDate: date, deviceId: 'mini-a', rows: [
                { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({
            id: b, workDate: date, deviceId: 'mini-b', rows: [
                { miniLocalId: 'b1', number: '001', name: 'Ana', normalHours: 4, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'b2', number: '002', name: 'Carlos', normalHours: 4, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        }), { expectedSaProjectId: SA_PROJECT, metadata: { sourcePeerName: 'Mini Cuadrilla B' } });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();

        const firstMiniB = [...host.querySelectorAll('[data-mini-action="resolve-hours"]')]
            .find(button => button.textContent.includes('Mini Cuadrilla B'));
        firstMiniB.click();
        await wait();
        // The just-resolved choice stays inspectable: no collapse hides live selection.
        expect(rowNumbers(host)).toEqual(['#001', '#002']);
        const selected = host.querySelector('[data-mini-action="resolve-hours"].is-selected[aria-pressed="true"]');
        expect(selected).not.toBeNull();
        expect(selected.textContent).toContain('Mini Cuadrilla B');
        expect(host.querySelector('[data-mini-action="toggle-resolved-rows"]')).toBeNull();
    });

    test('fully reviewed day shows the useful result without hiding it behind a toggle', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = '33333333-3333-4333-8333-333333333333';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-06', deviceId: 'mini-a', rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();

        expect(host.querySelector('[data-mini-action="toggle-resolved-rows"]')).toBeNull();
        expect(rowNumbers(host)).toEqual(['#001']);
        expect(host.querySelector('.mini-row-resolved-icon')).not.toBeNull();
    });

    test('SA comparison offers day bulk for safe hours rows only and reflects it immediately', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const date = '2026-09-06';
        const id = '44444444-4444-4444-8444-444444444444';
        attendance[`EMP-001-${date}`] = { employeeId: 'EMP-001', date, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] };
        attendance[`EMP-002-${date}`] = { employeeId: 'EMP-002', date, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] };
        attendance[`EMP-003-${date}`] = { employeeId: 'EMP-003', date, present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] };
        await inbox.importSubmission(buildSubmission({
            id, workDate: date, deviceId: 'mini-a', rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'm2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' },
                { miniLocalId: 'm3', number: '003', name: 'David', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-003' }
            ]
        }), { expectedSaProjectId: SA_PROJECT });

        const confirmSpy = jest.fn();
        window.confirm = confirmSpy;
        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();

        // One valid Mini advances directly to SA comparison; there is no redundant day-confirm step.
        expect(modal.connectedView).toBe('sa-comparison');
        const bulkBar = host.querySelector('[data-mini-sa-bulk-actions]');
        expect(bulkBar).not.toBeNull();
        const keepBtn = host.querySelector('[data-mini-action="bulk-keep-sa"]');
        const useBtn = host.querySelector('[data-mini-action="bulk-use-mini"]');
        expect(keepBtn?.textContent).toBe('Conservar actuales');
        expect(useBtn?.textContent).toBe('Usar Mini en cambios');
        expect(keepBtn?.classList.contains('is-selected')).toBe(true);
        expect(keepBtn?.getAttribute('aria-pressed')).toBe('true');
        expect(host.querySelectorAll('[data-mini-sa-conflict]').length).toBe(3);

        useBtn.click();
        // No native confirm/alert, same shell/day, immediate visual reflection.
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(host.querySelector('[data-mini-consolidation-skeleton]')).not.toBeNull();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 1');
        // Only the two safe single-position rows resolved; multi-position row stays pending.
        const remaining = [...host.querySelectorAll('[data-mini-sa-conflict]')].map(el => el.dataset.miniSaConflict);
        expect(remaining).toEqual(['EMP-003']);
        expect(host.querySelector('[data-mini-sa-bulk-actions]')).toBeNull();
        // Resolver state persisted through the canonical path (no direct attendance write).
        const dayState = modal.multiDayResolver.getDayState(date);
        expect(dayState.conflictPlan.rows.find(r => r.employeeId === 'EMP-001').decision).toMatchObject({ action: 'use_imported', acknowledged: true });
        expect(dayState.conflictPlan.rows.find(r => r.employeeId === 'EMP-002').decision).toMatchObject({ action: 'use_imported', acknowledged: true });
        expect(dayState.conflictPlan.rows.find(r => r.employeeId === 'EMP-003').decision.acknowledged).toBe(false);
        expect(attendance[`EMP-001-${date}`].hoursWorked).toBe(9);

        // Exception-first still holds after bulk: pending first, resolved collapsed.
        expect(rowNumbers(host)).toEqual(['#003']);
        const toggle = host.querySelector('[data-mini-action="toggle-resolved-rows"]');
        expect(toggle?.textContent).toContain('2 resueltos');
        toggle.click();
        expect(rowNumbers(host)).toEqual(['#003', '#001', '#002']);
        // Expanded resolved rows remain inspectable and preserve their explicit Mini selection.
        expect(host.querySelectorAll('[data-mini-sa-conflict]').length).toBe(3);
        const emp1Conflict = host.querySelector('[data-mini-sa-conflict="EMP-001"]');
        expect(emp1Conflict.querySelector('[data-mini-action="use-imported"]').getAttribute('aria-pressed')).toBe('true');
        expect(emp1Conflict.querySelector('[data-mini-action="keep-sa"]').getAttribute('aria-pressed')).toBe('false');
    });
});
