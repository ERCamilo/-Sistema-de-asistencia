import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { openProjectReconciliation, closeProjectReconciliation, registerProjectReconciliationGlobals }
    from '../modules/features/projects/ProjectReconciliationUI.js';

const project = { id: 'PRJ-wizard', name: 'Obra Norte', status: 'active' };
const change = (selector, value) => {
    const input = document.querySelector(selector);
    if (input.type === 'radio') input.checked = true;
    else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = action => document.querySelector('[data-r07-action="' + action + '"]').click();
const visibleStep = () => document.querySelector('[data-r07-step]:not([hidden])').dataset.r07Step;

describe('project assignment wizard', () => {
    let setup, apply, cashRead;
    beforeEach(() => {
        document.body.innerHTML = '';
        cashRead = jest.spyOn(indexedDBService, 'getAll').mockResolvedValue([]);
        setProjectsEnabled(true);
        setup = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id, projects: [project]
        });
        apply = jest.spyOn(repair, 'applyOwnershipRepair').mockResolvedValue({ status: repair.REPAIR_STATUS.OK });
        state.employees = [{ id: 'emp-w', number: '1', name: 'Ana', positions: ['pos-w'], leaderId: 'lead-w' }];
        state.positions = [{ id: 'pos-w', name: 'Ayudante', leaderId: 'lead-w' }];
        state.leaders = [{ id: 'lead-w', name: 'Pedro', active: true }];
        state.attendance = {};
        registerProjectReconciliationGlobals();
    });
    afterEach(() => {
        closeProjectReconciliation();
        cashRead.mockRestore();
        setup.mockRestore();
        apply.mockRestore();
    });
    test('five stages retain choices when returning and save only on final apply', async () => {
        await openProjectReconciliation();
        const overlay = document.querySelector('[data-modal-overlay]');
        expect(visibleStep()).toBe('0');
        expect(document.querySelector('[data-r07-action="wizard-next"]').disabled).toBe(true);
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('wizard-next');
        expect(visibleStep()).toBe('1');
        click('wizard-next');
        expect(visibleStep()).toBe('2');
        expect(document.querySelector('[data-r07-action="wizard-next"]').disabled).toBe(true);
        click('assign-source-leader');
        click('wizard-next');
        expect(visibleStep()).toBe('3');
        click('assign-source-position');
        click('wizard-next');
        expect(visibleStep()).toBe('4');
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        click('wizard-back');
        expect(visibleStep()).toBe('3');
        expect(document.querySelector('[data-r07-action="assign-source-position"]').getAttribute('aria-pressed')).toBe('true');
        click('wizard-next');
        expect(document.querySelector('[data-modal-overlay]')).toBe(overlay);
        expect(apply).not.toHaveBeenCalled();
        click('apply');
        expect(apply).toHaveBeenCalledWith(expect.objectContaining({
            targetProjectId: project.id, positionIds: ['pos-w'], leaderIds: ['lead-w'],
            employees: [expect.objectContaining({ id: 'emp-w' })]
        }));
        await Promise.resolve();
        await Promise.resolve();
    });
    test('skips empty leader and position steps', async () => {
        state.employees = [{ id: 'emp-w', number: '1', name: 'Ana', positions: [] }];
        state.positions = [];
        state.leaders = [];
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('wizard-next');
        click('wizard-next');
        expect(visibleStep()).toBe('4');
        expect(apply).not.toHaveBeenCalled();
    });
    test('changing destination clears dependent resolutions', async () => {
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('wizard-next');
        click('wizard-next');
        click('create-leader');
        expect(document.querySelector('[data-r07-leader-name]').value).toBe('Pedro');
        click('wizard-back');
        click('wizard-back');
        change('[name="r07-recon-action"][value="create"]');
        expect(document.querySelector('[data-r07-leader-name]')).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });
    test.each(['map', 'create'])('quick assignment to %s previews all entities without saving', async action => {
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="' + action + '"]');
        if (action === 'map') change('[data-r07-control="target-project"]', project.id);
        else {
            const input = document.querySelector('[data-r07-control="create-name"]');
            input.value = 'Obra Sur';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        click('quick-assign');
        expect(visibleStep()).toBe('4');
        expect(apply).not.toHaveBeenCalled();
        expect(document.querySelector('.r07-wizard-details').open).toBe(false);
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        click('apply');
        expect(apply).toHaveBeenCalledWith(expect.objectContaining({
            positionIds: ['pos-w'], leaderIds: ['lead-w'],
            employees: [expect.objectContaining({ id: 'emp-w' })]
        }));
        await Promise.resolve();
        await Promise.resolve();
    });
    test('quick assignment stops for positions that belong to another project', async () => {
        state.positions[0].projectId = 'PRJ-other';
        setup.mockResolvedValue({
            enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id,
            projects: [project, { id: 'PRJ-other', name: 'Otra obra', status: 'active' }]
        });
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('quick-assign');
        expect(visibleStep()).toBe('3');
        expect(apply).not.toHaveBeenCalled();
        expect(document.querySelector('[data-r07-action="wizard-next"]').disabled).toBe(true);
    });

    test('catalog-only quick assignment remains actionable without employees', async () => {
        state.employees = [];
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('quick-assign');
        expect(visibleStep()).toBe('4');
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        expect(apply).not.toHaveBeenCalled();
    });
    test.each(['map', 'create'])('cash-only quick assignment to %s reaches final review', async action => {
        state.employees = []; state.positions = []; state.leaders = [];
        cashRead.mockResolvedValue([
            { id: 'cash-orphan', name: 'Gastos', officialProjectId: 'missing' },
            { id: 'cash-valid', name: 'Caja válida', officialProjectId: project.id }
        ]);
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="' + action + '"]');
        if (action === 'map') change('[data-r07-control="target-project"]', project.id);
        else {
            const input = document.querySelector('[data-r07-control="create-name"]');
            input.value = 'Obra Sur';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        expect(document.querySelector('[data-r07-cash-id="cash-valid"]')).toBeNull();
        click('quick-assign');
        expect(visibleStep()).toBe('4');
        expect(apply).not.toHaveBeenCalled();
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        click('apply');
        expect(apply).toHaveBeenCalledWith(expect.objectContaining({
            employees: [], pettyCashIds: ['cash-orphan']
        }));
        await Promise.resolve(); await Promise.resolve();
    });

    test('Claude M2: deselecting people clears unused leader copies before applying', async () => {
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('wizard-next'); click('wizard-next'); click('create-leader');
        click('wizard-back'); click('toggle-all');
        expect(document.querySelector('[data-r07-leader-name]')).toBeNull();
        expect(apply).not.toHaveBeenCalled();
    });
    test('Claude M3: final review exposes leader conflicts when the position step was skipped', async () => {
        state.positions = [];
        state.employees[0].positions = [];
        state.employees.push({ id: 'unselected', number: '2', name: 'Luis', projectId: 'PRJ-other', leaderId: 'lead-w', positions: [] });
        setup.mockResolvedValue({ enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id,
            projects: [project, { id: 'PRJ-other', name: 'Otra', status: 'active' }] });
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('wizard-next'); click('wizard-next'); click('assign-source-leader'); click('wizard-next');
        expect(visibleStep()).toBe('4');
        expect(document.querySelector('[data-r07-step="4"] .r07-recon-blocker')).not.toBeNull();
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(true);
    });

    test('financial blocker shows the foreign closure and allows reviewing recovery on the blocked step', async () => {
        state.employees = [{ id: 'emp-w', number: '1', name: 'Ana', positions: [],
            loans: [{ id: 'loan-w', amount: 100, payments: [
                { id: 'pay-w', amount: 10, source: 'payroll', payrollClosureId: 'missing-<closure>' }
            ] }] }];
        state.positions = []; state.leaders = [];
        setup.mockResolvedValue({ enabled: true, ready: true, activeProjectId: project.id, defaultProjectId: project.id,
            projects: [project, { id: 'foreign', name: 'Otra obra', status: 'active' }] });
        cashRead.mockImplementation(async store => store === 'payrollClosures' ? [{ id: 'missing-<closure>', projectId: 'foreign' }] : []);
        const original = JSON.stringify(state.employees);
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('quick-assign');
        const step = document.querySelector('[data-r07-step]:not([hidden])');
        const alert = step.querySelector('.r07-recon-blocker');
        expect(alert.textContent).toContain('pertenece a otra obra');
        expect(alert.textContent).toContain('missing-<closure>');
        expect(alert.querySelector('closure')).toBeNull();
        expect(alert.textContent).toContain('Ana');
        const toggle = step.querySelector('[data-r07-financial-recovery]');
        expect(toggle).not.toBeNull();
        expect(toggle.checked).toBe(true);
        expect(apply).not.toHaveBeenCalled();
        expect(JSON.stringify(state.employees)).toBe(original);
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        click('wizard-next');
        expect(visibleStep()).toBe('4');
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(JSON.stringify(state.employees)).toBe(original);
    });

    test('missing orphan closure reaches final review with a warning and no preview writes', async () => {
        state.employees = [{ id: 'EMP1769317082863', number: '1', name: 'Wadne Exilien', positions: [],
            loans: [{ id: 'LOAN-msxkousx-a-8at1ve', amount: 100, payments: [
                { id: 'PAYROLL-erodn21d0ufo0', amount: 10, source: 'payroll', payrollClosureId: 'PAYROLL-CLOSURE-127z9jc1yh3evo' }
            ] }] }];
        state.positions = []; state.leaders = [];
        const original = JSON.stringify(state.employees);
        await openProjectReconciliation();
        change('[name="r07-recon-action"][value="map"]');
        change('[data-r07-control="target-project"]', project.id);
        click('quick-assign');
        expect(visibleStep()).toBe('4');
        const step = document.querySelector('[data-r07-step="4"]');
        expect(step.querySelector('.r07-recon-blocker')).toBeNull();
        expect(step.querySelector('[data-r07-financial-warnings]').textContent).toContain('PAYROLL-CLOSURE-127z9jc1yh3evo');
        expect(step.querySelector('[data-r07-financial-warnings]').textContent).toContain('Wadne Exilien');
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(JSON.stringify(state.employees)).toBe(original);
    });

});
