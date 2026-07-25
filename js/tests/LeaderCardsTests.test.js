import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { layoutLeaderCardGrid, setLeaderSortBy } from '../modules/features/employees/LeadersList.js';

describe('tarjetas y barra superior de líderes', () => {
    beforeEach(() => {
        EmployeesUI.init({
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        });
        state.employeeViewMode = 'leaders';
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        state.leaderSortBy = undefined;
        state.leaders = [
            { id: 'low', number: 2, name: 'Alba', active: true },
            { id: 'high', number: 1, name: 'Roberto', active: true }
        ];
        state.positions = [
            { id: 'p-low', name: 'Albañil', active: true, leaderId: 'low' },
            { id: 'p-high', name: 'Capataz', active: true, leaderId: 'high' }
        ];
        state.employees = [
            { id: 'e1', number: 1, name: 'Uno', active: true, positions: ['p-high'] },
            { id: 'e2', number: 2, name: 'Dos', active: true, positions: ['p-high'] },
            { id: 'e3', number: 3, name: 'Tres', active: true, positions: ['p-low'] }
        ];
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('usa la barra compacta y ordena por empleados de forma predeterminada', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="position-toolbar leader-toolbar"');
        expect(html).toContain('placeholder="Buscar líder por nombre o código..."');
        expect(html).toMatch(/class="active"[^>]+data-value="employees"/);
        expect(html.indexOf('Roberto')).toBeLessThan(html.indexOf('Alba'));
    });

    test('mantiene una tarjeta compacta y el detalle se expande por separado', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="leader-card__employee-count"');
        expect(html).toContain('class="leader-card__people" hidden');
        expect(html).toContain('data-action="open-leader-icon"');
        expect(html).toContain('title="Cambiar icono"');
        expect(html).not.toContain('style="display: none');
    });

    test('el cambio de orden acepta nombre y protege el valor predeterminado', () => {
        setLeaderSortBy('name');
        expect(state.leaderSortBy).toBe('name');

        setLeaderSortBy('invalid');
        expect(state.leaderSortBy).toBe('employees');
    });

    test('la grilla calcula una altura independiente para cada tarjeta', () => {
        document.body.innerHTML = `
            <div class="leader-card-grid" style="grid-auto-rows: 8px; row-gap: 12px;">
                <article class="leader-card" id="short"></article>
                <article class="leader-card" id="expanded"></article>
            </div>
        `;
        const short = document.querySelector('#short');
        const expanded = document.querySelector('#expanded');
        short.getBoundingClientRect = () => ({ height: 93 });
        expanded.getBoundingClientRect = () => ({ height: 293 });

        layoutLeaderCardGrid();

        expect(short.style.gridRowEnd).toBe('span 6');
        expect(expanded.style.gridRowEnd).toBe('span 16');
    });
});
