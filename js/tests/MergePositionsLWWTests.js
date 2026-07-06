/**
 * 🧪 MergePositionsLWWTests (fix del bucle de sanitización, capa 3)
 *
 * La UNIÓN incondicional de positions/positionSalaries en mergeEmployees
 * resucitaba las REMOCIONES: un huérfano corregido localmente (o un puesto
 * desasignado a propósito) volvía desde la copia remota vieja en CADA
 * merge — tanto al recibir (LiveSync) como al subir (saveOne mergeRemote
 * re-fusiona con el doc remoto ANTES de escribir). Con eso, ni siquiera
 * estampar updatedAt en la corrección hacía converger el bucle: la subida
 * re-incluía el huérfano en el payload.
 *
 * Regla nueva: si un lado es ESTRICTAMENTE más nuevo por updatedAt, su
 * lista de positions y su mapa de positionSalaries ganan COMPLETOS (LWW).
 * La unión queda SOLO para el empate o cuando falta updatedAt (sin
 * información, no perder nada es lo seguro). Post-Fase-1 esto es
 * correcto: toda mutación legítima estampa updatedAt (choke points), así
 * que "más nuevo" = "esta lista es la verdad actual".
 */

import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

testRunner.addSuite("MergePositionsLWW — positions", {

    "local estrictamente más nuevo: una posición REMOVIDA localmente NO resucita desde el server"() {
        const server = { id: 'e1', updatedAt: 100, positions: ['viva', 'huerfana'] };
        const local  = { id: 'e1', updatedAt: 200, positions: ['viva'] }; // corregido/desasignado
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positions.join(','), 'viva',
            'el lado más nuevo ganó — la remoción debe sobrevivir el merge (sin esto, el bucle de sanitización nunca converge)');
    },

    "server estrictamente más nuevo: su lista gana completa"() {
        const server = { id: 'e1', updatedAt: 300, positions: ['a', 'b'] };
        const local  = { id: 'e1', updatedAt: 100, positions: ['a', 'c'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positions.join(','), 'a,b');
    },

    "EMPATE de updatedAt: se conserva la unión (sin información, no perder nada)"() {
        const server = { id: 'e1', updatedAt: 100, positions: ['a', 'b'] };
        const local  = { id: 'e1', updatedAt: 100, positions: ['a', 'c'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals([...out.positions].sort().join(','), 'a,b,c');
    },

    "sin updatedAt en alguno de los dos: unión (comportamiento legacy preservado)"() {
        const server = { id: 'e1', positions: ['a', 'b'] };
        const local  = { id: 'e1', updatedAt: 200, positions: ['a', 'c'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals([...out.positions].sort().join(','), 'a,b,c',
            'un lado sin timestamp no da información de frescura — la unión sigue siendo lo seguro');
    },

    "el ganador estricto con lista VACÍA también gana (desasignó todos los puestos)"() {
        const server = { id: 'e1', updatedAt: 100, positions: ['a', 'b'] };
        const local  = { id: 'e1', updatedAt: 200, positions: [] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positions.length, 0);
    }

});

testRunner.addSuite("MergePositionsLWW — positionSalaries", {

    "local estrictamente más nuevo: una clave BORRADA localmente no resucita"() {
        const server = { id: 'e1', updatedAt: 100, positionSalaries: { viva: 100, huerfana: 50 } };
        const local  = { id: 'e1', updatedAt: 200, positionSalaries: { viva: 100 } };
        const out = mergeEmployees(server, local);
        testRunner.assert(!('huerfana' in out.positionSalaries),
            'la clave borrada por el lado más nuevo debe quedar borrada');
        testRunner.assertEquals(out.positionSalaries.viva, 100);
    },

    "server estrictamente más nuevo: su mapa gana completo"() {
        const server = { id: 'e1', updatedAt: 300, positionSalaries: { a: 1 } };
        const local  = { id: 'e1', updatedAt: 100, positionSalaries: { a: 2, b: 3 } };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positionSalaries.a, 1);
        testRunner.assert(!('b' in out.positionSalaries));
    },

    "EMPATE: unión con preferencia del ganador escalar (comportamiento legacy)"() {
        const server = { id: 'e1', updatedAt: 100, positionSalaries: { a: 1 } };
        const local  = { id: 'e1', updatedAt: 100, positionSalaries: { a: 2, b: 3 } };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positionSalaries.b, 3, 'la clave solo-local sobrevive en empate');
    }

});

testRunner.addSuite("MergePositionsLWW — convergencia del bucle (integración)", {

    "escenario del bucle real: remoto sucio VIEJO + local corregido NUEVO → el merge queda limpio en ambas direcciones"() {
        const remoteDirty = { id: 'e1', updatedAt: 100, positions: ['viva', 'huerfana'], positionSalaries: { viva: 10, huerfana: 5 } };
        const localFixed  = { id: 'e1', updatedAt: 200, positions: ['viva'], positionSalaries: { viva: 10 } };

        // Dirección de subida (saveOne mergeRemote: payload = merge(remote, local))
        const uploadPayload = mergeEmployees(remoteDirty, localFixed);
        testRunner.assertEquals(uploadPayload.positions.join(','), 'viva',
            'el payload que SUBE debe ir limpio — antes la unión re-metía el huérfano y la nube nunca convergía');
        testRunner.assert(!('huerfana' in uploadPayload.positionSalaries));

        // Dirección de bajada (LiveSync: merge(incoming=server, local))
        const applied = mergeEmployees(remoteDirty, localFixed);
        testRunner.assertEquals(applied.positions.join(','), 'viva',
            'lo aplicado localmente tampoco debe re-ganar el huérfano — sin esto el validador volvía a corregir en cada ronda');
    }

});

console.log('🧪 MergePositionsLWW tests cargados.');
