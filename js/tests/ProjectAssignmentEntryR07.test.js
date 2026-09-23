import { openProjectSetupModal, closeProjectSetupModal } from '../modules/features/projects/ProjectsUI.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { openProjectReconciliation } from '../modules/features/projects/ProjectReconciliationUI.js';

jest.mock('../modules/features/projects/ProjectReconciliationUI.js', () => ({
    openProjectReconciliation: jest.fn().mockResolvedValue({ isOpen: true })
}));
jest.mock('../modules/features/projects/ProjectListUI.js', () => ({
    mountProjectList: jest.fn(() => ({ update: jest.fn() })),
    openProjectListModal: jest.fn(),
    closeProjectListModal: jest.fn(),
    renderProjectListHTML: jest.fn()
}));

describe('R07 acceso manual a asignaciones desde Proyectos', () => {
    beforeEach(() => {
        jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
            enabled: true,
            ready: true,
            defaultProjectId: 'PRJ-A',
            activeProjectId: 'PRJ-A',
            activeProject: { id: 'PRJ-A', name: 'Mi obra' },
            projects: [{ id: 'PRJ-A', name: 'Mi obra', status: 'active' }]
        });
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeProjectSetupModal();
        jest.restoreAllMocks();
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    test('ofrece revisión aun sin banner y abre un escaneo nuevo al pulsar', async () => {
        await openProjectSetupModal();
        const button = document.querySelector('[data-project-review-assignments]');
        expect(button?.textContent).toContain('Revisar asignaciones');
        button.click();
        await Promise.resolve();
        expect(openProjectReconciliation).toHaveBeenCalledTimes(1);
        expect(document.getElementById('project-setup-modal')).toBeNull();
    });
});
