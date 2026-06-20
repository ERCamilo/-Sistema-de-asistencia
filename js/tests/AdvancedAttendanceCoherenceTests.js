/**
 * AdvancedAttendanceCoherenceTests — Fase 4 Paso 3 (AdvancedAttendanceModal).
 *
 * saveAdvancedAttendance mantiene la coherencia del índice EXPLÍCITAMENTE tras
 * escribir state.attendance[key] (sin depender del trap del proxy). El test clave
 * corre la función dentro de batchSetState (proxy silencioso): si attendanceByDate
 * queda coherente igual, es porque la coherencia explícita funcionó.
 */

import { state, stateManager } from '../modules/core/AppState.js';
import { saveAdvancedAttendance } from '../modules/ui/modals/AdvancedAttendanceModal.js';

const DATE = '2026-06-19';
const EMP_ID = 'empAdv1';
const POS_ID = 'posAdv1';
const KEY = `${EMP_ID}-${DATE}`;

function setupDOM() {
    document.body.innerHTML = `
        <input id="posHours_${POS_ID}" value="8">
        <input id="posOvertime_${POS_ID}" value="2">
        <input id="notes" value="nota avanzada">
    `;
}

function setupState() {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};

    const emp = { id: EMP_ID, name: 'Test Avanzado', positions: [POS_ID], hireDate: '2020-01-01' };
    raw.employees = [emp];
    raw.selectedEmployee = emp;
    raw.selectedDate = DATE;
    raw.settings.regularHoursPerDay = 8;
    raw.settings.holidays = [];
}

testRunner.addSuite("AdvancedAttendanceModal — Coherencia del índice (Fase 4 Paso 3)", {

    "saveAdvancedAttendance guarda el registro y deja el índice del día coherente"() {
        setupState();
        setupDOM();
        saveAdvancedAttendance();
        const raw = stateManager.getState();
        const rec = raw.attendance[KEY];
        testRunner.assert(rec && rec.hoursWorked === 8, "el registro debe quedar con hoursWorked=8");
        testRunner.assertEquals(
            (raw.attendanceByDate[DATE] || []).length, 1,
            "el índice del día debe contener el registro"
        );
    },

    "saveAdvancedAttendance en batchSetState (proxy silencioso) deja el índice coherente vía coherencia explícita"() {
        setupState();
        setupDOM();
        stateManager.batchSetState(() => { saveAdvancedAttendance(); });
        const raw = stateManager.getState();
        const rec = raw.attendance[KEY];
        testRunner.assert(rec && rec.hoursWorked === 8, "el registro debe guardarse aún en modo silencioso");
        testRunner.assertEquals(
            (raw.attendanceByDate[DATE] || []).length, 1,
            "el índice debe quedar coherente SIN el proxy (solo la coherencia explícita pudo construirlo)"
        );
    },

    "saveAdvancedAttendance en batchSetState invalida statsCache del empleado"() {
        setupState();
        setupDOM();
        const raw = stateManager.getState();
        raw.statsCache.mtd[EMP_ID] = { cached: true };
        stateManager.batchSetState(() => { saveAdvancedAttendance(); });
        testRunner.assert(
            !raw.statsCache.mtd[EMP_ID],
            "la cache de stats del empleado debe quedar invalidada"
        );
    }
});

console.log('AdvancedAttendanceCoherence tests cargados.');
