import { state } from '../modules/core/AppState.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { openEmployeeEditor, setEmployeeSalaryView } from '../modules/features/employees/EmployeesList.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';

describe('directorio visual de empleados', () => {
    beforeEach(() => {
        EmployeesUI.init({
            state,
            saveToLocalStorage: jest.fn(),
            render: jest.fn(),
            services: {}
        });
        state.employeeViewMode = 'employees';
        state.employeeFilters = { search: '', positionId: 'all', leaderId: 'all', status: 'active' };
        state.employeeSalaryView = 'month';
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

    test('renderiza tabla comparativa, filtros y selector de ganancias', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('class="employee-toolbar"');
        expect(html).toContain('class="employee-table__header"');
        expect(html).not.toContain('class="employee-preview"');
        expect(html).toContain('Todos los puestos');
        expect(html).toContain('Todos los líderes');
        expect(html).toContain('Cualquier estado');
        expect(html).toContain('Por día');
        expect(html).toContain('Por mes');
        expect(html).toContain('id="employee-editor-panel"');
        expect(html).toContain('employee-list-row is-selected');
    });

    test('muestra ganancias mensuales o diarias sin alterar la tarifa guardada', () => {
        const originalSalary = state.employees[0].positionSalaries.p1;
        const monthly = EmployeesUI.EmployeesTab();
        expect(monthly).toContain('$26,000');
        expect(monthly).toContain('/ mes');

        setEmployeeSalaryView('day');
        const daily = EmployeesUI.EmployeesTab();

        expect(daily).toContain('$1,200');
        expect(daily).toContain('/ día');
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

        const monthly = EmployeesUI.EmployeesTab();
        expect(monthly).toContain('$26,000–$41,600');
        expect(monthly).toContain('/ mes · según puesto');

        setEmployeeSalaryView('day');
        const daily = EmployeesUI.EmployeesTab();
        expect(daily).toContain('$1,200–$1,600');
        expect(daily).toContain('/ día · según puesto');
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

    test('el ojo abre el perfil completo y el lápiz conserva el editor lateral', () => {
        const html = EmployeesUI.EmployeesTab();

        expect(html).toContain('data-action="open-employee-profile" data-id="e1"');
        expect(html).toContain('title="Ver perfil completo"');
        expect(html).toContain('data-action="open-employee-editor" data-id="e1"');
        expect(html).toContain('title="Editar"');
    });

    test('el perfil completo acepta la key utilizada por la fila', () => {
        state.employees[0].key = 'employee-key';

        EmployeesUI.openEmployeeProfile('employee-key');

        expect(state.selectedEmployee).toMatchObject({ id: 'e1', key: 'employee-key' });
        expect(state.employeeProfile.employeeId).toBe('e1');
        expect(state.showEmployeeProfile).toBe(true);
    });
});
