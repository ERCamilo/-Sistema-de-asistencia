/**
 * 🧪 BusinessLogicTests - Pruebas para la lógica de nómina y festivos
 *
 * Convertido a módulo ES — importa las dependencias directamente
 * en lugar de depender de globales en window.
 */

import { isDayHoliday } from '../modules/utils/DateUtils.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';

testRunner.addSuite("Nómina y Festivos", {
    "isDayHoliday: Identifica correctamente días festivos"() {
        const holidays = ["2026-03-19", "2026-05-01"];
        testRunner.assert(isDayHoliday("2026-03-19", holidays), "Debe ser festivo");
        testRunner.assert(!isDayHoliday("2026-03-20", holidays), "No debe ser festivo");
    },

    "PayrollService: Cálculo de sueldo diario"() {
        // Stub mínimo del state: PayrollService.calculateDailySalary solo necesita el config
        const mockState = {
            settings: { regularHoursPerDay: 8 },
            positions: [],
            employees: []
        };
        const payroll = new PayrollService(mockState);
        // Sueldo de $30,000 mensual (6 días a la semana)
        const config = { amount: 30000, period: 'month', workDays: [1, 2, 3, 4, 5, 6] };
        const daily = payroll.calculateDailySalary(config);
        // 30000 / (6 * 4.333...) = ~1153.85
        testRunner.assert(
            Math.abs(daily - 1153.85) < 0.5,
            `Cálculo incorrecto: ${daily} (esperado ~1153.85)`
        );
    },

    "PayrollService: Factor de festivo aplicado"() {
        const mockState = {
            settings: { holidayFactor: 2, regularHoursPerDay: 8, holidays: ['2026-03-19'] },
            employees: [{
                id: 'emp1',
                name: 'Test',
                positions: ['pos1'],
                active: true,
                hireDate: '2020-01-01'
            }],
            positions: [{
                id: 'pos1',
                name: 'Pos1',
                hourlyRate: 100,
                active: true,
                workingDays: [1, 2, 3, 4, 5, 6]
            }],
            attendance: {
                'emp1-2026-03-19': {
                    employeeId: 'emp1',
                    date: '2026-03-19',
                    present: true,
                    hoursWorked: 8,
                    overtimeHours: 0,
                    isHoliday: true,
                    selectedPosition: 'pos1'
                }
            }
        };
        const payroll = new PayrollService(mockState);
        const result = payroll.calculateEmployeePayroll('emp1', '2026-03-19', '2026-03-19');

        testRunner.assert(result, "El resultado de payroll no debe ser null/undefined");
        testRunner.assert(
            typeof result.bruto === 'number' && result.bruto > 0,
            `result.bruto debe ser número positivo, recibido: ${result?.bruto}`
        );
        // 8 horas * $100 * 2 (factor festivo) = $1600
        testRunner.assertEquals(result.bruto, 1600, "El total bruto debe ser 1600 en festivo");
    }
});

console.log('🧪 BusinessLogic tests cargados.');
