import { readySection, renderOnboarding } from '../modules/ui/onboarding/OnboardingView.js';
import { defaultState } from '../modules/ui/onboarding/OnboardingCore.js';

describe('Onboarding ready summary', () => {
    test('renders restored company, positions and employees from the completed action summary', () => {
        const html = readySection({
            source: 'backup',
            company: '',
            employees: [],
            days: [true, true, true, true, true, true, false],
            hours: 8,
            posName: '',
            posRate: '',
            readySummary: { company: 'Constructora Restaurada', employeeCount: 7, positionCount: 3 }
        });
        expect(html).toContain('Constructora Restaurada');
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
