/**
 * 🧪 AttendanceRecordTimestampTests (Fase 1 — Portero por-registro, U1a)
 *
 * Raíz del bug del portero: los registros de asistencia se estampan a veces
 * con `updatedAt` en el momento de escritura (algunos sitios de app.js), pero
 * la clase Attendance lo DESCARTA en el round-trip — ni el constructor ni
 * toJSON() lo incluían. Al cargar de IndexedDB/nube vía `new Attendance(...)`
 * el timestamp se perdía, así que el merge entrante no tenía con qué comparar
 * frescura y caía en el spread ciego (un dispositivo viejo pisaba datos nuevos).
 *
 * U1a (aditivo, sin cambiar comportamiento de merge/borrado todavía): la clase
 * PRESERVA `updatedAt` y `deletedAt` (tombstone) a través del round-trip.
 * `deletedAt` es la base de U2 (tombstones): un registro borrado deja de
 * borrarse con `delete` y pasa a marcarse, para que el borrado viaje entre
 * dispositivos como dato y no se confunda con "nunca existió".
 */

import { Attendance } from '../modules/features/attendance/Attendance.js';

testRunner.addSuite("Attendance — preserva updatedAt/deletedAt en el round-trip (Fase 1, U1a)", {

    "el constructor preserva updatedAt cuando viene en los datos"() {
        const a = new Attendance({ employeeId: 'e1', date: '2026-07-01', updatedAt: 1234567890 });
        testRunner.assertEquals(a.updatedAt, 1234567890, 'debe conservar el updatedAt provisto');
    },

    "el constructor default updatedAt a 0 para registros legacy (sin timestamp)"() {
        // 0 = "el más viejo posible": en el merge LWW (U3) un registro legacy
        // sin timestamp pierde ante cualquiera con fecha real. Es el default
        // seguro — no inventamos una frescura que no tenemos.
        const a = new Attendance({ employeeId: 'e1', date: '2026-07-01' });
        testRunner.assertEquals(a.updatedAt, 0, 'sin dato, updatedAt debe ser 0 (legacy = más viejo)');
    },

    "toJSON incluye updatedAt (si no, se perdía al persistir/subir)"() {
        const a = new Attendance({ employeeId: 'e1', date: '2026-07-01', updatedAt: 999 });
        const json = a.toJSON();
        testRunner.assertEquals(json.updatedAt, 999, 'toJSON debe emitir updatedAt');
    },

    "round-trip completo: new Attendance(record.toJSON()) conserva updatedAt"() {
        const original = new Attendance({ employeeId: 'e1', date: '2026-07-01', updatedAt: 555 });
        const revived = new Attendance(original.toJSON());
        testRunner.assertEquals(revived.updatedAt, 555,
            'el timestamp debe sobrevivir el ciclo persistir→cargar (era el bug de raíz del portero)');
    },

    "el constructor preserva deletedAt (tombstone) y default null"() {
        const vivo = new Attendance({ employeeId: 'e1', date: '2026-07-01' });
        testRunner.assertEquals(vivo.deletedAt, null, 'un registro vivo no tiene deletedAt');

        const borrado = new Attendance({ employeeId: 'e1', date: '2026-07-01', deletedAt: 1700000000 });
        testRunner.assertEquals(borrado.deletedAt, 1700000000, 'debe conservar el tombstone provisto');
    },

    "toJSON incluye deletedAt y el tombstone sobrevive el round-trip"() {
        const borrado = new Attendance({ employeeId: 'e1', date: '2026-07-01', deletedAt: 1700000000, updatedAt: 1700000000 });
        const json = borrado.toJSON();
        testRunner.assertEquals(json.deletedAt, 1700000000, 'toJSON debe emitir deletedAt');

        const revived = new Attendance(json);
        testRunner.assertEquals(revived.deletedAt, 1700000000,
            'el tombstone debe sobrevivir el round-trip — si no, un borrado "revive" al recargar');
    },

    "un registro vivo emite deletedAt: null (no undefined) — Firestore distingue"() {
        // null explícito importa: en Firestore, ausencia (undefined) y null son
        // distintos, y el merge por-registro (U3) chequea `deletedAt != null`.
        const vivo = new Attendance({ employeeId: 'e1', date: '2026-07-01' });
        testRunner.assertEquals(vivo.toJSON().deletedAt, null, 'vivo debe emitir deletedAt null explícito');
    }

});

console.log('🧪 Attendance record timestamp tests cargados.');
