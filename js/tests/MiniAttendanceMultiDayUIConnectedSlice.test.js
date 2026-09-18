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
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Listo para confirmar');
        expect(host.querySelector('[data-mini-day-date="2026-09-07"]')).toBeNull();
        expect(appliedPlans).toHaveLength(0);

        host.querySelector('[data-mini-action="complete-mini-day"]').click();
        await wait();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(host.querySelector('[data-mini-day-date="2026-09-07"]').textContent).toBe('Identidad no resuelta');

        // Simulate closing/reopening before resolving day 2.
        const modal2Host = document.createElement('div'); document.body.replaceChildren(modal2Host);
        const modal2 = makeModal({ db, employees, positions, attendance, applyPlan });
        modal2.mount(modal2Host); await modal2.setImportMode('connected'); await modal2.openConnectedInbox();
        expect(modal2Host.querySelector('[data-mini-resume-consolidation]')).not.toBeNull();
        await modal2.resumeConsolidation();
        expect(modal2.connectedView).toBe('consolidation');
        expect(modal2Host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(modal2Host.querySelector('[data-mini-day-date="2026-09-07"]').textContent).toBe('Identidad no resuelta');
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
        expect(host.querySelector('[data-mini-day-date="2026-09-06"]').textContent).toBe('Listo para aplicar');
        const conflict = host.querySelector('[data-mini-sa-conflict="EMP-001"]');
        expect(conflict).not.toBeNull();
        expect(conflict.querySelector('[data-mini-action="keep-sa"]').textContent).toBe('Conservar actual');
        expect(conflict.querySelector('[data-mini-action="keep-sa"]').getAttribute('aria-pressed')).toBe('true');
        expect(conflict.querySelector('[data-mini-action="use-imported"]').getAttribute('aria-pressed')).toBe('false');
        expect(conflict.querySelector('[data-mini-sa-compare]')?.textContent).toContain('Mini');
        expect(conflict.querySelector('[data-mini-sa-compare]')?.textContent).toContain('Actual');
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
        ] }), { expectedSaProjectId: SA_PROJECT, metadata: { sourcePeerName: 'Mini Cuadrilla B' } });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${a}"]`).click(); host.querySelector(`[data-mini-draft-checkbox="${b}"]`).click();
        await modal.consolidateSelectedDrafts();

        const firstMiniB = [...host.querySelectorAll('[data-mini-action="resolve-hours"]')]
            .find(button => button.textContent.includes('Mini Cuadrilla B'));
        expect(firstMiniB).toBeDefined();
        firstMiniB.click(); await wait();
        const selected = host.querySelector('[data-mini-action="resolve-hours"].is-selected[aria-pressed="true"]');
        expect(selected).not.toBeNull();
        expect(selected.textContent).toContain('Mini Cuadrilla B');
        expect(selected.querySelector('svg.mini-source-choice-check')).not.toBeNull();

        const bulk = host.querySelector('[data-mini-action="use-day-source"][data-mini-device-id="mini-b"]');
        expect(bulk).not.toBeNull();
        bulk.click(); await wait();
        expect(modal.multiDayResolver.getDayState('2026-09-08').status).toBe('mini_day_ready');
        expect(modal.multiDayResolver.getDayState('2026-09-08').items.every(item => item.resolutionSource?.deviceId === 'mini-b')).toBe(true);
        const selectedButtons = [...host.querySelectorAll('[data-mini-action="resolve-hours"].is-selected')];
        expect(selectedButtons).toHaveLength(2);
        expect(selectedButtons.every(button => button.textContent.includes('Mini Cuadrilla B'))).toBe(true);
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

    test('single Mini is presented as review, offers ignore before SA and orders link candidates numerically', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-12', deviceId: 'mini-a', sourceId: 'mini-source-a',
            rows: [{ miniLocalId: 'm600', number: '600', name: 'Kk', normalHours: 8, overtimeHours: 0, status: 'present' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const reversedEmployees = [employees[2], employees[0], employees[1]];
        const confirmIgnore = jest.fn(async () => true);
        const modal = makeModal({
            db, employees: reversedEmployees, positions, attendance, applyPlan, confirmIgnore
        });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();

        expect(host.querySelector('.mini-import-topbar-subtitle').textContent).toBe('Revisar asistencia · Día 1 de 1');
        expect(host.querySelector('.mini-import-topbar-chip').textContent).toBe('REVISAR');
        expect(host.querySelector('[data-mini-day-date="2026-09-12"]').textContent).toBe('Identidad no resuelta');
        expect(host.textContent).not.toContain('Conflicto entre Minis');

        const select = host.querySelector('[data-mini-select-employee]');
        expect([...select.options].slice(1).map(option => option.textContent)).toEqual([
            '#001 Ana Pérez', '#002 Carlos Gómez', '#003 David López'
        ]);
        const ignore = host.querySelector('[data-mini-action="ignore-consolidated-attendance"]');
        expect(ignore).not.toBeNull();
        ignore.click(); await wait();

        expect(confirmIgnore).toHaveBeenCalledTimes(1);
        expect(modal.multiDayResolver.getDayState('2026-09-12').items).toHaveLength(0);
        expect(modal.multiDayResolver.items[0].excluded).toBe(true);
        expect(modal.activeConsolidationRecord.items[0].excluded).toBe(true);
    });

    test('shows a ranked employee suggestion by number/name and links it only after user confirmation', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const id = 'abababab-abab-4bab-8bab-abababababab';
        const suggestionEmployees = [
            ...employees,
            { id: 'EMP-600', number: '600', name: 'Kevin King', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
            { id: 'EMP-601', number: '601', name: 'Karla King', active: true, positions: ['pos-1'], projectId: SA_PROJECT }
        ];
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-12', deviceId: 'mini-a', sourceId: 'mini-source-a',
            rows: [{ miniLocalId: 'm600-suggest', number: '600', name: 'Kevín King', normalHours: 8, overtimeHours: 0, status: 'present' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const aliasStore = {
            lookup: jest.fn(async () => ({ status: 'missing', alias: null, employee: null })),
            record: jest.fn(async input => ({ status: 'remembered', ...input }))
        };
        const modal = makeModal({
            db, employees: suggestionEmployees, positions, attendance, applyPlan,
            aliasStore, actorUid: 'owner-sa'
        });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();

        const topSuggestion = host.querySelector('[data-mini-identity-suggestion="EMP-600"]');
        expect(topSuggestion).not.toBeNull();
        expect(topSuggestion.textContent).toContain('#600 · Kevin King');
        expect(topSuggestion.textContent).toContain('Coincidencia alta');
        expect(topSuggestion.textContent).toContain('Número exacto');
        expect(topSuggestion.textContent).toContain('Nombre exacto');
        expect(modal.multiDayResolver.items[0].saEmployeeId).toBeNull();

        topSuggestion.querySelector('[data-mini-action="use-identity-suggestion"]').click();
        await wait();

        expect(modal.multiDayResolver.items[0].saEmployeeId).toBe('EMP-600');
        expect(aliasStore.record).toHaveBeenCalledTimes(1);
    });

    test('one identity link resolves every day from the same Mini and is reused on a future import', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const first = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const second = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        for (const [id, workDate, localId] of [
            [first, '2026-09-13', 'm600-a'],
            [second, '2026-09-14', 'm600-b']
        ]) {
            await inbox.importSubmission(buildSubmission({
                id, workDate, deviceId: 'mini-a', sourceId: 'mini-source-a',
                rows: [{ miniLocalId: localId, number: '600', name: 'Kk', normalHours: 8, overtimeHours: 0, status: 'present' }]
            }), { expectedSaProjectId: SA_PROJECT });
        }

        const aliasStore = {
            lookup: jest.fn(async () => ({ status: 'missing', alias: null, employee: null })),
            record: jest.fn(async input => ({ status: 'remembered', ...input }))
        };
        const modal = makeModal({ db, employees, positions, attendance, applyPlan, aliasStore, actorUid: 'owner-sa' });
        modal.mount(host); await modal.setImportMode('connected'); await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${first}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${second}"]`).click();
        await modal.consolidateSelectedDrafts();

        const select = host.querySelector('[data-mini-select-employee]');
        select.value = 'EMP-002';
        select.dispatchEvent(new Event('change'));
        host.querySelector('[data-mini-action="resolve-identity"]').click();
        await wait();

        expect(modal.multiDayResolver.items.filter(item => !item.excluded)).toHaveLength(2);
        expect(modal.multiDayResolver.items.every(item => item.saEmployeeId === 'EMP-002')).toBe(true);
        expect(modal.multiDayResolver.getDayState('2026-09-13').status).toBe('mini_day_ready');
        expect(modal.multiDayResolver.getDayState('2026-09-14').status).toBe('mini_day_ready');
        expect(aliasStore.record).toHaveBeenCalledTimes(1);
        expect(aliasStore.record.mock.calls[0][0]).toMatchObject({
            scope: { ownerUid: 'owner-sa', siteId: SA_PROJECT, sourceId: 'source:mini-source-a|device:mini-a' },
            rawNumber: '600',
            rawName: 'Kk',
            targetEmployeeId: 'EMP-002'
        });

        const futureDb = new MemoryDB();
        const futureInbox = new AttendanceSubmissionInboxStore({ db: futureDb });
        const futureId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        await futureInbox.importSubmission(buildSubmission({
            id: futureId, workDate: '2026-09-15', deviceId: 'mini-a', sourceId: 'mini-source-a',
            rows: [{ miniLocalId: 'm600-c', number: '600', name: 'Kk', normalHours: 7, overtimeHours: 0, status: 'present' }]
        }), { expectedSaProjectId: SA_PROJECT });
        aliasStore.lookup.mockResolvedValue({
            status: 'remembered',
            employee: employees.find(employee => employee.id === 'EMP-002'),
            alias: { targetEmployeeId: 'EMP-002' }
        });

        const futureHost = document.createElement('div');
        document.body.replaceChildren(futureHost);
        const futureModal = makeModal({
            db: futureDb, employees, positions, attendance: {}, applyPlan, aliasStore, actorUid: 'owner-sa'
        });
        futureModal.mount(futureHost); await futureModal.setImportMode('connected'); await futureModal.openConnectedInbox();
        futureHost.querySelector(`[data-mini-draft-checkbox="${futureId}"]`).click();
        await futureModal.consolidateSelectedDrafts();

        expect(aliasStore.lookup).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: { ownerUid: 'owner-sa', siteId: SA_PROJECT, sourceId: 'source:mini-source-a|device:mini-a' },
            rawNumber: '600',
            rawName: 'Kk'
        }));
        expect(futureModal.multiDayResolver.items[0].saEmployeeId).toBe('EMP-002');
        expect(futureModal.multiDayResolver.getDayState('2026-09-15').status).toBe('mini_day_ready');
        expect(futureHost.querySelector('[data-mini-unresolved-identity]')).toBeNull();
        expect(futureHost.querySelector('[data-mini-day-date="2026-09-15"]').textContent).toBe('Listo para confirmar');
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
        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Listo para confirmar');
        expect(host.querySelector('[data-mini-select-position="EMP-003"]')).toBeNull();
        host.querySelector('[data-mini-action="complete-mini-day"]').click(); await wait();
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click(); await wait();
        expect(host.querySelector('[data-mini-day-date="2026-09-09"]').textContent).toBe('Cambio por revisar');
        const select = host.querySelector('[data-mini-select-position="EMP-003"]');
        const assign = host.querySelector('[data-mini-action="resolve-position"][data-mini-employee-id="EMP-003"]');
        expect(select).not.toBeNull(); expect(assign.disabled).toBe(true);
        select.value = 'pos-2'; select.dispatchEvent(new Event('change'));
        expect(assign.disabled).toBe(false); assign.click();
        expect(modal.multiDayResolver.buildDayApplyPlan('2026-09-09').writes[0].record.selectedPosition).toBe('pos-2');
    });
});
