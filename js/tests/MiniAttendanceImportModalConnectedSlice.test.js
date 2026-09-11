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
        expect([...modeTabs.querySelectorAll('[data-mini-mode]')].map(btn => btn.dataset.miniMode))
            .toEqual(['paste', 'connected']);
        expect(host.querySelector('.mini-import-content-gutter')).not.toBeNull();

        // Pegar texto view is visible by default
        expect(host.querySelector('[data-mini-source]')).not.toBeNull();
    });

    test('switching to Conectados renders request controls and exposes drafts through the separate inbox step', async () => {
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
        expect(host.querySelector('[data-mini-saved-drafts]')).toBeNull();
        const inboxButton = host.querySelector('[data-mini-action="open-connected-inbox"]');
        expect(inboxButton).not.toBeNull();
        expect(inboxButton.textContent).toContain('1');

        // Check linked Mini options
        const select = host.querySelector('[data-mini-connected-selector]');
        expect(select.options.length).toBeGreaterThan(1);
        expect(select.options[1].textContent).toContain('Mini Obra 1');

        // Draft cards live in the next modal step, not below the request form.
        await modal.openConnectedInbox();
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

        // Open the separate inbox step and select both drafts.
        await modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_1}"]`).click();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_2}"]`).click();

        // Click consolidate button
        const consolidateBtn = host.querySelector('[data-mini-action="consolidate-drafts"]');
        consolidateBtn.click();

        // Verify consolidation skeleton rendered
        const skeleton = host.querySelector('[data-mini-consolidation-skeleton]');
        expect(skeleton).not.toBeNull();
        expect(skeleton.closest('.mini-import-content-gutter')).not.toBeNull();
        expect(host.querySelector('.mini-badge-resolved').textContent).toContain('1');

        // Verify proposal seam banner is present
        const proposalSeam = host.querySelector('[data-mini-proposal-seam]');
        expect(proposalSeam).not.toBeNull();
        expect(proposalSeam.textContent).toContain('Consolidar Minis');
        expect(proposalSeam.textContent).toContain('SA no participa todavía');
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

describe('MiniAttendanceImportModal — All-Mini Progress, Cancel, Partial, Retry & LastSeen', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('all-Mini view renders one row per target with alias/name and lastSeen, without invented online status', () => {
        const linkedMinis = [
            {
                id: 'peer-mini-1',
                peerId: 'peer-mini-1',
                deviceId: 'device-1',
                name: 'Mini Obra 1',
                alias: 'Obra Norte',
                lastSeenAt: '2026-09-08T14:30:00.000Z'
            },
            {
                id: 'peer-mini-2',
                peerId: 'peer-mini-2',
                deviceId: 'device-2',
                name: 'Mini Taller 2',
                alias: null,
                lastSeenAt: null
            }
        ];

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '', // All Minis
            linkedMinis
        });
        modal.mount(host);

        const list = host.querySelector('[data-mini-peer-progress-list]');
        expect(list).not.toBeNull();

        // Check peer 1
        const row1 = host.querySelector('[data-mini-peer-row="peer-mini-1"]');
        expect(row1).not.toBeNull();
        const name1 = row1.querySelector('[data-mini-peer-name="peer-mini-1"]');
        expect(name1.textContent).toContain('Mini Obra 1 (Obra Norte)');
        const lastSeen1 = row1.querySelector('[data-mini-peer-last-seen="peer-mini-1"]');
        expect(lastSeen1.textContent).toContain('Última vez:');
        expect(lastSeen1.textContent).not.toContain('Sin registro');

        const status1 = row1.querySelector('[data-mini-peer-status="peer-mini-1"]');
        expect(status1.dataset.miniPeerState).toBe('pending');
        expect(status1.textContent).toBe('En espera');

        // Check peer 2
        const row2 = host.querySelector('[data-mini-peer-row="peer-mini-2"]');
        expect(row2).not.toBeNull();
        const name2 = row2.querySelector('[data-mini-peer-name="peer-mini-2"]');
        expect(name2.textContent).toContain('Mini Taller 2');
        const lastSeen2 = row2.querySelector('[data-mini-peer-last-seen="peer-mini-2"]');
        expect(lastSeen2.textContent).toBe('Última vez: Sin registro');

        const status2 = row2.querySelector('[data-mini-peer-status="peer-mini-2"]');
        expect(status2.dataset.miniPeerState).toBe('pending');
        expect(status2.textContent).toBe('En espera');

        // Verify NO invented online status anywhere in the list
        expect(list.textContent).not.toMatch(/en l[íi]nea|desconectado|online|offline/i);
    });

    test('progress state transitions update DOM badges in place without triggering full render', async () => {
        const linkedMinis = [
            { id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini Obra 1' }
        ];

        let progressCallback;
        let resolveRequest;
        const requestPromise = new Promise(resolve => {
            resolveRequest = resolve;
        });

        const onRequestSpy = jest.fn(({ onProgress }) => {
            progressCallback = onProgress;
            return requestPromise;
        });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '',
            linkedMinis,
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        const renderSpy = jest.spyOn(modal, 'render');

        // Start fetch
        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        fetchBtn.click();

        // Full render called once at start
        expect(renderSpy).toHaveBeenCalledTimes(1);

        const badge = host.querySelector('[data-mini-peer-status="peer-mini-1"]');
        expect(badge).not.toBeNull();
        expect(badge.dataset.miniPeerState).toBe('connecting');
        expect(badge.classList.contains('is-active')).toBe(true);

        // Transition: authenticating
        progressCallback({
            peerId: 'peer-mini-1',
            state: 'authenticating',
            message: 'Autenticando canal seguro con Mini Obra 1…'
        });
        expect(badge.dataset.miniPeerState).toBe('authenticating');
        expect(badge.textContent).toBe('Autenticando…');
        expect(badge.classList.contains('is-active')).toBe(true);
        expect(renderSpy).toHaveBeenCalledTimes(1); // NO full render!

        // Transition: requesting
        progressCallback({
            peerId: 'peer-mini-1',
            state: 'requesting',
            message: 'Transfiriendo asistencia desde Mini Obra 1…'
        });
        expect(badge.dataset.miniPeerState).toBe('requesting');
        expect(badge.textContent).toBe('Transfiriendo…');
        expect(badge.classList.contains('is-active')).toBe(true);
        expect(renderSpy).toHaveBeenCalledTimes(1); // NO full render!

        // Transition: receiving
        progressCallback({
            peerId: 'peer-mini-1',
            state: 'receiving',
            message: 'Esperando respuesta de Mini Obra 1…'
        });
        expect(badge.dataset.miniPeerState).toBe('receiving');
        expect(badge.textContent).toBe('Recibiendo…');
        expect(badge.classList.contains('is-active')).toBe(true);
        expect(renderSpy).toHaveBeenCalledTimes(1); // NO full render!

        // Transition: success
        progressCallback({
            peerId: 'peer-mini-1',
            state: 'success',
            message: 'Asistencia recibida de Mini Obra 1.'
        });
        expect(badge.dataset.miniPeerState).toBe('success');
        expect(badge.textContent).toBe('Completado');
        expect(badge.classList.contains('is-success')).toBe(true);
        expect(renderSpy).toHaveBeenCalledTimes(1); // NO full render!

        // Resolve fetch
        resolveRequest({
            ok: true,
            status: 'success',
            hasPartialError: false,
            importedCount: 1,
            duplicateCount: 0,
            message: '✓ Asistencia recibida de Mini Obra 1 (1 nuevos).'
        });
        await new Promise(resolve => setTimeout(resolve, 10));

        // Full render called once more upon completion to settle final UI
        expect(renderSpy).toHaveBeenCalledTimes(2);
        expect(modal.connectionState).toBe('success');
    });

    test('partial success renders partial notice, successful drafts, and allows Retry failed only', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const linkedMinis = [
            { id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' },
            { id: 'peer-mini-2', peerId: 'peer-mini-2', name: 'Mini 2' }
        ];

        const onRequestSpy = jest.fn(async ({ onProgress }) => {
            // Mini 1 succeeds
            onProgress({ peerId: 'peer-mini-1', state: 'success', message: 'OK' });
            await inboxStore.importSubmission(sampleSubmission(SUB_UUID_1, '2026-09-06'), {
                expectedSaProjectId: SA_PROJECT,
                metadata: { sourcePeerId: 'peer-mini-1', sourcePeerName: 'Mini 1' }
            });
            // Mini 2 fails
            onProgress({ peerId: 'peer-mini-2', state: 'timeout', message: 'Timeout' });
            return {
                ok: true,
                status: 'partial_success',
                hasPartialError: true,
                message: 'Parcial: 1 de 2 Minis respondieron (1 nuevos). Falló: Mini 2.',
                importedCount: 1,
                duplicateCount: 0,
                results: [{ peerId: 'peer-mini-1' }],
                errors: [{ peer: linkedMinis[1], error: new Error('Timeout') }]
            };
        });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '',
            linkedMinis,
            inboxStore,
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        const fetchBtn = host.querySelector('[data-mini-action="fetch-connected"]');
        fetchBtn.click();
        await new Promise(resolve => setTimeout(resolve, 20));

        // Verify partial success state
        expect(modal.connectionState).toBe('partial_success');
        expect(modal.failedMiniTargets).toEqual(['peer-mini-2']);

        // Notice has partial styling and message
        const notice = host.querySelector('[data-mini-transport-seam]');
        expect(notice).not.toBeNull();
        expect(notice.className).toContain('is-partial_success');
        expect(notice.textContent).toContain('Parcial: 1 de 2 Minis respondieron');

        // Mini 1 shows success badge, Mini 2 shows timeout badge
        const badge1 = host.querySelector('[data-mini-peer-status="peer-mini-1"]');
        const badge2 = host.querySelector('[data-mini-peer-status="peer-mini-2"]');
        expect(badge1.dataset.miniPeerState).toBe('success');
        expect(badge2.dataset.miniPeerState).toBe('timeout');

        // The successful response is persisted, but cards stay in the separate inbox step.
        expect(modal.savedDrafts.some(d => d.submissionId === SUB_UUID_1)).toBe(true);
        expect(host.querySelector(`[data-mini-draft-item="${SUB_UUID_1}"]`)).toBeNull();
        expect(host.querySelector('[data-mini-action="open-connected-inbox"]')?.textContent).toContain('1');

        // Retry failed button is visible with a numeric badge (no parenthetical).
        const retryFailedBtn = host.querySelector('[data-mini-action="retry-failed"]');
        expect(retryFailedBtn).not.toBeNull();
        expect(retryFailedBtn.textContent).toContain('Reintentar transferencia');
        expect(retryFailedBtn.textContent).not.toMatch(/\(\d+\)/);
        expect(retryFailedBtn.querySelector('[data-mini-count-badge]')?.textContent).toBe('1');

        // Per-peer retry button is also visible on row 2
        const peerRetryBtn = host.querySelector('[data-mini-action="retry-peer"][data-mini-target-peer-id="peer-mini-2"]');
        expect(peerRetryBtn).not.toBeNull();
    });

    test('retry target list passes failed peer IDs only and relies on inbox idempotency', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });

        const linkedMinis = [
            { id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' },
            { id: 'peer-mini-2', peerId: 'peer-mini-2', name: 'Mini 2' }
        ];

        let callCount = 0;
        const onRequestSpy = jest.fn(async ({ targetMiniIds }) => {
            callCount++;
            if (callCount === 1) {
                // Initial call: Mini 1 succeeds, Mini 2 fails
                await inboxStore.importSubmission(sampleSubmission(SUB_UUID_1, '2026-09-06'), {
                    expectedSaProjectId: SA_PROJECT
                });
                return {
                    ok: true,
                    status: 'partial_success',
                    hasPartialError: true,
                    message: 'Parcial: 1 de 2 respondieron. Falló: Mini 2.',
                    errors: [{ peer: linkedMinis[1], error: new Error('Peer offline') }]
                };
            }
            // Retry call: Mini 2 succeeds
            expect(targetMiniIds).toEqual(['peer-mini-2']);
            await inboxStore.importSubmission(sampleSubmission(SUB_UUID_2, '2026-09-06'), {
                expectedSaProjectId: SA_PROJECT,
                metadata: { sourcePeerId: 'peer-mini-2', sourcePeerName: 'Mini 2' }
            });
            return {
                ok: true,
                status: 'success',
                hasPartialError: false,
                message: '✓ Asistencia recibida de Mini 2 (1 nuevos).'
            };
        });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '',
            linkedMinis,
            inboxStore,
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        // Initial request
        host.querySelector('[data-mini-action="fetch-connected"]').click();
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(modal.connectionState).toBe('partial_success');
        expect(modal.failedMiniTargets).toEqual(['peer-mini-2']);

        // Click "Reintentar transferencia"
        const retryBtn = host.querySelector('[data-mini-action="retry-failed"]');
        expect(retryBtn).not.toBeNull();
        retryBtn.click();
        await new Promise(resolve => setTimeout(resolve, 20));

        // Second call was invoked with only failed targetMiniIds
        expect(onRequestSpy).toHaveBeenCalledTimes(2);
        expect(onRequestSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            targetMiniIds: ['peer-mini-2']
        }));

        // After successful retry: connectionState is success, failedMiniTargets is empty
        expect(modal.connectionState).toBe('success');
        expect(modal.failedMiniTargets).toEqual([]);
        expect(host.querySelector('[data-mini-action="retry-failed"]')).toBeNull();

        // Both drafts are in the persisted inbox (idempotent staging) and appear in its own step.
        expect(modal.savedDrafts.length).toBe(2);
        expect(host.querySelector('[data-mini-action="open-connected-inbox"]')?.textContent).toContain('2');
        await modal.openConnectedInbox();
        expect(host.querySelector(`[data-mini-draft-item="${SUB_UUID_1}"]`)).not.toBeNull();
        expect(host.querySelector(`[data-mini-draft-item="${SUB_UUID_2}"]`)).not.toBeNull();
    });

    test('cancel during in-flight request aborts signal, stops request, and updates UI to cancelled', async () => {
        let capturedSignal;
        let rejectRequest;
        const requestPromise = new Promise((_, reject) => {
            rejectRequest = reject;
        });

        const onRequestSpy = jest.fn(({ signal, onProgress }) => {
            capturedSignal = signal;
            signal.addEventListener('abort', () => {
                const cancelErr = new Error('Solicitud cancelada por el usuario.');
                cancelErr.name = 'AbortError';
                onProgress({ peerId: 'peer-mini-1', state: 'cancelled', message: 'Cancelado' });
                rejectRequest(cancelErr);
            });
            return requestPromise;
        });

        const linkedMinis = [
            { id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' }
        ];

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '',
            linkedMinis,
            onRequestSubmissions: onRequestSpy
        });
        modal.mount(host);

        // Click fetch
        host.querySelector('[data-mini-action="fetch-connected"]').click();

        expect(modal.isFetchingConnected).toBe(true);
        expect(capturedSignal).toBeDefined();
        expect(capturedSignal.aborted).toBe(false);

        // Cancel button is displayed
        const cancelBtn = host.querySelector('[data-mini-action="cancel-fetch"]');
        expect(cancelBtn).not.toBeNull();

        // Click Cancel
        cancelBtn.click();

        expect(capturedSignal.aborted).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(modal.isFetchingConnected).toBe(false);
        expect(modal.connectionState).toBe('cancelled');
        expect(modal.transportStatusMessage).toContain('cancelada');

        const notice = host.querySelector('[data-mini-transport-seam]');
        expect(notice.className).toContain('is-cancelled');
        expect(notice.textContent).toContain('cancelada');

        const badge = host.querySelector('[data-mini-peer-status="peer-mini-1"]');
        expect(badge.dataset.miniPeerState).toBe('cancelled');
        expect(badge.textContent).toBe('Cancelado');
    });

    test('no false success: failures, timeouts, and zero-record responses do not show false success', async () => {
        const linkedMinis = [
            { id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' }
        ];

        // 1. Error does NOT show success
        const errorModal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: 'peer-mini-1',
            linkedMinis,
            onRequestSubmissions: jest.fn().mockRejectedValue(new Error('Fallo de red'))
        });
        errorModal.mount(host);

        host.querySelector('[data-mini-action="fetch-connected"]').click();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(errorModal.connectionState).toBe('error');
        const errNotice = host.querySelector('[data-mini-transport-seam]');
        expect(errNotice.className).not.toContain('is-success');
        expect(errNotice.textContent).not.toContain('✓');
        expect(errNotice.textContent).toContain('Error: Fallo de red');

        // 2. Zero records received clearly states no records rather than false imported count
        const zeroModal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: 'peer-mini-1',
            linkedMinis,
            onRequestSubmissions: jest.fn().mockResolvedValue({
                ok: true,
                status: 'success',
                hasPartialError: false,
                totalSubmissions: 0,
                importedCount: 0,
                duplicateCount: 0,
                message: '✓ Asistencia recibida de Mini 1 (sin registros para esta fecha).'
            })
        });
        zeroModal.mount(host);

        host.querySelector('[data-mini-action="fetch-connected"]').click();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(zeroModal.connectionState).toBe('success');
        const zeroNotice = host.querySelector('[data-mini-transport-seam]');
        expect(zeroNotice.textContent).toContain('sin registros para esta fecha');
        expect(zeroNotice.textContent).not.toContain('0 importados');
    });
});

describe('MiniAttendanceImportModal — structural modal morph continuity', () => {
    test('keeps the same overlay and shell while a structural view changes size', async () => {
        const overlay = document.createElement('div');
        const shell = document.createElement('div');
        shell.dataset.modalContainer = '';
        const host = document.createElement('div');
        shell.appendChild(host);
        overlay.appendChild(shell);
        document.body.replaceChildren(overlay);

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'paste',
            linkedMinis: [{ id: 'mini-1', peerId: 'mini-1', name: 'Mini 1' }]
        });
        modal.modal = { element: overlay };
        modal.host = host;

        let naturalHeight = 420;
        const originalReplaceChildren = host.replaceChildren.bind(host);
        host.replaceChildren = (...nodes) => {
            originalReplaceChildren(...nodes);
            naturalHeight = modal.importMode === 'connected' ? 560 : 420;
        };
        shell.getBoundingClientRect = () => {
            const explicitHeight = Number.parseFloat(shell.style.height || '');
            const explicitWidth = Number.parseFloat(shell.style.width || '');
            return {
                width: Number.isFinite(explicitWidth) ? explicitWidth : 720,
                height: Number.isFinite(explicitHeight) ? explicitHeight : naturalHeight,
                top: 0, left: 0, right: 720, bottom: naturalHeight, x: 0, y: 0,
                toJSON() { return this; }
            };
        };

        modal.render();
        const overlayRef = modal.modal.element;
        const shellRef = overlay.querySelector('[data-modal-container]');
        const connectedModeButton = host.querySelector('[data-mini-mode="connected"]');
        connectedModeButton.focus();
        expect(document.activeElement).toBe(connectedModeButton);

        await modal.setImportMode('connected');
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(modal.modal.element).toBe(overlayRef);
        expect(overlay.querySelector('[data-modal-container]')).toBe(shellRef);
        expect(shell.style.transition).toContain('height 260ms');
        expect(shell.style.height).toBe('560px');
        expect(host.querySelector('[data-mini-mode="connected"]')).not.toBeNull();
        expect(document.activeElement?.dataset?.miniMode).toBe('connected');

        modal._activeMorphCleanup?.();
        expect(shell.style.height).toBe('');
        expect(shell.style.width).toBe('');
    });
});

describe('MiniAttendanceImportModal — review regressions', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('retrying one failed Mini preserves other failed peers until each is resolved', async () => {
        const linkedMinis = [
            { id: 'mini-a', peerId: 'mini-a', name: 'Mini A' },
            { id: 'mini-b', peerId: 'mini-b', name: 'Mini B' },
            { id: 'mini-c', peerId: 'mini-c', name: 'Mini C' }
        ];
        const calls = [];
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected',
            selectedMiniId: '',
            linkedMinis,
            onRequestSubmissions: async ({ targetMiniIds }) => {
                calls.push(targetMiniIds ? [...targetMiniIds] : null);
                return {
                    ok: true,
                    status: 'success',
                    hasPartialError: false,
                    importedCount: 0,
                    duplicateCount: 1,
                    message: 'Reintento completado.'
                };
            }
        });
        modal.mount(host);
        modal.failedMiniTargets = ['mini-b', 'mini-c'];
        modal.connectionState = 'partial_success';

        await modal.handleFetchConnected({ targetMiniIds: ['mini-b'] });
        expect(calls[0]).toEqual(['mini-b']);
        expect(modal.failedMiniTargets).toEqual(['mini-c']);
        expect(modal.connectionState).toBe('partial_success');
        expect(modal.transportStatusMessage).toContain('1 Mini(s) aún pendientes');

        await modal.handleFetchConnected({ targetMiniIds: ['mini-c'] });
        expect(calls[1]).toEqual(['mini-c']);
        expect(modal.failedMiniTargets).toEqual([]);
        expect(modal.connectionState).toBe('success');
    });

    test('closing the modal aborts an active request, cleans morph state and blocks detached rerender', () => {
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            importMode: 'connected'
        });
        modal.mount(host);
        const controller = new AbortController();
        const morphCleanup = jest.fn();
        modal.activeAbortController = controller;
        modal._activeMorphCleanup = morphCleanup;

        modal.handleModalClosed();

        expect(controller.signal.aborted).toBe(true);
        expect(morphCleanup).toHaveBeenCalledTimes(1);
        expect(modal._activeMorphCleanup).toBeNull();
        expect(modal.host).toBeNull();
    });
});


describe('MiniAttendanceImportModal — connected wizard and proxy-safe reconciliation', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    test('Conectados separates request, inbox and consolidation into distinct modal steps', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        await inboxStore.importSubmission(sampleSubmission(), { expectedSaProjectId: SA_PROJECT });
        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            inboxStore,
            importMode: 'connected',
            linkedMinis: [{ id: 'mini-1', deviceId: 'phone-1', name: 'Mini Obra 1' }]
        });
        modal.mount(host);
        await modal.setImportMode('connected');

        expect(host.querySelector('[data-mini-connected-selection]')).not.toBeNull();
        expect(host.querySelector('[data-mini-saved-drafts]')).toBeNull();
        const openInbox = host.querySelector('[data-mini-action="open-connected-inbox"]');
        expect(openInbox).not.toBeNull();
        expect(openInbox.textContent).toMatch(/1/);

        openInbox.click();
        expect(host.querySelector('[data-mini-connected-selection]')).toBeNull();
        expect(host.querySelector('[data-mini-saved-drafts]')).not.toBeNull();
        expect(host.querySelector(`[data-mini-draft-item="${SUB_UUID_1}"]`)).not.toBeNull();
        expect(host.querySelector('[data-mini-action="back-connected-request"]')).not.toBeNull();

        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_1}"]`).click();
        host.querySelector('[data-mini-action="consolidate-drafts"]').click();
        expect(host.querySelector('[data-mini-consolidation-skeleton]')).not.toBeNull();
        expect(host.querySelector('[data-mini-saved-drafts]')).toBeNull();
        expect(host.querySelector('[data-mini-action="back-connected-inbox"]')).not.toBeNull();
    });


    test('draft inbox filters new/non-incorporated/incorporated and sorts by work date or update date', async () => {
        const db = new MemoryDB();
        let now = 1000;
        const inboxStore = new AttendanceSubmissionInboxStore({ db, now: () => now });
        const thirdId = '123e4567-e89b-42d3-a456-426614174003';
        await inboxStore.importSubmission(sampleSubmission(SUB_UUID_1, '2026-09-06'), { expectedSaProjectId: SA_PROJECT });
        now = 2000;
        await inboxStore.importSubmission(sampleSubmission(SUB_UUID_2, '2026-09-09'), { expectedSaProjectId: SA_PROJECT });
        now = 3000;
        await inboxStore.updateStatus(SA_PROJECT, SUB_UUID_2, 'reviewed');
        now = 4000;
        await inboxStore.importSubmission(sampleSubmission(thirdId, '2026-09-08'), { expectedSaProjectId: SA_PROJECT });
        now = 5000;
        await inboxStore.updateStatus(SA_PROJECT, thirdId, 'incorporated', { metadata: { incorporatedAt: now } });

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            inboxStore,
            importMode: 'connected'
        });
        modal.mount(host);
        await modal.setImportMode('connected');
        await modal.openConnectedInbox();

        expect(host.querySelector(`[data-mini-draft-item="${SUB_UUID_1}"] [data-mini-draft-new]`)?.textContent).toBe('Nuevo');
        const incorporatedCard = host.querySelector(`[data-mini-draft-item="${thirdId}"]`);
        expect(incorporatedCard.classList.contains('is-incorporated')).toBe(true);
        expect(host.querySelector(`[data-mini-draft-checkbox="${thirdId}"]`).disabled).toBe(true);

        const ids = () => [...host.querySelectorAll('[data-mini-draft-item]')].map(node => node.dataset.miniDraftItem);
        expect(ids()).toEqual([SUB_UUID_2, thirdId, SUB_UUID_1]);

        const statusFilter = host.querySelector('[data-mini-draft-status-filter]');
        statusFilter.value = 'new';
        statusFilter.dispatchEvent(new Event('change'));
        expect(ids()).toEqual([SUB_UUID_1]);

        host.querySelector('[data-mini-draft-status-filter]').value = 'not-incorporated';
        host.querySelector('[data-mini-draft-status-filter]').dispatchEvent(new Event('change'));
        expect(ids()).toEqual([SUB_UUID_2, SUB_UUID_1]);

        host.querySelector('[data-mini-draft-status-filter]').value = 'all';
        host.querySelector('[data-mini-draft-status-filter]').dispatchEvent(new Event('change'));
        const sort = host.querySelector('[data-mini-draft-sort]');
        sort.value = 'updatedAt';
        sort.dispatchEvent(new Event('change'));
        expect(ids()).toEqual([thirdId, SUB_UUID_2, SUB_UUID_1]);
    });


    test('completion waits for pending review persistence so incorporated cannot be overwritten by reviewed', async () => {
        let releaseReview;
        const reviewStatusPromise = new Promise(resolve => { releaseReview = resolve; });
        const updateStatus = jest.fn(async (_projectId, submissionId, status) => ({
            ...sampleSubmission(submissionId),
            submissionId,
            saProjectId: SA_PROJECT,
            status,
            workDate: '2026-09-06'
        }));
        const inboxStore = {
            updateStatus,
            list: jest.fn(async () => [{
                submissionId: SUB_UUID_1,
                saProjectId: SA_PROJECT,
                status: 'incorporated',
                workDate: '2026-09-06',
                sourceSnapshot: sampleSubmission()
            }])
        };
        const modal = new MiniAttendanceImportModal({ saProjectId: SA_PROJECT, inboxStore, importMode: 'connected' });
        modal.mount(host);
        modal.savedDrafts = [{
            submissionId: SUB_UUID_1,
            saProjectId: SA_PROJECT,
            status: 'reviewed',
            workDate: '2026-09-06',
            sourceSnapshot: sampleSubmission()
        }];
        modal.selectedDraftIds.add(SUB_UUID_1);
        modal.multiDayResolver = {
            getMultiDaySummary: () => ({ totalDays: 1, appliedDaysCount: 1, workDates: ['2026-09-06'] })
        };
        modal.reviewStatusPromise = reviewStatusPromise;

        const completion = modal.completeConnectedImport();
        await Promise.resolve();
        expect(updateStatus).not.toHaveBeenCalled();
        releaseReview();
        await completion;
        expect(updateStatus).toHaveBeenCalledTimes(1);
        expect(updateStatus.mock.calls[0][2]).toBe('incorporated');
        expect(modal.connectedView).toBe('inbox');
    });

    test('connected reconciliation unwraps AppState-like proxies before reading frozen positionHours', async () => {
        const db = new MemoryDB();
        const inboxStore = new AttendanceSubmissionInboxStore({ db });
        await inboxStore.importSubmission(sampleSubmission(), { expectedSaProjectId: SA_PROJECT });

        const frozenRecord = Object.freeze({
            employeeId: 'EMP-001',
            date: '2026-09-06',
            present: true,
            hoursWorked: 8,
            overtimeHours: 0,
            selectedPosition: 'POS-1',
            multiPosition: false,
            positionHours: Object.freeze([{ positionId: 'POS-1', hours: 8, overtimeHours: 0 }])
        });
        const rawAttendance = { 'EMP-001-2026-09-06': frozenRecord };
        const cache = new WeakMap();
        const recursiveProxy = value => {
            if (!value || typeof value !== 'object') return value;
            if (cache.has(value)) return cache.get(value);
            const proxy = new Proxy(value, {
                get(target, prop, receiver) {
                    if (prop === '_rawTarget') return target;
                    const child = Reflect.get(target, prop, receiver);
                    return child && typeof child === 'object' ? recursiveProxy(child) : child;
                }
            });
            cache.set(value, proxy);
            return proxy;
        };
        const attendance = recursiveProxy(rawAttendance);
        // Demonstrate the exact invariant that previously reached the global error handler.
        expect(() => attendance['EMP-001-2026-09-06'].positionHours).toThrow(TypeError);

        const modal = new MiniAttendanceImportModal({
            saProjectId: SA_PROJECT,
            proposedDate: '2026-09-06',
            inboxStore,
            importMode: 'connected',
            attendance,
            employees: [{ id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['POS-1'], projectId: SA_PROJECT }],
            positions: [{ id: 'POS-1', name: 'Ayudante' }]
        });
        modal.mount(host);
        await modal.setImportMode('connected');
        modal.openConnectedInbox();
        host.querySelector(`[data-mini-draft-checkbox="${SUB_UUID_1}"]`).click();

        expect(() => modal.consolidateSelectedDrafts()).not.toThrow();
        expect(modal.multiDayResolver).not.toBeNull();
    });
});
