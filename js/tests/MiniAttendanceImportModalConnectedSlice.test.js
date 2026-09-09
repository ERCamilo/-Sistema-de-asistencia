import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { AttendanceSubmissionInboxStore } from '../modules/services/AttendanceSubmissionInboxStore.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
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
}

const SA_PROJECT = 'PRJ-OBRA-1';
const SUB_UUID_1 = '123e4567-e89b-42d3-a456-426614174001';
const SUB_UUID_2 = '123e4567-e89b-42d3-a456-426614174002';

function sampleSubmission(id = SUB_UUID_1, workDate = '2026-09-06') {
    return {
        schema: 'attendance-submission/v1',
        submissionId: id,
        saProjectId: SA_PROJECT,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-1' },
        deviceId: 'phone-1',
        rosterVersion: 'roster-1',
        capturedAt: '2026-09-07T12:00:00.000Z',
        workDate,
        rows: [
            {
                miniLocalId: 'm1',
                number: '001',
                name: 'Ana Pérez',
                normalHours: 8,
                overtimeHours: 0,
                status: 'present',
                saEmployeeId: 'EMP-001'
            }
        ]
    };
}

describe('MiniAttendanceImportModal — Conectados vs Pegar texto slice', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('initial UI offers the choice between Conectados and Pegar texto', () => {
        const modal = new MiniAttendanceImportModal({
            proposedDate: '2026-09-06',
            importMode: 'paste'
        });
        modal.mount(host);

        const modeTabs = host.querySelector('[data-mini-mode-tabs]');
        expect(modeTabs).not.toBeNull();

        const connectedBtn = host.querySelector('[data-mini-mode="connected"]');
        const pasteBtn = host.querySelector('[data-mini-mode="paste"]');
        expect(connectedBtn).not.toBeNull();
        expect(pasteBtn).not.toBeNull();
        expect(pasteBtn.classList.contains('is-active')).toBe(true);
        expect(connectedBtn.classList.contains('is-active')).toBe(false);

        // Pegar texto view is visible by default
        expect(host.querySelector('[data-mini-source]')).not.toBeNull();
    });

    test('switching to Conectados renders linked Mini selector, day/range controls, and draft list', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        await inboxStore.importSubmission(sampleSubmission(SUB_UUID_1, '2026-09-06'), { expectedSaProjectId: SA_PROJECT });

        const linkedMinis = [
            { id: 'mini-1', deviceId: 'phone-1', name: 'Mini Obra 1' }
        ];

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            inboxStore,
            linkedMinis,
            importMode: 'paste'
        });
        modal.mount(host);

        // Click on "Conectados" tab
        const connectedBtn = host.querySelector('[data-mini-mode="connected"]');
        connectedBtn.click();

        // Wait for async load of drafts if any
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(modal.importMode).toBe('connected');
        expect(host.querySelector('[data-mini-connected-selection]')).not.toBeNull();
        expect(host.querySelector('[data-mini-connected-selector]')).not.toBeNull();
        expect(host.querySelector('[data-mini-date-controls]')).not.toBeNull();
        expect(host.querySelector('[data-mini-saved-drafts]')).not.toBeNull();

        // Check linked Mini options
        const select = host.querySelector('[data-mini-connected-selector]');
        expect(select.options.length).toBeGreaterThan(1);
        expect(select.options[1].textContent).toContain('Mini Obra 1');

        // Check draft list
        const draftItem = host.querySelector(`[data-mini-draft-item="${SUB_UUID_1}"]`);
        expect(draftItem).not.toBeNull();
    });

    test('exposes clean callback/service seam for transport requests without touching P2PCore', () => {
        const onRequestSpy = jest.fn();
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        expect(fetchBtn).not.toBeNull();

        fetchBtn.click();
        expect(onRequestSpy).toHaveBeenCalledTimes(1);
        expect(onRequestSpy).toHaveBeenCalledWith(expect.objectContaining({
            date: '2026-09-06',
            groupingMode: 'day'
        }));
    });

    test('if transport callback is omitted, renders clean seam status notice without throwing', () => {
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected'
        });
        modal.mount(host);

        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        fetchBtn.click();

        const notice = host.querySelector('[data-mini-transport-seam]');
        expect(notice).not.toBeNull();
        expect(notice.textContent).toContain('Transporte P2P en preparación');
    });

    test('grouping mode can be toggled between day and period', () => {
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected'
        });
        modal.mount(host);

        // Default grouping mode is day
        expect(host.querySelector('[data-mini-date-input]')).not.toBeNull();
        expect(host.querySelector('[data-mini-range-start]')).toBeNull();

        // Switch to period
        host.querySelector('[data-mini-action="set-grouping-period"]').click();
        expect(modal.groupingMode).toBe('period');
        expect(host.querySelector('[data-mini-range-start]')).not.toBeNull();
        expect(host.querySelector('[data-mini-range-end]')).not.toBeNull();

        // Switch back to day
        host.querySelector('[data-mini-action="set-grouping-day"]').click();
        expect(modal.groupingMode).toBe('day');
        expect(host.querySelector('[data-mini-date-input]')).not.toBeNull();
    });

    test('consolidating drafts renders consolidation review skeleton and proposal seam without writing to attendance', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        // Add 2 submissions: Mini 1 has EMP-001 (8h), Mini 2 has EMP-001 (8h)
        const sub1 = sampleSubmission(SUB_UUID_1, '2026-09-06');
        const sub2 = {
            ...sampleSubmission(SUB_UUID_2, '2026-09-06'),
            deviceId: 'phone-2',
            scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-2' }
        };
        await inboxStore.importSubmission(sub1, { expectedSaProjectId: SA_PROJECT });
        await inboxStore.importSubmission(sub2, { expectedSaProjectId: SA_PROJECT });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            inboxStore,
            importMode: 'connected',
            attendance: {} // No existing attendance in SA
        });
        modal.mount(host);
        await modal.setImportMode('connected');

        // Select both drafts
        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_2}"]`).click();

        // Click consolidate button
        const consolidateBtn = host.querySelector('[data-mini-action="consolidate-drafts"]');
        consolidateBtn.click();

        // Verify consolidation skeleton rendered
        const skeleton = host.querySelector('[data-mini-consolidation-skeleton]');
        expect(skeleton).not.toBeNull();
        expect(host.querySelector('.mini-badge-resolved').textContent).toContain('1');

        // Verify proposal seam banner is present
        const proposalSeam = host.querySelector('[data-mini-proposal-seam]');
        expect(proposalSeam).not.toBeNull();
        expect(proposalSeam.textContent).toContain('Seam de propuesta para conciliación');
        expect(proposalSeam.textContent).toContain('No se ha escrito en la asistencia oficial');
    });

    test('Pegar texto preserves existing WhatsApp parser and behavior after switching back and forth', () => {
        const modal = new MiniAttendanceImportModal({
            proposedDate: '2026-09-06',
            importMode: 'paste'
        });
        modal.mount(host);

        // Paste some WhatsApp report text
        const sampleReport = '*Asistencia de hoy martes, 28 de julio* 001. Ana Perez *8h*';
        const textarea = host.querySelector('[data-mini-source]');
        textarea.value = sampleReport;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        // Switch to Conectados and back to Pegar texto
        host.querySelector('[data-mini-mode="connected"]').click();
        expect(host.querySelector('[data-mini-source]')).toBeNull();

        host.querySelector('[data-mini-mode="paste"]').click();
        const restoredTextarea = host.querySelector('[data-mini-source]');
        expect(restoredTextarea).not.toBeNull();
        expect(restoredTextarea.value).toBe(sampleReport);

        // Analyze button works as before
        const analyzeBtn = host.querySelector('[data-mini-action="analyze"]');
        expect(analyzeBtn.disabled).toBe(false);
        analyzeBtn.click();

        // Enters setup stage
        expect(host.querySelector('[data-mini-stage]').dataset.miniStage).toBe('setup');
    });
});
