/**
 * 🧪 SchemaMigrationRunnerTests (Fase 4.1 paso 3)
 *
 * Verifica el orquestador puro de migración. Recibe sus dependencias
 * inyectadas (crear-snapshot, guardar-empleados, marcar-versión,
 * notificar), de modo que se puede testear sin tocar Firebase.
 *
 * Contrato:
 *   - Si needsMigration() es false, retorna { migrated: false } sin tocar
 *     ninguna dependencia.
 *   - Si necesita migrar, ejecuta EN ESTE ORDEN:
 *       1. createSnapshot()
 *       2. saveEmployees(payloads)
 *       3. markSchemaVersion(2)
 *       4. notify(...)
 *   - Si createSnapshot falla: NO continúa con saveEmployees (preserva
 *     el invariante de "siempre hay red de seguridad").
 *   - Si saveEmployees falla: NO marca schemaVersion (la migración no
 *     se considera completada; puede reintentarse).
 *   - Si markSchemaVersion falla: la migración SE CONSIDERA fallida
 *     parcialmente; los empleados ya están escritos. Notifica de forma
 *     diferente para que el caller lo reporte.
 *   - notify() es opcional (no exige que esté presente).
 *   - Idempotente: correr dos veces sobre una cuenta ya migrada es noop.
 *   - Modo demo: respeta isDemo: true y no migra.
 */

import { runMigrationIfNeeded } from '../modules/services/SchemaMigrationRunner.js';

function makeDeps(overrides = {}) {
    return {
        createSnapshot:     jest.fn().mockResolvedValue(undefined),
        saveEmployees:      jest.fn().mockResolvedValue({ written: 0 }),
        savePositions:      jest.fn().mockResolvedValue({ written: 0 }),
        saveLeaders:        jest.fn().mockResolvedValue({ written: 0 }),
        markSchemaVersion:  jest.fn().mockResolvedValue(undefined),
        notify:             jest.fn(),
        ...overrides
    };
}

const PARENT_NEEDS_MIGRATION = {
    employees: [
        { id: 'e1', name: 'Ana', updatedAt: 100 },
        { id: 'e2', name: 'Bob', updatedAt: 200 }
    ],
    positions: [
        { id: 'p1', name: 'Developer' }
    ],
    leaders: [
        { id: 'l1', name: 'Leader A', number: 1 }
    ]
};

const PARENT_ALREADY_MIGRATED = {
    schemaVersion: 3,
    employees: [{ id: 'e1', name: 'Ana' }],
    positions: [{ id: 'p1', name: 'Developer' }],
    leaders: [{ id: 'l1', name: 'Leader A', number: 1 }]
};

testRunner.addSuite("SchemaMigrationRunner — short-circuit (Fase 4.1)", {

    async "cuenta ya migrada (schemaVersion=2) → retorna {migrated:false} y NO toca deps"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_ALREADY_MIGRATED, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(deps.createSnapshot.mock.calls.length, 0);
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 0);
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 0);
        testRunner.assertEquals(deps.notify.mock.calls.length, 0);
    },

    async "cuenta vacía → retorna {migrated:false}"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: { employees: [] }, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 0);
    },

    async "modo demo → no migra aunque haya datos"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({
            parentDoc: PARENT_NEEDS_MIGRATION, isDemo: true, ...deps
        });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(deps.createSnapshot.mock.calls.length, 0);
    },

    async "parentDoc null → retorna {migrated:false} sin reventar"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: null, ...deps });
        testRunner.assertEquals(result.migrated, false);
    }

});

