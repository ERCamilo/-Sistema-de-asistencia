/**
 * 🧪 AttendanceMergeTests (Fase 1, U3 — merge LWW por-registro)
 *
 * mergeAttendanceRecords(local, incoming) es la función pura que reemplaza
 * el spread ciego `{...local, ...incoming}` en los 3 sitios de merge
 * entrante. Reglas (roadmap Fase 1):
 *   - Por cada clave, gana el de mayor updatedAt.
 *   - Empate → gana local (mismo criterio que EmployeeMerge.js: más
 *     conservador para el dispositivo que tiene la sesión activa).
 *   - La AUSENCIA nunca borra: una clave que solo existe de un lado
 *     sobrevive intacta en el resultado.
 *   - Un tombstone (present:false + deletedAt) es un registro más: gana o
 *     pierde por updatedAt como cualquier otro, sin caso especial.
 */

import { mergeAttendanceRecords } from '../modules/features/attendance/AttendanceMerge.js';

testRunner.addSuite("mergeAttendanceRecords — Fase 1 U3", {

    "clave solo en incoming (no colisiona) → se agrega"() {
        const local = {};
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', date: '2026-06-01', present: true, updatedAt: 100 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].present, true);
    },

    "clave solo en local (ausente en incoming) → NUNCA se borra"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', date: '2026-06-01', present: true, updatedAt: 100 } };
        const incoming = {};
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assert(!!result['e1-2026-06-01'], 'una clave ausente del lado entrante no debe desaparecer del resultado');
        testRunner.assertEquals(result['e1-2026-06-01'].present, true);
    },

    "incoming con updatedAt MAYOR → incoming gana"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 8, updatedAt: 100 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 5, updatedAt: 300 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].hoursWorked, 5, 'debe ganar el registro con updatedAt mayor (incoming)');
    },

    "local con updatedAt MAYOR → local gana (no lo pisa un incoming viejo)"() {
        // Este es EL bug original: un dispositivo desconectado que sube tarde
        // con datos viejos pisaba registros locales más nuevos.
        const local = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 8, updatedAt: 500 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 5, updatedAt: 100 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].hoursWorked, 8, 'el local más fresco no debe perder contra un incoming viejo');
    },

    "empate de updatedAt → gana local"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 8, updatedAt: 100 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 5, updatedAt: 100 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].hoursWorked, 8, 'en empate gana local (mismo criterio que EmployeeMerge.js)');
    },

    "tombstone incoming más nuevo pisa un registro vivo local más viejo (el borrado se propaga)"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 8, updatedAt: 100, deletedAt: null } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', present: false, deletedAt: 500, updatedAt: 500 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].present, false, 'el tombstone más nuevo debe ganar');
        testRunner.assertEquals(result['e1-2026-06-01'].deletedAt, 500);
    },

    "registro vivo incoming más nuevo revive un tombstone local más viejo"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', present: false, deletedAt: 100, updatedAt: 100 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 8, deletedAt: null, updatedAt: 700 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].present, true, 'la revivida más nueva debe ganar');
        testRunner.assertEquals(result['e1-2026-06-01'].deletedAt, null);
    },

    "registro legacy sin updatedAt (default 0) pierde contra cualquier incoming con updatedAt real"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 8, updatedAt: 0 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', present: true, hoursWorked: 3, updatedAt: 50 } };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].hoursWorked, 3, 'un legacy sin frescura real debe ceder ante cualquier updatedAt>0');
    },

    "múltiples claves se resuelven independientemente"() {
        const local = {
            'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 8, updatedAt: 500 }, // local gana
            'e1-2026-06-02': { employeeId: 'e1', hoursWorked: 8, updatedAt: 100 }, // incoming gana
        };
        const incoming = {
            'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 1, updatedAt: 100 },
            'e1-2026-06-02': { employeeId: 'e1', hoursWorked: 9, updatedAt: 900 },
            'e2-2026-06-01': { employeeId: 'e2', hoursWorked: 4, updatedAt: 100 }, // clave nueva
        };
        const result = mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(result['e1-2026-06-01'].hoursWorked, 8, 'gana local en la 1ra clave');
        testRunner.assertEquals(result['e1-2026-06-02'].hoursWorked, 9, 'gana incoming en la 2da clave');
        testRunner.assertEquals(result['e2-2026-06-01'].hoursWorked, 4, 'clave nueva se agrega');
    },

    "es puro: no muta ninguno de los dos inputs"() {
        const local = { 'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 8, updatedAt: 100 } };
        const incoming = { 'e1-2026-06-01': { employeeId: 'e1', hoursWorked: 5, updatedAt: 300 } };
        const localBefore = JSON.stringify(local);
        const incomingBefore = JSON.stringify(incoming);
        mergeAttendanceRecords(local, incoming);
        testRunner.assertEquals(JSON.stringify(local), localBefore, 'local no debe mutarse');
        testRunner.assertEquals(JSON.stringify(incoming), incomingBefore, 'incoming no debe mutarse');
    },

    "local/incoming nulos o vacíos no rompen (defaults a {})"() {
        testRunner.assert(typeof mergeAttendanceRecords(null, null) === 'object');
        testRunner.assert(typeof mergeAttendanceRecords(undefined, { a: { updatedAt: 1 } }) === 'object');
        testRunner.assertEquals(Object.keys(mergeAttendanceRecords(null, null)).length, 0);
    }

});

console.log('🧪 AttendanceMerge tests cargados.');
