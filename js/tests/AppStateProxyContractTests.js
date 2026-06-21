/**
 * 🛡️ AppStateProxyContractTests — Red de seguridad de los efectos del Proxy de estado.
 *
 * Caracteriza (lock-in) el comportamiento OCULTO de los set/delete traps del Proxy
 * de AppState.js, que hoy NO tiene cobertura de comportamiento y es lo más peligroso
 * de refactorizar (Fase 0 del plan de desacople del `state` global).
 *
 * Contratos que esta suite fija sobre el código actual:
 *
 *   1. Escribir un registro de asistencia (state.attendance[key] = rec) invalida
 *      statsCache.mtd[employeeId].
 *   2. La misma escritura reconstruye attendanceByDate[dateKey] vía buildAttendanceIndex.
 *   3. La misma escritura agenda exactamente un render.
 *   4. Borrar un registro (delete state.attendance[key]) invalida la cache y
 *      reconstruye el índice del día según el valor previo (oldValue).
 *   5. En modo silencioso (batchSetState) una escritura de asistencia NO ejecuta
 *      ninguno de esos efectos: la cache y el índice NO se tocan y sólo se agenda
 *      un render al cerrar el batch. (Documenta el acoplamiento que cualquier
 *      refactor debe preservar o reubicar explícitamente.)
 *   6. El set-trap desenvuelve Proxies anidados con toRaw antes de almacenar
 *      (defensa anti-DataCloneError de IndexedDB).
 *
 * Por qué importa: estos efectos son el ÚNICO disparador de coherencia de la cache
 * y el índice de asistencia. Un refactor del estado que los altere en silencio
 * desincroniza estadísticas y nómina sin tirar ningún error. Esta suite muerde antes.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 🧭 GUÍA DE CONVERSIÓN PARA FASE 4 PASO 4 (sacar la rama de asistencia de los traps)
 * Cuando Paso 4 borre la coherencia de los traps (AppState.js set L241-263 / delete
 * L275-279), ESTOS tests SE DAN VUELTA — es esperado, no un bug:
 *   • Test 1 (escribir invalida statsCache)  → INVERTIR: una escritura DIRECTA cruda ya
 *     NO debe invalidar (el proxy es agnóstico). La coherencia ahora la hacen los
 *     handlers explícitamente (ver los *CoherenceTests.js).
 *   • Test 2 (escribir reconstruye attendanceByDate) → INVERTIR igual (ya NO reconstruye).
 *   • Test 4 (borrar invalida + reconstruye) → INVERTIR igual.
 * Estos NO cambian (siguen verdes): Test 3 (agenda render — eso es Paso 5),
 *   Test 5 (modo silencioso ya era agnóstico), Test 6 (toRaw).
 * Antes de invertir, correr la suite COMPLETA: AttendanceCoherenceCoverageTests +
 * los *CoherenceTests.js deben seguir verdes (prueban que la coherencia explícita
 * cubre todo). Si alguno se pone rojo, falta un sitio de Paso 3 — ESE es el bug real.
 * ───────────────────────────────────────────────────────────────────────────────
 */

import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';

// ─────────────────────────────────────────────────────────────
// Helpers (espía de scheduleRender, igual que RenderBatchingTests)
// ─────────────────────────────────────────────────────────────

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

/**
 * Reinicia las porciones del estado que tocan estos tests SIN pasar por el Proxy
 * (escribe sobre el objeto crudo vía getState()), para no disparar traps ni renders
 * durante el setup. `state` es un singleton de módulo compartido entre tests.
 */
function reset() {
    scheduleCallCount = 0;
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;

    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.employees = [];
}

