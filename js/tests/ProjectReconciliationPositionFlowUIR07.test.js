import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import {
    openProjectReconciliation,
    closeProjectReconciliation,
    registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

const P1 = { id: 'PRJ-ui-source', name: 'Obra Origen', status: 'active' };
const P2 = { id: 'PRJ-ui-target', name: 'Obra Destino', status: 'active' };
const MISSING = 'PRJ-ui-missing';
const OLD_POS = { id: 'POS-ui-old', name: 'Albañil viejo', projectId: P1.id, active: true };
const TARGET_POS = { id: 'POS-ui-target', name: 'Albañil destino', projectId: P2.id, active: true };

describe('ProjectReconciliationPositionFlowUIR07', () => {
    let getStateSpy;

    beforeEach(() => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: P1.id, defaultProjectId: P1.id });
        registerProjectReconciliationGlobals();
        const emp = {
            id: 'emp-ui-remap', number: '34', name: 'Andres Sanchez',
            active: true, projectId: MISSING, positions: [OLD_POS.id],
            positionSalaries: { [OLD_POS.id]: 150 }
        };
        const key = emp.id + '-2026-09-18';
        state.employees = [emp];
        state.positions = [OLD_POS, TARGET_POS];
        state.leaders = [];
        state.attendance = {
            [key]: {
                key, employeeId: emp.id, date: '2026-09-18',
                present: true, hoursWorked: 8, projectId: MISSING,
                selectedPosition: OLD_POS.id
            }
        };
        getStateSpy = jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true,
            activeProjectId: P1.id, defaultProjectId: P1.id,
            activeProject: P1, projects: [P1, P2]
        });
    });

    afterEach(() => {
        closeProjectReconciliation();
        getStateSpy?.mockRestore();
        resetEntityScope();
        document.body.innerHTML = '';
    });
    test('turns a cross-project position blocker into a guided target-position choice', async () => {
        await openProjectReconciliation();

        const mapChoice = document.querySelector('input[name="r07-recon-action"][value="map"]');
        mapChoice.click();

        const projectSelect = document.querySelector('[data-r07-control="target-project"]');
        projectSelect.value = P2.id;
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));

        const positionSelect = document.querySelector('[data-r07-position-target]');
        expect(positionSelect).toBeTruthy();
        expect(positionSelect.textContent).toContain('Albañil destino');
        expect(document.querySelector('.r07-position-remap').textContent).toContain('Obra Destino');
        expect(document.querySelector('.r07-position-remap').textContent).toContain('1 día');
        expect(document.querySelector('.r07-position-remap').textContent).toContain('8h');

        const apply = document.querySelector('[data-r07-action="apply"]');
        expect(apply.disabled).toBe(true);
    });
    test('guided position choice reassigns worked-day history and enables the move', async () => {
        await openProjectReconciliation();
        document.querySelector('input[name="r07-recon-action"][value="map"]').click();

        const projectSelect = document.querySelector('[data-r07-control="target-project"]');
        projectSelect.value = P2.id;
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));

        const positionSelect = document.querySelector('[data-r07-position-target]');
        positionSelect.value = TARGET_POS.id;
        positionSelect.dispatchEvent(new Event('change', { bubbles: true }));

        expect(document.querySelector('.r07-position-remap').textContent).toContain('Días que se reasignarán');
        expect(document.querySelector('[data-r07-action="apply"]').disabled).toBe(false);
    });
});
