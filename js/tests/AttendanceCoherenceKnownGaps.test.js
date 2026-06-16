/**
 * 🚨 AttendanceCoherenceKnownGaps — Defectos de coherencia detectados por el audit
 * de Fase 4, capturados como tripwires `test.failing`.
 *
 * `test.failing` pasa (verde) MIENTRAS el test falla → documenta el bug actual sin
 * romper la suite. Cuando Fase 4 arregle el defecto, el test empezará a PASAR y
 * `test.failing` lo marcará en ROJO, avisando "convertime en un test normal".
 *
 * Ambos defectos deben quedar arreglados como criterio de aceptación de Fase 4.
 */

import { state, stateManager, getEmployeeMTDStats } from '../modules/core/AppState.js';
import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';

const svc = new AttendanceService(state);
const D15 = new Date(2026, 5, 15);
const D16 = new Date(2026, 5, 16);

function reset(employees) {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.employees = employees;
    raw.settings.regularHoursPerDay = 8;
    raw.settings.holidays = raw.settings.holidays || [];
}

describe('Attendance coherence — BRECHAS CONOCIDAS (Fase 4 debe arreglar)', () => {

    // BUG: el set-trap deriva employeeId con key.split('-')[0], que trunca 'emp-7' a
    // 'emp' en updates → invalida la cache equivocada y deja el MTD de 'emp-7' stale.
    test.failing('employeeId con guion: un update invalida la cache correcta', () => {
        reset([{ id: 'emp-7', name: 'X', positions: ['p1'], hireDate: '2020-01-01' }]);
        svc.createRecord('emp-7', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp-7', D16);                     // cache: 8h
        svc.updateRecord('emp-7', D15, { hoursWorked: 10 });
        const s = getEmployeeMTDStats('emp-7', D16);
        expect(s.hours).toBe(10);                              // hoy devuelve 8 (stale) → falla → tripwire verde
    });

    // BUG: una escritura de asistencia dentro de batchSetState corre en modo silencioso,
    // el trap se saltea entero y la cache/índice quedan stale (el "hueco" central).
    test.failing('escritura de asistencia en batchSetState mantiene coherencia de stats', () => {
        reset([{ id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' }]);
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);                      // cache: 8h
        stateManager.batchSetState(() => {
            svc.updateRecord('emp1', D15, { hoursWorked: 10 });
        });
        const s = getEmployeeMTDStats('emp1', D16);
        expect(s.hours).toBe(10);                              // hoy devuelve 8 (silencioso) → falla → tripwire verde
    });
});
