/**
 * 🛡️ AttendanceCoherenceTests — Red de seguridad de CONTRATO para la Fase 4.
 *
 * A diferencia de AppStateProxyContractTests (que fotografía el PROXY), esta suite
 * verifica el CONTRATO de coherencia a través del API sancionado (AttendanceService),
 * sin depender de QUIÉN lo dispara. Por eso pasa HOY (el proxy mantiene la coherencia)
 * y DEBE seguir pasando tras Fase 4 (cuando AttendanceService la mantenga explícito).
 *
 * Contrato fijado: tras crear/editar/borrar/touch un registro vía AttendanceService,
 *   (a) getEmployeeMTDStats devuelve totales correctos (cache nunca stale), y
 *   (b) state.attendanceByDate equivale a una reconstrucción total desde cero.
 *
 * Los defectos conocidos (employeeId con guion en update, y escrituras en batch que
 * dejan stats stale) NO se prueban acá (romperían el verde): viven en
 * AttendanceCoherenceKnownGaps.test.js como tripwires `test.failing`.
 */

import {
    state,
    stateManager,
    getEmployeeMTDStats,
} from '../modules/core/AppState.js';
import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';

const svc = new AttendanceService(state);

const D15 = new Date(2026, 5, 15);   // 2026-06-15 (mes index 5 = junio)
const D16 = new Date(2026, 5, 16);
const D03 = new Date(2026, 5, 3);
const JUL05 = new Date(2026, 6, 5);

function reset(employees) {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.employees = employees || [
        { id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' },
        { id: 'emp2', name: 'B', positions: ['p1'], hireDate: '2020-01-01' },
    ];
    raw.settings.regularHoursPerDay = 8;
    raw.settings.holidays = raw.settings.holidays || [];
}

/** True si attendanceByDate coincide con una reconstrucción total desde state.attendance. */
function indexMatchesFullRebuild() {
    const raw = stateManager.getState();
    const expected = {};
    for (const r of Object.values(raw.attendance)) {
        if (!r || !r.date) continue;
        (expected[r.date] = expected[r.date] || []).push(r);
    }
    const liveKeys = Object.keys(raw.attendanceByDate)
        .filter(k => (raw.attendanceByDate[k] || []).length > 0).sort();
    const expKeys = Object.keys(expected).sort();
    if (liveKeys.join('|') !== expKeys.join('|')) return false;
    for (const k of expKeys) {
        if ((raw.attendanceByDate[k] || []).length !== expected[k].length) return false;
    }
    return true;
}

testRunner.addSuite("Attendance — Contrato de coherencia (red Fase 4)", {

    "crear un registro se refleja en MTD (cache no queda stale)"() {
        reset();
        stateManager.getState().statsCache.mtd['emp1'] = { days: 0, hours: 0, overtime: 0, monthKey: '2026-06' };
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.days, 1, "days debe ser 1 tras crear");
        testRunner.assertEquals(s.hours, 8, "hours debe ser 8 tras crear");
    },

    "editar hoursWorked/overtime se refleja en MTD"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8, overtimeHours: 0 });
        getEmployeeMTDStats('emp1', D16);                       // poblar cache (8h)
        svc.updateRecord('emp1', D15, { hoursWorked: 10, overtimeHours: 2 });
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.hours, 10, "hours debe reflejar 10");
        testRunner.assertEquals(s.overtime, 2, "overtime debe reflejar 2");
    },

    "borrar un registro baja su día del MTD"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);
        svc.deleteRecord('emp1', D15);
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.days, 0, "days debe volver a 0 tras borrar");
        testRunner.assertEquals(s.hours, 0, "hours debe volver a 0 tras borrar");
    },

    "togglear present:false saca el día del MTD"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);
        svc.updateRecord('emp1', D15, { present: false });
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.days, 0, "un día ausente no cuenta");
        testRunner.assertEquals(s.hours, 0, "sin horas si está ausente");
    },

    "editar un campo irrelevante a stats (notes) no altera los totales"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);
        svc.updateRecord('emp1', D15, { notes: 'observación' });
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.hours, 8, "hours no debe cambiar");
        testRunner.assertEquals(s.days, 1, "days no debe cambiar");
    },

    "backfill de un día pasado del mismo mes entra en el MTD"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);                       // cache: 1 día, 8h
        svc.createRecord('emp1', D03, { hoursWorked: 8 });      // día anterior, mismo mes
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.days, 2, "debe contar el día backfilleado");
        testRunner.assertEquals(s.hours, 16, "debe sumar las horas del backfill");
    },

    "aislamiento entre empleados: tocar emp1 no invalida el MTD de emp2"() {
        reset();
        stateManager.getState().statsCache.mtd['emp2'] = { days: 3, hours: 24, overtime: 0, monthKey: '2026-06' };
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        const s2 = getEmployeeMTDStats('emp2', D16);
        testRunner.assertEquals(s2.days, 3, "el cache de emp2 debe sobrevivir");
        testRunner.assertEquals(s2.hours, 24, "los totales de emp2 no deben cambiar");
    },

    "cruce de mes: una query de julio recomputa, no sirve el cache de junio"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        getEmployeeMTDStats('emp1', D16);                       // cache junio
        const s = getEmployeeMTDStats('emp1', JUL05);
        testRunner.assertEquals(s.monthKey, '2026-07', "monthKey debe ser julio");
        testRunner.assertEquals(s.days, 0, "julio no tiene registros");
    },

    "el índice del día equivale a una reconstrucción tras crear"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        testRunner.assert(indexMatchesFullRebuild(), "attendanceByDate debe igualar la reconstrucción total");
        testRunner.assertEquals((stateManager.getState().attendanceByDate['2026-06-15'] || []).length, 1, "el bucket del día debe tener 1");
    },

    "borrar saca el registro del bucket del día"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        svc.deleteRecord('emp1', D15);
        testRunner.assertEquals((stateManager.getState().attendanceByDate['2026-06-15'] || []).length, 0, "bucket vacío tras borrar");
        testRunner.assert(indexMatchesFullRebuild(), "el índice debe seguir coherente tras borrar");
    },

    "secuencia mixta deja el índice completo == reconstrucción total"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8 });
        svc.createRecord('emp2', D15, { hoursWorked: 8 });     // mismo día, otro empleado
        svc.createRecord('emp1', D16, { hoursWorked: 8 });     // otro día
        svc.deleteRecord('emp2', D15);
        testRunner.assert(indexMatchesFullRebuild(), "todo el índice debe igualar la reconstrucción desde cero");
    },

    "registro multiposición mantiene coherencia de índice y stats"() {
        reset();
        svc.createRecord('emp1', D15, { hoursWorked: 8, multiPosition: true, positionHours: [{ positionId: 'p1', hours: 8 }] });
        testRunner.assert(indexMatchesFullRebuild(), "índice coherente con registro multiposición");
        const s = getEmployeeMTDStats('emp1', D16);
        testRunner.assertEquals(s.days, 1, "el día multiposición cuenta 1");
    }
});

console.log('🛡️ AttendanceCoherence tests cargados.');
