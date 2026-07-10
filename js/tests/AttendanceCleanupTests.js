/**
 * 🧪 AttendanceCleanupTests
 *
 * Borrado ROBUSTO del historial de asistencia (tombstones, no delete de
 * claves — así el borrado sobrevive al multi-dispositivo, igual que Fase 1).
 * Dos usos:
 *   - al eliminar un empleado, borrar SU historial (opcional, vía modal).
 *   - en Ajustes/Datos, limpiar la asistencia HUÉRFANA (de empleados que ya
 *     no existen).
 *
 * Funciones puras: no tocan state ni la nube. El orquestador (con state) las
 * usa y sube las fechas tocadas.
 */

import {
    collectEmployeeAttendanceKeys,
    collectOrphanAttendanceKeys,
    countLiveAttendance,
    tombstoneAttendanceKeys
} from '../modules/services/AttendanceCleanup.js';

function att(employeeId, date, extra = {}) {
    return { employeeId, date, present: true, ...extra };
}

testRunner.addSuite("AttendanceCleanup — collectEmployeeAttendanceKeys", {

    "junta las claves de asistencia VIVA de un empleado"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),
            'e1-2026-07-02': att('e1', '2026-07-02'),
            'e2-2026-07-01': att('e2', '2026-07-01')
        };
        const keys = collectEmployeeAttendanceKeys(attendance, 'e1');
        testRunner.assertEquals(keys.sort().join(','), 'e1-2026-07-01,e1-2026-07-02');
    },

    "excluye los registros ya tombstoneados (no re-borrar)"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),
            'e1-2026-07-02': att('e1', '2026-07-02', { deletedAt: 123, present: false })
        };
        const keys = collectEmployeeAttendanceKeys(attendance, 'e1');
        testRunner.assertEquals(keys.join(','), 'e1-2026-07-01', 'el ya borrado no cuenta');
    },

    "empleado sin asistencia → []"() {
        testRunner.assertEquals(collectEmployeeAttendanceKeys({ 'e2-2026-07-01': att('e2', '2026-07-01') }, 'e1').length, 0);
    },

    "defensivo: attendance null / empId vacío → []"() {
        testRunner.assertEquals(collectEmployeeAttendanceKeys(null, 'e1').length, 0);
        testRunner.assertEquals(collectEmployeeAttendanceKeys({ 'e1-x': att('e1', 'x') }, '').length, 0);
    }

});

testRunner.addSuite("AttendanceCleanup — countLiveAttendance", {

    "cuenta solo los registros vivos del empleado"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),
            'e1-2026-07-02': att('e1', '2026-07-02', { deletedAt: 1, present: false }),
            'e1-2026-07-03': att('e1', '2026-07-03')
        };
        testRunner.assertEquals(countLiveAttendance(attendance, 'e1'), 2);
    }

});

testRunner.addSuite("AttendanceCleanup — collectOrphanAttendanceKeys", {

    "junta las claves cuyo empleado ya no existe (vivo)"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),   // e1 vivo
            'e9-2026-07-01': att('e9', '2026-07-01'),   // e9 borrado (huérfano)
            'e9-2026-07-02': att('e9', '2026-07-02')
        };
        const live = new Set(['e1']);
        const keys = collectOrphanAttendanceKeys(attendance, live);
        testRunner.assertEquals(keys.sort().join(','), 'e9-2026-07-01,e9-2026-07-02');
    },

    "no toca la asistencia de empleados vivos"() {
        const attendance = { 'e1-2026-07-01': att('e1', '2026-07-01') };
        testRunner.assertEquals(collectOrphanAttendanceKeys(attendance, new Set(['e1'])).length, 0);
    },

    "excluye huérfanos ya tombstoneados (idempotente)"() {
        const attendance = {
            'e9-2026-07-01': att('e9', '2026-07-01', { deletedAt: 1, present: false })
        };
        testRunner.assertEquals(collectOrphanAttendanceKeys(attendance, new Set()).length, 0,
            'un huérfano ya borrado no se re-borra');
    },

    "un registro sin employeeId usa el prefijo de la clave como fallback"() {
        // Las claves son `${empId}-${fecha}`; si falta employeeId, el id se
        // infiere del prefijo antes del primer guion de fecha.
        const attendance = { 'e9-2026-07-01': { date: '2026-07-01', present: true } };
        const keys = collectOrphanAttendanceKeys(attendance, new Set(['e1']));
        testRunner.assertEquals(keys.join(','), 'e9-2026-07-01');
    },

    "defensivo: attendance null / live no-Set → []"() {
        testRunner.assertEquals(collectOrphanAttendanceKeys(null, new Set()).length, 0);
        testRunner.assert(Array.isArray(collectOrphanAttendanceKeys({}, null)));
    }

});

testRunner.addSuite("AttendanceCleanup — tombstoneAttendanceKeys", {

    "tombstonea cada clave (present:false + deletedAt + updatedAt) y junta las fechas tocadas"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),
            'e1-2026-07-02': att('e1', '2026-07-02')
        };
        const { dateKeys } = tombstoneAttendanceKeys(attendance, ['e1-2026-07-01', 'e1-2026-07-02'], 9000);
        testRunner.assertEquals(attendance['e1-2026-07-01'].present, false);
        testRunner.assertEquals(attendance['e1-2026-07-01'].deletedAt, 9000);
        testRunner.assertEquals(attendance['e1-2026-07-01'].updatedAt, 9000, 'frescura para ganar el merge LWW');
        testRunner.assertEquals(dateKeys.sort().join(','), '2026-07-01,2026-07-02',
            'las fechas tocadas deben subirse');
    },

    "una clave inexistente se ignora (no rompe)"() {
        const attendance = { 'e1-2026-07-01': att('e1', '2026-07-01') };
        const { dateKeys } = tombstoneAttendanceKeys(attendance, ['e1-2026-07-01', 'no-existe'], 1);
        testRunner.assertEquals(dateKeys.join(','), '2026-07-01');
    },

    "fechas duplicadas se cuentan una sola vez"() {
        const attendance = {
            'e1-2026-07-01': att('e1', '2026-07-01'),
            'e2-2026-07-01': att('e2', '2026-07-01')
        };
        const { dateKeys } = tombstoneAttendanceKeys(attendance, ['e1-2026-07-01', 'e2-2026-07-01'], 1);
        testRunner.assertEquals(dateKeys.length, 1, 'misma fecha de dos empleados → una sola subida');
    },

    "keys vacío / null → sin fechas, sin romper"() {
        testRunner.assertEquals(tombstoneAttendanceKeys({}, [], 1).dateKeys.length, 0);
        testRunner.assertEquals(tombstoneAttendanceKeys({}, null, 1).dateKeys.length, 0);
    }

});

console.log('🧪 AttendanceCleanup tests cargados.');
