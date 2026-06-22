/**
 * AdvancedAttendanceModalBatchingTests — Fase 4 Paso 5.
 *
 * saveAdvancedAttendance escribía state.attendance[key] (1 set-trap → agenda
 * window.render) Y ADEMÁS llamaba a window.render() a mano (un closure aparte que NO
 * se deduplica) → 2 renders reales en el navegador. Tras envolver el write + la
 * coherencia en batchSetState y soltar el render() manual, queda 1 render.
 *
 * ⚠️ El render-count NO se puede medir conductualmente en jsdom: este módulo no importa
 * RenderManager, así que window.render es un stub no-op y llamarlo no agenda nada (un
 * test de scheduleRender no mordería). Por eso el contrato de render se verifica por
 * CONTRATO-DE-FUENTE (batchSetState presente, sin window.render() directo), y la
 * seguridad FINANCIERA con un test conductual de coherencia (determinístico).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { state, stateManager, getEmployeeMTDStats } from '../modules/core/AppState.js';
import { saveAdvancedAttendance } from '../modules/ui/modals/AdvancedAttendanceModal.js';

const MODAL_SRC = readFileSync(join(process.cwd(), 'js/modules/ui/modals/AdvancedAttendanceModal.js'), 'utf8');

/** Extrae el cuerpo de una función exportada (desde su firma hasta el próximo `export `). */
function funcSource(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) return '';
    const after = src.indexOf('\nexport ', start + signature.length);
    return after === -1 ? src.slice(start) : src.slice(start, after);
}

function setup() {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.settings.holidays = [];
    raw.settings.regularHoursPerDay = 8;
    raw.selectedDate = new Date(2026, 5, 17);
    raw.selectedEmployee = { id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' };
}

testRunner.addSuite("AdvancedAttendanceModal — Batching de render (Fase 4 Paso 5)", {

    "CONTRATO: saveAdvancedAttendance batchea el write y NO llama window.render() a mano"() {
        const fn = funcSource(MODAL_SRC, 'export function saveAdvancedAttendance');
        testRunner.assert(fn.length > 0, "debe encontrarse la función saveAdvancedAttendance en el fuente");
        testRunner.assert(
            fn.includes('batchSetState'),
            "el write + la coherencia deben ir envueltos en stateManager.batchSetState"
        );
        testRunner.assert(
            !fn.includes('window.render()'),
            "ya NO debe llamar window.render() a mano: el render lo agenda batchSetState al cerrar (evita el doble repintado)"
        );
    },

    "COHERENCIA (financiera): tras guardar, statsCache del empleado queda invalidado y el día indexado"() {
        setup();
        const raw = stateManager.getState();
        const key = 'emp1-2026-06-17';
        // Sembramos una stat previa que DEBE invalidarse (coherencia explícita dentro del batch)
        raw.statsCache.mtd['emp1'] = { days: 9, hours: 99, overtime: 9, monthKey: '2026-06' };

        saveAdvancedAttendance();

        testRunner.assert(
            raw.attendance[key] !== undefined,
            "saveAdvancedAttendance debe escribir el registro de asistencia del día"
        );
        testRunner.assert(
            raw.statsCache.mtd['emp1'] === undefined,
            "debe invalidar statsCache.mtd['emp1'] (coherencia financiera dentro del batch)"
        );
        const bucket = raw.attendanceByDate['2026-06-17'];
        testRunner.assert(
            Array.isArray(bucket) && bucket.some(r => r.employeeId === 'emp1'),
            "debe reconstruir el índice del día con el registro escrito"
        );
        // Y la stat recomputada debe ser coherente con lo escrito (no la sembrada stale)
        const s = getEmployeeMTDStats('emp1', new Date(2026, 5, 18));
        testRunner.assert(s.hours !== 99, "getEmployeeMTDStats no debe devolver la stat stale sembrada");
    }
});

console.log('AdvancedAttendanceModalBatching tests cargados.');
