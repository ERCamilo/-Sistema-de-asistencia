/**
 * Sueldo del período en el panel de detalle de Asistencia: el mismo bruto que
 * Nómina, no "horas × tarifa de la primera posición".
 */
import { computeAttendanceDetailEarnings } from '../modules/features/attendance/AttendanceDetailEarnings.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';

const day = (employeeId, date, positionId, hours = 8) => ({
    employeeId, date, present: true, hoursWorked: hours, overtimeHours: 0, selectedPosition: positionId, positionId
});

const state = {
    employees: [{
        id: 'E1', number: '001', name: 'Ana', active: true, positions: ['P1', 'P2'],
        positionSalaries: { P2: 2000 }, positionSalaryModes: { P2: 'daily' }, bonuses: [], deductions: []
    }],
    positions: [
        { id: 'P1', name: 'Ayudante', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6] },
        { id: 'P2', name: 'Varillero', hourlyRate: 50, workingDays: [1, 2, 3, 4, 5, 6] }
    ],
    leaders: [],
    attendance: {
        'E1-2026-03-02': day('E1', '2026-03-02', 'P1'),
        'E1-2026-03-03': day('E1', '2026-03-03', 'P2'),
        'E1-2026-03-04': day('E1', '2026-03-04', 'P1')
    },
    settings: { regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2, restDayFactor: 2, holidays: [] }
};

describe('sueldo del período en el panel de Asistencia', () => {
    test('coincide con el bruto de Nómina, con cada posición y el sueldo propio del empleado', () => {
        const result = computeAttendanceDetailEarnings(state, 'E1', '2026-03-01', '2026-03-07');
        const payroll = new PayrollService(state).calculateEmployeePayroll('E1', '2026-03-01', '2026-03-07', [], [], []);
        expect(result.available).toBe(true);
        expect(result.gross).toBe(Math.round(payroll.brutoOriginal * 100) / 100);
        expect(result.breakdown.map(item => item.positionName).sort()).toEqual(['Ayudante', 'Varillero']);
        // La fórmula vieja (24h × 100 de la primera posición) daba otra cosa.
        expect(result.gross).not.toBe(24 * 100);
    });

    test('rango vacío o invertido: cero', () => {
        expect(computeAttendanceDetailEarnings(state, 'E1', '2026-03-07', '2026-03-01').gross).toBe(0);
        expect(computeAttendanceDetailEarnings(state, null, '2026-03-01', '2026-03-07').gross).toBe(0);
    });
});
