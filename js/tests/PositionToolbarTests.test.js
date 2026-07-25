import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';

describe('barra superior de puestos', () => {
    beforeEach(() => {
        EmployeesUI.init({
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        });
        state.employeeViewMode = 'positions';
        state.positions = [
            { id: 'low', name: 'Ayudante', hourlyRate: 100, active: true, workingDays: [1, 2, 3, 4, 5] },
            { id: 'high', name: 'Capataz', hourlyRate: 250, active: true, workingDays: [1, 2, 3, 4, 5] }
        ];
        state.employees = [
            { id: 'e1', active: true, positions: ['low'] },
            { id: 'e2', active: true, positions: ['low'] },
            { id: 'e3', active: true, positions: ['low'] }
        ];
        state.leaders = [];
        state.positionFilters = { search: '', leaderId: 'all', status: 'active' };
        state.positionSortBy = 'salary';
        state.settings.regularHoursPerDay = 8;
    });

    test('muestra búsqueda amplia, filtros secundarios y orden por tarifa real', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="position-toolbar"');
        expect(html).toContain('placeholder="Buscar posición..."');
        expect(html).toContain('class="position-toolbar__filters"');
        expect(html).toContain('Por tarifa');
        expect(html.indexOf('Capataz')).toBeLessThan(html.indexOf('Ayudante'));
    });

    test('preselecciona cantidad de empleados y mantiene igual la tarjeta colapsada', () => {
        state.positionSortBy = undefined;

        const html = EmployeesUI.EmployeesTab();

        expect(html).toMatch(/class="active"[^>]+data-value="employees"/);
        expect(html.indexOf('Ayudante')).toBeLessThan(html.indexOf('Capataz'));
        expect(html).toContain('class="position-card__employee-count"');
        expect(html).not.toContain('position-card__people-toggle');
    });
});
