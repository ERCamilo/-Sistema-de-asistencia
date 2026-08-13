/**
 * AttendanceUITests - Tests for Attendance UI controls and components
 */

import {
    AttendanceBulkActions,
    DateControls,
    DateControlsCompact,
    shouldShowCompactDayControls,
    formatSplitName,
    WeekView,
    SearchBar,
    PositionFilters,
    DayView,
    EmployeeRow,
    EmployeeRowCompact,
    getAttendanceWatermarkPositions,
    getAttendanceWatermarkModel,
    getAttendanceCardStatus,
    getEffectiveAttendanceDetailEmployeeId,
    usesAttendanceDetailPanel
} from '../modules/ui/AttendanceUI.js';
import { CalendarView, getPayPeriodCalendarDays } from '../modules/ui/components/CalendarView.js';
import {
    AttendanceDetailCalendar,
    normalizeAttendanceDetailCalendarView
} from '../modules/ui/components/AttendanceDetailCalendar.js';

testRunner.addSuite("AttendanceUI - DateControls y Adaptabilidad", {

    "estado de tarjeta distingue fecha inactiva de inactividad actual"() {
        const selected = '2026-05-10';
        const activeNowInactiveThen = {
            id: 'status-a', active: true,
            statusHistory: [{ date: '2026-05-01', active: false }, { date: '2026-05-11', active: true }]
        };
        const inactiveNowActiveThen = {
            id: 'status-b', active: false,
            statusHistory: [{ date: '2026-05-01', active: true }, { date: '2026-05-11', active: false }]
        };
        const inactiveBoth = {
            id: 'status-c', active: false,
            statusHistory: [{ date: '2026-05-01', active: false }]
        };
        const activeNormal = { id: 'status-d', active: true, statusHistory: [{ date: '2026-05-01', active: true }] };

        const warningStatus = getAttendanceCardStatus(activeNowInactiveThen, selected, {});
        testRunner.assertEquals(warningStatus.kind, 'not-active-on-date');
        testRunner.assert(!Object.prototype.hasOwnProperty.call(warningStatus, 'blocksAttendance'), 'la advertencia no introduce estado de bloqueo paralelo');
        testRunner.assertEquals(getAttendanceCardStatus(inactiveNowActiveThen, selected, {}).kind, 'inactive-currently');
        testRunner.assertEquals(getAttendanceCardStatus(inactiveBoth, selected, {}).kind, 'not-active-on-date');
        testRunner.assertEquals(getAttendanceCardStatus(activeNormal, selected, {}).kind, 'active');

        const explicit = { 'status-c-2026-05-10': { present: true, hoursWorked: 8 } };
        testRunner.assertEquals(getAttendanceCardStatus(inactiveBoth, selected, explicit).kind, 'inactive-currently',
            'asistencia explícita viva conserva el contrato de wasEmployeeActiveOnDate');
    },

    "EmployeeRow advierte fecha inactiva sin bloquear el control normal"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const employee = {
            id: 'warning-card', number: '027', name: 'Empleado Advertido', positions: ['p1'], active: true,
            statusHistory: [{ date: '2026-05-01', active: false }, { date: '2026-05-11', active: true }]
        };
        window.state.selectedDate = new Date('2026-05-10T12:00:00');
        window.state.attendance = {};
        window.state.positions = [{ id: 'p1', name: 'Ayudante', workingDays: [0] }];
        try {
            const html = EmployeeRow(employee);
            testRunner.assert(html.indexOf('employee-number-badge') < html.indexOf('Empleado Advertido'), 'número antes del nombre');
            testRunner.assert(html.includes('No activo en esta fecha'), 'pill ámbar de fecha');
            testRunner.assert(html.includes('data-att-action="handle-checkbox-click"'), 'la advertencia conserva la acción normal');
            testRunner.assert(!html.includes('attendance-pending-tile'), 'la advertencia no crea un estado Pendiente paralelo');
            testRunner.assert(!html.includes('aria-disabled="true"'), 'la advertencia no presenta semántica deshabilitada');
            testRunner.assert(!html.includes('>INACTIVO<'), 'el badge inline antiguo fue retirado');

            const compactHtml = EmployeeRowCompact(employee);
            testRunner.assert(compactHtml.indexOf('employee-number-badge') < compactHtml.indexOf('Empleado Advertido'), 'compacta mantiene número antes del nombre');
            testRunner.assert(compactHtml.includes('No activo en esta fecha'), 'compacta conserva el estado de fecha');
            testRunner.assert(compactHtml.includes('data-att-action="handle-checkbox-click"'), 'compacta conserva la acción normal');
            testRunner.assert(!compactHtml.includes('attendance-pending-tile'), 'compacta tampoco crea Pendiente');
            testRunner.assert(!compactHtml.includes('aria-disabled="true"'), 'compacta no presenta semántica deshabilitada');

            const uiSource = require('fs').readFileSync(require('path').resolve(__dirname, '../modules/ui/AttendanceUI.js'), 'utf8');
            testRunner.assert(
                /'handle-checkbox-click':\s*\([^)]*\)\s*=>\s*window\.handleCheckboxClick\?\.\(e,\s*el\.dataset\.empId\)/.test(uiSource),
                'el mapa delegado debe enviar el checkbox normal al handler sin guardas de bloqueo'
            );
            window.state.attendance = {
                'warning-card-2026-05-10': { present: true, hoursWorked: 8, selectedPosition: 'p1', updatedAt: 1 }
            };
            const attendedHtml = EmployeeRow(employee);
            testRunner.assert(!attendedHtml.includes('No activo en esta fecha'), 'la asistencia explícita elimina la advertencia al renderizar de nuevo');
            testRunner.assert(attendedHtml.includes('hours-badge'), 'la tarjeta asistida conserva el badge normal de horas');
            const attendedCompactHtml = EmployeeRowCompact(employee);
            testRunner.assert(!attendedCompactHtml.includes('No activo en esta fecha'), 'compacta también elimina la advertencia');
            testRunner.assert(attendedCompactHtml.includes('8h'), 'compacta conserva sus horas normales');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
        }
    },

    "EmployeeRow permite asistencia histórica si está inactivo actualmente"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const employee = {
            id: 'historical-card', number: '028', name: 'Empleado Histórico', positions: ['p1'], active: false,
            statusHistory: [{ date: '2026-05-01', active: true }, { date: '2026-05-11', active: false }]
        };
        window.state.selectedDate = new Date('2026-05-10T12:00:00');
        window.state.attendance = {};
        window.state.positions = [{ id: 'p1', name: 'Ayudante', workingDays: [0] }];
        try {
            const html = EmployeeRow(employee);
            testRunner.assert(html.includes('Inactivo actualmente'), 'pill slate de estado actual');
            testRunner.assert(html.includes('data-att-action="handle-checkbox-click"'), 'la fecha históricamente activa sigue editable');
            testRunner.assert(!html.includes('attendance-pending-tile'), 'no debe bloquear control histórico');
            testRunner.assert(!html.includes('>INACTIVO<'), 'sin marcador inline antiguo');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
        }
    },

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

    "DateControls: eleva la capa activa del calendario normal y flotante"() {
        const originalShowDatePicker = window.state.showDatePicker;
        const originalDatePickerTarget = window.state.datePickerTarget;
        const originalIsScrolled = window.state.isScrolled;
        const originalActiveTab = window.state.activeTab;
        const originalDatePicker = window.DatePicker;

        window.DatePicker = () => '<div class="calendar-picker">Calendario</div>';
        window.state.showDatePicker = true;
        window.state.activeTab = 'attendance';

        try {
            window.state.datePickerTarget = 'full';
            testRunner.assert(
                DateControls().includes('attendance-toolbar glass-effect date-picker-open'),
                'El calendario normal debe elevar el contenedor que crea su capa'
            );

            window.state.datePickerTarget = 'compact';
            window.state.isScrolled = true;
            testRunner.assert(
                DateControlsCompact().includes('date-controls-compact visible date-picker-open'),
                'El calendario flotante debe elevarse cuando está abierto'
            );
        } finally {
            window.state.showDatePicker = originalShowDatePicker;
            window.state.datePickerTarget = originalDatePickerTarget;
            window.state.isScrolled = originalIsScrolled;
            window.state.activeTab = originalActiveTab;
            window.DatePicker = originalDatePicker;
        }
    },

    "DateControlsCompact: agrupa fecha y selector compacto de horas en la vista diaria"() {
        const originalViewMode = window.state.viewMode;
        const originalDayHoursConfig = window.state.dayHoursConfig;
        const originalDate = window.state.selectedDate;

        window.state.viewMode = 'day';
        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.dayHoursConfig = { '2026-07-26': 8 };

        try {
            const html = DateControlsCompact();
            testRunner.assert(html.includes('attendance-floating-date'), 'Debe identificar la navegación flotante de fecha');
            testRunner.assert(html.includes('attendance-floating-hours'), 'Debe colocar el selector flotante de horas debajo de la fecha');
            testRunner.assert(html.includes('data-att-action="change-base-hours"'), 'Debe conservar el comportamiento del selector de horas');
            testRunner.assert(html.includes('8h'), 'Debe mostrar las horas asignadas al día');
            testRunner.assert(!html.includes('Horas a Asignar'), 'El selector flotante no debe mostrar un título adicional');
            testRunner.assert(!html.includes('control-section center-control'), 'El selector flotante no debe conservar el marco exterior del control completo');
        } finally {
            window.state.viewMode = originalViewMode;
            window.state.dayHoursConfig = originalDayHoursConfig;
            window.state.selectedDate = originalDate;
        }
    },

    "DateControlsCompact: compara el color con las horas regulares configuradas, no con 8"() {
        const originalViewMode = window.state.viewMode;
        const originalSettings = window.state.settings;
        const originalDayHoursConfig = window.state.dayHoursConfig;
        window.state.viewMode = 'day';
        window.state.settings = { ...window.state.settings, regularHoursPerDay: 6 };
        window.state.dayHoursConfig = {};
        try {
            const html = DateControlsCompact();
            testRunner.assert(html.includes('color: #10b981'), '6h debe ser jornada regular verde cuando Ajustes define 6h');
        } finally {
            window.state.viewMode = originalViewMode;
            window.state.settings = originalSettings;
            window.state.dayHoursConfig = originalDayHoursConfig;
        }
    },

    "DateControlsCompact: espera a que acciones y primera fila salgan antes de fijarse"() {
        testRunner.assert(
            !shouldShowCompactDayControls({ scrollY: 562, activationScrollY: 200, safeTop: 73, protectedBottom: 181 }),
            'No debe aparecer mientras el contenido protegido intersecte la zona flotante'
        );
        testRunner.assert(
            shouldShowCompactDayControls({ scrollY: 562, activationScrollY: 200, safeTop: 73, protectedBottom: 72 }),
            'Debe aparecer cuando acciones y primera fila ya hayan salido de la zona flotante'
        );
        testRunner.assert(
            !shouldShowCompactDayControls({ scrollY: 150, activationScrollY: 200, safeTop: 73, protectedBottom: 40 }),
            'Debe respetar el umbral mínimo de desplazamiento'
        );
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

    "DayView: mantiene buscador y acciones masivas en el flujo normal"() {
        const html = DayView();
        testRunner.assert(html.includes('attendance-flow-controls'), 'Debe usar un contenedor de flujo normal para los controles diarios');
        testRunner.assert(!html.includes('class="sticky-controls-wrapper"'), 'La vista diaria no debe fijar la barra de acciones al desplazarse');
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

    "EmployeeRow: muestra resumen del período y nota diaria escapada"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalSettings = window.state.settings;
        const employee = { id: 'emp-summary', number: '014', name: 'Resumen', positions: ['p1'], active: true, hireDate: '2026-05-04' };

        window.state.selectedDate = new Date('2026-05-05T12:00:00');
        window.state.positions = [{ id: 'p1', name: 'Ayudante', workingDays: [1, 2, 3, 4, 5] }];
        window.state.settings = {
            ...window.state.settings,
            regularHoursPerDay: 8,
            showAttendanceCardDeficit: true,
            attendanceDeficitUnit: 'hours',
            holidays: [],
            payPeriod: { periodStart: '2026-05-01', periodLength: 15 }
        };
        window.state.attendance = {
            'emp-summary-2026-05-04': { present: true, hoursWorked: 4, overtimeHours: 2, selectedPosition: 'p1' },
            'emp-summary-2026-05-05': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1', notes: '<img src=x onerror=alert(1)>' }
        };

        try {
            const html = EmployeeRow(employee);
            testRunner.assert(html.includes('attendance-period-summary'), 'debe mostrar el pie compacto del período');
            testRunner.assert(!html.includes('attendance-period-range'), 'la tarjeta no debe repetir el rango del período');
            testRunner.assert(html.includes('1.5/2 días'), 'debe mostrar crédito proporcional 4/8 + 8/8');
            testRunner.assert(html.includes('−4h'), 'debe respetar la unidad global de déficit');
            testRunner.assert(html.includes('+2h extra'), 'debe mostrar extras por separado');
            testRunner.assert(html.includes('attendance-card-note'), 'debe mostrar la nota del día por defecto');
            testRunner.assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'debe escapar la nota');
            testRunner.assert(!html.includes('<img src=x'), 'no debe inyectar HTML desde la nota');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.settings = originalSettings;
        }
    },

    "EmployeeRow: una tarjeta 3/10 se vuelve proporcional según sus horas reales"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalSettings = window.state.settings;
        const originalDayHoursConfig = window.state.dayHoursConfig;
        const employee = { id: 'emp-proportional', number: '015', name: 'Proporcional', positions: ['p1'], active: true, hireDate: '2026-05-04' };

        window.state.selectedDate = new Date('2026-05-15T12:00:00');
        window.state.positions = [{ id: 'p1', name: 'Ayudante', workingDays: [1, 2, 3, 4, 5] }];
        window.state.settings = {
            ...window.state.settings,
            regularHoursPerDay: 8,
            showAttendanceCardDeficit: true,
            attendanceDeficitUnit: 'days',
            holidays: [],
            payPeriod: { periodStart: '2026-05-04', periodLength: 12 }
        };
        window.state.dayHoursConfig = {};
        window.state.attendance = {
            'emp-proportional-2026-05-04': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' },
            'emp-proportional-2026-05-05': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' },
            'emp-proportional-2026-05-06': { present: true, hoursWorked: 4, overtimeHours: 0, selectedPosition: 'p1' }
        };

        try {
            const html = EmployeeRow(employee);
            testRunner.assert(html.includes('2.5/10 días'), 'dos jornadas completas + 4/8 deben mostrar 2.5/10, no 3/10');
            testRunner.assert(html.includes('−7.5 días'), 'el déficit debe concordar con el crédito proporcional');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.settings = originalSettings;
            window.state.dayHoursConfig = originalDayHoursConfig;
        }
    },

    "EmployeeRow: oculta déficit por defecto sin perder crédito proporcional"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalSettings = window.state.settings;
        const employee = { id: 'emp-day-decimal', number: '016', name: 'Decimal', positions: ['p1'], active: true, hireDate: '2026-05-04' };
        window.state.selectedDate = new Date('2026-05-04T12:00:00');
        window.state.positions = [{ id: 'p1', name: 'Ayudante', workingDays: [1] }];
        window.state.settings = {
            ...window.state.settings,
            regularHoursPerDay: 8,
            showAttendanceCardDeficit: false,
            attendanceDeficitUnit: 'days',
            holidays: [],
            payPeriod: { periodStart: '2026-05-04', periodLength: 1 }
        };
        window.state.attendance = {
            'emp-day-decimal-2026-05-04': { present: true, hoursWorked: 5.5, overtimeHours: 0, selectedPosition: 'p1' }
        };
        try {
            const html = EmployeeRow(employee);
            testRunner.assert(html.includes('0.7/1 días'), '0.6875 días debe mostrarse como 0.7');
            testRunner.assert(!html.includes('attendance-period-deficit'), 'el déficit debe ocultarse completamente por defecto');
            testRunner.assert(!html.includes('−0.3 días'), 'el valor oculto no debe quedar en el HTML');
            testRunner.assert(!html.includes('0.6875/1'), 'la precisión completa no debe filtrarse a la presentación');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.settings = originalSettings;
        }
    },

    "EmployeeRow: conserva el gradiente semántico de jornada incompleta para déficit"() {
        const cssSource = require('fs').readFileSync(require('path').resolve(__dirname, '../../css/attendance_ui.css'), 'utf8');
        testRunner.assert(
            /\.attendance-period-deficit\.check-undertime[\s\S]*?linear-gradient\(135deg,\s*#ec4899,\s*#ef4444\)/.test(cssSource),
            'El déficit debe usar el gradiente rosa-rojo establecido'
        );
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

    "EmployeeRow: muestra como marca de agua el puesto realmente trabajado ese día"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalEmployees = window.state.employees;
        const originalSettings = window.state.settings;
        const employee = {
            id: 'emp-watermark',
            name: 'Empleado Marca',
            number: '019',
            positions: ['pos-primary', 'pos-worked'],
            active: true
        };

        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.positions = [
            { id: 'pos-primary', name: 'Ayudante', color: '#8b5cf6', icon: 'crew' },
            { id: 'pos-worked', name: 'Albañil', color: '#f59e0b', icon: 'bricks' }
        ];
        window.state.employees = [employee];
        window.state.attendance = {
            'emp-watermark-2026-07-26': {
                employeeId: employee.id,
                date: '2026-07-26',
                present: true,
                hoursWorked: 8,
                selectedPosition: 'pos-worked',
                updatedAt: 1
            }
        };
        window.state.settings = {
            ...window.state.settings,
            attendancePositionWatermarks: true,
            attendanceWatermarkVisibility: 'present',
            attendanceWatermarkContent: 'position'
        };

        try {
            const attendance = window.state.attendance['emp-watermark-2026-07-26'];
            const positions = getAttendanceWatermarkPositions(employee, attendance);
            const html = EmployeeRow(employee);

            testRunner.assertEquals(positions.length, 1, 'debe resolver una sola labor trabajada');
            testRunner.assertEquals(positions[0].id, 'pos-worked', 'debe usar el puesto registrado, no el puesto principal');
            testRunner.assert(html.includes('attendance-watermarks is-position has-1'), 'debe renderizar la marca de agua');
            testRunner.assert(html.includes('--watermark-color: #f59e0b'), 'debe conservar el color del puesto trabajado');
            testRunner.assert(!html.includes('--watermark-color: #8b5cf6'), 'no debe mostrar el puesto principal que no se trabajó');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.employees = originalEmployees;
            window.state.settings = originalSettings;
        }
    },

    "EmployeeRow: respeta el ajuste de marcas de agua y admite varias labores del día"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalEmployees = window.state.employees;
        const originalSettings = window.state.settings;
        const employee = {
            id: 'emp-watermark-multi',
            name: 'Empleado Multi',
            number: '020',
            positions: ['pos-a', 'pos-b'],
            active: true
        };

        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.positions = [
            { id: 'pos-a', name: 'Albañil', color: '#f59e0b', icon: 'bricks' },
            { id: 'pos-b', name: 'Operador', color: '#06b6d4', icon: 'tractor' }
        ];
        window.state.employees = [employee];
        window.state.attendance = {
            'emp-watermark-multi-2026-07-26': {
                employeeId: employee.id,
                date: '2026-07-26',
                present: true,
                hoursWorked: 8,
                multiPosition: true,
                positionHours: [
                    { positionId: 'pos-a', hours: 4 },
                    { positionId: 'pos-b', hours: 4 }
                ],
                updatedAt: 1
            }
        };
        window.state.settings = {
            ...window.state.settings,
            attendancePositionWatermarks: true,
            attendanceWatermarkVisibility: 'present',
            attendanceWatermarkContent: 'position'
        };

        try {
            const enabledHTML = EmployeeRow(employee);
            testRunner.assert(enabledHTML.includes('attendance-watermarks is-position has-2'),
                'debe mostrar las dos labores realmente trabajadas');

            window.state.settings.attendancePositionWatermarks = false;
            const disabledHTML = EmployeeRow(employee);
            testRunner.assert(!disabledHTML.includes('attendance-watermarks'),
                'debe ocultar las marcas inmediatamente al apagar el ajuste');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.employees = originalEmployees;
            window.state.settings = originalSettings;
        }
    },

    "EmployeeRow: permite usar el número y elegir si la marca se ve estando ausente"() {
        const originalDate = window.state.selectedDate;
        const originalAttendance = window.state.attendance;
        const originalPositions = window.state.positions;
        const originalEmployees = window.state.employees;
        const originalSettings = window.state.settings;
        const employee = {
            id: 'emp-watermark-number',
            name: 'Empleado Número',
            number: '042',
            positions: ['pos-primary'],
            active: true
        };

        window.state.selectedDate = new Date('2026-07-26T12:00:00');
        window.state.positions = [
            { id: 'pos-primary', name: 'Albañil', color: '#f59e0b', icon: 'bricks' }
        ];
        window.state.employees = [employee];
        window.state.attendance = {};
        window.state.settings = {
            ...window.state.settings,
            attendancePositionWatermarks: true,
            attendanceWatermarkVisibility: 'always',
            attendanceWatermarkContent: 'number'
        };

        try {
            const numberModel = getAttendanceWatermarkModel(employee, undefined);
            const numberHTML = EmployeeRow(employee);
            testRunner.assert(numberModel.visible === true, 'siempre visible debe incluir empleados ausentes');
            testRunner.assert(numberHTML.includes('attendance-watermarks is-number'),
                'debe renderizar la variante numérica');
            testRunner.assert(numberHTML.includes('<span>042</span>'),
                'debe conservar ceros iniciales del número');

            window.state.settings.attendanceWatermarkVisibility = 'present';
            const presentOnlyHTML = EmployeeRow(employee);
            testRunner.assert(!presentOnlyHTML.includes('attendance-watermarks'),
                'solo presente debe ocultarla mientras no exista asistencia');

            window.state.settings.attendanceWatermarkVisibility = 'always';
            window.state.settings.attendanceWatermarkContent = 'position';
            const fallbackPositionHTML = EmployeeRow(employee);
            testRunner.assert(fallbackPositionHTML.includes('attendance-watermarks is-position has-1'),
                'el icono siempre visible debe usar el puesto principal antes de marcar asistencia');
            testRunner.assert(fallbackPositionHTML.includes('--watermark-color: #f59e0b'),
                'el puesto de respaldo debe conservar su color');
        } finally {
            window.state.selectedDate = originalDate;
            window.state.attendance = originalAttendance;
            window.state.positions = originalPositions;
            window.state.employees = originalEmployees;
            window.state.settings = originalSettings;
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
    },

    "CalendarView: el modo período muestra únicamente sus fechas aunque cruce de mes"() {
        const originalAttendance = window.state.attendance;
        const originalSettings = window.state.settings;
        const employee = {
            id: 'emp-period-calendar',
            name: 'Empleado Período',
            positions: [],
            active: true
        };
        const payPeriod = {
            periodStart: '2026-05-25',
            periodLength: 10,
            payDay: '2026-06-03'
        };

        window.state.attendance = {};
        window.state.settings = { ...window.state.settings, payPeriod };

        try {
            const days = getPayPeriodCalendarDays(payPeriod);
            const html = CalendarView({
                employee,
                month: new Date('2026-05-01T12:00:00'),
                navAction: 'noop',
                selectAction: 'selectAttendanceDetailDate',
                displayMode: 'period',
                payPeriod
            });
            const renderedDates = [...html.matchAll(/data-cv-date="([^"]+)"/g)].map(match => match[1]);

            testRunner.assertEquals(days.length, 10, 'debe resolver la duración exacta del período');
            testRunner.assertEquals(renderedDates.length, 10, 'debe dibujar solo sus diez días');
            testRunner.assertEquals(renderedDates[0], '2026-05-25', 'debe comenzar en la fecha configurada');
            testRunner.assertEquals(renderedDates[9], '2026-06-03', 'debe cruzar de mes sin cortar el período');
            testRunner.assert(!html.includes('data-cv-date="2026-05-24"'), 'no debe incluir días anteriores');
            testRunner.assert(!html.includes('data-cv-date="2026-06-04"'), 'no debe incluir días posteriores');
            testRunner.assert(html.includes('data-calendar-display="period"'), 'debe identificar el modo período');
            testRunner.assert(!html.includes('aria-label="Mes anterior"'), 'el período exacto no necesita navegación mensual');
        } finally {
            window.state.attendance = originalAttendance;
            window.state.settings = originalSettings;
        }
    },

    "AttendanceDetailCalendar: usa período por defecto y conserva el calendario completo como alternativa"() {
        const originalAttendance = window.state.attendance;
        const originalSettings = window.state.settings;
        const employee = {
            id: 'emp-detail-calendar',
            name: 'Empleado Detalle',
            positions: [],
            active: true
        };
        const args = {
            employee,
            selectedDate: new Date('2026-05-28T12:00:00'),
            calendarMonth: new Date('2026-05-01T12:00:00'),
            payPeriod: { periodStart: '2026-05-25', periodLength: 10 }
        };

        window.state.attendance = {
            'emp-detail-calendar-2026-05-25': {
                employeeId: 'emp-detail-calendar',
                date: '2026-05-25',
                present: true,
                hoursWorked: 8
            },
            'emp-detail-calendar-2026-05-26': {
                employeeId: 'emp-detail-calendar',
                date: '2026-05-26',
                present: true,
                hoursWorked: 6
            },
            'emp-detail-calendar-2026-05-27': {
                employeeId: 'emp-detail-calendar',
                date: '2026-05-27',
                present: true,
                hoursWorked: 8
            }
        };
        window.state.settings = {
            ...window.state.settings,
            regularHoursPerDay: 8,
            holidays: ['2026-05-27']
        };

        try {
            const defaultHTML = AttendanceDetailCalendar(args);
            const fullHTML = AttendanceDetailCalendar({ ...args, activeView: 'full' });

            testRunner.assertEquals(normalizeAttendanceDetailCalendarView(undefined), 'period',
                'el modo principal debe ser período');
            testRunner.assert(defaultHTML.includes('data-detail-calendar-view="period"'),
                'debe abrir directamente el período actual');
            testRunner.assert(defaultHTML.includes('Período actual') && defaultHTML.includes('Calendario completo'),
                'debe ofrecer las dos vistas');
            testRunner.assertEquals(
                (defaultHTML.match(/<span class="hours-dot">8h<\/span>/g) || []).length,
                1,
                'debe ocultar la jornada normal repetida, pero conservarla en feriados'
            );
            testRunner.assert(defaultHTML.includes('<span class="hours-dot">6h</span>'),
                'debe conservar las horas que requieren atención');
            testRunner.assert(fullHTML.includes('data-detail-calendar-view="full"'),
                'debe permitir el calendario completo');
            testRunner.assert(fullHTML.includes('aria-label="Mes anterior"'),
                'el calendario completo debe conservar su navegación mensual');
        } finally {
            window.state.attendance = originalAttendance;
            window.state.settings = originalSettings;
        }
    },

    "AttendanceDetailCalendar: sin período ofrece acceso directo a su configuración"() {
        const html = AttendanceDetailCalendar({
            employee: {
                id: 'emp-no-period',
                name: 'Empleado Sin Período',
                positions: [],
                active: true
            },
            selectedDate: new Date('2026-05-28T12:00:00'),
            calendarMonth: new Date('2026-05-01T12:00:00'),
            payPeriod: { periodStart: null, periodLength: 21 }
        });

        testRunner.assert(html.includes('data-calendar-period-empty'),
            'debe explicar que falta configurar el período');
        testRunner.assert(html.includes('data-app-fn="openCalendarioAjustes"'),
            'debe enlazar directamente a Ajustes > Calendario');
        testRunner.assert(html.includes('Configurar período'),
            'el llamado a la acción debe ser explícito');
    }
});
