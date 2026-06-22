/**
 * AttendanceHandlersCoherenceTests — Fase 4 Paso 3 (toggleHoliday).
 *
 * toggleHoliday() muta IN-PLACE att.isHoliday/att.updatedAt de cada registro del
 * día (L63-69). El trap del proxy solo dispara en set/delete de CLAVES, no en
 * propiedades anidadas → statsCache.mtd queda stale HOY (bug latente) y romperá
 * tras Paso 4. Como isHoliday alimenta nómina (factor feriado), hay que invalidar
 * las stats de los empleados tocados EXPLÍCITAMENTE.
 *
 * El test clave corre toggleHoliday DENTRO de batchSetState (proxy silencioso): si
 * statsCache queda invalidado, es por la coherencia explícita.
 *
 * ⚠️ HYPHEN TRAP: derivar el empleado por att.employeeId, NUNCA por split('-') de
 * la clave (los ids pueden tener guiones).
 */

import { state, stateManager } from '../modules/core/AppState.js';
import { toggleHoliday } from '../modules/ui/AttendanceHandlers.js';

const DATE = '2026-06-19';

function setup(empIds) {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.settings.holidays = [];
    raw.selectedDate = DATE;
    empIds.forEach(empId => {
        raw.attendance[`${empId}-${DATE}`] = {
            employeeId: empId, date: DATE, present: true, hoursWorked: 8, isHoliday: false,
        };
        raw.statsCache.mtd[empId] = { cached: true }; // stat previa que debe invalidarse
    });
}

testRunner.addSuite("AttendanceHandlers.toggleHoliday — Coherencia de stats (Fase 4 Paso 3)", {

    "marca el día como feriado en los registros existentes"() {
        setup(['emp1']);
        toggleHoliday(DATE);
        const raw = stateManager.getState();
        testRunner.assertEquals(raw.attendance[`emp1-${DATE}`].isHoliday, true, "isHoliday debe quedar en true");
    },

    "en batchSetState invalida statsCache de los empleados tocados vía coherencia explícita"() {
        setup(['emp1', 'emp2']);
        stateManager.batchSetState(() => { toggleHoliday(DATE); });
        const raw = stateManager.getState();
        testRunner.assert(!raw.statsCache.mtd['emp1'], "stats de emp1 deben invalidarse sin el proxy");
        testRunner.assert(!raw.statsCache.mtd['emp2'], "stats de emp2 deben invalidarse sin el proxy");
    },

    "deriva el empleado por att.employeeId (id con guion, no split de la clave)"() {
        setup(['dept-01-ana']);
        stateManager.batchSetState(() => { toggleHoliday(DATE); });
        const raw = stateManager.getState();
        testRunner.assert(
            !raw.statsCache.mtd['dept-01-ana'],
            "el empleado con guion debe invalidarse por employeeId, no por un split erróneo"
        );
    }
});

console.log('AttendanceHandlersCoherence tests cargados.');
