/**
 * 🧪 AttendancePositionAuditTests
 *
 * Funciones puras que sostienen el flujo "quitar una posición a un empleado
 * con días trabajados en ella":
 *   - collectPositionDays: detecta los días VIVOS y PRESENTES afectados
 *     (para el modal: cuántos, entre qué fechas, cuántas horas).
 *   - reassignPositionDays: reescribe esos días a otra posición del empleado
 *     (decisión EXPLÍCITA del usuario), estampando por el choke point para
 *     que el cambio gane el merge y suba por el canal 'daily'.
 *
 * Regla de producto: el default siempre es CONSERVAR el historial (el pasado
 * es un hecho); reasignar es opt-in consciente con el impacto a la vista.
 */

import { collectPositionDays, reassignPositionDays } from '../modules/services/AttendancePositionAudit.js';

function makeAttendance() {
    return {
        // emp1: 2 días simples como albañil, 1 multi-posición, 1 ausente, 1 tombstoneado
        'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01', present: true, selectedPosition: 'albanil', hoursWorked: 8, updatedAt: 1000 },
        'emp1-2026-07-03': { employeeId: 'emp1', date: '2026-07-03', present: true, selectedPosition: 'albanil', hoursWorked: 6, updatedAt: 1000 },
        'emp1-2026-07-05': {
            employeeId: 'emp1', date: '2026-07-05', present: true, multiPosition: true,
            positionHours: [{ positionId: 'albanil', hours: 4, overtimeHours: 1 }, { positionId: 'ayudante', hours: 3, overtimeHours: 0 }],
            updatedAt: 1000
        },
        'emp1-2026-07-06': { employeeId: 'emp1', date: '2026-07-06', present: false, selectedPosition: 'albanil', hoursWorked: 0, updatedAt: 1000 },
        'emp1-2026-07-07': { employeeId: 'emp1', date: '2026-07-07', present: true, selectedPosition: 'albanil', hoursWorked: 8, deletedAt: 2000, updatedAt: 2000 },
        // emp1 en OTRA posición (no debe contar)
        'emp1-2026-07-02': { employeeId: 'emp1', date: '2026-07-02', present: true, selectedPosition: 'ayudante', hoursWorked: 8, updatedAt: 1000 },
        // OTRO empleado en albañil (no debe contar cuando se filtra por emp1)
        'emp2-2026-07-01': { employeeId: 'emp2', date: '2026-07-01', present: true, selectedPosition: 'albanil', hoursWorked: 8, updatedAt: 1000 }
    };
}

testRunner.addSuite("AttendancePositionAudit — collectPositionDays", {

    "detecta los días vivos y presentes del empleado en la posición (simples + multi)"() {
        const res = collectPositionDays(makeAttendance(), { employeeId: 'emp1', positionId: 'albanil' });
        testRunner.assertEquals(res.count, 3, '2 simples + 1 multi-posición; el ausente y el tombstoneado NO cuentan');
        const dates = [...res.dateKeys].sort().join(',');
        testRunner.assertEquals(dates, '2026-07-01,2026-07-03,2026-07-05');
    },

    "excluye tombstoneados, ausentes, otras posiciones y otros empleados"() {
        const res = collectPositionDays(makeAttendance(), { employeeId: 'emp1', positionId: 'albanil' });
        testRunner.assert(!res.keys.includes('emp1-2026-07-07'), 'tombstoneado fuera');
        testRunner.assert(!res.keys.includes('emp1-2026-07-06'), 'ausente fuera (no es día trabajado)');
        testRunner.assert(!res.keys.includes('emp1-2026-07-02'), 'otra posición fuera');
        testRunner.assert(!res.keys.includes('emp2-2026-07-01'), 'otro empleado fuera');
    },

    "reporta rango de fechas y total de horas (incluye extra de la entrada multi)"() {
        const res = collectPositionDays(makeAttendance(), { employeeId: 'emp1', positionId: 'albanil' });
        testRunner.assertEquals(res.firstDate, '2026-07-01');
        testRunner.assertEquals(res.lastDate, '2026-07-05');
        // 8 + 6 simples + (4 + 1 extra) de la entrada albañil del día multi = 19
        testRunner.assertEquals(res.totalHours, 19);
    },

    "sin employeeId audita TODOS los empleados (guardia de eliminar del catálogo)"() {
        const res = collectPositionDays(makeAttendance(), { positionId: 'albanil' });
        testRunner.assertEquals(res.count, 4, 'los 3 de emp1 + el de emp2');
    },

    "sin días afectados devuelve count 0 y fechas nulas"() {
        const res = collectPositionDays(makeAttendance(), { employeeId: 'emp1', positionId: 'inexistente' });
        testRunner.assertEquals(res.count, 0);
        testRunner.assertEquals(res.firstDate, null);
        testRunner.assertEquals(res.totalHours, 0);
    },

    "defensivo: attendance null/undefined no rompe"() {
        testRunner.assertEquals(collectPositionDays(null, { positionId: 'x' }).count, 0);
        testRunner.assertEquals(collectPositionDays(undefined, { positionId: 'x' }).count, 0);
    }

});

