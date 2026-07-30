import { editMiniAttendanceDraftRow } from '../modules/features/attendance/MiniAttendanceDraft.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

const DATE = '2026-07-28';
const REPORT = '001. Ana Perez *8h*';
const employees = [{ id: 'e1', number: '1', name: 'Ana Pérez', positions: ['p1'] }];
const positions = [{ id: 'p1', name: 'Oficial' }];

function enterReview(applyPlan) {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const controller = new MiniAttendanceImportModal({
        employees,
        positions,
        proposedDate: DATE,
        regularLimit: 8,
        applyPlan
    }).mount(host);
    const source = host.querySelector('[data-mini-source]');
    source.value = REPORT;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('[data-mini-action="analyze"]').click();
    host.querySelector('[data-mini-action="confirm-date"]').click();
    host.querySelector('[data-mini-action="continue"]').click();
    host.querySelector('[data-mini-auto-choice][value="modify"]').click();
    host.querySelector('[data-mini-action="accept-automatic"]').click();
    return { controller, host };
}

function approveRow(host) {
    const unit = host.querySelector('[data-mini-review-unit]');
    unit.querySelector('[data-mini-action="confirm-unit"]').click();
    host.querySelector('[data-mini-action="show-summary"]').click();
}

async function flushAsyncUi() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('Mini attendance import async apply UI', () => {
    test('shows useful success counts and only closes by explicit action', async () => {
        const applyPlan = jest.fn().mockResolvedValue({
            appliedCount: 1,
            keptCount: 2,
            writtenKeys: [`e1-${DATE}`],
            keptKeys: ['k1', 'k2']
        });
        const { controller, host } = enterReview(applyPlan);
        approveRow(host);

        host.querySelector('[data-mini-action="apply"]').click();
        await flushAsyncUi();

        expect(applyPlan).toHaveBeenCalledTimes(1);
        expect(applyPlan.mock.calls[0][0]).toMatchObject({
            date: DATE,
            draftRevision: controller.draft.revision
        });
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('1 aplicadas · 2 conservadas');
        expect(controller.stage).toBe('review');
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(true);

        controller.close = jest.fn();
        host.querySelector('[data-mini-action="close-result"]').click();
        expect(controller.close).toHaveBeenCalledTimes(1);
    });

    test('pending state prevents double submission and disables review controls', async () => {
        let resolveApply;
        const pending = new Promise(resolve => { resolveApply = resolve; });
        const applyPlan = jest.fn().mockReturnValue(pending);
        const { host } = enterReview(applyPlan);
        approveRow(host);
        const applyButton = host.querySelector('[data-mini-action="apply"]');

        applyButton.click();
        applyButton.click();
        expect(applyPlan).toHaveBeenCalledTimes(1);
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('Aplicando');
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(true);
        expect(host.querySelector('[data-mini-action="back-review"]').disabled).toBe(true);

        resolveApply({ appliedCount: 1, keptCount: 0, writtenKeys: [], keptKeys: [] });
        await flushAsyncUi();
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('1 aplicadas');
    });

    test('shows failures, never reports success, and permits retry', async () => {
        const applyPlan = jest.fn()
            .mockRejectedValueOnce(new Error('No se pudo guardar'))
            .mockResolvedValueOnce({
                appliedCount: 1,
                keptCount: 0,
                writtenKeys: [`e1-${DATE}`],
                keptKeys: []
            });
        const { host } = enterReview(applyPlan);
        approveRow(host);

        host.querySelector('[data-mini-action="apply"]').click();
        await flushAsyncUi();
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('No se pudo guardar');
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .not.toContain('aplicadas');
        expect(host.querySelector('[data-mini-action="apply"]').disabled).toBe(false);

        host.querySelector('[data-mini-action="apply"]').click();
        await flushAsyncUi();
        expect(applyPlan).toHaveBeenCalledTimes(2);
        expect(host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('1 aplicadas');
    });

    test('blocks unresolved plans and rejects a stale draft at click time', async () => {
        const applyPlan = jest.fn();
        const blocked = enterReview(applyPlan);
        expect(blocked.host.querySelector('[data-mini-action="apply"]')).toBeNull();
        expect(applyPlan).not.toHaveBeenCalled();

        const ready = enterReview(applyPlan);
        approveRow(ready.host);
        const applyButton = ready.host.querySelector('[data-mini-action="apply"]');
        ready.controller.draft = editMiniAttendanceDraftRow(
            ready.controller.draft,
            0,
            { normalHours: 7, overtimeHours: 1 }
        );
        applyButton.click();
        await flushAsyncUi();

        expect(applyPlan).not.toHaveBeenCalled();
        expect(ready.host.querySelector('[data-mini-apply-status]').textContent)
            .toContain('Stale draft revision');
    });
});