// ─────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("AppState — Contrato de efectos del Proxy (red de seguridad)", {

    "AGNÓSTICO: una escritura directa de asistencia NO invalida statsCache.mtd (Paso 4)"() {
        reset();
        const raw = stateManager.getState();
        // Sembramos una entrada de cache (en crudo, sin disparar el trap)
        raw.statsCache.mtd['emp1'] = { days: 5, hours: 40, overtime: 0, monthKey: '2026-06' };

        // Escritura DIRECTA al Proxy, fuera de un handler. Tras Paso 4 el proxy es
        // AGNÓSTICO: NO mantiene la coherencia de stats. Esa responsabilidad pasó a los
        // handlers (invalidateEmployeeStats explícito; ver los *CoherenceTests.js).
        state.attendance['emp1-2026-06-15'] = {
            employeeId: 'emp1', date: '2026-06-15', present: true, hoursWorked: 8
        };

        testRunner.assert(
            raw.statsCache.mtd['emp1'] !== undefined,
            "el proxy agnóstico NO debe invalidar statsCache.mtd: una escritura cruda no es coherencia"
        );
    },

    "AGNÓSTICO: una escritura directa de asistencia NO reconstruye attendanceByDate (Paso 4)"() {
        reset();
        const raw = stateManager.getState();

        // Escritura DIRECTA al Proxy: el índice por fecha lo reconstruye buildAttendanceIndex
        // desde los handlers, ya NO el trap del proxy.
        state.attendance['emp1-2026-06-15'] = {
            employeeId: 'emp1', date: '2026-06-15', present: true, hoursWorked: 8
        };

        testRunner.assert(
            raw.attendanceByDate['2026-06-15'] === undefined,
            "el proxy agnóstico NO debe reconstruir el índice del día tras una escritura cruda"
        );
    },

    "asistencia: escribir un registro agenda exactamente un render"() {
        installScheduleSpy();
        try {
            reset();
            scheduleCallCount = 0;

            state.attendance['emp1-2026-06-15'] = {
                employeeId: 'emp1', date: '2026-06-15', present: true
            };

            testRunner.assertEquals(
                scheduleCallCount, 1,
                "Una escritura de asistencia debe agendar exactamente 1 render"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "asistencia: borrar un registro invalida la cache y reconstruye el índice del día"() {
        reset();
        const raw = stateManager.getState();

        // Sembramos el registro vía Proxy y re-sembramos la cache en crudo
        state.attendance['emp2-2026-06-20'] = { employeeId: 'emp2', date: '2026-06-20', present: true };
        raw.statsCache.mtd['emp2'] = { days: 1, hours: 8, overtime: 0, monthKey: '2026-06' };

        delete state.attendance['emp2-2026-06-20'];

        testRunner.assert(
            raw.statsCache.mtd['emp2'] === undefined,
            "Borrar asistencia debe invalidar statsCache.mtd del empleado (según oldValue)"
        );
        const bucket = raw.attendanceByDate['2026-06-20'];
        testRunner.assert(
            Array.isArray(bucket) && bucket.length === 0,
            "Tras borrar, el bucket del día debe reconstruirse vacío"
        );
    },

    "modo silencioso (batchSetState): una escritura de asistencia NO ejecuta efectos"() {
        installScheduleSpy();
        try {
            reset();
            const raw = stateManager.getState();
            raw.statsCache.mtd['emp3'] = { days: 2, hours: 16, overtime: 0, monthKey: '2026-06' };
            scheduleCallCount = 0;

            stateManager.batchSetState(() => {
                state.attendance['emp3-2026-06-21'] = { employeeId: 'emp3', date: '2026-06-21', present: true };
            });

            testRunner.assert(
                raw.statsCache.mtd['emp3'] !== undefined,
                "En modo silencioso la cache del empleado NO debe invalidarse"
            );
            testRunner.assert(
                raw.attendanceByDate['2026-06-21'] === undefined,
                "En modo silencioso el índice del día NO debe reconstruirse"
            );
            testRunner.assertEquals(
                scheduleCallCount, 1,
                "batchSetState debe agendar 1 render al cerrar el batch (no por mutación)"
            );
        } finally {
            uninstallScheduleSpy();
        }
    },

    "set-trap: desenvuelve Proxies anidados con toRaw antes de almacenar"() {
        reset();
        const raw = stateManager.getState();

        // Leer un objeto anidado devuelve un Proxy de nuestro sistema
        state.employees = [{ id: 'e1', name: 'Juan' }];
        const proxiedEmp = state.employees[0];
        testRunner.assert(proxiedEmp._isProxy === true, "Leer un objeto anidado debe devolver un Proxy");

        // Asignar ese Proxy debe almacenar un objeto plano (toRaw lo desenvuelve)
        state.tempPositionSelection.ref = proxiedEmp;
        const stored = raw.tempPositionSelection.ref;

        testRunner.assert(
            !stored._isProxy,
            "El valor almacenado NO debe ser un Proxy (toRaw debe desenvolverlo)"
        );
        testRunner.assertEquals(stored.id, 'e1', "El valor desenvuelto debe conservar los datos");

        delete raw.tempPositionSelection.ref;
    }
});

console.log('🛡️ AppStateProxyContract tests cargados.');
