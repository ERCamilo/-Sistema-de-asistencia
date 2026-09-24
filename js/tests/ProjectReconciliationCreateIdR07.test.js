import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { Project } from '../modules/features/projects/Project.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

/**
 * ProjectReconciliationCreateIdR07 — the create-project draft keeps ONE stable
 * projectId across retries in the same modal: re-entering the "create" choice
 * after moving away does not regenerate a fresh id (Project.create is called
 * exactly once for the draft).
 */
const P1 = { id: 'PRJ-create-1', name: 'Obra', status: 'active' };

describe('ProjectReconciliationCreateIdR07', () => {
    let getStateSpy;
    let createSpy;

    beforeEach(() => {
        setProjectsEnabled(true);
        registerProjectReconciliationGlobals();
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            activeProjectId: P1.id,
            defaultProjectId: P1.id,
            activeProject: P1,
            projects: [P1]
        });
        state.employees = [{ id: 'emp-orphan', number: '34', name: 'Andres', active: true, projectId: 'PRJ-missing' }];
        state.positions = [];
        state.leaders = [];
        state.attendance = {};
        createSpy = jest.spyOn(Project, 'create');
    });

    afterEach(() => {
        getStateSpy.mockRestore();
        createSpy.mockRestore();
        closeProjectReconciliation();
        document.body.innerHTML = '';
    });

    function pickAction(dialog, value) {
        const radio = dialog.querySelector('input[type="radio"][name="r07-recon-action"][value="' + value + '"]');
        expect(radio).toBeTruthy();
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        return document.body.querySelector('[role="dialog"]');
    }

    test('re-entering the create choice reuses the same draft projectId (no fresh id per retry)', async () => {
        await openProjectReconciliation();
        let dialog = document.body.querySelector('[role="dialog"]');

        dialog = pickAction(dialog, 'create');
        expect(createSpy).toHaveBeenCalledTimes(1);

        // Move away and back to "create": the draft id must be retained, not regenerated.
        dialog = pickAction(dialog, 'map');
        dialog = pickAction(dialog, 'create');
        expect(createSpy).toHaveBeenCalledTimes(1);

        dialog = pickAction(dialog, 'map');
        dialog = pickAction(dialog, 'create');
        expect(createSpy).toHaveBeenCalledTimes(1);

        // The create input renders the stability hint for the user.
        const nameInput = dialog.querySelector('input[data-r07-control="create-name"]');
        expect(nameInput).toBeTruthy();
        expect(nameInput.type).toBe('text');
        expect(dialog.textContent).toContain('Se creará una única obra nueva');
    });
});