testRunner.addSuite("AttendancePositionAudit — reassignPositionDays", {

    "reasigna los días simples (selectedPosition) y estampa updatedAt (choke point)"() {
        const att = makeAttendance();
        const before = Date.now() - 1;
        const res = reassignPositionDays(att, { employeeId: 'emp1', fromId: 'albanil', toId: 'ayudante' });
        testRunner.assertEquals(att['emp1-2026-07-01'].selectedPosition, 'ayudante');
        testRunner.assertEquals(att['emp1-2026-07-03'].selectedPosition, 'ayudante');
        testRunner.assert(att['emp1-2026-07-01'].updatedAt > before,
            'sin la estampa el cambio no sube ni gana el merge multi-dispositivo');
        testRunner.assert(res.changedKeys.includes('emp1-2026-07-01'));
    },

    "en el día multi-posición renombra la entrada y FUSIONA horas si el destino ya existe"() {
        const att = makeAttendance();
        reassignPositionDays(att, { employeeId: 'emp1', fromId: 'albanil', toId: 'ayudante' });
        const ph = att['emp1-2026-07-05'].positionHours;
        testRunner.assertEquals(ph.length, 1, 'albañil(4h+1e) se fusiona con ayudante(3h) → una sola entrada');
        testRunner.assertEquals(ph[0].positionId, 'ayudante');
        testRunner.assertEquals(ph[0].hours, 7, '4 + 3');
        testRunner.assertEquals(ph[0].overtimeHours, 1, '1 + 0');
    },

    "NO toca tombstoneados, ausentes, otras posiciones ni otros empleados"() {
        const att = makeAttendance();
        reassignPositionDays(att, { employeeId: 'emp1', fromId: 'albanil', toId: 'ayudante' });
        testRunner.assertEquals(att['emp1-2026-07-07'].selectedPosition, 'albanil', 'tombstoneado intacto');
        testRunner.assertEquals(att['emp1-2026-07-06'].selectedPosition, 'albanil', 'ausente intacto');
        testRunner.assertEquals(att['emp2-2026-07-01'].selectedPosition, 'albanil', 'otro empleado intacto');
        testRunner.assertEquals(att['emp1-2026-07-02'].updatedAt, 1000, 'día de otra posición sin re-estampar');
    },

    "devuelve las dateKeys únicas tocadas (para subir por el canal daily)"() {
        const att = makeAttendance();
        const res = reassignPositionDays(att, { employeeId: 'emp1', fromId: 'albanil', toId: 'ayudante' });
        testRunner.assertEquals([...res.dateKeys].sort().join(','), '2026-07-01,2026-07-03,2026-07-05');
    },

    "now inyectable para tests deterministas"() {
        const att = makeAttendance();
        reassignPositionDays(att, { employeeId: 'emp1', fromId: 'albanil', toId: 'ayudante', now: 55555 });
        testRunner.assertEquals(att['emp1-2026-07-01'].updatedAt, 55555);
    }

});

console.log('🧪 AttendancePositionAudit tests cargados.');
