/**
 * AttendanceUITests - Tests for Attendance UI controls and components
 */

import {
    AttendanceBulkActions,
    DateControls,
    formatSplitName,
    WeekView,
    SearchBar,
    PositionFilters,
    DayView,
    EmployeeRow,
    EmployeeRowCompact,
    getEffectiveAttendanceDetailEmployeeId,
    usesAttendanceDetailPanel
} from '../modules/ui/AttendanceUI.js';
import { CalendarView } from '../modules/ui/components/CalendarView.js';

testRunner.addSuite("AttendanceUI - DateControls y Adaptabilidad", {

    "DateControls: mantiene etiquetas consistentes para Dia y Semana independientemente de viewMode"() {
        const originalViewMode = window.state.viewMode;

        window.state.viewMode = 'day';
        const htmlDay = DateControls();
        testRunner.assert(htmlDay.includes('Dia') || htmlDay.includes('Día'), 'Debe mostrar Dia en la etiqueta de la pestana de Dia');
        testRunner.assert(htmlDay.includes('Semana'), 'Debe mostrar Semana en la etiqueta de la pestana de Semana');

        window.state.viewMode = 'week';
        const htmlWeek = DateControls();
        testRunner.assert(htmlWeek.includes('Dia') || htmlWeek.includes('Día'), 'Debe mostrar Dia cuando esta en vista semanal');
        testRunner.assert(htmlWeek.includes('Semana'), 'Debe mostrar Semana cuando esta en vista semanal');

        window.state.viewMode = originalViewMode;
    },

    "formatSplitName: divide correctamente nombres largos en primer nombre y primer apellido"() {
        const res2 = formatSplitName("Juan Perez");
        testRunner.assert(res2.includes("Juan"), "Debe tener Juan en la linea 1");
        testRunner.assert(res2.includes("Perez"), "Debe tener Perez en la linea 2");

        const res3 = formatSplitName("Juan Carlos Perez");
        testRunner.assert(res3.includes("Juan"), "Debe tener Juan en la linea 1");
        testRunner.assert(res3.includes("Perez"), "Debe tener Perez en la linea 2");

        const res3Surname = formatSplitName("Jose Perez Gomez");
        testRunner.assert(res3Surname.includes("Jose"), "Debe tener Jose en la linea 1");
        testRunner.assert(res3Surname.includes("Perez"), "Debe tener Perez en la linea 2");

        const res4 = formatSplitName("Juan Carlos Perez Gomez");
        testRunner.assert(res4.includes("Juan"), "Debe tener Juan en la linea 1");
        testRunner.assert(res4.includes("Perez"), "Debe tener Perez en la linea 2");
    },

    "WeekView: genera cabeceras compactas sin redundancia del ano en columnas de dias"() {
        const originalViewMode = window.state.viewMode;
        const originalDate = window.state.selectedDate;

        window.state.viewMode = 'week';
        window.state.selectedDate = new Date('2026-05-25T12:00:00');

        const html = WeekView();

        testRunner.assert(!html.includes('2026'), 'Las cabeceras no deben contener el ano 2026');
        testRunner.assert(html.includes('Lun 25'), 'Debe incluir la columna Lun 25');
        testRunner.assert(html.includes('Mar 26'), 'Debe incluir la columna Mar 26');
        testRunner.assert(html.includes('Sab 30') || html.includes('Sáb 30'), 'Debe incluir la columna Sab 30');

        window.state.viewMode = originalViewMode;
        window.state.selectedDate = originalDate;
    },

    "SearchBar: contiene controles conectados y responsivos"() {
        const html = SearchBar();
        testRunner.assert(html.includes('class="search-wrapper"'), 'Debe contener la clase search-wrapper');
        testRunner.assert(html.includes('search-input-group'), 'Debe contener la clase search-input-group');
        testRunner.assert(html.includes('data-att-action="set-search-filter"'), 'La busqueda debe estar conectada al handler de asistencia');
        testRunner.assert(html.includes('data-att-action="open-filter-catalog"'), 'Los filtros visuales deben abrirse desde la barra compacta');
        testRunner.assert(html.includes('data-value="positions"'), 'Debe permitir abrir el catálogo de profesiones');
        testRunner.assert(html.includes('data-value="leaders"'), 'Debe permitir abrir el catálogo de líderes');
        testRunner.assert(html.includes('employee-search-input'), 'Debe preservar el foco mientras se escribe en la busqueda');
        testRunner.assert(html.includes('data-app-fn="openAttendanceLayoutModal"'), 'Debe incluir el boton de opciones de distribucion');
    },

    "PositionFilters: alterna un mismo catálogo visual entre profesiones y líderes"() {
        const originalShowFilters = window.state.showFilters;
        const originalCatalog = window.state.attendanceFilterCatalog;
        const originalDate = window.state.selectedDate;
        const originalPositions = window.state.positions;
        const originalLeaders = window.state.leaders;
        const originalEmployees = window.state.employees;

        window.state.showFilters = true;
        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.positions = [
            { id: 'p1', name: 'Albañil', color: '#f59e0b', icon: 'bricks', leaderId: 'l1', active: true }
        ];
        window.state.leaders = [
            { id: 'l1', number: 'L-001', name: 'Juan Líder', icon: 'supervisor', active: true }
        ];
        window.state.employees = [
            { id: 'e1', name: 'Empleado Uno', positions: ['p1'], active: true }
        ];

        try {
            window.state.attendanceFilterCatalog = 'positions';
            const positionsHTML = PositionFilters();
            testRunner.assert(positionsHTML.includes('Filtrar por profesiones'), 'Debe identificar el catálogo de profesiones');
            testRunner.assert(positionsHTML.includes('Albañil'), 'Debe mostrar las profesiones disponibles');
            testRunner.assert(positionsHTML.includes('data-att-action="set-position-filter"'), 'Debe conectar la selección de profesión');

            window.state.attendanceFilterCatalog = 'leaders';
            const leadersHTML = PositionFilters();
            testRunner.assert(leadersHTML.includes('Filtrar por líderes'), 'Debe identificar el catálogo de líderes');
            testRunner.assert(leadersHTML.includes('Juan Líder'), 'Debe mostrar los líderes disponibles');
            testRunner.assert(leadersHTML.includes('data-att-action="set-leader-filter"'), 'Debe conectar la selección de líder');

            window.state.showFilters = false;
            testRunner.assert(PositionFilters() === '', 'El catálogo debe quedar oculto al cerrarse');
        } finally {
            window.state.showFilters = originalShowFilters;
            window.state.attendanceFilterCatalog = originalCatalog;
            window.state.selectedDate = originalDate;
            window.state.positions = originalPositions;
            window.state.leaders = originalLeaders;
            window.state.employees = originalEmployees;
        }
    },

    "AttendanceBulkActions: muestra alcance visible y conteos accionables"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.attendance = {
            'e1-2026-07-26': { employeeId: 'e1', date: '2026-07-26', present: true, hoursWorked: 8 }
        };

        try {
            const html = AttendanceBulkActions([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
            testRunner.assert(html.includes('3 empleados visibles'), 'debe explicar el alcance filtrado');
            testRunner.assert(html.includes('data-att-action="mark-visible-present"'), 'debe conectar la acción de marcar presentes');
            testRunner.assert(html.includes('data-att-action="clear-visible-attendance"'), 'debe conectar la acción de limpiar');
            testRunner.assert(html.includes('Poner todos presentes'), 'debe conservar una etiqueta comprensible');
            testRunner.assert(html.includes('Limpiar asistencias'), 'debe evitar el ambiguo Limpiar todo');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
        }
    },

    "DayView: aplica clase de distribucion de columnas"() {
        const originalColumns = window.state.attendanceListColumns;

        window.state.attendanceListColumns = 2;
        const twoColumnsHTML = DayView();
        testRunner.assert(twoColumnsHTML.includes('employee-list-cols-2'), 'Debe aplicar la clase de dos columnas');

        window.state.attendanceListColumns = 1;
        const oneColumnHTML = DayView();
        testRunner.assert(oneColumnHTML.includes('employee-list-cols-1'), 'Debe aplicar la clase de una columna');

        window.state.attendanceListColumns = originalColumns;
    },

    "DayView: aplica modo reducido de tarjetas"() {
        const originalMode = window.state.listDisplayMode;

        window.state.listDisplayMode = 'compact';
        const compactHTML = DayView();
        testRunner.assert(compactHTML.includes('compact-list'), 'Debe aplicar la clase de lista reducida');

        window.state.listDisplayMode = 'relaxed';
        const normalHTML = DayView();
        testRunner.assert(!normalHTML.includes('compact-list'), 'La vista normal no debe usar compact-list');

        window.state.listDisplayMode = originalMode;
    },

    "EmployeeRow: mantiene selección visual coherente con el panel desktop"() {
        const originalSelected = window.state.selectedDetailEmployeeId;
        const originalPositions = window.state.positions;
        const originalEmployees = window.state.employees;

        window.state.positions = [{ id: 'pos1', name: 'Ayudante', color: '#10b981' }];
        const selectedEmployee = { id: 'emp-selected', name: 'Empleado Seleccionado', number: '007', positions: ['pos1'], active: true };
        const otherEmployee = { id: 'emp-other', name: 'Otro Empleado', number: '008', positions: ['pos1'], active: true };
        window.state.employees = [selectedEmployee, otherEmployee];

        try {
            window.state.selectedDetailEmployeeId = null;
            testRunner.assertEquals(
                getEffectiveAttendanceDetailEmployeeId(),
                'emp-selected',
                'El primer empleado activo debe ser la selección efectiva inicial'
            );
            testRunner.assert(EmployeeRow(selectedEmployee).includes('is-detail-selected'), 'La tarjeta inicial debe coincidir con el panel');
            testRunner.assert(!EmployeeRow(otherEmployee).includes('is-detail-selected'), 'Solo una tarjeta debe quedar seleccionada');

            window.state.selectedDetailEmployeeId = 'emp-other';
            testRunner.assert(EmployeeRow(otherEmployee).includes('is-detail-selected'), 'La tarjeta normal debe mover la selección');
            testRunner.assert(EmployeeRowCompact(otherEmployee).includes('is-detail-selected'), 'La tarjeta reducida debe mover la selección');
        } finally {
            window.state.selectedDetailEmployeeId = originalSelected;
            window.state.positions = originalPositions;
            window.state.employees = originalEmployees;
        }
    },

    "EmployeeRow: la huella de memo cambia al mover el marco seleccionado"() {
        const originalSelected = window.state.selectedDetailEmployeeId;
        const originalPositions = window.state.positions;
        const originalEmployees = window.state.employees;
        const originalAttendance = window.state.attendance;
        const employee = { id: 'emp-a', name: 'Empleado A', number: '001', positions: ['pos1'], active: true };
        const employeeB = { id: 'emp-b', name: 'Empleado B', number: '002', positions: ['pos1'], active: true };

        window.state.positions = [{ id: 'pos1', name: 'Ayudante', color: '#10b981' }];
        window.state.employees = [employee, employeeB];
        window.state.attendance = {};

        try {
            window.state.selectedDetailEmployeeId = 'emp-a';
            const selectedHTML = EmployeeRow(employee);
            window.state.selectedDetailEmployeeId = 'emp-b';
            const idleHTML = EmployeeRow(employee);
            const selectedFingerprint = selectedHTML.match(/data-memo-f="([^"]+)"/)?.[1];
            const idleFingerprint = idleHTML.match(/data-memo-f="([^"]+)"/)?.[1];

            testRunner.assert(selectedFingerprint && idleFingerprint, 'Ambas tarjetas deben exponer su huella de memo');
            testRunner.assert(selectedFingerprint !== idleFingerprint, 'La selección debe invalidar la caché visual');
            testRunner.assert(selectedHTML.includes('data-att-action="view-employee-details"'), 'El nombre debe usar la interacción responsiva unificada');
            testRunner.assert(!selectedHTML.includes('data-att-action="open-employee-floating"'), 'El nombre no debe forzar el modal móvil en desktop');
        } finally {
            window.state.selectedDetailEmployeeId = originalSelected;
            window.state.positions = originalPositions;
            window.state.employees = originalEmployees;
            window.state.attendance = originalAttendance;
        }
    },

    "usesAttendanceDetailPanel: coincide con el breakpoint visual de 1024px"() {
        testRunner.assert(!usesAttendanceDetailPanel(1023), 'En móvil/tablet debe abrir el detalle flotante');
        testRunner.assert(usesAttendanceDetailPanel(1024), 'En desktop debe actualizar el panel lateral');
    },

    "CalendarView: marca asistencia con clases de color check"() {
        const originalAttendance = window.state.attendance;
        const originalSettings = window.state.settings;
        const originalPositions = window.state.positions;

        window.state.settings = {
            ...window.state.settings,
            regularHoursPerDay: 8,
            holidays: ['2026-05-14']
        };
        window.state.positions = [
            { id: 'p1', name: 'Ayudante', color: '#8b5cf6' },
            { id: 'p2', name: 'Operador', color: '#f59e0b' }
        ];
        window.state.attendance = {
            'emp-cal-2026-05-12': { employeeId: 'emp-cal', date: '2026-05-12', present: true, hoursWorked: 8, positionHours: [{ positionId: 'p1', hours: 8 }] },
            'emp-cal-2026-05-13': { employeeId: 'emp-cal', date: '2026-05-13', present: true, hoursWorked: 4, positionHours: [{ positionId: 'p1', hours: 4 }] },
            'emp-cal-2026-05-14': { employeeId: 'emp-cal', date: '2026-05-14', present: true, hoursWorked: 8, positionHours: [{ positionId: 'p1', hours: 8 }] },
            'emp-cal-2026-05-15': { employeeId: 'emp-cal', date: '2026-05-15', present: true, hoursWorked: 10, positionHours: [{ positionId: 'p1', hours: 10 }] },
            'emp-cal-2026-05-16': { employeeId: 'emp-cal', date: '2026-05-16', present: true, hoursWorked: 8, positionHours: [{ positionId: 'p1', hours: 4 }, { positionId: 'p2', hours: 4 }] }
        };

        try {
            const html = CalendarView({
                employee: {
                    id: 'emp-cal',
                    name: 'Empleado Calendario',
                    positions: ['p1', 'p2'],
                    active: true,
                    statusHistory: [
                        { date: '2026-05-17', active: false, timestamp: 1 },
                        { date: '2026-05-18', active: true, timestamp: 2 }
                    ]
                },
                month: new Date('2026-05-01T12:00:00'),
                navAction: 'noop'
            });

            testRunner.assert(html.includes('check-regular'), 'Debe marcar asistencia completa en verde');
            testRunner.assert(html.includes('check-undertime'), 'Debe marcar asistencia incompleta en rojo');
            testRunner.assert(html.includes('check-holiday'), 'Debe marcar asistencia en feriado en dorado');
            testRunner.assert(html.includes('check-overtime'), 'Debe marcar horas extra en azul');
            testRunner.assert(html.includes('check-multiposition'), 'Debe marcar multi-posicion en morado');
            testRunner.assert(html.includes('calendar-position-dot'), 'Debe mostrar puntos de puesto trabajado');
            testRunner.assert(html.includes('--pos-color: #8b5cf6'), 'Debe usar el color del puesto Ayudante');
            testRunner.assert(html.includes('--pos-color: #f59e0b'), 'Debe usar el color del puesto Operador');
            testRunner.assert(html.includes('Ayudante: 4h') && html.includes('Operador: 4h'), 'El tooltip debe listar puestos y horas');
            testRunner.assert(html.includes('calendar-day-inactive'), 'Debe marcar dias donde el empleado estaba inactivo');
            testRunner.assert(html.includes('Empleado inactivo segun historial'), 'El tooltip debe explicar el estado inactivo');
        } finally {
            window.state.attendance = originalAttendance;
            window.state.settings = originalSettings;
            window.state.positions = originalPositions;
        }
    }
});
