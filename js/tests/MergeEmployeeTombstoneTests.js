/**
 * 🧪 MergeEmployeeTombstoneTests
 *
 * Lápida (tombstone) de empleado: un empleado eliminado queda como un doc
 * con `deletedAt` (soft-delete), y ese tombstone viaja por el merge para que
 * el borrado sobreviva al multi-dispositivo (no revive desde una copia vieja
 * de otro dispositivo que estaba offline).
 *
 * Regla en mergeEmployees: el GANADOR escalar (por updatedAt) decide
 * deletedAt, INCLUYENDO su ausencia:
 *   - winner con deletedAt (borrado más nuevo) → out borrado, aunque el loser
 *     lo tuviera vivo.
 *   - winner SIN deletedAt (edición/reactivación más nueva) → out revive,
 *     aunque el loser tuviera un tombstone viejo.
 *
 * Sin el manejo explícito, el spread {...loser, ...winner} heredaría el
 * deletedAt del loser cuando el winner no tiene esa clave → un empleado
 * revivido a propósito quedaría borrado para siempre.
 */

import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

testRunner.addSuite("MergeEmployeeTombstone — deletedAt lo decide el ganador escalar", {

    "borrado NUEVO (winner con deletedAt) gana sobre una copia viva VIEJA"() {
        const server = { id: 'e1', name: 'Ana', updatedAt: 100 };            // viva, vieja
        const local  = { id: 'e1', name: 'Ana', updatedAt: 200, deletedAt: 200 }; // borrada, nueva
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.deletedAt, 200,
            'el borrado más nuevo debe ganar — sin esto el empleado revive desde la copia vieja del otro dispositivo');
    },

    "reactivación NUEVA (winner SIN deletedAt) revive un tombstone VIEJO"() {
        const server = { id: 'e1', name: 'Ana', updatedAt: 300 };              // reactivada, nueva
        const local  = { id: 'e1', name: 'Ana', updatedAt: 100, deletedAt: 100 }; // borrada, vieja
        const out = mergeEmployees(server, local);
        testRunner.assert(!('deletedAt' in out) || out.deletedAt == null,
            'una reactivación posterior al borrado debe quitar el tombstone (el spread no debe heredar el deletedAt del loser)');
    },

    "ambos borrados: el tombstone sobrevive"() {
        const server = { id: 'e1', updatedAt: 100, deletedAt: 100 };
        const local  = { id: 'e1', updatedAt: 200, deletedAt: 200 };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.deletedAt, 200, 'gana el deletedAt del más nuevo');
    },

    "un empleado sin tombstone en ningún lado no gana un deletedAt de la nada"() {
        const server = { id: 'e1', updatedAt: 100 };
        const local  = { id: 'e1', updatedAt: 200 };
        const out = mergeEmployees(server, local);
        testRunner.assert(!('deletedAt' in out) || out.deletedAt == null);
    },

    "el borrado gana aunque el lado vivo tenga MÁS préstamos (no se resucita por tener más datos)"() {
        const server = { id: 'e1', updatedAt: 100, loans: [{ id: 'L1', principal: 100 }] }; // vivo con datos
        const local  = { id: 'e1', updatedAt: 200, deletedAt: 200, loans: [] };             // borrado nuevo
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.deletedAt, 200,
            'el tombstone más nuevo gana aunque el otro lado tenga préstamos — la unión de loans no debe re-vivir al empleado');
    }

});

console.log('🧪 MergeEmployeeTombstone tests cargados.');
