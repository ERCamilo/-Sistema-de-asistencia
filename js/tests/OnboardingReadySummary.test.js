import { readySection } from '../modules/ui/onboarding/OnboardingView.js';

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
});
