/**
 * 🧪 AttendanceUITests — Tests for Attendance UI controls and components
 */

import { DateControls, formatSplitName, WeekView, SearchBar } from '../modules/ui/AttendanceUI.js';

testRunner.addSuite("AttendanceUI — DateControls y Adaptabilidad", {

    "DateControls: mantiene etiquetas consistentes para Día y Semana independientemente de viewMode"() {
        const originalViewMode = window.state.viewMode;
        
        // Caso 1: viewMode = 'day'
        window.state.viewMode = 'day';
        const htmlDay = DateControls();
        testRunner.assert(htmlDay.includes('Día'), 'Debe mostrar "Día" en la etiqueta de la pestaña de Día');
        testRunner.assert(htmlDay.includes('Semana'), 'Debe mostrar "Semana" en la etiqueta de la pestaña de Semana');

        // Caso 2: viewMode = 'week'
        window.state.viewMode = 'week';
        const htmlWeek = DateControls();
        testRunner.assert(htmlWeek.includes('Día'), 'Debe mostrar "Día" en la etiqueta de la pestaña de Día cuando está en vista semanal');
        testRunner.assert(htmlWeek.includes('Semana'), 'Debe mostrar "Semana" en la etiqueta de la pestaña de Semana cuando está en vista semanal');

        // Limpiar
        window.state.viewMode = originalViewMode;
    },

    "formatSplitName: divide correctamente nombres largos en primer nombre y primer apellido"() {
        // Caso de 2 partes: Juan Pérez
        const res2 = formatSplitName("Juan Pérez");
        testRunner.assert(res2.includes("Juan"), "Debe tener Juan en la línea 1");
        testRunner.assert(res2.includes("Pérez"), "Debe tener Pérez en la línea 2");

        // Caso de 3 partes con segundo nombre común: Juan Carlos Pérez
        const res3 = formatSplitName("Juan Carlos Pérez");
        testRunner.assert(res3.includes("Juan"), "Debe tener Juan en la línea 1");
        testRunner.assert(res3.includes("Pérez"), "Debe tener Pérez en la línea 2 (omitiendo el segundo nombre común)");

        // Caso de 3 partes sin segundo nombre común (ej. Jose Perez Gomez -> Jose Perez)
        const res3Surname = formatSplitName("Jose Pérez Gómez");
        testRunner.assert(res3Surname.includes("Jose"), "Debe tener Jose en la línea 1");
        testRunner.assert(res3Surname.includes("Pérez"), "Debe tener Pérez en la línea 2");

        // Caso de 4 partes con segundo nombre común: Juan Carlos Pérez Gómez
        const res4 = formatSplitName("Juan Carlos Pérez Gómez");
        testRunner.assert(res4.includes("Juan"), "Debe tener Juan en la línea 1");
        testRunner.assert(res4.includes("Pérez"), "Debe tener Pérez en la línea 2");
    },

    "WeekView: genera cabeceras compactas sin redundancia del año en columnas de días"() {
        const originalViewMode = window.state.viewMode;
        const originalDate = window.state.selectedDate;
        
        window.state.viewMode = 'week';
        window.state.selectedDate = new Date('2026-05-25T12:00:00'); // Lunes 25 Mayo 2026
        
        const html = WeekView();
        
        // No debe contener el año redundante '2026' en las cabeceras generadas de la tabla
        testRunner.assert(!html.includes('2026'), 'Las cabeceras no deben contener el año 2026');
        
        // Debe contener los días en formato compacto
        testRunner.assert(html.includes('Lun 25'), 'Debe incluir la columna "Lun 25"');
        testRunner.assert(html.includes('Mar 26'), 'Debe incluir la columna "Mar 26"');
        testRunner.assert(html.includes('Sáb 30'), 'Debe incluir la columna "Sáb 30"');
        
        // Restaurar estado
        window.state.viewMode = originalViewMode;
        window.state.selectedDate = originalDate;
    },

    "SearchBar: contiene las clases CSS requeridas para la adaptabilidad responsiva"() {
        const html = SearchBar();
        testRunner.assert(html.includes('class="search-wrapper"'), 'Debe contener la clase search-wrapper');
        testRunner.assert(html.includes('class="search-input-group"'), 'Debe contener la clase search-input-group');
    }
});

