import { state } from '../modules/core/AppState.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    registerProjectReconciliationGlobals,
    openProjectReconciliation,
    closeProjectReconciliation
} from '../modules/features/projects/ProjectReconciliationUI.js';

const projectId = 'PRJ-active-1';
const source = {
    id: 'historic-closure-with-deleted-employee',
    projectId: 'deleted-work-id', fingerprint: 'historic-fingerprint',
    periodStart: '2026-10-01', periodEnd: '2026-10-15',
    rows: [{ employeeId: 'deleted-employee', employeeName: 'Empleado eliminado' }]
};

describe('recovering a closure when the only pending issue is a missing employee', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        registerProjectReconciliationGlobals();
        setProjectsEnabled(true);
        state.employees = []; state.attendance = {}; state.positions = []; state.leaders = [];
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true, activeProjectId: projectId, defaultProjectId: projectId,
            projects: [{ id: projectId, status: 'active', name: 'Nueva obra' }]
        });
        jest.spyOn(indexedDBService, 'getAll').mockImplementation(async store =>
            store === 'payrollClosures' ? [source] : []);
    });
    afterEach(() => {
        closeProjectReconciliation();
        jest.restoreAllMocks();
    });

    test('offers a target selector for orphan financial-only data, without generic Apply', async () => {
        await openProjectReconciliation();
        const selector = document.querySelector('[data-r07-control="historical-target-project"]');
        expect(selector).not.toBeNull();
        expect(document.querySelector('[data-r07-action="apply"]')).toBeNull();
        let action = document.querySelector('[data-r07-action="recover-historical-closure"]');
        expect(action).not.toBeNull();
        expect(action.disabled).toBe(true);
        selector.value = projectId;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        action = document.querySelector('[data-r07-action="recover-historical-closure"]');
        expect(action.disabled).toBe(false);
        expect(document.querySelector('select[data-r07-control="historical-target-project"]').value).toBe(projectId);
        expect(document.querySelector('[data-r07-action="close"]')).not.toBeNull();
        document.querySelector('[data-r07-action="close"]').click();
        // Modal.close animates removal. Its closing flag appears immediately.
        expect(document.querySelector('[data-modal-overlay][data-modal-closing="true"]')).not.toBeNull();
    });
});
