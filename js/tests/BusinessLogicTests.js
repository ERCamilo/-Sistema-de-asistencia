/**
 * 🧪 BusinessLogicTests - Pruebas para la lógica de nómina y festivos
 */

testRunner.addSuite("Nómina y Festivos", {
    "isDayHoliday: Identifica correctamente días festivos"() {
        const holidays = ["2026-03-19", "2026-05-01"];
        testRunner.assert(isDayHoliday("2026-03-19", holidays), "Debe ser festivo");
        testRunner.assert(!isDayHoliday("2026-03-20", holidays), "No debe ser festivo");
    },

    "PayrollService: Cálculo de sueldo diario"() {
        const payroll = new PayrollService(window.state);
        // Sueldo de $30,000 mensual (6 días a la semana)
        const config = { amount: 30000, period: 'month', workDays: [1,2,3,4,5,6] };
        const daily = payroll.calculateDailySalary(config);
        // 30000 / (6 * 4.33) = ~1154.73
        testRunner.assert(Math.abs(daily - 1154.73) < 0.01, `Cálculo incorrecto: ${daily}`);
    },

    "PayrollService: Factor de festivo aplicado"() {
        const mockState = {
            settings: { holidayFactor: 2, regularHoursPerDay: 8 },
            employees: [{ id: 'emp1', name: 'Test', positions: ['pos1'] }],
            positions: [{ id: 'pos1', name: 'Pos1', hourlyRate: 100 }],
            attendance: {
                'emp1-2026-03-19': {
                    employeeId: 'emp1',
                    date: '2026-03-19',
                    present: true,
                    hoursWorked: 8,
                    isHoliday: true // Marcado en el registro
                }
            }
        };
        const payroll = new PayrollService(mockState);
        const result = payroll.calculateEmployeePayroll('emp1', '2026-03-19', '2026-03-19');
        
        // 8 horas * $100 * 2 (factor festivo) = $1600
        testRunner.assertEquals(result.bruto, 1600, "El total bruto debe ser 1600 en festivo");
    }
});
