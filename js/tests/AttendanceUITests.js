/**
 * 🧪 AttendanceUITests — Tests for Attendance UI controls and components
 */

import { DateControls } from '../modules/ui/AttendanceUI.js';

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
    }
});
