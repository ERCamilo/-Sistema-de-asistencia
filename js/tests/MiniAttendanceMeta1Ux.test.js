import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceConsolidationStore } from '../modules/services/MiniAttendanceConsolidationStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { createMultiDayAttendanceResolver } from '../modules/features/attendance/MultiDayAttendanceResolver.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key); }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.store(name).set(value.key ?? value.submissionId, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const SA_PROJECT = 'PRJ-META1-UX';
const SA_SCOPE = Object.freeze({ enabled: true, projectId: SA_PROJECT, defaultProjectId: SA_PROJECT });
const wait = () => new Promise(resolve => setTimeout(resolve, 15));

function buildSubmission({ id, workDate, deviceId = 'tech-device-1', sourceId = 'tech-source-1', rows = [] }) {
    return {
        schema: 'attendance-submission/v1', submissionId: id, saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId }, deviceId,
        rosterVersion: 'roster-1', capturedAt: '2026-09-10T12:00:00.000Z', workDate, rows
    };
}

function makeModal({ db, employees, positions, attendance, applyPlan, linkedMinis = [] }) {
    return new MiniAttendanceImportModal({
        saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
        inboxStore: new AttendanceSubmissionInboxStore({ db }),
        consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
        employees, positions, attendance, applyPlan, importMode: 'connected',
        linkedMinis
    });
}

