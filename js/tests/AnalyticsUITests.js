/**
 * 🧪 AnalyticsUITests — Tests for Analytics and Reports UI
 */

import { init, EmployeeReportGeneralTable } from '../modules/features/analytics/AnalyticsUI.js';

testRunner.addSuite("AnalyticsUI — Report Table Sticky Columns", {

    "EmployeeReportGeneralTable: incluye las clases sticky-column y sticky-column-2 para fijar las columnas clave"() {
        // Inicializar el módulo con mock context
        const stateMock = {
            attendance: {},
            settings: { regularHoursPerDay: 8, holidayFactor: 2, holidays: [] }
        };
        const ctxMock = {
            state: stateMock,
            render: () => {},
            saveToLocalStorage: () => {}
        };
        init(ctxMock);

        const mockEmployees = [
            { id: 'emp1', number: '001', name: 'Juan Perez', dayValues: {}, totalDays: 0, totalHours: 0 }
        ];
        const mockDays = [
            { date: new Date('2026-05-25'), isHoliday: false }
        ];

        const html = EmployeeReportGeneralTable(mockEmployees, mockDays);

        testRunner.assert(typeof html === 'string', 'Debe retornar un string HTML');
        testRunner.assert(html.includes('sticky-column'), 'Debe incluir la clase sticky-column para el índice/número');
        testRunner.assert(html.includes('sticky-column-2'), 'Debe incluir la clase sticky-column-2 para el nombre del empleado');
    }
});
