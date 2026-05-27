/**
 * 🧪 SnapshotDiffTests (Snapshot B - lógica de comparación)
 *
 * Verifica la función pura computeSnapshotDiff(snapshotState, currentState).
 * Esta función describe qué cambia si el usuario restaurara el snapshot:
 *   - Conteos: empleados, posiciones, préstamos, registros de asistencia.
 *   - Deltas: cuántos se ganan/pierden por categoría.
 *   - Riesgo: si el estado actual tiene MÁS datos que el snapshot, advertir
 *     porque restaurar los borraría.
 *   - IDs perdidos: lista de IDs de empleados/préstamos que existen en
 *     current pero no en snapshot (los que se perderían).
 */

import { computeSnapshotDiff } from '../modules/services/SnapshotDiff.js';

function emp(id, name, loans = []) {
    return { id, name, number: id, loans };
}
function loan(id, amount = 1000) {
    return { id, amount, status: 'active' };
}
function pos(id, name) {
    return { id, name };
}

testRunner.addSuite("SnapshotDiff — computeSnapshotDiff (Snapshot B)", {

    "estados idénticos → todos los deltas son 0 y noChange=true"() {
        const state = {
            employees: [emp('e1', 'Ana', [loan('l1')]), emp('e2', 'Bob')],
            positions: [pos('p1', 'Caja')],
            attendance: { 'e1-2026-05-01': {}, 'e1-2026-05-02': {} }
        };
        const diff = computeSnapshotDiff(state, state);
        testRunner.assertEquals(diff.employees.delta, 0);
        testRunner.assertEquals(diff.positions.delta, 0);
        testRunner.assertEquals(diff.loans.delta, 0);
        testRunner.assertEquals(diff.attendance.delta, 0);
        testRunner.assertEquals(diff.noChange, true);
        testRunner.assertEquals(diff.willLoseData, false);
    },

    "snapshot tiene MENOS empleados que current → willLoseData=true"() {
        const snapshot = { employees: [emp('e1', 'Ana')], positions: [], attendance: {} };
        const current  = { employees: [emp('e1', 'Ana'), emp('e2', 'Bob')], positions: [], attendance: {} };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.employees.delta, -1, "Restaurar perdería 1 empleado");
        testRunner.assertEquals(diff.willLoseData, true);
        testRunner.assertEquals(diff.lostEmployees.length, 1);
        testRunner.assertEquals(diff.lostEmployees[0].id, 'e2');
        testRunner.assertEquals(diff.lostEmployees[0].name, 'Bob');
    },

    "snapshot tiene MÁS empleados que current → delta positivo, sin pérdida"() {
        const snapshot = { employees: [emp('e1'), emp('e2')], positions: [], attendance: {} };
        const current  = { employees: [emp('e1')], positions: [], attendance: {} };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.employees.delta, 1);
        testRunner.assertEquals(diff.willLoseData, false,
            "Si snapshot tiene MÁS empleados, restaurar NO pierde (gana)");
        testRunner.assertEquals(diff.lostEmployees.length, 0);
    },

    "préstamos: cuenta agregada cruzando todos los empleados"() {
        const snapshot = {
            employees: [emp('e1', 'Ana', [loan('l1'), loan('l2')])],
            positions: [], attendance: {}
        };
        const current = {
            employees: [emp('e1', 'Ana', [loan('l1'), loan('l2'), loan('l3')])],
            positions: [], attendance: {}
        };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.loans.snapshot, 2);
        testRunner.assertEquals(diff.loans.current, 3);
        testRunner.assertEquals(diff.loans.delta, -1, "Restaurar perdería 1 préstamo");
        testRunner.assertEquals(diff.willLoseData, true);
        testRunner.assertEquals(diff.lostLoans.length, 1);
        testRunner.assertEquals(diff.lostLoans[0].id, 'l3');
    },

    "préstamos: empleado nuevo con sus préstamos también se contabiliza"() {
        const snapshot = { employees: [emp('e1', 'Ana', [loan('l1')])], positions: [], attendance: {} };
        const current  = {
            employees: [
                emp('e1', 'Ana', [loan('l1')]),
                emp('e2', 'Bob', [loan('l99')])
            ],
            positions: [], attendance: {}
        };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.loans.delta, -1);
        testRunner.assertEquals(diff.lostLoans.find(l => l.id === 'l99')?.employeeName, 'Bob',
            "Préstamo perdido debe llevar el nombre del empleado dueño");
    },

    "posiciones: comparación por count"() {
        const snapshot = { employees: [], positions: [pos('p1', 'Caja')], attendance: {} };
        const current  = { employees: [], positions: [pos('p1', 'Caja'), pos('p2', 'Limpieza')], attendance: {} };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.positions.delta, -1);
        testRunner.assertEquals(diff.lostPositions.length, 1);
        testRunner.assertEquals(diff.lostPositions[0].name, 'Limpieza');
    },

    "asistencia: solo cuenta de claves, no diff por registro"() {
        const snapshot = { employees: [], positions: [], attendance: { 'e1-2026-01-01': {} } };
        const current  = { employees: [], positions: [], attendance: { 'e1-2026-01-01': {}, 'e1-2026-01-02': {} } };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.attendance.snapshot, 1);
        testRunner.assertEquals(diff.attendance.current, 2);
        testRunner.assertEquals(diff.attendance.delta, -1);
        testRunner.assertEquals(diff.willLoseData, true);
    },

    "tolera campos faltantes (employees ausente, loans ausentes, etc.)"() {
        const snapshot = { employees: [{ id: 'e1', name: 'Ana' }] };
        const current = { employees: [{ id: 'e1', name: 'Ana' }] };
        let diff;
        let threw = false;
        try { diff = computeSnapshotDiff(snapshot, current); } catch (e) { threw = true; }
        testRunner.assert(!threw, "No debe lanzar con campos faltantes");
        testRunner.assertEquals(diff.loans.snapshot, 0);
        testRunner.assertEquals(diff.positions.snapshot, 0);
        testRunner.assertEquals(diff.attendance.snapshot, 0);
    },

    "tolera estados null/undefined"() {
        let threw = false;
        let diff;
        try { diff = computeSnapshotDiff(null, null); } catch (e) { threw = true; }
        testRunner.assert(!threw, "No debe lanzar con null");
        testRunner.assertEquals(diff.noChange, true);
    },

    "willLoseData es false si snapshot supera a current en todas las categorías"() {
        const snapshot = {
            employees: [emp('e1'), emp('e2')],
            positions: [pos('p1', 'A'), pos('p2', 'B')],
            attendance: { k1: {}, k2: {} }
        };
        const current = {
            employees: [emp('e1')],
            positions: [pos('p1', 'A')],
            attendance: { k1: {} }
        };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.willLoseData, false,
            "Si todo el snapshot es >= current, no se pierden datos al restaurar");
    },

    "willLoseData se activa si CUALQUIER categoría tiene pérdida"() {
        // snapshot tiene más empleados pero MENOS préstamos
        const snapshot = {
            employees: [emp('e1'), emp('e2')],
            positions: [], attendance: {}
        };
        const current = {
            employees: [emp('e1', 'Ana', [loan('l1')])],
            positions: [], attendance: {}
        };
        const diff = computeSnapshotDiff(snapshot, current);
        testRunner.assertEquals(diff.employees.delta, 1, "snapshot tiene 1 empleado más");
        testRunner.assertEquals(diff.loans.delta, -1, "snapshot tiene 1 préstamo menos");
        testRunner.assertEquals(diff.willLoseData, true,
            "La pérdida en cualquier categoría debe activar willLoseData");
    }

});

console.log('🧪 SnapshotDiff tests cargados.');
