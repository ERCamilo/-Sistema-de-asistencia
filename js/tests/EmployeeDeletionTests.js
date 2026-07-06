/**
 * 🧪 EmployeeDeletionTests
 *
 * Orquestador del borrado permanente de un empleado (deleteEmployeePermanently).
 * Junta el guard (canDeleteEmployee) con los efectos: encolar el tombstone
 * durable, sacar el empleado de la vista local, persistir. Testeable con
 * dependencias inyectadas (sin nube ni state real).
 */

import { deleteEmployeePermanently } from '../modules/services/EmployeeDeletion.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-06T12:00:00Z').getTime();

function inactiveEmp(daysInactive = 60) {
    return {
        id: 'e1', name: 'Ana', active: false,
        lastStatusChange: new Date(NOW - daysInactive * DAY).toISOString().slice(0, 10),
        loans: [], updatedAt: 1
    };
}

function spies() {
    const calls = { tombstone: [], removed: [], persisted: 0 };
    return {
        calls,
        deps: {
            now: NOW,
            enqueueTombstone: (id, deletedAt) => calls.tombstone.push({ id, deletedAt }),
            removeFromState: (id) => calls.removed.push(id),
            persist: () => { calls.persisted++; }
        }
    };
}

testRunner.addSuite("EmployeeDeletion — deleteEmployeePermanently", {

    "un empleado que pasa el guard: encola tombstone, lo saca de state y persiste"() {
        const emp = inactiveEmp(60);
        const { calls, deps } = spies();
        const r = deleteEmployeePermanently(emp, deps);
        testRunner.assertEquals(r.ok, true);
        testRunner.assertEquals(calls.tombstone.length, 1, 'debe encolar el tombstone');
        testRunner.assertEquals(calls.tombstone[0].id, 'e1');
        testRunner.assertEquals(calls.tombstone[0].deletedAt, NOW, 'el deletedAt es el momento del borrado');
        testRunner.assertEquals(calls.removed[0], 'e1', 'debe sacarlo de la vista');
        testRunner.assertEquals(calls.persisted, 1, 'debe persistir');
    },

    "un empleado que NO pasa el guard: no toca nada y devuelve la razón"() {
        const emp = inactiveEmp(5); // menos de 30 días
        const { calls, deps } = spies();
        const r = deleteEmployeePermanently(emp, deps);
        testRunner.assertEquals(r.ok, false);
        testRunner.assert(typeof r.reason === 'string' && r.reason.length > 0);
        testRunner.assertEquals(calls.tombstone.length, 0, 'no debe encolar nada');
        testRunner.assertEquals(calls.removed.length, 0, 'no debe sacar nada de state');
        testRunner.assertEquals(calls.persisted, 0, 'no debe persistir');
    },

    "un empleado activo no se borra (guard)"() {
        const emp = { ...inactiveEmp(60), active: true };
        const { calls, deps } = spies();
        const r = deleteEmployeePermanently(emp, deps);
        testRunner.assertEquals(r.ok, false);
        testRunner.assertEquals(calls.tombstone.length, 0);
    },

    "el orden importa: encola el tombstone ANTES de sacarlo de state (no perder el borrado)"() {
        const emp = inactiveEmp(60);
        const order = [];
        const deps = {
            now: NOW,
            enqueueTombstone: () => order.push('tombstone'),
            removeFromState: () => order.push('remove'),
            persist: () => order.push('persist')
        };
        deleteEmployeePermanently(emp, deps);
        testRunner.assertEquals(order.join(','), 'tombstone,remove,persist',
            'el tombstone se encola primero — si fallara el orden, un borrado podría no propagarse');
    },

    "respeta minInactiveDays inyectado"() {
        const emp = inactiveEmp(15);
        const { calls, deps } = spies();
        deps.minInactiveDays = 10;
        const r = deleteEmployeePermanently(emp, deps);
        testRunner.assertEquals(r.ok, true, 'con umbral 10, 15 días alcanza');
        testRunner.assertEquals(calls.tombstone.length, 1);
    },

    "defensivo: emp null → no ok, sin lanzar ni tocar deps"() {
        const { calls, deps } = spies();
        const r = deleteEmployeePermanently(null, deps);
        testRunner.assertEquals(r.ok, false);
        testRunner.assertEquals(calls.tombstone.length, 0);
    }

});

console.log('🧪 EmployeeDeletion tests cargados.');
