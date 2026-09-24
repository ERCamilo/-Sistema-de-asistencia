import { state, stateManager } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import {
    refreshProjectReconciliationSnapshot,
    renderProjectReconciliationBanner,
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';
import { closeImportFullModal } from '../modules/features/export/ExportController.js';
import {
    beginFullImportIsolation,
    endFullImportIsolation
} from '../modules/services/PersistenceService.js';

const A = { id: 'PRJ-ux-a', name: 'Obra Norte', status: 'active' };
const B = { id: 'PRJ-ux-b', name: 'Obra Sur', status: 'active' };

function orphan(id, number) {
    return { id, number: String(number), name: 'Persona ' + number, active: true, positions: [], loans: [], projectId: 'PRJ-missing-999' };
}

describe('ProjectReconciliationUxHardeningR07', () => {
    let getStateSpy;

    beforeEach(() => {
        document.body.innerHTML = '';
        setProjectsEnabled(true);
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            activeProjectId: A.id,
            defaultProjectId: A.id,
            activeProject: A,
            projects: [A, B]
        });
        state.employees = [orphan('emp-34', 34), orphan('emp-405', 405)];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        registerProjectReconciliationGlobals();
    });

    afterEach(() => {
        closeProjectReconciliation();
        getStateSpy.mockRestore();
        document.body.innerHTML = '';
    });

    test('banner exposes the numeric pending count to assistive technology', async () => {
        await refreshProjectReconciliationSnapshot();
        document.body.innerHTML = renderProjectReconciliationBanner();
        const banner = document.querySelector('.r07-recon-banner');
        expect(banner.getAttribute('aria-label')).toMatch(/2 empleados pendientes de asignación/i);
    });

    test('create-and-assign rejects a duplicate project name before Apply becomes enabled', async () => {
        await openProjectReconciliation();
        const create = document.querySelector('input[name="r07-recon-action"][value="create"]');
        create.checked = true;
        create.dispatchEvent(new Event('change', { bubbles: true }));

        const input = document.querySelector('#r07-create-project-name');
        input.focus();
        input.value = '  obra   norte  ';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply.disabled).toBe(true);
        expect(document.querySelector('.modal-body').textContent).toMatch(/ya existe una obra.*Obra Norte/i);
        expect(document.activeElement?.id).toBe('r07-create-project-name');
    });

    test('orphan project technical id is not exposed as primary user copy', async () => {
        await openProjectReconciliation();
        expect(document.querySelector('.modal-body').textContent).not.toContain('PRJ-missing-999');
        expect(document.querySelector('.modal-body').textContent).toMatch(/obra (de origen )?no disponible/i);
    });

    test('positions without a valid project can be selected for a batch assignment', async () => {
        state.positions = [{ id: 'pos-orphan', name: 'Ayudante especial', active: true, projectId: 'PRJ-missing-pos' }];
        await openProjectReconciliation();
        const body = document.querySelector('.modal-body');
        expect(body.textContent).toContain('Ayudante especial');
        expect(body.querySelector('[data-r07-entity-select="positions:pos-orphan"]')).toBeTruthy();
        expect(body.querySelector('[data-r07-catalog-project]')).toBeNull();
        expect(body.querySelector('[data-r07-action="catalog-apply"]')).toBeNull();
        expect(body.querySelector('[data-r07-action="apply"]')).toBeTruthy();
    });

    test('FULL modal cannot be closed while the atomic FULL-import boundary is active', () => {
        const raw = stateManager.getState();
        raw.showImportFullModal = true;
        raw.importFullText = '{"data":{}}';
        beginFullImportIsolation();
        try {
            closeImportFullModal();
            expect(raw.showImportFullModal).toBe(true);
            expect(raw.importFullText).toBe('{"data":{}}');
        } finally {
            endFullImportIsolation();
            raw.showImportFullModal = false;
            raw.importFullText = '';
        }
    });
});
