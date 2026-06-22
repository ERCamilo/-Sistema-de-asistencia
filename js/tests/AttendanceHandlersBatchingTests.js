/**
 * AttendanceHandlersBatchingTests — Fase 4 Paso 5.
 *
 * Fija el contrato de render-count de los handlers de horas-base NO-FINANCIEROS
 * (changeBaseHours / setDayHours). En vista semanal escriben state.dayHoursConfig
 * para hasta 7 días; en vista día, para 1. Antes de batchear, cada escritura disparaba
 * el set-trap del proxy → un render por día (semana = 9 renders, día = 3). Tras envolver
 * el loop en stateManager.batchSetState (y soltar el render() manual), el handler agenda
 * un número de renders CONSTANTE, independiente de la cantidad de días.
 *
 * El contrato se afirma como cota en UNA sola corrida (vista semanal): el handler
 * agenda a lo sumo 2 renders (el del batch al cerrar + a lo sumo 1 que agenda
 * saveApplicationData como side-effect del guardado), un número CONSTANTE que NO
 * escala con los 7 días. Pre-batch eran 9 (7 escrituras + render() + save), así que
 * la cota muerde. Se evita comparar semana-vs-día en la misma corrida porque
 * saveApplicationData está debounced y la 2da invocación se saltea (contamina el conteo).
 *
 * Estos handlers NO tocan registros de asistencia (dayHoursConfig solo afecta días
 * creados a futuro), así que NO hay coherencia que mantener — solo el colapso de render.
 */

import { stateManager, renderOptimizer } from '../modules/core/AppState.js';
import { changeBaseHours, setDayHours, toggleHoliday } from '../modules/ui/AttendanceHandlers.js';

let scheduleCallCount = 0;
let originalScheduleRender = null;

function installScheduleSpy() {
    originalScheduleRender = renderOptimizer.scheduleRender.bind(renderOptimizer);
    renderOptimizer.scheduleRender = function spy(cb) {
        scheduleCallCount++;
        return originalScheduleRender(cb);
    };
}

function uninstallScheduleSpy() {
    if (originalScheduleRender) {
        renderOptimizer.scheduleRender = originalScheduleRender;
        originalScheduleRender = null;
    }
}

/** Resetea el estado relevante y la cola del optimizador; deja viewMode dado. */
function setup(viewMode) {
    const raw = stateManager.getState();
    raw.viewMode = viewMode;
    raw.selectedDate = new Date(2026, 5, 17); // miércoles 2026-06-17 → semana de 7 días
    raw.dayHoursConfig = {};
    raw.settings.regularHoursPerDay = 8;
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;
    scheduleCallCount = 0;
}

/** Corre `fn` en la vista dada (1 sola vez) y devuelve cuántos renders agendó. */
function rendersFor(viewMode, fn) {
    setup(viewMode);
    scheduleCallCount = 0;
    fn();
    return scheduleCallCount;
}

const MAX_RENDERS = 2; // batch (1) + a lo sumo 1 de saveApplicationData; constante, no por-día/registro

/** Siembra `empCount` empleados con asistencia en DATE; devuelve DATE. */
function setupHoliday(empCount) {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.settings.holidays = [];
    raw.viewMode = 'day';
    const DATE = '2026-06-19';
    raw.selectedDate = DATE;
    for (let i = 0; i < empCount; i++) {
        const id = `emp${i}`;
        raw.attendance[`${id}-${DATE}`] = { employeeId: id, date: DATE, present: true, hoursWorked: 8, isHoliday: false };
    }
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;
    scheduleCallCount = 0;
    return DATE;
}

testRunner.addSuite("AttendanceHandlers — Batching de render (Fase 4 Paso 5)", {

    "changeBaseHours en semana agenda un número constante de renders (≤2), no 1 por día"() {
        installScheduleSpy();
        try {
            const week = rendersFor('week', () => changeBaseHours(0.5));
            testRunner.assert(
                week <= MAX_RENDERS,
                `changeBaseHours en semana debe agendar ≤${MAX_RENDERS} renders (batch + save), no 1 por día; agendó ${week} (pre-batch eran 9)`
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "setDayHours en semana agenda un número constante de renders (≤2), no 1 por día"() {
        installScheduleSpy();
        try {
            const week = rendersFor('week', () => setDayHours('9'));
            testRunner.assert(
                week <= MAX_RENDERS,
                `setDayHours en semana debe agendar ≤${MAX_RENDERS} renders (batch + save), no 1 por día; agendó ${week} (pre-batch eran 9)`
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "toggleHoliday agenda un número constante de renders, no 1 por registro tocado (FINANCIERO)"() {
        installScheduleSpy();
        try {
            const date = setupHoliday(5); // 5 empleados con asistencia ese día
            scheduleCallCount = 0;
            toggleHoliday(date);
            // Cota = batch(1) + los renders de saveApplicationData() sin arg (guardado
            // completo, agenda 2; verificado: Notification no agenda render). Constante,
            // NO por-registro: pre-batch eran 14 con 5 empleados (~2 por registro tocado).
            const MAX_RENDERS_TOGGLE = 3;
            testRunner.assert(
                scheduleCallCount <= MAX_RENDERS_TOGGLE,
                `toggleHoliday debe agendar ≤${MAX_RENDERS_TOGGLE} renders (batch + guardado), no 1 por registro; agendó ${scheduleCallCount} con 5 empleados (pre-batch 14)`
            );
        } finally {
            uninstallScheduleSpy();
        }
    }
});

console.log('AttendanceHandlersBatching tests cargados.');
