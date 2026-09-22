import fs from 'fs';
import path from 'path';
import { mountProjectOnboarding } from '../modules/features/projects/ProjectOnboarding.js';

describe('R07 UX — nueva obra debe quedar activa antes de crear personal o puestos', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.restoreAllMocks();
    });

    test('Ajustes usa el onboarding estructurado como ruta principal de Nuevo proyecto', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../modules/features/projects/ProjectsUI.js'),
            'utf8'
        );
        expect(source).toContain("import { mountProjectOnboarding } from './ProjectOnboarding.js'");
        expect(source).toContain('mountProjectOnboarding(createSlot');
        expect(source).not.toContain('mountProjectCreateForm(createSlot');
    });
    test('onSuccess recibe el estado POST-switch de la obra recién creada', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const oldProject = { id: 'PRJ-OLD', name: 'Obra anterior', status: 'active' };
        const newProject = { id: 'PRJ-NEW', name: 'Obra nueva', status: 'active' };
        const oldState = {
            enabled: true,
            ready: true,
            activeProjectId: oldProject.id,
            defaultProjectId: oldProject.id,
            activeProject: oldProject,
            projects: [oldProject]
        };
        const newState = {
            enabled: true,
            ready: true,
            activeProjectId: newProject.id,
            defaultProjectId: oldProject.id,
            activeProject: newProject,
            projects: [oldProject, newProject]
        };
        let switched = false;
        const setupService = {
            store: {
                listAll: jest.fn(async () => switched ? newState.projects : oldState.projects)
            },
            createEmptyProject: jest.fn(async ({ name }) => ({
                project: { ...newProject, name },
                state: oldState
            })),
            switchActiveProject: jest.fn(async id => {
                expect(id).toBe(newProject.id);
                switched = true;
                return { activeProjectId: id, activeProject: newProject, state: newState };
            }),
            getState: jest.fn(async () => switched ? newState : oldState)
        };
        const onSuccess = jest.fn();

        mountProjectOnboarding(container, {
            setupService,
            persistenceService: { saveApplicationData: jest.fn(async () => ({ localOk: true })) },
            onSuccess
        });
        const input = container.querySelector('[data-field="projectName"]');
        input.value = 'Obra nueva';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        container.querySelector('[data-act="next"]').click();
        expect(container.querySelector('[data-od-id="od-ready"]')).toBeTruthy();

        container.querySelector('[data-act="next"]').click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(setupService.switchActiveProject).toHaveBeenCalledWith(newProject.id);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0]).toEqual(expect.objectContaining({ id: newProject.id }));
        expect(onSuccess.mock.calls[0][1]).toEqual(expect.objectContaining({
            activeProjectId: newProject.id,
            activeProject: expect.objectContaining({ id: newProject.id })
        }));
    });
});
