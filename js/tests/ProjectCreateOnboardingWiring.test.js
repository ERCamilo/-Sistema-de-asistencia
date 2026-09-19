import fs from 'fs';
import path from 'path';
import { projectContext, setActiveProjectId } from '../modules/features/projects/ProjectContext.js';
import { ProjectStore } from '../modules/features/projects/ProjectStore.js';
import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import {
    openProjectCreateModal,
    closeProjectCreateModal
} from '../modules/features/projects/ProjectCreateUI.js';

describe('Contract D: ProjectCreateUI Wiring & Non-Reload Project Switch Refresh', () => {
    let mockStore;
    let setupService;

    beforeEach(() => {
        setProjectsEnabled(true);
        const projects = [
            { id: 'PRJ-A', name: 'Obra Alpha', status: 'active', schemaVersion: 1, createdAt: 100, updatedAt: 100 },
            { id: 'PRJ-B', name: 'Obra Beta', status: 'active', schemaVersion: 1, createdAt: 200, updatedAt: 200 }
        ];

        mockStore = {
            get: jest.fn(async id => projects.find(p => p.id === id) || null),
            listAll: jest.fn(async () => projects.map(p => ({ ...p }))),
            create: jest.fn(async p => ({ ...p })),
            update: jest.fn(async p => ({ ...p }))
        };

        setupService = new ProjectSetupService({
            store: mockStore,
            getScope: async () => ({ enabled: true, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' }),
            flags: { isEnabled: () => true, setEnabled: () => {} },
            setActiveId: id => projectContext.setActiveProjectId(id)
        });
    });

    afterEach(() => {
        closeProjectCreateModal();
        setProjectsEnabled(false);
    });

    test('ProjectCreateUI: openProjectCreateModal connects to structured onboarding experience instead of raw flat form', async () => {
        const modalEl = await openProjectCreateModal({ setupService });
        expect(modalEl).toBeTruthy();

        // Must offer structured onboarding entry points (step selection or wizard modes)
        // rather than only the legacy single input "Crear proyecto vacío"
        const hasOnboardingCapabilities = !!modalEl.querySelector(
            '[data-project-onboarding], [data-mode="empty"], [data-mode="copy"], [data-mode="manual"], [data-project-create-mode]'
        );

        expect(hasOnboardingCapabilities).toBe(true);
    });

    test('Project switch: changes active project without window.location.reload', async () => {
        // Spy on location.reload if present in jsdom
        const reloadSpy = jest.fn();
        delete window.location;
        window.location = { reload: reloadSpy, href: 'http://localhost/' };

        projectContext.store = mockStore;

        // Perform project switch from A to B
        await setupService.switchActiveProject('PRJ-B');

        // Reload must NEVER be called
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    test('Source contract: app.js projectContext subscription must trigger UI render on project switch', () => {
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        // Locate projectContext.subscribe in app.js
        const subIndex = appSource.indexOf('projectContext.subscribe(');
        expect(subIndex).toBeGreaterThan(-1);

        const subSnippet = appSource.slice(subIndex, subIndex + 500);

        // Finding 7: Switching projects must refresh counters and filters without reload
        // Currently, app.js only refreshes the header name (refreshHeaderActiveProjectName),
        // but does not trigger render() or refresh the active tab/sidebar
        const triggersRender = /(?:render\(\)|window\.render\(\)|stateManager\.render\(\))/.test(subSnippet);
        expect(triggersRender).toBe(true);
    });
});
