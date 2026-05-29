/**
 * 🧪 AttendanceVisibilityTests
 *
 * Regla nueva para la lista de asistencia:
 *   - Un empleado INACTIVO hoy aparece solo en los días que estuvo activo.
 *   - Un empleado ACTIVO hoy SIEMPRE aparece (desde su fecha de ingreso),
 *     aunque el historial diga que no estuvo activo ese día — en ese caso se
 *     muestra con un MARCADOR ("flagged") y sigue siendo totalmente funcional.
 *   - Antes de su fecha de ingreso, un empleado no aparece.
 *
 * Además, se corrige wasEmployeeActiveOnDate:
 *   - Decide por FECHA (no por timestamp) — el orden por timestamp rompía el
 *     caso de reactivación tras un merge multi-dispositivo con relojes
 *     desincronizados.
 *   - Normaliza fechas a YYYY-MM-DD (tolera ISO con hora en hireDate, etc).
 */

import { wasEmployeeActiveOnDate, isEmployeeVisibleOnDate } from '../modules/utils/DateUtils.js';

function emp(over = {}) {
    return { id: 'e1', number: '1', name: 'X', active: true, statusHistory: [], ...over };
}

testRunner.addSuite("wasEmployeeActiveOnDate — correctness", {

    "sin historial, activo → true"() {
        testRunner.assertEquals(wasEmployeeActiveOnDate(emp(), '2026-05-10'), true);
    },

    "sin historial, inactivo → false"() {
        testRunner.assertEquals(wasEmployeeActiveOnDate(emp({ active: false }), '2026-05-10'), false);
    },

    "decide por FECHA aunque el timestamp esté desordenado (merge multi-dispositivo)"() {
        // Desactivado el 01 (ts alto), reactivado el 10 (ts bajo por reloj desfasado).
        const e = emp({
            active: true,
            statusHistory: [
                { date: '2026-05-01', active: false, timestamp: 200 },
                { date: '2026-05-10', active: true, timestamp: 100 }
            ]
        });
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-15'), true,
            'El 15 debe estar activo: gana la reactivación del 10 (por fecha, no por timestamp)');
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-05'), false,
            'El 05 (entre desactivación 01 y reactivación 10) debe estar inactivo');
    },

    "hireDate en ISO con hora no rompe la comparación"() {
        const e = emp({ hireDate: '2026-05-15T00:00:00.000Z', statusHistory: [] });
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-14'), false,
            'Antes del ingreso → inactivo');
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-20'), true,
            'Después del ingreso → activo');
    },

    "asistencia explícita ese día → activo (aunque el historial diga lo contrario)"() {
        const e = emp({ active: false, statusHistory: [{ date: '2026-05-01', active: false, timestamp: 1 }] });
        const att = { 'e1-2026-05-10': { present: true } };
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-10', att), true);
    },

    "fecha anterior a cualquier cambio registrado → activo (estaba activo antes de desactivarse)"() {
        const e = emp({ active: false, statusHistory: [{ date: '2026-05-20', active: false, timestamp: 5 }], hireDate: '2026-01-01' });
        testRunner.assertEquals(wasEmployeeActiveOnDate(e, '2026-05-10'), true);
    }

});

testRunner.addSuite("isEmployeeVisibleOnDate — lista + marcador", {

    "activo hoy y activo ese día → visible, sin marcador"() {
        const r = isEmployeeVisibleOnDate(emp(), '2026-05-10');
        testRunner.assertEquals(r.visible, true);
        testRunner.assertEquals(r.flagged, false);
    },

    "activo hoy, inactivo ese día, fecha >= ingreso → visible CON marcador"() {
        const e = emp({
            active: true,
            hireDate: '2026-01-01',
            statusHistory: [{ date: '2026-05-20', active: false, timestamp: 9 }]
        });
        const r = isEmployeeVisibleOnDate(e, '2026-05-25');
        testRunner.assertEquals(r.visible, true, 'Un activo siempre se muestra desde su ingreso');
        testRunner.assertEquals(r.flagged, true, 'Marcado: el historial dice inactivo ese día');
    },

    "activo hoy, inactivo ese día, fecha < ingreso → oculto"() {
        const e = emp({ active: true, hireDate: '2026-05-15' });
        const r = isEmployeeVisibleOnDate(e, '2026-05-10');
        testRunner.assertEquals(r.visible, false, 'Antes del ingreso no aparece');
    },

    "inactivo hoy, activo ese día → visible, sin marcador"() {
        const e = emp({
            active: false,
            hireDate: '2026-01-01',
            statusHistory: [{ date: '2026-05-20', active: false, timestamp: 9 }]
        });
        const r = isEmployeeVisibleOnDate(e, '2026-05-10');
        testRunner.assertEquals(r.visible, true, 'Aparece en los días que estuvo activo');
        testRunner.assertEquals(r.flagged, false);
    },

    "inactivo hoy, inactivo ese día → oculto"() {
        const e = emp({ active: false, statusHistory: [{ date: '2026-05-01', active: false, timestamp: 1 }] });
        const r = isEmployeeVisibleOnDate(e, '2026-05-10');
        testRunner.assertEquals(r.visible, false);
    }

});

console.log('🧪 AttendanceVisibility tests cargados.');
