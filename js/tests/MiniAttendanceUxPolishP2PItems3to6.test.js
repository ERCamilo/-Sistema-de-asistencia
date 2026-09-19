import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';
import { MiniAttendanceConsolidationStore } from '../modules/services/MiniAttendanceConsolidationStore.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { consolidateAttendanceSubmissions } from '../modules/features/attendance/AttendanceConsolidation.js';

class MemoryDB {
    constructor() { this.stores = new Map(); }
    store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
    async get(name, key) { return this.store(name).get(key); }
    async getAll(name) { return [...this.store(name).values()]; }
    async update(name, value) { this.store(name).set(value.key ?? value.submissionId, JSON.parse(JSON.stringify(value))); }
    async delete(name, key) { this.store(name).delete(key); }
}

const SA_PROJECT = 'PRJ-UX-POLISH';
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

describe('P2P UX polish items 3-6 — attendance connected flow', () => {
    let host;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });
    afterEach(() => document.body.replaceChildren());

    test('(3) technical IDs are not primary UI; human identity is primary with Detalles popup for audit', async () => {
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

        // Selector (request view) shows human alias/name, not raw technical IDs.
        const selector = host.querySelector('[data-mini-connected-selector]');
        expect(selector).not.toBeNull();
        const optionTexts = [...selector.querySelectorAll('option')].map(o => o.textContent);
        expect(optionTexts.some(t => t.includes('Mini Norte'))).toBe(true);
        expect(optionTexts.some(t => t.includes('tech-device-uuid-aaa'))).toBe(false);
        expect(optionTexts.some(t => t.includes('tech-peer-uuid-zzz'))).toBe(false);
        // Meta1: compact Detalles trigger opens an in-modal popup (no inline <details>).
        expect(host.querySelector('[data-mini-connected-selection] details.mini-technical-details')).toBeNull();
        const linkedTrigger = host.querySelector('[data-mini-connected-selection] [data-mini-technical-trigger]');
        expect(linkedTrigger).not.toBeNull();
        expect(linkedTrigger.textContent).toBe('Detalles');
        expect(linkedTrigger.getAttribute('aria-haspopup')).toBe('dialog');
        linkedTrigger.click();
        const linkedPopup = host.querySelector('[data-mini-technical-popup]');
        expect(linkedPopup).not.toBeNull();
        expect(linkedPopup.getAttribute('role')).toBe('dialog');
        expect(linkedPopup.textContent).toContain('tech-device-uuid-aaa');
        host.querySelector('[data-mini-technical-close]').click();

        await modal.openConnectedInbox();

        // Draft primary shows human Mini name; technical IDs live in Detalles popup.
        const draftSource = host.querySelector('.mini-import-draft-source');
        expect(draftSource).not.toBeNull();
        expect(draftSource.textContent).toContain('Mini Norte');
        expect(draftSource.textContent).not.toContain('tech-device-uuid-aaa');
        expect(host.querySelector('[data-mini-draft-item] details')).toBeNull();
        const draftTrigger = host.querySelector('[data-mini-draft-item] [data-mini-technical-trigger]');
        expect(draftTrigger).not.toBeNull();
        expect(draftTrigger.textContent).toBe('Detalles');
        draftTrigger.click();
        const draftPopup = host.querySelector('[data-mini-technical-popup]');
        expect(draftPopup).not.toBeNull();
        expect(draftPopup.textContent).toContain(id);
        expect(draftPopup.textContent).toContain('tech-device-uuid-aaa');
        host.querySelector('[data-mini-technical-close]').click();

        // Consolidate and check row primary identity is employee # + name with human Mini provenance.
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();
        const rowName = host.querySelector('[data-mini-consolidation-item] .mini-row-name');
        const rowNumber = host.querySelector('[data-mini-consolidation-item] .mini-row-number');
        expect(rowName.textContent).toContain('Ana');
        expect(rowNumber.textContent).toContain('#001');
        const provenance = host.querySelector('[data-mini-source-provenance]');
        expect(provenance).not.toBeNull();
        expect(provenance.textContent).toContain('Mini Norte');
        expect(provenance.textContent).not.toContain('tech-device-uuid-aaa');
        expect(host.querySelector('[data-mini-consolidation-item] details.mini-technical-details')).toBeNull();
        const rowTrigger = host.querySelector('[data-mini-consolidation-item] [data-mini-technical-trigger]');
        expect(rowTrigger).not.toBeNull();
        expect(rowTrigger.textContent).toBe('Detalles');
        // saEmployeeId must not be primary visible text when human label exists.
        // It may only appear inside the optional Detalles popup.
        const rowEl = host.querySelector('[data-mini-consolidation-item]');
        const primaryTexts = [...rowEl.querySelectorAll('.mini-row-name, .mini-row-number, .mini-row-hours, .mini-row-status, .mini-row-provenance')]
            .map(el => el.textContent);
        expect(primaryTexts.some(t => t.includes('EMP-001'))).toBe(false);
        rowTrigger.click();
        const rowPopup = host.querySelector('[data-mini-technical-popup]');
        expect(rowPopup).not.toBeNull();
        expect(rowPopup.textContent).toContain('tech-device-uuid-aaa');
        expect(rowPopup.textContent).toContain('EMP-001');

        // Data/contracts still preserve identifiers (no removal).
        expect(modal.consolidatedResult.items[0].saEmployeeId).toBe('EMP-001');
        expect(modal.consolidatedResult.items[0].sources[0].submissionId).toBe(id);
        expect(modal.consolidatedResult.items[0].sources[0].deviceId).toBe('tech-device-uuid-aaa');
    });

    test('(4) user-facing vocabulary is standardized: Transferir / Consolidar / Comparar / Aplicar / Importación', async () => {
        const db = new MemoryDB();
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const modal = makeModal({
            db, employees, positions, attendance, applyPlan,
            linkedMinis: [{ id: 'mini-1', deviceId: 'dev-1', name: 'Mini Norte', alias: 'Norte' }]
        });
        modal.mount(host);
        await modal.setImportMode('connected');

        // Request = Transferir (device movement), never Solicitar.
        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        expect(fetchBtn.textContent).toContain('Transferir');
        expect(fetchBtn.textContent).not.toContain('Solicitar');
        expect(host.querySelector('.mini-import-topbar-subtitle').textContent).toContain('Transferir');
        expect(host.querySelector('.mini-import-topbar-chip').textContent).toBe('TRANSFERIR');
        expect(modal.getStateLabel('requesting')).toBe('Transfiriendo…');
        const backToRequest = host.querySelector('[data-mini-action="open-connected-inbox"]');
        expect(backToRequest).not.toBeNull();

        await modal.openConnectedInbox();
        const inboxHint = host.querySelector('.mini-import-connected-nav .mini-import-hint').textContent;
        expect(inboxHint).toContain('aplica');
        expect(inboxHint).toContain('consolidar');
        expect(inboxHint).toContain('comparar');
        expect(inboxHint).not.toContain('conciliación');
        expect(inboxHint).not.toContain('se escribe');

        // Single-Mini stage = Revisar, multi-Mini stage = Consolidar; SA = Comparar; writes = Aplicar.
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const draftId = '22222222-2222-4222-8222-222222222222';
        await inbox.importSubmission(buildSubmission({
            id: draftId, workDate: '2026-09-06', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });
        modal.savedDrafts = await modal.inboxStore.list({ saProjectId: SA_PROJECT });
        modal.render();
        host.querySelector(`[data-mini-draft-checkbox="${draftId}"]`).click();
        await modal.consolidateSelectedDrafts();
        expect(modal.connectedView).toBe('sa-comparison');
        const miniBannerStrong = host.querySelector('[data-mini-proposal-seam] strong').textContent;
        const miniBannerCopy = host.querySelector('[data-mini-proposal-seam] p').textContent;
        expect(miniBannerStrong).toContain('Comparar con SA');
        expect(miniBannerCopy).toContain('consolidado Mini revisado');
        expect(miniBannerCopy).toContain('Nada se aplica');

        const saBannerStrong = host.querySelector('[data-mini-proposal-seam] strong').textContent;
        expect(saBannerStrong).toContain('Comparar con SA');
        const applyBtn = host.querySelector('[data-mini-action="apply-ready-days"]');
        expect(applyBtn.textContent).toContain('Aplicar');
        const saHint = host.querySelector('[data-mini-batch-actions] .mini-import-complete-hint').textContent;
        expect(saHint).toContain('Compara');
        expect(saHint).toContain('aplica');
        expect(saHint).toContain('importación');
    });

    test('(5) consolidation shell keeps one compact executive status; no duplicated counts or prose', async () => {
        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id = '33333333-3333-4333-8333-333333333333';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-11', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'm1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });

        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();

        const badges = host.querySelector('[data-mini-executive-status]');
        expect(badges).not.toBeNull();
        expect(badges.getAttribute('role')).toBe('status');
        const badgeTexts = [...badges.querySelectorAll('.mini-badge')].map(el => el.textContent);
        expect(badgeTexts).toContain('Total: 1');

        const banner = host.querySelector('[data-mini-proposal-seam]');
        expect(banner.textContent).not.toContain('Propuestas generadas');
        expect(banner.textContent).not.toContain('Listas:');
        expect(banner.textContent).not.toContain('Bloqueadas:');
        expect(banner.textContent).not.toContain('Total:');

        // Back navigation lives in the contextual footer; the old large top nav is gone.
        expect(host.querySelector('.mini-import-connected-nav')).toBeNull();
        const nav = host.querySelector('[data-mini-footer-nav]');
        expect(nav).not.toBeNull();
        expect(nav.querySelector('[data-mini-action="back-connected-inbox"]')).not.toBeNull();
        expect(nav.querySelector('p')).toBeNull();

        // Footer keeps only actionable hints, without repeating badge counts.
        const footerHint = host.querySelector('[data-mini-batch-actions] .mini-import-complete-hint');
        expect(footerHint).not.toBeNull();
        expect(footerHint.textContent).not.toContain('Total:');
        expect(footerHint.textContent).not.toContain('Propuestas generadas');
    });

    test('(6) progress skips single-Mini review when there are no exceptions and goes directly to Comparar', async () => {
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

        // Same overlay/shell is preserved.
        expect(host.querySelector('.mini-import-topbar')).not.toBeNull();
        expect(host.querySelector('.mini-import-progress-bar')).not.toBeNull();
        expect(host.querySelector('.mini-attendance-import').getAttribute('aria-live')).toBe('polite');

        // A single Mini without exceptions skips review and opens SA comparison directly.
        expect(modal.connectedView).toBe('sa-comparison');
        const saSubtitle = host.querySelector('.mini-import-topbar-subtitle').textContent;
        const saStep = host.querySelector('.mini-import-topbar-step').textContent;
        const saChip = host.querySelector('.mini-import-topbar-chip').textContent;
        expect(saSubtitle).toBe('Comparar con SA · Día 1 de 2');
        expect(saStep).toBe('Día 1 de 2');
        expect(saChip).toBe('COMPARAR');
        expect(saSubtitle).not.toContain('Paso 4');
        expect(saStep).not.toContain('4/4');
        const progress = host.querySelector('.mini-import-progress-bar');
        expect(progress.getAttribute('role')).toBe('progressbar');
        expect(progress.getAttribute('aria-valuenow')).toBe('1');
        expect(progress.getAttribute('aria-valuemax')).toBe('2');
        expect(progress.getAttribute('aria-label')).toBe('Comparar con SA · Día 1 de 2');
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 1 de 2');

        host.querySelector('[data-mini-action="next-consolidation-day"]').click();
        await wait();
        expect(host.querySelector('[data-mini-day-counter]').textContent).toBe('Día 2 de 2');
        expect(host.querySelector('.mini-import-topbar-subtitle').textContent).toBe('Comparar con SA · Día 2 de 2');
    });

    test('preserves numeric employee ordering and canonical safety (no SA writes before explicit Aplicar)', async () => {
        const ordered = consolidateAttendanceSubmissions([
            buildSubmission({
                id: '66666666-6666-4666-8666-666666666666', workDate: '2026-09-08', deviceId: 'mini-a',
                rows: [
                    { miniLocalId: 'm10', number: '010', name: 'Diez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-010' },
                    { miniLocalId: 'm2', number: '2', name: 'Dos', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' },
                    { miniLocalId: 'm1', number: '001', name: 'Uno', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
                ]
            })
        ]);
        expect(ordered.items.map(i => i.displayNumber)).toEqual(['001', '2', '010']);

        const db = new MemoryDB();
        const inbox = new AttendanceSubmissionInboxStore({ db });
        const { positions, employees, attendance, applyPlan } = baseFixtures();
        const id = '77777777-7777-4777-8777-777777777777';
        await inbox.importSubmission(buildSubmission({
            id, workDate: '2026-09-06', deviceId: 'mini-a',
            rows: [{ miniLocalId: 'a1', number: '001', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        }), { expectedSaProjectId: SA_PROJECT });
        const modal = makeModal({ db, employees, positions, attendance, applyPlan });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${id}"]`).click();
        await modal.consolidateSelectedDrafts();
        expect(applyPlan).not.toHaveBeenCalled();
        expect(attendance).toEqual({});
    });
});
