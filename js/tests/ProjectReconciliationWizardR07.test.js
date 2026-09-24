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

});
