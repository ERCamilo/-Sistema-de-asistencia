/**
 * 🧪 AnalyticsUITests — Tests for Analytics and Reports UI
 */

import { init, EmployeeReportGeneralTable, EmployeeReportControls, formatPeriodRange, getPastPeriodsList, PastPeriodsModal } from '../modules/features/analytics/AnalyticsUI.js';
import { DateRangeManager } from '../modules/utils/DateManagers.js';
import { formatDateShort } from '../modules/utils/DateUtils.js';

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
    },

    "EmployeeReportGeneralTable: aplica colores canónicos (rojo < 1, azul > 1, amarillo festivo/libre, verde = 1) y encabezado oscuro"() {
        const stateMock = {
            attendance: {},
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: { regularHoursPerDay: 8, holidayFactor: 2, holidays: [] }
        };
        init({ state: stateMock, render: () => {}, saveToLocalStorage: () => {} });

        // Lunes 2026-05-25 (regular), Martes 2026-05-26 (regular), Miércoles 2026-05-27 (regular), Sábado 2026-05-30 (libre)
        const mockDays = [
            { date: new Date('2026-05-25T12:00:00Z'), isHoliday: false }, // d1 (regular)
            { date: new Date('2026-05-26T12:00:00Z'), isHoliday: false }, // d2 (regular)
            { date: new Date('2026-05-27T12:00:00Z'), isHoliday: false }, // d3 (regular)
            { date: new Date('2026-05-30T12:00:00Z'), isHoliday: false }  // d4 (sábado = día libre)
        ];

        const mockEmployees = [
            {
                id: 'emp1',
                number: '001',
                name: 'Empleado Prueba',
                positions: ['p1'],
                dayValues: {
                    '2026-05-25': 0.9,  // < 1 en día regular -> debe ser ROJO (#ef4444)
                    '2026-05-26': 1.3,  // > 1 en día regular -> debe ser AZUL (#3b82f6)
                    '2026-05-27': 1.0,  // = 1 en día regular -> debe ser VERDE (#10b981)
                    '2026-05-30': 1.5   // Día libre trabajado -> debe ser AMARILLO (#f59e0b)
                },
                totalDays: 4.7,
                totalHours: 37.6
            }
        ];

        const html = EmployeeReportGeneralTable(mockEmployees, mockDays);

        // Encabezado oscuro/grisáceo (#1e293b)
        testRunner.assert(html.includes('background: #1e293b'), 'El encabezado debe tener fondo oscuro (#1e293b)');
        testRunner.assert(!html.includes('background: #3b82f6; min-width: 32px; font-size: 0.75rem;'), 'El encabezado NO debe tener fondo azul brillante');

        // Colores de celdas
        testRunner.assert(html.includes('color: #ef4444'), 'Menos de 1 día (0.9) en día regular debe ser ROJO (#ef4444)');
        testRunner.assert(html.includes('color: #3b82f6'), 'Más de 1 día (1.3) en día regular debe ser AZUL (#3b82f6)');
        testRunner.assert(html.includes('color: #10b981'), 'Día regular completo (1.0) debe ser VERDE (#10b981)');
        testRunner.assert(html.includes('color: #f59e0b'), 'Día libre o festivo trabajado debe ser AMARILLO (#f59e0b)');

        // Checkmark SVG verde en lugar de emoji unicode
        testRunner.assert(html.includes('<svg') && html.includes('stroke="#10b981"') && html.includes('M20 6L9 17l-5-5'), 'Día regular completo debe renderizar un SVG checkmark verde');
        testRunner.assert(!html.includes('✅'), 'No debe renderizar el emoji unicode ✅ en el resumen general');
    }
});

