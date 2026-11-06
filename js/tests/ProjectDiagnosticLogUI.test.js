import { state } from '../modules/core/AppState.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    registerProjectReconciliationGlobals, openProjectReconciliation,
    closeProjectReconciliation
} from '../modules/features/projects/ProjectReconciliationUI.js';

describe('diagnostic report button in Multiobra', () => {
    beforeEach(() => {
        registerProjectReconciliationGlobals();
        setProjectsEnabled(true);
        document.body.innerHTML = '';
        state.employees = []; state.positions = []; state.leaders = []; state.attendance = {};
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true, ready: true, activeProjectId: 'A', defaultProjectId: 'A',
            projects: [{ id: 'A', name: 'Obra 1', status: 'active' }]
        });
        jest.spyOn(indexedDBService, 'getAll').mockImplementation(async store =>
            store === 'payrollClosures' ? [{ id: 'closure-orphan', projectId: 'missing',
                periodStart: '2026-10-01', periodEnd: '2026-10-15', fingerprint: 'x',
                rows: [{ employeeId: 'deleted' }] }] : []);
    });
    afterEach(() => { closeProjectReconciliation(); jest.restoreAllMocks(); });
    test('diagnostic-only wizard exposes a voluntary .log action and a close control', async () => {
        await openProjectReconciliation();
        const button = document.querySelector('[data-r07-action="share-diagnostics"]');
        expect(button).not.toBeNull();
        expect(button.textContent).toContain('.log');
        expect(document.querySelector('[data-r07-action="close"]')).not.toBeNull();
    });
});
