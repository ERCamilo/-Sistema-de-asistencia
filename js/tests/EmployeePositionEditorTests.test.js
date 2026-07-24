import {
    buildEmployeePositionPeriodSnapshot,
    calculatePositionAccrued,
    getPositionPeriodMetrics,
    getPositionTotalHours,
    resolvePositionBaseHourlyRate
} from '../modules/features/employees/EmployeePositionMetrics.js';
import {
    attachEmployeePositionEditor,
    renderEmployeePositionEditor
} from '../modules/features/employees/EmployeePositionEditor.js';
import { EmployeePositionPickerModal } from '../modules/ui/modals/EmployeePositionPickerModal.js';

function makeState() {
    return {
        settings: {
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2,
            holidays: ['2026-07-03'],
            payPeriod: { periodStart: '2026-07-01', periodLength: 21 }
        },
        positions: [
            { id: 'p1', name: 'Operador', active: true, hourlyRate: 100, color: '#22c4c9', workingDays: [1, 2, 3, 4, 5], icon: 'drill' },
            { id: 'p2', name: 'Capataz', active: true, hourlyRate: 150, color: '#fb5265', workingDays: [1, 2, 3, 4, 5], icon: 'hard-hat' },
            { id: 'p3', name: 'Ayudante', active: true, hourlyRate: 80, color: '#9b78e8', workingDays: [1, 2, 3, 4, 5], icon: 'crew' }
        ],
        employees: [{
            id: 'e1',
            key: 'e1',
            number: 1,
            name: 'Franklin',
            active: true,
            positions: ['p1', 'p2'],
            positionSalaries: { p2: 200 },
            positionSalaryModes: { p2: 'daily' }
        }],
        attendance: {
            'e1-2026-07-02': {
                employeeId: 'e1',
                date: '2026-07-02',
                present: true,
                selectedPosition: 'p1',
                hoursWorked: 8,
                overtimeHours: 2
            },
            'e1-2026-07-03': {
                employeeId: 'e1',
                date: '2026-07-03',
                present: true,
                selectedPosition: 'p1',
                hoursWorked: 8,
                overtimeHours: 0,
                isHoliday: true
            },
            'e1-2026-07-04': {
                employeeId: 'e1',
                date: '2026-07-04',
                present: true,
                positionHours: [
                    { positionId: 'p1', hours: 4, overtimeHours: 1 },
                    { positionId: 'p2', hours: 4, overtimeHours: 0 }
                ]
            }
        }
    };
}

describe('métricas de puestos dentro del editor de empleado', () => {
    test('usa el período configurado y separa las horas por puesto como Nómina', () => {
        const state = makeState();
        const snapshot = buildEmployeePositionPeriodSnapshot(state, state.employees[0]);
        const operator = getPositionPeriodMetrics(snapshot, 'p1');
        const foreman = getPositionPeriodMetrics(snapshot, 'p2');

        expect(snapshot.period).toEqual({
            periodStart: '2026-07-01',
            periodEnd: '2026-07-21',
            source: 'configured'
        });
        expect(operator).toEqual({
            days: 3,
            regularHours: 12,
            overtimeHours: 3,
            holidayHours: 8
        });
        expect(getPositionTotalHours(operator)).toBe(23);
        expect(foreman.regularHours).toBe(4);
    });

    test('el acumulado aplica los factores de extras y feriados', () => {
        const state = makeState();
        const snapshot = buildEmployeePositionPeriodSnapshot(state, state.employees[0]);
        const metrics = getPositionPeriodMetrics(snapshot, 'p1');

        expect(calculatePositionAccrued(metrics, 100, state.settings)).toBe(3250);
    });

    test('la tarifa base conserva el fallback usado por puestos antiguos', () => {
        expect(resolvePositionBaseHourlyRate({
            hourlyRate: 0,
            salaryConfig: { amount: 24000 }
        }, 8)).toBe(100);
    });
});

describe('tarjetas de puestos del editor', () => {
    test('renderiza solo los puestos asignados con tarifa, métricas y botón para agregar', () => {
        const state = makeState();
        const html = renderEmployeePositionEditor(state, state.employees[0], 8);

        expect(html).toContain('data-position-assignment="p1"');
        expect(html).toContain('data-position-assignment="p2"');
        expect(html).not.toContain('data-position-assignment="p3"');
        expect(html).toContain('Días trabajados');
        expect(html).toContain('Horas del período');
        expect(html).toContain('Acumulado');
        expect(html).toContain('data-open-position-picker');
    });

    test('elimina tarjetas, cambia la unidad y recalcula el acumulado sin tocar el estado', () => {
        const state = makeState();
        const employee = state.employees[0];
        const originalPositions = [...employee.positions];
        const root = document.createElement('div');
        root.innerHTML = renderEmployeePositionEditor(state, employee, 8);
        attachEmployeePositionEditor({ root, state, employee, regularHours: 8 });

        const operator = root.querySelector('[data-position-assignment="p1"]');
        operator.querySelector('[data-salary-mode="daily"]').click();
        expect(operator.querySelector('.custom-salary-mode').value).toBe('daily');
        expect(operator.querySelector('.custom-salary-input').value).toBe('800');
        expect(operator.querySelector('[data-position-accrued]').textContent).toBe('$3,250');

        root.querySelector('[data-position-assignment="p2"] [data-remove-position]').click();
        expect(root.querySelectorAll('[data-position-assignment]')).toHaveLength(1);
        expect(operator.querySelector('[data-remove-position]').classList.contains('is-hidden')).toBe(true);
        expect(employee.positions).toEqual(originalPositions);
    });

    test('el botón más agrega una tarjeta mediante el selector central', () => {
        const state = makeState();
        const employee = state.employees[0];
        const pickerSpy = jest.spyOn(EmployeePositionPickerModal, 'open').mockImplementation(options => {
            options.onAdd(state.positions[2]);
            return {};
        });
        const root = document.createElement('div');
        root.innerHTML = renderEmployeePositionEditor(state, employee, 8);
        attachEmployeePositionEditor({ root, state, employee, regularHours: 8 });

        root.querySelector('[data-open-position-picker]').click();

        expect(pickerSpy).toHaveBeenCalled();
        expect(root.querySelector('[data-position-assignment="p3"]')).not.toBeNull();
        pickerSpy.mockRestore();
    });
});
