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

testRunner.addSuite("MergePositionsLWW — positionsUpdatedAt (frescura fina de puestos)", {

    // 🐛 Judgment Day Fase 2A: usar el updatedAt GENERAL para el LWW de puestos
    // hacía que editar un campo NO relacionado (teléfono) pisara los puestos del
    // otro dispositivo. positionsUpdatedAt es la frescura ESPECÍFICA de puestos:
    // sólo sube cuando se tocan puestos, así que una edición ajena no gana.
    "positionsUpdatedAt manda sobre updatedAt: editar un campo no relacionado no pisa los puestos del otro lado"() {
        // server agregó 'Barra' tocando puestos (positionsUpdatedAt=200).
        // local editó el teléfono (updatedAt=300) SIN tocar puestos (positionsUpdatedAt=100).
        const server = { id: 'e1', updatedAt: 200, positionsUpdatedAt: 200, positions: ['Cocina', 'Barra'], positionSalaries: { Cocina: 10, Barra: 20 } };
        const local  = { id: 'e1', updatedAt: 300, positionsUpdatedAt: 100, positions: ['Cocina'], positionSalaries: { Cocina: 10 } };
        const out = mergeEmployees(server, local);
        testRunner.assert(out.positions.includes('Barra'),
            'server tocó los puestos más recientemente → su lista gana, aunque local tenga updatedAt mayor por editar el teléfono');
        testRunner.assertEquals(out.positionSalaries.Barra, 20, 'el salario del puesto agregado también debe sobrevivir');
    },

    "la remoción de un puesto (positionsUpdatedAt nuevo) no resucita desde el lado stale"() {
        const server = { id: 'e1', updatedAt: 100, positionsUpdatedAt: 100, positions: ['Cocina', 'Caja'] };
        const local  = { id: 'e1', updatedAt: 300, positionsUpdatedAt: 200, positions: ['Cocina'] }; // removió Caja
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positions.join(','), 'Cocina',
            'local removió Caja más recientemente (positionsUpdatedAt mayor) → no debe resucitar');
    },

    "el resultado propaga el mayor positionsUpdatedAt (para futuros merges)"() {
        const server = { id: 'e1', updatedAt: 100, positionsUpdatedAt: 150, positions: ['a'] };
        const local  = { id: 'e1', updatedAt: 100, positionsUpdatedAt: 250, positions: ['a', 'b'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positionsUpdatedAt, 250,
            'debe propagarse el positionsUpdatedAt más nuevo');
    },

    "empate de positionsUpdatedAt: unión (no perder puestos agregados en paralelo)"() {
        const server = { id: 'e1', updatedAt: 500, positionsUpdatedAt: 200, positions: ['a', 'b'] };
        const local  = { id: 'e1', updatedAt: 100, positionsUpdatedAt: 200, positions: ['a', 'c'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals([...out.positions].sort().join(','), 'a,b,c',
            'sin diferencia de frescura de puestos, la unión evita perder adiciones concurrentes');
    },

    "un lado con positionsUpdatedAt gana sobre el otro que sólo tiene updatedAt (fallback) menor"() {
        // Transición: local ya migró a positionsUpdatedAt, server es viejo (solo updatedAt).
        const server = { id: 'e1', updatedAt: 100, positions: ['Cocina', 'Caja'] }; // fallback → 100
        const local  = { id: 'e1', updatedAt: 100, positionsUpdatedAt: 200, positions: ['Cocina'] };
        const out = mergeEmployees(server, local);
        testRunner.assertEquals(out.positions.join(','), 'Cocina',
            'local tocó puestos en 200 > fallback 100 del server → gana la remoción');
    },

    // 🐛 Judgment Day Fase 2A Ronda 2 (CRITICAL, Juez A): la ASIMETRÍA reabría
    // el bug. Cuando UN lado tiene positionsUpdatedAt real y el otro sólo cae al
    // fallback updatedAt, comparar magnitudes no comparables deja que editar un
    // campo ajeno (que sube updatedAt) en el lado SIN sello gane los puestos.
    "el lado que tocó puestos (tiene positionsUpdatedAt) gana aunque el otro tenga updatedAt MAYOR por editar otro campo"() {
        // server agregó 'Barra' tocando puestos (positionsUpdatedAt=1000).
        // local es legacy (sin positionsUpdatedAt) y editó el teléfono → updatedAt=2000.
        const server = { id: 'e1', updatedAt: 1000, positionsUpdatedAt: 1000, positions: ['Cocina', 'Barra'] };
        const local  = { id: 'e1', updatedAt: 2000, positions: ['Cocina'] };
        const out = mergeEmployees(server, local);
        testRunner.assert(out.positions.includes('Barra'),
            'el lado con frescura ESPECÍFICA de puestos gana; el fallback updatedAt del legacy NO debe pisar los puestos');
    },

    "simétrico inverso: el lado sin sello NO gana los puestos por subir updatedAt"() {
        const server = { id: 'e1', updatedAt: 5000, positions: ['Cocina'] }; // legacy, editó otro campo
        const local  = { id: 'e1', updatedAt: 1000, positionsUpdatedAt: 1000, positions: ['Cocina', 'Barra'] };
        const out = mergeEmployees(server, local);
        testRunner.assert(out.positions.includes('Barra'),
            'local tocó puestos (tiene sello) → gana sobre el server legacy con updatedAt mayor');
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
