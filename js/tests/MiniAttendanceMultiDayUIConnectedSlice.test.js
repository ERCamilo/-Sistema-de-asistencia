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

function buildSubmission({ id, workDate, deviceId = 'phone-1', sourceId = deviceId, rows = [] }) {
    return {
        schema: 'attendance-submission/v1', submissionId: id, saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId }, deviceId,
        rosterVersion: 'roster-1', capturedAt: '2026-09-10T12:00:00.000Z', workDate, rows
    };
}

function makeModal({ db, employees, positions, attendance, applyPlan }) {
    return new MiniAttendanceImportModal({
        saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
        inboxStore: new AttendanceSubmissionInboxStore({ db }),
        consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
        employees, positions, attendance, applyPlan, importMode: 'connected'
    });
}

describe('MiniAttendanceImportModal — staged Mini↔Mini → consolidated↔SA', () => {
    let host;
    let employees;
    let positions;
    let attendance;
    let appliedPlans;
    let applyPlan;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
        positions = [{ id: 'pos-1', name: 'Albañil' }, { id: 'pos-2', name: 'Fierrero' }];
        employees = [
            { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
            { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
            { id: 'EMP-003', number: '003', name: 'David López', active: true, positions: ['pos-1', 'pos-2'], projectId: SA_PROJECT }
        ];
        attendance = {};
        appliedPlans = [];
        applyPlan = jest.fn(async plan => {
            appliedPlans.push(plan);
            for (const write of plan.writes) attendance[write.key] = write.record;
            return { date: plan.date, appliedCount: plan.writes.length, writtenKeys: plan.writes.map(w => w.key), keptCount: plan.keptKeys.length, keptKeys: [...plan.keptKeys] };
        });
    });

    afterEach(() => document.body.replaceChildren());

    test('paginates by day, persists completed sub-consolidations and resumes on the first incomplete day', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id1 = '11111111-1111-4111-8111-111111111111';
        const id2 = '22222222-2222-4222-8222-222222222222';
        await inbox.importSubmission(buildSubmission({ id: id1, workDate: '2026-09-06', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
        ] }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({ id: id2, workDate: '2026-09-07', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${id2}"]`).click();
        await modal.consolidateSelectedDrafts();

        expect(modal.connectedView).toBe('consolidation');
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 2');
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Listo para completar');
        expect(host.querySelector('[data-mini-day-date="2026-09-07"]')).toBeNull();
        expect(appliedPlans).toHaveLength(0);

        host.querySelector('[data-mini-action="complete-mini-day"]').click();
        await wait();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(host.querySelector('[data-mini-day-date="2026-09-07"]').textContent).toBe('Conflicto entre Minis');

        // Simulate closing/reopening before resolving day 2.
        const modal2Host = document.createElement('div'); document.body.replaceChildren(modal2Host);
        const modal2 = makeModal({ db, employees, positions, attendance, applyPlan });
        modal2.mount(modal2Host); await modal2.setImportMode('connected'); await modal2.openConnectedInbox();
        expect(modal2Host.querySelector('[data-mini-resume-consolidation]')).not.toBeNull();
        await modal2.resumeConsolidation();
        expect(modal2.connectedView).toBe('consolidation');
        expect(modal2Host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(modal2Host.querySelector('[data-mini-day-date="2026-09-07"]').textContent).toBe('Conflicto entre Minis');
    });

    test('SA is not consulted until every Mini conflict is resolved and the reviewed consolidated draft is created', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        attendance['EMP-001-2026-09-06'] = { employeeId: 'EMP-001', date: '2026-09-06', present: true, hoursWorked: 9, overtimeHours: 0, selectedPosition: 'pos-1', positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }] };
        const a = '33333333-3333-4333-8333-333333333333';
        const b = '44444444-4444-4444-8444-444444444444';
        await inbox.importSubmission(buildSubmission({ id: a, workDate: '2026-09-06', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
        ] }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({ id: b, workDate: '2026-09-06', deviceId: 'mini-b', rows: [
            { miniLocalId: 'b1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-001' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click(); host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Conflicto entre Minis');
        expect(host.querySelector('[data-mini-sa-conflict="EMP-001"]')).toBeNull();

        host.querySelector('[data-mini-action="resolve-hours"][data-mini-source-index="0"]').click();
        await wait();
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Listo para completar');
        expect(host.querySelector('[data-mini-sa-conflict="EMP-001"]')).toBeNull();
        host.querySelector('[data-mini-action="complete-mini-day"]').click(); await wait();
        expect(host.querySelector('[data-mini-action="create-mini-consolidated"]').disabled).toBe(false);
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click(); await wait();

        expect(modal.connectedView).toBe('sa-comparison');
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Conflicto con SA');
        expect(host.querySelector('[data-mini-sa-conflict="EMP-001"]')).not.toBeNull();
        expect(appliedPlans).toHaveLength(0);
    });

    test('multi-position choice is deferred to SA comparison after Mini review', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = '55555555-5555-4555-8555-555555555555';
        await inbox.importSubmission(buildSubmission({ id, workDate: '2026-09-09', deviceId: 'mini-a', rows: [
            { miniLocalId: 'm3', number: '003', name: 'David', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-003' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click(); await modal.consolidateSelectedDrafts();
        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Listo para completar');
        expect(host.querySelector('[data-mini-select-position="EMP-003"]')).toBeNull();
        host.querySelector('[data-mini-action="complete-mini-day"]').click(); await wait();
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click(); await wait();
        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Conflicto con SA');
        const select = host.querySelector('[data-mini-select-position="EMP-003"]');
        const assign = host.querySelector('[data-mini-action="resolve-position"][data-mini-employee-id="EMP-003"]');
        expect(select).not.toBeNull(); expect(assign.disabled).toBe(true);
        select.value = 'pos-2'; select.dispatchEvent(new Event('change'));
        expect(assign.disabled).toBe(false); assign.click();
        expect(modal.multiDayResolver.buildDayApplyPlan('2026-09-09').writes[0].record.selectedPosition).toBe('pos-2');
    });
});
