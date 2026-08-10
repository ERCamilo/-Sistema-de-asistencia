import {
    filterPayrollAdjustmentEmployees,
    renderPayrollAdjustmentEmployeePicker
} from '../modules/features/payroll/PayrollAdjustmentEmployeePicker.js';

const employees = [
    {
        id: 'e1',
        number: '1',
        name: 'Juan Perez',
        active: true,
        positions: ['Albanil', 'Ayudante', 'Carpintero', 'Pintor'],
        gross: 1250
    },
    {
        id: 'e3',
        number: '3',
        name: 'Pedro Gomez',
        active: false,
        positions: ['Electricista'],
        gross: 0
    }
];

describe('PayrollAdjustmentEmployeePicker', () => {
    test('filters by search and employee status', () => {
        expect(filterPayrollAdjustmentEmployees(employees, { query: '3', status: 'all' }))
            .toEqual([employees[1]]);
        expect(filterPayrollAdjustmentEmployees(employees, { query: 'carpintero', status: 'active' }))
            .toEqual([employees[0]]);
        expect(filterPayrollAdjustmentEmployees(employees, { query: '', status: 'inactive' }))
            .toEqual([employees[1]]);
    });

    test('renders search, status filters and selectable employee rows', () => {
        const host = document.createElement('div');
        host.innerHTML = renderPayrollAdjustmentEmployeePicker({
            employees,
            selectedIds: ['e3'],
            status: 'all'
        });
        const juan = host.querySelector('[data-adjustment-picker-employee="e1"]');
        const pedro = host.querySelector('[data-adjustment-picker-employee="e3"]');

        expect(host.querySelector('[data-adjustment-picker-search]')).not.toBeNull();
        expect(host.querySelectorAll('[data-adjustment-picker-status]')).toHaveLength(3);
        expect(juan.textContent).toContain('1');
        expect(juan.textContent).toContain('Juan Perez');
        expect(juan.textContent).toContain('Albanil');
        expect(juan.textContent).toContain('Ayudante');
        expect(juan.textContent).toContain('Carpintero');
        expect(juan.textContent).not.toContain('Pintor');
        expect(juan.textContent).toContain('$1,250.00');
        expect(juan.textContent).toContain('Activo');
        expect(pedro.textContent).toContain('Inactivo');
        expect(pedro.getAttribute('aria-pressed')).toBe('true');
        expect(juan.getAttribute('aria-pressed')).toBe('false');
    });
});
