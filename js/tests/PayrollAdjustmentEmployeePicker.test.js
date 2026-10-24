import {
    filterPayrollAdjustmentEmployees,
    renderPayrollAdjustmentEmployeePicker,
    openPayrollAdjustmentEmployeePicker
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
    test('only confirmed exclusion from payroll shows the warning; a calculated zero is not enough', () => {
        const host = document.createElement('div');
        host.innerHTML = renderPayrollAdjustmentEmployeePicker({ employees: [
            { ...employees[0], gross: 0, inPayroll: true },
            { ...employees[1], inPayroll: false }
        ] });
        expect(host.querySelector('[data-adjustment-picker-employee="e1"] .payroll-status')).toBeNull();
        expect(host.querySelector('[data-adjustment-picker-employee="e3"] .payroll-status--warning svg')).not.toBeNull();
    });
    test('the picker follows the visible viewport and releases the resize listener on close', async () => {
        jest.useFakeTimers();
        const previousViewport = window.visualViewport;
        const viewport = new EventTarget();
        viewport.height = 400;
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        try {
            const pending = openPayrollAdjustmentEmployeePicker({ employees });
            const container = document.querySelector('.payroll-adjustment-picker-modal');
            const gap = window.innerWidth <= 620 ? 16 : 24;
            expect(container.style.getPropertyValue('--payroll-picker-height')).toBe(`${400 - gap}px`);
            viewport.height = 500;
            viewport.dispatchEvent(new Event('resize'));
            expect(container.style.getPropertyValue('--payroll-picker-height')).toBe(`${500 - gap}px`);
            document.querySelector('[data-button-index="0"]').click();
            await pending;
            viewport.height = 600;
            viewport.dispatchEvent(new Event('resize'));
            expect(container.style.getPropertyValue('--payroll-picker-height')).toBe(`${500 - gap}px`);
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousViewport });
        }
    });
    test('toggling selection preserves the employee rows and cancel does not apply it', async () => {
        jest.useFakeTimers();
        const pending = openPayrollAdjustmentEmployeePicker({ employees, selectedIds: [] });
        const row = document.querySelector('[data-adjustment-picker-employee="e1"]');
        row.click();
        expect(document.querySelector('[data-adjustment-picker-employee="e1"]')).toBe(row);
        expect(row.getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelector('[data-button-index="1"]').textContent).toBe('Aplicar (1)');
        row.click();
        expect(row.getAttribute('aria-pressed')).toBe('false');
        document.querySelector('[data-button-index="0"]').click();
        await expect(pending).resolves.toBeNull();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });
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