function baseFixtures() {
    const positions = [{ id: 'pos-1', name: 'Albañil' }];
    const employees = [
        { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'], projectId: SA_PROJECT },
        { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'], projectId: SA_PROJECT }
    ];
    const attendance = {};
    const applyPlan = jest.fn(async plan => ({
        date: plan.date, appliedCount: plan.writes.length,
        writtenKeys: plan.writes.map(w => w.key), keptCount: plan.keptKeys.length, keptKeys: [...plan.keptKeys]
    }));
    return { positions, employees, attendance, applyPlan };
}

describe('Meta1 UX — technical Detalles popup (no inline <details>)', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    test('connected flow uses compact Detalles trigger opening an in-modal popup; IDs never primary', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id = '11111111-1111-4111-8111-111111111111';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-06', deviceId: 'tech-device-uuid-aaa', sourceId: 'tech-source-uuid-bbb',
            rows: [{ miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), {
            expectedSaProjectId: SA_PROJECT,
            metadata: { sourcePeerName: 'Mini Norte', sourcePeerId: 'tech-peer-uuid-zzz' }
        });

        const linkedMinis = [{ id: 'mini-1', deviceId: 'tech-device-uuid-aaa', peerId: 'tech-peer-uuid-zzz', name: 'Mini Norte', alias: 'Norte' }];
        const modal = makeModal({ db, employees, positions, attendance, applyPlan, linkedMinis });
        modal.mount(host);
        await modal.setImportMode('connected');

        // No large inline technical <details> in connected flow.
        expect(host.querySelector('details.mini-technical-details')).toBeNull();

        // Linked Mini selection: human primary, technical only in popup.
        const selector = host.querySelector('[data-mini-connected-selector]');
        expect(selector).not.toBeNull();
        const optionTexts = [...selector.querySelectorAll('option')].map(o => o.textContent);
        expect(optionTexts.some(t => t.includes('Mini Norte'))).toBe(true);
        expect(optionTexts.some(t => t.includes('tech-device-uuid-aaa'))).toBe(false);

        const linkedTrigger = host.querySelector('[data-mini-connected-selection] [data-mini-technical-trigger]');
        expect(linkedTrigger).not.toBeNull();
        expect(linkedTrigger.textContent).toBe('Detalles');
        expect(linkedTrigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(linkedTrigger.getAttribute('aria-expanded')).toBe('false');
        // Technical IDs hidden until popup opens.
        expect(host.querySelector('[data-mini-technical-popup]')).toBeNull();
        linkedTrigger.click();
        const linkedPopup = host.querySelector('[data-mini-technical-popup]');
        expect(linkedPopup).not.toBeNull();
        expect(linkedPopup.getAttribute('role')).toBe('dialog');
        expect(linkedPopup.textContent).toContain('tech-device-uuid-aaa');
        expect(linkedTrigger.getAttribute('aria-expanded')).toBe('true');
        // Close returns focus to trigger.
        host.querySelector('[data-mini-technical-close]').click();
        expect(host.querySelector('[data-mini-technical-popup]')).toBeNull();
        expect(document.activeElement).toBe(linkedTrigger);

        await modal.openConnectedInbox();

        // Draft card: human primary, Detalles trigger opens popup with IDs.
        const draftSource = host.querySelector('.mini-import-draft-source');
        expect(draftSource.textContent).toContain('Mini Norte');
        expect(draftSource.textContent).not.toContain('tech-device-uuid-aaa');
        expect(host.querySelector('[data-mini-draft-item] details')).toBeNull();
        const draftTrigger = host.querySelector('[data-mini-draft-item] [data-mini-technical-trigger]');
        expect(draftTrigger).not.toBeNull();
        expect(draftTrigger.getAttribute('aria-haspopup')).toBe('dialog');
        draftTrigger.click();
        const draftPopup = host.querySelector('[data-mini-technical-popup]');
        expect(draftPopup).not.toBeNull();
        expect(draftPopup.getAttribute('role')).toBe('dialog');
        expect(draftPopup.textContent).toContain(id);
        expect(draftPopup.textContent).toContain('tech-device-uuid-aaa');
        // Escape closes and returns focus.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(host.querySelector('[data-mini-technical-popup]')).toBeNull();

        // Consolidation row: primary never shows technical IDs.
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();
        const rowEl = host.querySelector('[data-mini-consolidation-item]');
        expect(rowEl).not.toBeNull();
        expect(rowEl.querySelector('details')).toBeNull();
        const rowTrigger = rowEl.querySelector('[data-mini-technical-trigger]');
        expect(rowTrigger).not.toBeNull();
        const primaryTexts = [...rowEl.querySelectorAll('.mini-row-name, .mini-row-number, .mini-row-hours, .mini-row-status, .mini-row-provenance')]
            .map(el => el.textContent);
        expect(primaryTexts.some(t => t.includes('EMP-001'))).toBe(false);
        expect(primaryTexts.some(t => t.includes('tech-device-uuid-aaa'))).toBe(false);
        rowTrigger.click();
        const rowPopup = host.querySelector('[data-mini-technical-popup]');
        expect(rowPopup.textContent).toContain('EMP-001');
        expect(rowPopup.textContent).toContain('tech-device-uuid-aaa');
        // Popup lives inside the modal content (in-modal overlay).
        expect(rowPopup.closest('.mini-attendance-import')).not.toBeNull();
    });
});

describe('Hotfix UX — ignorar asistencia en comparación Mini→SA', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    test('shows an explicit ignore action for a new Mini attendance and excludes it after confirmation', async () => {
        const db = new MemoryDB();
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const confirmIgnore = jest.fn(async () => true);
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
            inboxStore: new AttendanceSubmissionInboxStore({ db }),
            consolidationStore: new MiniAttendanceConsolidationStore({ db, now: () => 1000 }),
            employees, positions, attendance, applyPlan, importMode: 'connected', confirmIgnore
        });
        const consolidation = {
            saProjectId: SA_PROJECT, workDates: ['2026-09-06'], devices: [], contributingSubmissions: [],
            summary: { totalItems: 1, resolvedCount: 1, hoursConflictCount: 0, unresolvedIdentityCount: 0, submissionsCount: 1 },
            items: [{
                id: 'ignore-hotfix-row', saProjectId: SA_PROJECT, saEmployeeId: 'EMP-001', workDate: '2026-09-06',
                status: 'resolved', sourceStatus: 'present', rosterStatus: 'active', displayNumber: '001', displayName: 'Ana Pérez',
                normalHours: 8, overtimeHours: 0, totalHours: 8, sources: []
            }]
        };
        modal.mount(host);
        modal.consolidatedResult = consolidation;
        modal.multiDayResolver = createMultiDayAttendanceResolver({
            consolidation, employees, attendance, positions, saProjectId: SA_PROJECT, entityScope: SA_SCOPE,
            stage: 'sa', applyPlan
        });
        modal.connectedView = 'sa-comparison';
        modal.consolidationDayIndex = 0;
        modal.render();

        const ignore = host.querySelector('[data-mini-action="ignore-consolidated-attendance"]');
        expect(ignore).not.toBeNull();
        expect(ignore.textContent).toBe('Ignorar esta asistencia');
        expect(modal.multiDayResolver.getDayState('2026-09-06').applyPlan.writes).toHaveLength(1);

        ignore.click();
        await wait();
        expect(confirmIgnore).toHaveBeenCalledTimes(1);
        expect(modal.multiDayResolver.getDayState('2026-09-06').items).toHaveLength(0);
        expect(modal.multiDayResolver.getDayState('2026-09-06').applyPlan.writes).toHaveLength(0);
        expect(host.querySelector('[data-mini-consolidation-item="ignore-hotfix-row"]')).toBeNull();
    });
});

