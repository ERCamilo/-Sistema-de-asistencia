import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import {
    openEmployeeEditor,
    toggleEmployeeLeaderFilter,
    toggleEmployeePositionFilter
} from '../modules/features/employees/EmployeesList.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';

describe('directorio visual de empleados', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        EmployeesUI.init({
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        });
        state.employeeViewMode = 'employees';
        state.employeeFilters = {
            search: '',
            positionIds: [],
            leaderIds: [],
            status: 'active'
        };
        state.selectedPersonnelEmployeeId = null;
        state.settings.regularHoursPerDay = 8;
        state.positions = [{
            id: 'p1',
            name: 'Operador CTK',
            active: true,
            leaderId: 'l1',
            hourlyRate: 150,
            color: '#22c4c9',
            workingDays: [1, 2, 3, 4, 5]
        }];
        state.leaders = [{ id: 'l1', number: 1, name: 'Roberto', active: true }];
        state.employees = [
            {
                id: 'e1',
                key: 'e1',
                number: 1,
                name: 'Franklin',
                active: true,
                positions: ['p1'],
                positionSalaries: { p1: 150 },
                hireDate: '2026-01-25',
                lastStatusChange: '2026-03-18'
            },
            {
                id: 'e2',
                key: 'e2',
                number: 2,
                name: 'Pauliny',
                active: true,
                positions: ['p1'],
                positionSalaries: { p1: 160 }
            }
        ];
        state.attendance = {
            'e1-2026-05-15': {
                employeeId: 'e1',
                date: '2026-05-15',
                present: true,
                hoursWorked: 8,
                overtimeHours: 1,
                deletedAt: null
            }
        };
    });

    test('renderiza el directorio con contexto y filtros multiselección compactos', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="employee-toolbar"');
        expect(html).toContain('class="employee-table__header"');
        expect(html).not.toContain('class="employee-preview"');
        expect(html).toContain('class="personnel-page__context">Empleados</span>');
        expect(html).toContain('class="employee-multifilter');
        expect(html).toContain('Buscar puesto...');
        expect(html).toContain('Buscar líder...');
        expect(html).toContain('employee-multifilter__backdrop');
        expect(html).toContain('employee-multifilter__header');
        expect(html).toContain('data-action="close-employee-filter"');
        expect(html).toContain('employee-toolbar__status');
        expect(html).not.toContain('Mostrar ganancias por período');
        expect(html).toContain('id="employee-editor-panel"');
        expect(html).toContain('employee-list-row is-selected');
    });

    test('cierra el filtro desde la X, al tocar fuera y con Escape', () => {
        document.body.innerHTML = EmployeesUI.EmployeesTab();
        const filter = document.querySelector('[data-filter-kind="positions"]');
        const closeButton = filter.querySelector('.employee-multifilter__header [data-action="close-employee-filter"]');

        filter.open = true;
        closeButton.click();
        expect(filter.open).toBe(false);

        filter.open = true;
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(filter.open).toBe(false);

        filter.open = true;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(filter.open).toBe(false);
        expect(document.activeElement).toBe(filter.querySelector('summary'));
    });

    test('muestra ganancias diarias y mensuales a la vez sin alterar la tarifa guardada', () => {
        const originalSalary = state.employees[0].positionSalaries.p1;
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('$1,200');
        expect(html).toContain('/día');
        expect(html).toContain('$26,000');
        expect(html).toContain('/mes');
        expect(state.employees[0].positionSalaries.p1).toBe(originalSalary);
    });

    test('muestra un rango correcto cuando el empleado tiene tarifas en varios puestos', () => {
        state.positions.push({
            id: 'p2',
            name: 'Capataz',
            active: true,
            hourlyRate: 200,
            color: '#fb5265',
            workingDays: [1, 2, 3, 4, 5, 6]
        });
        state.employees[0].positions = ['p1', 'p2'];
        state.employees[0].positionSalaries = { p1: 150, p2: 200 };

        const html = EmployeesUI.EmployeesTab();
        expect(html).toContain('$26,000–$41,600');
        expect(html).toContain('$1,200–$1,600');
        expect(html).not.toContain('según puesto');
    });

    test('seleccionar una fila actualiza la selección persistente sin alterar empleados', () => {
        const employeesReference = state.employees;

        openEmployeeEditor('e2');

        expect(state.selectedPersonnelEmployeeId).toBe('e2');
        expect(state.employees).toBe(employeesReference);
    });

    test('en pantallas compactas mantiene el formulario como modal normal', () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = jest.fn().mockReturnValue({ matches: true });
        const openSpy = jest.spyOn(EmployeeModal, 'open').mockImplementation(() => {});

        openEmployeeEditor('e1');

        expect(openSpy).toHaveBeenCalledWith('e1');
        openSpy.mockRestore();
        window.matchMedia = originalMatchMedia;
    });

    test('puede montar el formulario existente dentro del panel sin overlay', () => {
        const host = document.createElement('aside');
        document.body.appendChild(host);

        EmployeeModal.open('e1', { inlineHost: host });

        expect(host.querySelector('.employee-inline-editor')).not.toBeNull();
        expect(host.querySelector('#empName').value).toBe('Franklin');
        expect(host.querySelector('.modal-overlay')).toBeNull();
        expect(document.body.style.overflow).toBe('');
        host.remove();
    });

    test('el número permanece visible como columna primaria y la fila abre el editor', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="employee-list-row__number">001</span>');
        expect(html).toContain('data-action="open-employee-editor" data-id="e1"');
        expect(html).toContain('style="--employee-position-color: #22c4c9;"');
        expect(html).toContain('employee-list-row__status is-active');
    });

    test('el botón de perfil usa un icono de persona y el lápiz conserva el editor lateral', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('data-action="open-employee-profile" data-id="e1"');
        expect(html).toContain('title="Ver perfil completo"');
        expect(html).toContain('employee-profile-icon');
        expect(html).toContain('data-action="open-employee-editor" data-id="e1"');
        expect(html).toContain('title="Editar"');
    });

    test('renderiza los iconos de todos los puestos como fondo decorativo', () => {
        state.positions.push({
            id: 'p2',
            name: 'Capataz',
            active: true,
            leaderId: 'l2',
            hourlyRate: 200,
            color: '#ef4444',
            icon: 'hammer',
            workingDays: [1, 2, 3, 4, 5, 6]
        });
        state.employees[0].positions = ['p1', 'p2'];

        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="employee-list-row__watermarks has-2"');
        expect(html).toContain('--watermark-color: #22c4c9');
        expect(html).toContain('--watermark-color: #ef4444');
    });

    test('combina posiciones con OR, líderes con OR y ambos grupos con AND', () => {
        state.positions.push({
            id: 'p2',
            name: 'Capataz',
            active: true,
            leaderId: 'l2',
            hourlyRate: 200,
            color: '#ef4444',
            workingDays: [1, 2, 3, 4, 5, 6]
        });
        state.leaders.push({ id: 'l2', number: 2, name: 'Johan', active: true });
        state.employees.push({
            id: 'e3',
            key: 'e3',
            number: 3,
            name: 'Varnet',
            active: true,
            positions: ['p2'],
            positionSalaries: { p2: 200 }
        });

        toggleEmployeePositionFilter('p1', true);
        toggleEmployeePositionFilter('p2', true);
        toggleEmployeeLeaderFilter('l2', true);
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('Varnet');
        expect(html).not.toContain('Franklin</strong>');
        expect(html).not.toContain('Pauliny</strong>');
    });

    test('el perfil completo acepta la key utilizada por la fila', () => {
        state.employees[0].key = 'employee-key';

        EmployeesUI.openEmployeeProfile('employee-key');

        expect(state.selectedEmployee).toMatchObject({ id: 'e1', key: 'employee-key' });
        expect(state.employeeProfile.employeeId).toBe('e1');
        expect(state.showEmployeeProfile).toBe(true);
    });
});
