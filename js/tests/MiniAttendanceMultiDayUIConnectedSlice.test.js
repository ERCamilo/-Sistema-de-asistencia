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

    test('SA comparison shows overtime merge checked by default and toggles the final apply plan', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = '66666666-6666-4666-8666-666666666666';
        await inbox.importSubmission(buildSubmission({ id, workDate: '2026-09-10', deviceId: 'mini-a', rows: [
            { miniLocalId: 'm2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 3.5, status: 'present', saEmployeeId: 'EMP-002' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click(); await modal.consolidateSelectedDrafts();
        host.querySelector('[data-mini-action="complete-mini-day"]').click(); await wait();
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click(); await wait();

        const checkbox = host.querySelector('[data-mini-merge-overtime]');
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(true);
        let record = modal.multiDayResolver.buildDayApplyPlan('2026-09-10').writes[0].record;
        expect(record).toMatchObject({ hoursWorked: 11.5, overtimeHours: 0 });

        checkbox.click();
        record = modal.multiDayResolver.buildDayApplyPlan('2026-09-10').writes[0].record;
        expect(record).toMatchObject({ hoursWorked: 8, overtimeHours: 3.5 });
    });

    test('keeps the chosen Mini visibly selected and can apply one Mini to the whole day', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const a = '66666666-6666-4666-8666-666666666666';
        const b = '77777777-7777-4777-8777-777777777777';
        await inbox.importSubmission(buildSubmission({ id: a, workDate: '2026-09-08', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 4, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
            { miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 4, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
        ] }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({ id: b, workDate: '2026-09-08', deviceId: 'mini-b', rows: [
            { miniLocalId: 'b1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
            { miniLocalId: 'b2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-002' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click(); host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();

        const firstMiniB = [...host.querySelectorAll('[data-mini-action="resolve-hours"]')]
            .find(button => button.textContent.includes('mini-b'));
        expect(firstMiniB).toBeDefined();
        firstMiniB.click(); await wait();
        const selected = host.querySelector('[data-mini-action="resolve-hours"].is-selected[aria-pressed="true"]');
        expect(selected).not.toBeNull();
        expect(selected.textContent).toContain('mini-b');
        expect(selected.querySelector('svg.mini-source-choice-check')).not.toBeNull();

        const bulk = host.querySelector('[data-mini-action="use-day-source"][data-mini-device-id="mini-b"]');
        expect(bulk).not.toBeNull();
        bulk.click(); await wait();
        expect(modal.multiDayResolver.getDayState('2026-09-08').status).toBe('mini_day_ready');
        expect(modal.multiDayResolver.getDayState('2026-09-08').items.every(item => item.resolutionSource?.deviceId === 'mini-b')).toBe(true);
        const selectedButtons = [...host.querySelectorAll('[data-mini-action="resolve-hours"].is-selected')];
        expect(selectedButtons).toHaveLength(2);
        expect(selectedButtons.every(button => button.textContent.includes('mini-b'))).toBe(true);
    });

    test('footer can save a day pending or confirm it and continue to the next day', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const a = '88888888-8888-4888-8888-888888888888';
        const b = '99999999-9999-4999-8999-999999999999';
        await inbox.importSubmission(buildSubmission({ id: a, workDate: '2026-09-06', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
        ] }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({ id: b, workDate: '2026-09-07', deviceId: 'mini-a', rows: [
            { miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click(); host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 2');

        const pending = host.querySelector('[data-mini-action="leave-mini-day-pending"]');
        expect(pending).not.toBeNull();
        pending.click(); await wait();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(modal.multiDayResolver.getDayState('2026-09-06').status).toBe('mini_day_ready');

        const confirmLast = host.querySelector('[data-mini-action="complete-mini-day"]');
        expect(confirmLast.textContent).toContain('Confirmar día');
        confirmLast.click(); await wait();
        expect(modal.multiDayResolver.getDayState('2026-09-07').status).toBe('mini_day_completed');
        expect(modal.multiDayResolver.getDayState('2026-09-06').status).toBe('mini_day_ready');
    });


    test('hides zero summary badges and keeps footer actions concise and ordered', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        await inbox.importSubmission(buildSubmission({ id, workDate: '2026-09-11', deviceId: 'mini-a', rows: [
            { miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
        ] }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click(); await modal.consolidateSelectedDrafts();

        const miniBadges = [...host.querySelectorAll('.mini-consolidation-summary-badges .mini-badge')].map(el => el.textContent);
        expect(miniBadges).toContain('Total: 1');
        expect(miniBadges).toContain('Resueltos: 1');
        expect(miniBadges.some(text => text.startsWith('Conflictos entre Minis:'))).toBe(false);
        expect(miniBadges.some(text => text.startsWith('Identidades no resueltas:'))).toBe(false);
        expect(miniBadges.some(text => text.startsWith('Días revisados:'))).toBe(false);

        let footerLabels = [...host.querySelectorAll('[data-mini-batch-actions] button')].map(button => button.textContent.trim());
        expect(footerLabels).toEqual(['Anterior', 'Siguiente', 'Pendiente', 'Confirmar día', 'Descartar', 'Crear consolidado']);

        host.querySelector('[data-mini-action="complete-mini-day"]').click(); await wait();
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click(); await wait();

        const saBadges = [...host.querySelectorAll('.mini-consolidation-summary-badges .mini-badge')].map(el => el.textContent);
        expect(saBadges).toContain('Días listos: 1');
        expect(saBadges.some(text => text.startsWith('Días aplicados:'))).toBe(false);
        footerLabels = [...host.querySelectorAll('[data-mini-batch-actions] button')].map(button => button.textContent.trim());
        expect(footerLabels).toEqual(['Anterior', 'Siguiente', 'Aplicar listos', 'Finalizar']);
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