describe('Meta1 UX — sticky centered work date in consolidation topbar', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    test('consolidation/comparison shows current work date centered and sticky with day X/N', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id1 = '44444444-4444-4444-8444-444444444444';
        const id2 = '55555555-5555-4555-8555-555555555555';
        await inbox.importSubmission(buildSubmission({
            id: id1, workDate: '2026-09-06', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({
            id: id2, workDate: '2026-09-07', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'a2', number: '002', name: 'Carlos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${id2}"]`).click();
        await modal.consolidateSelectedDrafts();

        const topbar = host.querySelector('.mini-import-topbar');
        expect(topbar).not.toBeNull();
        const center = host.querySelector('[data-mini-topbar-workdate]');
        expect(center).not.toBeNull();
        expect(center.closest('.mini-import-topbar')).toBe(topbar);
        expect(center.getAttribute('role')).toBe('status');
        // Current work date centered (formatted DD/MM/YYYY) + day position.
        expect(host.querySelector('[data-mini-topbar-date]').textContent).toBe('06/09/2026');
        expect(host.querySelector('[data-mini-topbar-day]').textContent).toBe('Día 1 de 2');
        expect(center.getAttribute('aria-label')).toContain('06/09/2026');
        // Day X/N without competing generic step signals.
        expect(host.querySelector('.mini-import-topbar-subtitle').textContent).toBe('Comparar con SA · Día 1 de 2');
        expect(host.querySelector('.mini-import-topbar-step').textContent).toBe('Día 1 de 2');
        expect(host.querySelector('.mini-import-topbar-subtitle').textContent).not.toContain('Paso 3');
        const progress = host.querySelector('.mini-import-progress-bar');
        expect(progress).not.toBeNull();
        expect(progress.getAttribute('aria-valuenow')).toBe('1');
        expect(progress.getAttribute('aria-valuemax')).toBe('2');

        // Advancing keeps the sticky header centered on the new date.
        host.querySelector('[data-mini-action="next-consolidation-day"]').click();
        await wait();
        expect(host.querySelector('[data-mini-topbar-date]').textContent).toBe('07/09/2026');
        expect(host.querySelector('[data-mini-topbar-day]').textContent).toBe('Día 2 de 2');
        expect(host.querySelector('[data-mini-topbar-workdate]').closest('.mini-import-topbar')).not.toBeNull();
    });
});

describe('Meta1 UX — consolidation footer zones and button hierarchy', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    test('footer separates nav / day decision / global with distinct primary-secondary-danger', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const id2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-11', deviceId: 'mini-a', sourceId: 'mini-a',
            rows: [{ miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });
        await inbox.importSubmission(buildSubmission({
            id: id2, workDate: '2026-09-11', deviceId: 'mini-b', sourceId: 'mini-b',
            rows: [{ miniLocalId: 'm2', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${id2}"]`).click();
        await modal.consolidateSelectedDrafts();

        const footer = host.querySelector('[data-mini-batch-actions]');
        expect(footer).not.toBeNull();
        const nav = host.querySelector('[data-mini-footer-nav]');
        const decision = host.querySelector('[data-mini-footer-decision]');
        const global = host.querySelector('[data-mini-footer-global]');
        expect(nav).not.toBeNull();
        expect(decision).not.toBeNull();
        expect(global).not.toBeNull();
        // Zones are in order: navigation, decision, global.
        expect(footer.contains(nav)).toBe(true);
        expect(footer.contains(decision)).toBe(true);
        expect(footer.contains(global)).toBe(true);
        const order = [...footer.querySelectorAll('[data-mini-footer-nav], [data-mini-footer-decision], [data-mini-footer-global]')];
        expect(order).toEqual([nav, decision, global]);
        expect(nav.getAttribute('role')).toBe('group');
        expect(decision.getAttribute('role')).toBe('group');
        expect(global.getAttribute('role')).toBe('group');

        // Button order preserved within zones.
        const labels = [...footer.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\d+$/, '').trim());
        expect(labels).toEqual(['Anterior', 'Siguiente', 'Pendiente', 'Confirmar día', 'Descartar', 'Crear consolidado']);

        // Primary vs secondary/danger visually distinct.
        expect(host.querySelector('[data-mini-action="complete-mini-day"]').classList.contains('mini-import-action-primary')).toBe(true);
        expect(host.querySelector('[data-mini-action="create-mini-consolidated"]').classList.contains('mini-import-action-primary')).toBe(true);
        expect(host.querySelector('[data-mini-action="previous-consolidation-day"]').classList.contains('mini-import-action-secondary')).toBe(true);
        expect(host.querySelector('[data-mini-action="leave-mini-day-pending"]').classList.contains('mini-import-action-secondary')).toBe(true);
        const discard = host.querySelector('[data-mini-action="discard-active-consolidation"]');
        expect(discard.classList.contains('mini-import-action-danger')).toBe(true);
        expect(discard.classList.contains('mini-import-action-primary')).toBe(false);

        // No native dialogs in footer actions.
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
        const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
        host.querySelector('[data-mini-action="next-consolidation-day"]').click();
        expect(alertSpy).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
        confirmSpy.mockRestore();

        // SA stage keeps nav + global separation.
        host.querySelector('[data-mini-action="complete-mini-day"]').click();
        await wait();
        host.querySelector('[data-mini-action="create-mini-consolidated"]').click();
        await wait();
        expect(modal.connectedView).toBe('sa-comparison');
        expect(host.querySelector('[data-mini-footer-nav]')).not.toBeNull();
        expect(host.querySelector('[data-mini-footer-global]')).not.toBeNull();
        const saLabels = [...host.querySelectorAll('[data-mini-batch-actions] button')].map(b => b.textContent.trim());
        expect(saLabels).toEqual(['Anterior', 'Siguiente', 'Aplicar listos', 'Finalizar']);
    });
});

describe('Meta1 UX — numeric count badge (no parenthetical counters)', () => {
    let host;
    beforeEach(() => { host = document.createElement('div'); document.body.replaceChildren(host); });
    afterEach(() => document.body.replaceChildren());

    test('action counters use a compact badge element hidden at zero', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-06', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan, linkedMinis: [] });
        modal.mount(host);
        await modal.setImportMode('connected');

        // Revisar borradores: no "(N)", badge conveys count.
        const openInbox = host.querySelector('[data-mini-action="open-connected-inbox"]');
        expect(openInbox).not.toBeNull();
        expect(openInbox.textContent).toContain('Revisar borradores');
        expect(openInbox.textContent).not.toContain('(1)');
        expect(openInbox.textContent).not.toMatch(/\(\d+\)/);
        const inboxBadge = openInbox.querySelector('[data-mini-count-badge]');
        expect(inboxBadge).not.toBeNull();
        expect(inboxBadge.textContent).toBe('1');
        expect(inboxBadge.getAttribute('aria-label')).toContain('1');
        expect(inboxBadge.hidden).toBe(false);
        expect(inboxBadge.textContent).not.toMatch(/\(|\)/);

        await modal.openConnectedInbox();

        // Consolidar selecciones: badge hidden at zero, shown when selected.
        const consolidate = host.querySelector('[data-mini-action="consolidate-drafts"]');
        expect(consolidate.textContent).toContain('Consolidar selecciones');
        expect(consolidate.textContent).not.toMatch(/\(\d+\)/);
        const zeroBadge = consolidate.querySelector('[data-mini-count-badge]');
        expect(zeroBadge).not.toBeNull();
        expect(zeroBadge.textContent).toBe('0');
        expect(zeroBadge.hidden).toBe(true);
        expect(zeroBadge.getAttribute('aria-label')).toContain('0');

        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        const selectedConsolidate = host.querySelector('[data-mini-action="consolidate-drafts"]');
        const selectedBadge = selectedConsolidate.querySelector('[data-mini-count-badge]');
        expect(selectedBadge.textContent).toBe('1');
        expect(selectedBadge.hidden).toBe(false);
        expect(selectedConsolidate.textContent).not.toMatch(/\(\d+\)/);
    });

    test('empty inbox hides the badge instead of showing (0)', async () => {
        const db = new MemoryDB();
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        const openInbox = host.querySelector('[data-mini-action="open-connected-inbox"]');
        expect(openInbox.textContent).not.toMatch(/\(\d+\)/);
        const badge = openInbox.querySelector('[data-mini-count-badge]');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('0');
        expect(badge.hidden).toBe(true);
    });
});
