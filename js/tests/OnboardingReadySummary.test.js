import { readySection, projectSection, renderOnboarding } from '../modules/ui/onboarding/OnboardingView.js';
import { defaultState, saveProgress, restoreProgress } from '../modules/ui/onboarding/OnboardingCore.js';

describe('Onboarding ready summary', () => {
    test('confirmación lista obras recuperadas y aclara que el nombre no crea otra obra', () => {
        const html = projectSection({
            ...defaultState(), phase: 'project', source: 'backup', projectName: 'Obra Sur',
            recoveredProjects: [{ id: 'A', name: 'Torre Norte' }, { id: 'B', name: 'Obra Sur' }]
        });
        const host = document.createElement('div');
        host.innerHTML = html;
        expect(host.querySelector('[data-od-id="od-recovered-projects"]').textContent).toContain('Torre Norte');
        expect(host.querySelector('#f-project-confirm').value).toBe('Obra Sur');
        expect(host.textContent).toContain('Cambiar el nombre conserva la obra y sus datos');
    });

    test('la recarga programada tras restaurar conserva los nombres de las obras en la confirmación', () => {
        const state = { ...defaultState(), phase: 'project', source: 'backup', projectName: 'Obra Sur',
            recoveredProjects: [{ id: 'A', name: 'Torre Norte' }, { id: 'B', name: 'Obra Sur' }] };
        saveProgress(localStorage, state);
        const resumed = restoreProgress(localStorage, defaultState());
        expect(resumed.phase).toBe('project');
        expect(resumed.recoveredProjects).toEqual(state.recoveredProjects);
        expect(projectSection(resumed)).toContain('Torre Norte');
        localStorage.removeItem('onboarding-pos');
    });
    test('renders restored company, positions and employees from the completed action summary', () => {
        const html = readySection({
            source: 'backup',
            company: '',
            employees: [],
            days: [true, true, true, true, true, true, false],
            hours: 8,
            posName: '',
            posRate: '',
            projectName: 'Torre Restaurada',
            readySummary: { company: 'Constructora Restaurada', projectName: 'Torre Restaurada', employeeCount: 7, positionCount: 3 }
        });
        expect(html).toContain('Constructora Restaurada');
        expect(html).toContain('Torre Restaurada');
        expect(html).toContain('7 empleados');
        expect(html).toContain('Posiciones');
        expect(html).toContain('>3<');
        expect(html).not.toContain('Restauración de datos disponible en una fase posterior');
    });

    test('ready footer exposes only one Continue action and no Back control', () => {
        const html = renderOnboarding({
            ...defaultState(),
            phase: 'ready',
            source: 'backup',
            readySummary: { company: 'Obra Norte', employeeCount: 3, positionCount: 2 }
        });
        const host = document.createElement('div');
        host.innerHTML = html;
        const footer = host.querySelector('[data-od-id="od-footer"]');
        expect(footer).not.toBeNull();
        expect(footer.querySelector('[data-act="back"]')).toBeNull();
        const next = footer.querySelector('[data-act="next"]');
        expect(next).not.toBeNull();
        expect(next.textContent).toContain('Continuar');
        expect(footer.querySelectorAll('button')).toHaveLength(1);
    });

});
