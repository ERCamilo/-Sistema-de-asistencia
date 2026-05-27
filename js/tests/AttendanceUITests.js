/**
 * AttendanceUITests - Tests for Attendance UI controls and components
 */

import { DateControls, formatSplitName, WeekView, SearchBar, DayView } from '../modules/ui/AttendanceUI.js';

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
        testRunner.assert(html.includes('class="search-input-group"'), 'Debe contener la clase search-input-group');
        testRunner.assert(html.includes('data-att-action="set-search-filter"'), 'La busqueda debe estar conectada al handler de asistencia');
        testRunner.assert(html.includes('data-att-action="set-leader-filter"'), 'El filtro de lider debe estar conectado al handler de asistencia');
        testRunner.assert(html.includes('employee-search-input'), 'Debe preservar el foco mientras se escribe en la busqueda');
        testRunner.assert(html.includes('data-app-fn="openAttendanceLayoutModal"'), 'Debe incluir el boton de opciones de distribucion');
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
    }
});
