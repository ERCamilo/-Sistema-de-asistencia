import { openProjectSetupModal, closeProjectSetupModal } from '../modules/features/projects/ProjectsUI.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { openProjectDuplicatesScreen } from '../modules/ui/ProjectDuplicatesScreenBoot.js';
import { isProjectDuplicatesEnabled, setProjectDuplicatesEnabled } from '../modules/config/FeatureFlags.js';
import { state } from '../modules/core/AppState.js';

jest.mock('../modules/ui/ProjectDuplicatesScreenBoot.js', () => ({
    openProjectDuplicatesScreen: jest.fn().mockResolvedValue({ overlay: {} })
}));
jest.mock('../modules/features/projects/ProjectListUI.js', () => ({
    mountProjectList: jest.fn(() => ({ update: jest.fn() })),
    openProjectListModal: jest.fn(),
    closeProjectListModal: jest.fn(),
    renderProjectListHTML: jest.fn()
}));

/**
 * La revisión de obras repetidas es una función en preparación: solo aparece
 * en Ajustes → Proyectos con la bandera encendida y si hay pares sospechosos.
 */
const person = (id, number, name, projectId) => ({ id, number, name, projectId, loans: [] });
const SHARED = [['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre']];
const crew = (projectId, prefix) => SHARED.map(([number, name], i) => person(`${prefix}${i}`, number, name, projectId));

function setup(projects) {
    jest.spyOn(projectSetupService, 'getState').mockResolvedValue({
        enabled: true, ready: true, defaultProjectId: 'PRJ-A', activeProjectId: 'PRJ-A',
        activeProject: { id: 'PRJ-A', name: 'Torre Norte' }, projects
    });
}
const twoProjects = (extra = {}) => [
    { id: 'PRJ-A', name: 'Torre Norte', status: 'active', ...extra },
    { id: 'PRJ-B', name: 'Edificio Sur', status: 'active' }
];

describe('bandera de obras repetidas', () => {
    beforeEach(() => localStorage.clear());
    test('está apagada por defecto y se enciende y apaga', () => {
        expect(isProjectDuplicatesEnabled()).toBe(false);
        setProjectDuplicatesEnabled(true);
        expect(isProjectDuplicatesEnabled()).toBe(true);
        setProjectDuplicatesEnabled(false);
        expect(isProjectDuplicatesEnabled()).toBe(false);
    });
    test('cualquier valor distinto de «true» es apagada', () => {
        localStorage.setItem('asistencia_feature_project_duplicates', 'TRUE');
        expect(isProjectDuplicatesEnabled()).toBe(false);
    });
    test('si el almacenamiento falla, queda apagada', () => {
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        try { expect(isProjectDuplicatesEnabled()).toBe(false); } finally { spy.mockRestore(); }
    });
});

describe('aviso en Ajustes → Proyectos', () => {
    let previous;
    beforeEach(() => {
        localStorage.clear();
        previous = { employees: state.employees, attendance: state.attendance };
        state.employees = [...crew('PRJ-A', 'a'), ...crew('PRJ-B', 'b')];
        state.attendance = {};
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeProjectSetupModal();
        state.employees = previous.employees;
        state.attendance = previous.attendance;
        jest.restoreAllMocks();
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    test('con la bandera apagada no aparece aunque haya obras repetidas', async () => {
        setup(twoProjects());
        await openProjectSetupModal();
        expect(document.querySelector('[data-project-duplicates]')).toBeNull();
    });

    test('con la bandera encendida y un par sospechoso, ofrece revisarlo', async () => {
        setProjectDuplicatesEnabled(true);
        setup(twoProjects());
        await openProjectSetupModal();
        const notice = document.querySelector('[data-project-duplicates]');
        expect(notice.textContent).toContain('1 posible obra repetida');
        document.querySelector('[data-project-duplicates-open]').click();
        await Promise.resolve();
        expect(openProjectDuplicatesScreen).toHaveBeenCalledTimes(1);
        expect(document.getElementById('project-setup-modal')).toBeNull();
    });

    test('al cerrar la pantalla vuelve a abrir Proyectos', async () => {
        jest.useFakeTimers();
        try {
            setProjectDuplicatesEnabled(true);
            setup(twoProjects());
            await openProjectSetupModal();
            document.querySelector('[data-project-duplicates-open]').click();
            await Promise.resolve();
            const { onClose } = openProjectDuplicatesScreen.mock.calls[0][0];
            onClose();
            jest.advanceTimersByTime(400);
            await Promise.resolve();
            expect(projectSetupService.getState).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    test('sin pares sospechosos no aparece', async () => {
        setProjectDuplicatesEnabled(true);
        state.employees = [...crew('PRJ-A', 'a')];
        setup(twoProjects());
        await openProjectSetupModal();
        expect(document.querySelector('[data-project-duplicates]')).toBeNull();
    });

    test('un par descartado con «No son la misma» no vuelve a avisar', async () => {
        setProjectDuplicatesEnabled(true);
        setup(twoProjects({ notSameAs: ['PRJ-B'] }));
        await openProjectSetupModal();
        expect(document.querySelector('[data-project-duplicates]')).toBeNull();
    });

    test('si la comparación falla, el modal de Proyectos sigue funcionando', async () => {
        setProjectDuplicatesEnabled(true);
        setup([{ name: 'Rota', status: 'active', get id() { throw new Error('boom'); } }, ...twoProjects()]);
        await openProjectSetupModal();
        expect(document.querySelector('[data-project-review-assignments]')).not.toBeNull();
        expect(document.querySelector('[data-project-duplicates]')).toBeNull();
    });
});
