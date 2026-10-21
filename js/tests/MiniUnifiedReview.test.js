import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

const date = '2026-10-21';
const employees = [
    { id: 'e1', number: '1', name: 'Ana Pérez', active: true, positions: ['p1'], projectId: 'project' },
    { id: 'e2', number: '2', name: 'Luis García', active: true, positions: ['p1', 'p2'], projectId: 'project' }
];
const positions = [{ id: 'p1', name: 'Oficial' }, { id: 'p2', name: 'Ayudante' }];
const existing = { employeeId: 'e1', date, present: true, hoursWorked: 6, overtimeHours: 0,
    selectedPosition: 'p1', positionHours: [{ positionId: 'p1', hours: 6, overtimeHours: 0 }] };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function paste({ report = '001. Ana Perez *8h*', mode = 'compare', attendance = {}, ...options } = {}) {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const applyPlan = jest.fn(async plan => ({ appliedCount: plan.writes.length, writtenKeys: plan.writes.map(w => w.key), keptCount: plan.keptKeys.length }));
    const inboxStore = { updateStatus: jest.fn(), list: jest.fn(), save: jest.fn() };
    const consolidationStore = { updateStatus: jest.fn(), saveConsolidated: jest.fn() };
    const modal = new MiniAttendanceImportModal({ employees, positions, proposedDate: date,
        connectedReviewMode: mode, saProjectId: 'project', attendance, applyPlan,
        inboxStore, consolidationStore, confirmImportDates: () => true, ...options }).mount(host);
    modal.source = report;
    modal.analyze();
    modal.confirmDate();
    modal.startReview();
    return { modal, host, applyPlan, inboxStore, consolidationStore };
}
function click(host, action) {
    const button = host.querySelector(`[data-mini-action="${action}"]`);
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    button.click();
}
function confirmDetail(host) { click(host, 'confirm-unit'); }
function openGuidedReviewer(host) {
    host.querySelectorAll('[data-mini-auto-choice][value="modify"]').forEach(input => {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(host, 'accept-automatic');
}

afterEach(() => document.body.replaceChildren());

test('compare: pasted text uses the shared P2P comparison list, only writes after Apply, no inbox side effects', async () => {
    const { modal, host, applyPlan, inboxStore, consolidationStore } = paste();
    expect(host.querySelector('.mini-import-connected-view-sa-comparison')).not.toBeNull();
    expect(host.querySelectorAll('[data-mini-consolidation-item]')).toHaveLength(1);
    expect(applyPlan).not.toHaveBeenCalled();
    click(host, 'apply-day');
    await tick();
    expect(applyPlan).toHaveBeenCalledTimes(1);
    const plan = applyPlan.mock.calls[0][0];
    expect(plan.date).toBe(date);
    expect(plan.writes[0].record.hoursWorked).toBe(8);
    expect(modal.applyStatus).toBe('success');
    expect(host.querySelector('[data-mini-action="complete-connected-import"]').disabled).toBe(false);
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(true);
    for (const store of [inboxStore, consolidationStore]) {
        Object.values(store).forEach(fn => expect(fn).not.toHaveBeenCalled());
    }
});

test('daily: both pasted and connected drafts can reach the same individual reviewer', () => {
    const pasted = paste({ mode: 'daily' });
    openGuidedReviewer(pasted.host);
    expect(pasted.host.querySelector('.mini-import-individual-review')).not.toBeNull();
    const host = document.createElement('div'); document.body.append(host);
    const connected = new MiniAttendanceImportModal({ employees, positions, importMode: 'connected', connectedReviewMode: 'daily', attendance: {} }).mount(host);
    connected.beginConnectedDayReview({ items: [{ id: 'c1', saEmployeeId: 'e1', workDate: date, status: 'resolved', normalHours: 8, overtimeHours: 0, displayNumber: '1', displayName: 'Ana Pérez', sources: [] }] });
    openGuidedReviewer(host);
    expect(host.querySelector('.mini-import-individual-review')).not.toBeNull();
});

test('compare: preserves SA until an explicit Mini decision and allows returning to validation', () => {
    const { modal, host, applyPlan } = paste({ attendance: { [`e1-${date}`]: existing } });
    expect(host.querySelector('[data-mini-sa-compare]')).not.toBeNull();
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(true);
    click(host, 'use-imported');
    expect(modal.conflictPlan.rows[0].decision.action).toBe('use_imported');
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(false);
    click(host, 'back-connected-inbox');
    expect(host.querySelector('.mini-import-setup')).not.toBeNull();
    expect(modal.draft.confirmedDate).toBe(date);
    expect(modal.source).toBe('001. Ana Perez *8h*');
    expect(applyPlan).not.toHaveBeenCalled();
});

test('compare: unknown identities use the canonical individual editor and return to the list', () => {
    const { modal, host } = paste({ report: '099. Persona Nueva *8h*' });
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(true);
    click(host, 'review-text-detail');
    expect(host.querySelector('.mini-import-individual-review')).not.toBeNull();
    const select = host.querySelector('[data-mini-employee]');
    select.value = 'e1'; select.dispatchEvent(new Event('change'));
    confirmDetail(host);
    expect(host.querySelector('.mini-import-connected-view-sa-comparison')).not.toBeNull();
    expect(modal.conflictPlan.rows[0].employeeId).toBe('e1');
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(false);
});

test('compare: different duplicate hours cannot be bypassed by list choices', () => {
    const { host, applyPlan } = paste({ report: '001. Ana Perez *8h*\n001. Ana Perez *6h*' });
    expect(host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(true);
    expect(host.querySelector('[data-mini-action="use-imported"]')).toBeNull();
    click(host, 'review-text-detail');
    expect(host.querySelector('[data-mini-duplicate-hours]')).not.toBeNull();
    expect(host.querySelector('[data-mini-action="confirm-unit"]').disabled).toBe(true);
    expect(applyPlan).not.toHaveBeenCalled();
});

test('compare: several positions retain the detailed allocation editor', () => {
    const { modal, host } = paste({ report: '002. Luis Garcia *8h*' });
    click(host, 'review-text-detail');
    expect(host.querySelectorAll('[data-mini-position-allocation]')).toHaveLength(2);
    for (const [id, hours] of [['p1', 3], ['p2', 6]]) {
        const row = host.querySelector(`[data-mini-position-allocation="${id}"]`);
        const input = row.querySelector('[data-mini-position-normal]');
        input.value = hours; input.dispatchEvent(new Event('input'));
    }
    confirmDetail(host);
    expect(modal.conflictPlan.rows[0].positionAllocations).toEqual([
        { positionId: 'p1', normalHours: 3, overtimeHours: 0 },
        { positionId: 'p2', normalHours: 6, overtimeHours: 0 }
    ]);
    expect(host.querySelector('.mini-import-connected-view-sa-comparison')).not.toBeNull();
    expect(host.querySelector('[data-mini-adjusted-allocation]').textContent).toContain('9h');
    expect(modal.draft.rows[0].sourceRow.totalHours).toBe(8);
});

test('compare: split normal/overtime allocation is preserved and errors allow retry', async () => {
    const { modal, host, applyPlan } = paste({ report: '001. Ana Perez *10h*' });
    click(host, 'back-connected-inbox');
    modal.setAllocationMode('split_at_regular_limit');
    modal.startReview();
    expect(host.querySelector('[data-mini-merge-overtime]')).toBeNull();
    applyPlan.mockRejectedValueOnce(new Error('No se pudo guardar'));
    click(host, 'apply-day'); await tick();
    expect(modal.applyStatus).toBe('error');
    expect(host.textContent).toContain('No se pudo guardar');
    click(host, 'apply-day'); await tick();
    expect(applyPlan).toHaveBeenCalledTimes(2);
    expect(applyPlan.mock.calls[1][0].writes[0].record).toMatchObject({ hoursWorked: 8, overtimeHours: 2 });
});

test('compare: equal SA hours are a no-op, and keeping SA preserves its record', async () => {
    const same = paste({ report: '001. Ana Perez *6h*', attendance: { [`e1-${date}`]: existing } });
    click(same.host, 'apply-day'); await tick();
    expect(same.applyPlan.mock.calls[0][0].writes).toHaveLength(0);
    expect(same.applyPlan.mock.calls[0][0].keptKeys).toEqual([`e1-${date}`]);

    const changed = paste({ attendance: { [`e1-${date}`]: existing } });
    click(changed.host, 'keep-sa');
    click(changed.host, 'apply-day'); await tick();
    expect(changed.applyPlan.mock.calls[0][0].writes).toHaveLength(0);
    expect(existing.hoursWorked).toBe(6);
});

test('compare: ignoring a row excludes only the import and never updates SA', async () => {
    const { modal, host, applyPlan } = paste({ confirmIgnore: () => true });
    click(host, 'ignore-consolidated-attendance'); await tick();
    expect(modal.draft.rows[0].excluded).toBe(true);
    expect(host.querySelectorAll('[data-mini-consolidation-item]')).toHaveLength(0);
    expect(applyPlan).not.toHaveBeenCalled();
});

test('compare: inactive and suggested identities still require individual resolution', () => {
    const inactive = employees.map(employee => ({ ...employee, active: false }));
    const paused = paste({ employees: inactive });
    click(paused.host, 'review-text-detail');
    expect(paused.host.querySelector('[data-mini-inactive-banner]')).not.toBeNull();
    expect(paused.applyPlan).not.toHaveBeenCalled();

    const suggested = paste({ report: '099. Ana Perez *8h*' });
    expect(suggested.host.querySelector('[data-mini-action="apply-day"]').disabled).toBe(true);
    expect(suggested.host.querySelector('[data-mini-action="use-imported"]')).toBeNull();
    click(suggested.host, 'review-text-detail');
    expect(suggested.host.querySelector('.mini-import-individual-review')).not.toBeNull();
});

test('compare: canceling the date warning writes nothing and does not repeat the warning', async () => {
    const confirmImportDates = jest.fn(async () => false);
    const { host, applyPlan, modal } = paste({ confirmImportDates });
    click(host, 'apply-day'); await tick();
    expect(confirmImportDates).toHaveBeenCalledTimes(1);
    expect(applyPlan).not.toHaveBeenCalled();
    expect(modal.applyStatus).toBe('idle');
});

test('compare: an already accepted row can be edited individually and reconfirmed before applying', async () => {
    const { modal, host, applyPlan } = paste();
    expect(modal.buildReviewView().items[0].confirmed).toBe(true);
    click(host, 'review-text-detail');
    const hours = host.querySelector('[data-mini-position-normal]');
    hours.value = '9'; hours.dispatchEvent(new Event('input'));
    confirmDetail(host);
    expect(host.querySelector('[data-mini-adjusted-allocation]').textContent).toContain('9h');
    click(host, 'apply-day'); await tick();
    expect(applyPlan.mock.calls[0][0].writes[0].record.hoursWorked).toBe(9);
    expect(modal.draft.rows[0].sourceRow.totalHours).toBe(8);
});