testRunner.addSuite("SchemaMigrationRunner — happy path (Fase 4.1)", {

    async "cuenta no migrada → ejecuta los 4 pasos en orden"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });

        testRunner.assertEquals(result.migrated, true);
        testRunner.assertEquals(result.count, 4, "Debe reportar 4 entidades migradas (2 empleados + 1 cargo + 1 líder)");

        // 1. snapshot creado
        testRunner.assertEquals(deps.createSnapshot.mock.calls.length, 1);
        // 2. saveEmployees con los payloads correctos
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 1);
        const empsArg = deps.saveEmployees.mock.calls[0][0];
        testRunner.assertEquals(empsArg.length, 2);
        testRunner.assert(empsArg.find(e => e.id === 'e1'), "Debe incluir Ana");
        testRunner.assert(empsArg.find(e => e.id === 'e2'), "Debe incluir Bob");
        // 3. savePositions y saveLeaders llamados
        testRunner.assertEquals(deps.savePositions.mock.calls.length, 1);
        testRunner.assertEquals(deps.saveLeaders.mock.calls.length, 1);
        // 4. schemaVersion marcado
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 1);
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls[0][0], 3,
            "Debe marcar schemaVersion: 3");
        // 5. notificación
        testRunner.assertEquals(deps.notify.mock.calls.length, 1);
    },

    async "el orden es: snapshot → saveEmployees → markSchemaVersion → notify"() {
        const calls = [];
        const deps = {
            createSnapshot:    jest.fn().mockImplementation(async () => { calls.push('snapshot'); }),
            saveEmployees:     jest.fn().mockImplementation(async () => { calls.push('save');     return { written: 2 }; }),
            savePositions:     jest.fn().mockImplementation(async () => { calls.push('savePos');  return { written: 1 }; }),
            saveLeaders:       jest.fn().mockImplementation(async () => { calls.push('saveLead'); return { written: 1 }; }),
            markSchemaVersion: jest.fn().mockImplementation(async () => { calls.push('mark');     }),
            notify:            jest.fn().mockImplementation(()       => { calls.push('notify');   })
        };
        await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        testRunner.assertEquals(calls.join(','), 'snapshot,save,savePos,saveLead,mark,notify',
            "El orden debe ser snapshot → save → savePos → saveLead → mark → notify");
    },

    async "notify es opcional — no romper si no se pasa"() {
        const deps = makeDeps();
        delete deps.notify;
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        testRunner.assertEquals(result.migrated, true);
        // No debe lanzar.
    },

    async "el mensaje del notify incluye el conteo"() {
        const deps = makeDeps();
        await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        const msg = deps.notify.mock.calls[0][0];
        testRunner.assert(typeof msg === 'string' && msg.length > 0);
        testRunner.assert(msg.includes('3'),
            `Mensaje debe mencionar versión 3. Recibido: "${msg}"`);
    }

});

testRunner.addSuite("SchemaMigrationRunner — manejo de errores (Fase 4.1)", {

    async "si createSnapshot falla, NO continúa con saveEmployees"() {
        const deps = makeDeps({
            createSnapshot: jest.fn().mockRejectedValue(new Error('snap-fail'))
        });
        let threw = false;
        try {
            await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Debe propagar el error de snapshot");
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 0,
            "Si falla snapshot, NO se debe escribir empleados (preservar red de seguridad)");
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 0);
    },

    async "si saveEmployees falla, NO marca schemaVersion (permite reintento)"() {
        const deps = makeDeps({
            saveEmployees: jest.fn().mockRejectedValue(new Error('write-fail'))
        });
        let threw = false;
        try {
            await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        } catch (e) { threw = true; }
        testRunner.assert(threw);
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 0,
            "Sin escribir empleados, no se marca como migrada — permite reintentar");
    },

    async "si markSchemaVersion falla → migración considerada parcialmente fallida"() {
        const deps = makeDeps({
            markSchemaVersion: jest.fn().mockRejectedValue(new Error('mark-fail'))
        });
        let threw = false;
        try {
            await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Debe propagar el error de markSchemaVersion");
        // Empleados sí se escribieron
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 1);
        // El siguiente intento (parentDoc aún sin schemaVersion) re-correrá:
        // setDoc con merge:true es idempotente, así que es seguro.
    }

});

console.log('🧪 SchemaMigrationRunner tests cargados.');
