/**
 * ✅ AttendanceCoherenceKnownGaps — Dos defectos de coherencia que el audit de Fase 4
 * detectó y que el Paso 2 ARREGLÓ al mover la coherencia a AttendanceService
 * (explícita, con el employeeId real, sin depender del modo silencioso del proxy).
 *
 * Nacieron como tripwires `test.failing` (verdes mientras el bug existía); al
 * arreglarse en Paso 2 dieron vuelta, así que ahora son tests normales que
 * GUARDAN contra la regresión. (Cubren la vía AttendanceService; la vía de
 * escritura directa al proxy se elimina recién en Paso 4.)
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

describe('Attendance coherence — regresiones arregladas en Fase 4 Paso 2', () => {

    // Antes: el set-trap derivaba employeeId con key.split('-')[0] y truncaba 'emp-7' a
    // 'emp'. Ahora AttendanceService invalida con el employeeId real recibido.
    test('employeeId con guion: un update invalida la cache correcta (vía service)', () => {
        reset([{ id: 'emp-7', name: 'X', positions: ['p1'], hireDate: '2020-01-01' }]);
        svc.createRecord('emp-7', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp-7', D16);                     // cache: 8h
        svc.updateRecord('emp-7', D15, { hoursWorked: 10 });
        const s = getEmployeeMTDStats('emp-7', D16);
        expect(s.hours).toBe(10);
    });

    // Antes: una escritura dentro de batchSetState corría silenciosa y el trap se
    // salteaba, dejando la cache stale. Ahora la coherencia es explícita en el service.
    test('escritura de asistencia en batchSetState mantiene coherencia de stats', () => {
        reset([{ id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' }]);
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);                      // cache: 8h
        stateManager.batchSetState(() => {
            svc.updateRecord('emp1', D15, { hoursWorked: 10 });
        });
        const s = getEmployeeMTDStats('emp1', D16);
        expect(s.hours).toBe(10);
    });
});