testRunner.addSuite("AnalyticsUI — Past Periods Feature & DateRangeManager", {

    "DateRangeManager.setRange actualiza startDate y endDate simultáneamente"() {
        const state = { startDate: '2026-01-01', endDate: '2026-01-15' };
        let saved = false;
        const manager = new DateRangeManager(state, {
            startDateKey: 'startDate',
            endDateKey: 'endDate',
            name: 'Test'
        }, () => { saved = true; });

        manager.setRange('2026-08-01', '2026-08-15');

        testRunner.assert(state.startDate === '2026-08-01', 'startDate debe ser 2026-08-01');
        testRunner.assert(state.endDate === '2026-08-15', 'endDate debe ser 2026-08-15');
        testRunner.assert(saved === true, 'Debe invocar onSave callback');
    },

    "formatPeriodRange formatea rangos del mismo mes y de diferentes meses correctamente"() {
        const sameMonth = formatPeriodRange('2026-08-01', '2026-08-15');
        testRunner.assert(sameMonth.includes('1 – 15 ago 2026'), 'Mismo mes debe formatearse "1 – 15 ago 2026": ' + sameMonth);

        const diffMonth = formatPeriodRange('2026-08-16', '2026-09-02');
        testRunner.assert(diffMonth.includes('16 ago – 2 sep 2026'), 'Diferentes meses debe formatearse "16 ago – 2 sep 2026": ' + diffMonth);
    },

    "formatDateShort y DateUtils manejan números (timestamps), strings y Dates sin lanzar getDay TypeError"() {
        const timestamp = new Date('2026-08-16T12:00:00Z').getTime();
        const formattedNum = formatDateShort(timestamp);
        testRunner.assert(typeof formattedNum === 'string' && formattedNum.length > 0, 'Timestamp numérico debe formatear correctamente: ' + formattedNum);

        const formattedStr = formatDateShort('2026-08-16');
        testRunner.assert(typeof formattedStr === 'string' && formattedStr.length > 0, 'String YYYY-MM-DD debe formatear correctamente');

        const formattedDate = formatDateShort(new Date());
        testRunner.assert(typeof formattedDate === 'string' && formattedDate.length > 0, 'Date object debe formatear correctamente');

        const formattedNull = formatDateShort(null);
        testRunner.assert(typeof formattedNull === 'string' && formattedNull.length > 0, 'Null debe tener fallback seguro sin lanzar error');
    },

    "getPastPeriodsList genera cierres reales, ciclos calculados y meses anteriores con deduplicación"() {
        const state = {
            settings: {
                payPeriod: {
                    periodStart: '2026-09-01',
                    periodLength: 15
                }
            }
        };
        const closures = [
            {
                id: 'closure-1',
                periodStart: '2026-08-16',
                periodEnd: '2026-08-31',
                status: 'closed',
                closedAt: '2026-09-01T12:00:00Z',
                employeeCount: 25
            }
        ];

        const list = getPastPeriodsList(state, closures);

        testRunner.assert(Array.isArray(list) && list.length > 0, 'Debe retornar una lista no vacía');
        
        // 1. El primer elemento debe ser el cierre de nómina real
        const closureItem = list.find(p => p.type === 'closure');
        testRunner.assert(Boolean(closureItem), 'Debe incluir el período cerrado');
        testRunner.assert(closureItem.start === '2026-08-16' && closureItem.end === '2026-08-31', 'Rango del cierre correcto');
        testRunner.assert(closureItem.badgeText === 'CERRADO', 'Badge debe ser CERRADO');
        testRunner.assert(closureItem.subtext.includes('25 empleados'), 'Subtexto debe mencionar 25 empleados');

        // 2. Debe incluir ciclos calculados
        const cycleItems = list.filter(p => p.type === 'cycle');
        testRunner.assert(cycleItems.length > 0, 'Debe incluir ciclos calculados');
        testRunner.assert(cycleItems[0].days === 15, 'La duración del ciclo debe ser 15 días');

        // 3. Debe incluir atajos de meses
        const monthItems = list.filter(p => p.type === 'month');
        testRunner.assert(monthItems.length > 0, 'Debe incluir meses anteriores');
    },

    "EmployeeReportControls incluye el botón Períodos Anteriores y los inputs nativos"() {
        const stateMock = {
            employeeReportStartDate: '2026-08-01',
            employeeReportEndDate: '2026-08-15',
            settings: { payPeriod: { periodStart: '2026-08-01', periodLength: 15 } }
        };
        init({
            state: stateMock,
            render: () => {},
            saveToLocalStorage: () => {}
        });

        const html = EmployeeReportControls();

        testRunner.assert(html.includes('data-analytics-action="open-past-periods-modal"'), 'Debe tener botón para abrir modal de períodos');
        testRunner.assert(html.includes('Períodos Anteriores'), 'El botón debe tener texto Períodos Anteriores');
        testRunner.assert(html.includes('type="date" id="employeeReportStartDate"'), 'Debe tener input date de inicio');
        testRunner.assert(html.includes('type="date" id="employeeReportEndDate"'), 'Debe tener input date de fin');
    },

    "PastPeriodsModal genera el modal con sus secciones y atributos de accesibilidad"() {
        const stateMock = {
            employeeReportStartDate: '2026-08-16',
            employeeReportEndDate: '2026-08-31',
            settings: { payPeriod: { periodStart: '2026-09-01', periodLength: 15 } },
            cachedPayrollClosures: [
                {
                    id: 'closure-1',
                    periodStart: '2026-08-16',
                    periodEnd: '2026-08-31',
                    status: 'closed',
                    closedAt: '2026-09-01T12:00:00Z',
                    employeeCount: 18
                }
            ]
        };
        init({
            state: stateMock,
            render: () => {},
            saveToLocalStorage: () => {}
        });

        const html = PastPeriodsModal();

        testRunner.assert(html.includes('role="dialog"'), 'Debe tener role="dialog"');
        testRunner.assert(html.includes('Períodos Anteriores'), 'Debe tener el título del modal');
        testRunner.assert(html.includes('Períodos Cerrados en Nómina'), 'Debe incluir la sección de cierres');
        testRunner.assert(html.includes('ACTIVO'), 'El período actualmente seleccionado debe marcarse como ACTIVO');
        testRunner.assert(html.includes('data-analytics-action="select-past-period"'), 'Las tarjetas deben tener acción select-past-period');
        testRunner.assert(html.includes('data-analytics-action="close-past-periods-modal"'), 'Debe tener acción de cerrar');
    }
});

