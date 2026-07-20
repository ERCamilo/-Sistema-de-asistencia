/**
 * 🧪 SchemaMigrationRunnerTests (Fase 4.1 paso 3 / Fase 2B U3)
 *
 * Verifica el orquestador puro de migración. Recibe sus dependencias
 * inyectadas (crear-snapshot, guardar-empleados, sembrar-settings,
 * marcar-versión, notificar), de modo que se puede testear sin tocar
 * Firebase.
 *
 * Contrato:
 *   - Si needsMigration() es false, retorna { migrated: false } sin tocar
 *     ninguna dependencia.
 *   - Si necesita migrar, ejecuta EN ESTE ORDEN:
 *       1. createSnapshot()
 *       2. saveEmployees(payloads)      — solo si version < 2
 *       3. savePositions/saveLeaders    — solo si version < 3
 *       4. notifyMigrationStart() + saveSettings(parentDoc.settings) — solo si version < 4
 *       5. markSchemaVersion(4)
 *       6. notify(...)
 *   - Los 3 gates (version<2 / version<3 / version<4) son mutuamente
 *     excluyentes por rango: una cuenta v3 SOLO entra a la rama v4, sin
 *     re-correr la migración de roster (empleados/cargos/líderes).
 *   - Si createSnapshot falla: NO continúa con ninguna escritura (preserva
 *     el invariante de "siempre hay red de seguridad").
 *   - Si saveEmployees falla: NO marca schemaVersion (la migración no
 *     se considera completada; puede reintentarse).
 *   - Si markSchemaVersion falla: la migración SE CONSIDERA fallida
 *     parcialmente; los empleados ya están escritos. Notifica de forma
 *     diferente para que el caller lo reporte.
 *   - notify() y notifyMigrationStart() son opcionales (no exigen estar presentes).
 *   - Idempotente: correr dos veces sobre una cuenta ya migrada (v4) es noop.
 *   - Modo demo: respeta isDemo: true y no migra.
 *   - v4: el seed de settings es COPY-FORWARD no-destructivo — nunca borra
 *     ni muta parentDoc.settings (el espejo conserva su copia inline).
 */

import { runMigrationIfNeeded } from '../modules/services/SchemaMigrationRunner.js';

function makeDeps(overrides = {}) {
    return {
        createSnapshot:        jest.fn().mockResolvedValue(undefined),
        saveEmployees:         jest.fn().mockResolvedValue({ written: 0 }),
        savePositions:         jest.fn().mockResolvedValue({ written: 0 }),
        saveLeaders:           jest.fn().mockResolvedValue({ written: 0 }),
        saveSettings:          jest.fn().mockResolvedValue(undefined),
        markSchemaVersion:     jest.fn().mockResolvedValue(undefined),
        notifyMigrationStart:  jest.fn(),
        notify:                jest.fn(),
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
    ],
    settings: { theme: 'dark', businessName: 'Acme' }
};

const PARENT_ALREADY_MIGRATED = {
    schemaVersion: 4,
    employees: [{ id: 'e1', name: 'Ana' }],
    positions: [{ id: 'p1', name: 'Developer' }],
    leaders: [{ id: 'l1', name: 'Leader A', number: 1 }],
    settings: { theme: 'dark' }
};

// Cuenta v3 "real": ya pasó por v1→v2→v3, conserva el respaldo legacy
// congelado de empleados/cargos/líderes (ver comentario en SchemaMigration.js:
// "se conserva 4 semanas como respaldo"), y todavía no tiene su doc de
// settings per-registro (Fase 2B). SOLO debe entrar a la rama version<4.
const PARENT_V3_ONLY = {
    schemaVersion: 3,
    employees: [{ id: 'e1', name: 'Ana' }],
    positions: [{ id: 'p1', name: 'Developer' }],
    leaders: [{ id: 'l1', name: 'Leader A', number: 1 }],
    settings: { theme: 'dark', businessName: 'Acme' }
};

testRunner.addSuite("SchemaMigrationRunner — short-circuit (Fase 4.1)", {

    async "cuenta ya migrada (schemaVersion=4) → retorna {migrated:false} y NO toca deps (idempotencia)"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_ALREADY_MIGRATED, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(deps.createSnapshot.mock.calls.length, 0,
            "NO-OP total: ni siquiera el snapshot pre-migración se toma");
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 0);
        testRunner.assertEquals(deps.savePositions.mock.calls.length, 0);
        testRunner.assertEquals(deps.saveLeaders.mock.calls.length, 0);
        testRunner.assertEquals(deps.saveSettings.mock.calls.length, 0,
            "NO-OP total: no se siembra el doc de settings de nuevo");
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 0,
            "NO-OP total: no se re-escribe la versión");
        testRunner.assertEquals(deps.notifyMigrationStart.mock.calls.length, 0);
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

testRunner.addSuite("SchemaMigrationRunner — happy path (Fase 4.1 / Fase 2B U3)", {

    async "cuenta v0/v1 no migrada → recorre las 3 ramas (v2, v3, v4) y marca versión 4"() {
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
        // 4. rama v4: spinner + seed de settings
        testRunner.assertEquals(deps.notifyMigrationStart.mock.calls.length, 1);
        testRunner.assertEquals(deps.saveSettings.mock.calls.length, 1);
        testRunner.assertEquals(deps.saveSettings.mock.calls[0][0], PARENT_NEEDS_MIGRATION.settings,
            "Debe sembrar el doc de settings con parentDoc.settings");
        // 5. schemaVersion marcado al target vigente (4)
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 1);
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls[0][0], 4,
            "Debe marcar schemaVersion: 4");
        // 6. notificación
        testRunner.assertEquals(deps.notify.mock.calls.length, 1);
    },

    async "el orden es: snapshot → save → savePos → saveLead → migrationStart → saveSettings → mark → notify"() {
        const calls = [];
        const deps = {
            createSnapshot:       jest.fn().mockImplementation(async () => { calls.push('snapshot'); }),
            saveEmployees:        jest.fn().mockImplementation(async () => { calls.push('save');          return { written: 2 }; }),
            savePositions:        jest.fn().mockImplementation(async () => { calls.push('savePos');       return { written: 1 }; }),
            saveLeaders:          jest.fn().mockImplementation(async () => { calls.push('saveLead');      return { written: 1 }; }),
            notifyMigrationStart: jest.fn().mockImplementation(()       => { calls.push('migrationStart'); }),
            saveSettings:         jest.fn().mockImplementation(async () => { calls.push('saveSettings'); }),
            markSchemaVersion:    jest.fn().mockImplementation(async () => { calls.push('mark');           }),
            notify:               jest.fn().mockImplementation(()       => { calls.push('notify');         })
        };
        await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        testRunner.assertEquals(
            calls.join(','),
            'snapshot,save,savePos,saveLead,migrationStart,saveSettings,mark,notify',
            "El orden debe ser snapshot → save → savePos → saveLead → migrationStart → saveSettings → mark → notify"
        );
    },

    async "notify y notifyMigrationStart son opcionales — no romper si no se pasan"() {
        const deps = makeDeps();
        delete deps.notify;
        delete deps.notifyMigrationStart;
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        testRunner.assertEquals(result.migrated, true);
        // No debe lanzar.
    },

    async "el mensaje del notify incluye la versión y menciona las preferencias movidas"() {
        const deps = makeDeps();
        await runMigrationIfNeeded({ parentDoc: PARENT_NEEDS_MIGRATION, ...deps });
        const msg = deps.notify.mock.calls[0][0];
        testRunner.assert(typeof msg === 'string' && msg.length > 0);
        testRunner.assert(msg.includes('4'),
            `Mensaje debe mencionar versión 4. Recibido: "${msg}"`);
        testRunner.assert(/preferencias/i.test(msg),
            `Mensaje debe mencionar que las preferencias se movieron. Recibido: "${msg}"`);
    }

});

testRunner.addSuite("SchemaMigrationRunner — rama v4: settings per-registro (Fase 2B U3)", {

    async "cuenta v3 entra SOLO a la rama v4: NO re-migra empleados/cargos/líderes"() {
        const deps = makeDeps();
        const result = await runMigrationIfNeeded({ parentDoc: PARENT_V3_ONLY, ...deps });

        testRunner.assertEquals(result.migrated, true);
        testRunner.assertEquals(deps.saveEmployees.mock.calls.length, 0,
            "Cuenta v3: el roster ya está migrado, no debe re-subirse");
        testRunner.assertEquals(deps.savePositions.mock.calls.length, 0,
            "Cuenta v3: cargos ya migrados, no debe re-subirse");
        testRunner.assertEquals(deps.saveLeaders.mock.calls.length, 0,
            "Cuenta v3: líderes ya migrados, no debe re-subirse");
        testRunner.assertEquals(deps.saveSettings.mock.calls.length, 1,
            "Cuenta v3: SÍ debe sembrar el doc de settings (única rama pendiente)");
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls[0][0], 4);
    },

    async "v3→v4 siembra settings desde parentDoc.settings y marca la versión AL FINAL"() {
        const calls = [];
        const deps = makeDeps({
            saveSettings:      jest.fn().mockImplementation(async (settings) => { calls.push(['saveSettings', settings]); }),
            markSchemaVersion: jest.fn().mockImplementation(async (v)        => { calls.push(['mark', v]); })
        });
        await runMigrationIfNeeded({ parentDoc: PARENT_V3_ONLY, ...deps });

        testRunner.assertEquals(deps.saveSettings.mock.calls[0][0], PARENT_V3_ONLY.settings,
            "Debe sembrar el doc con el settings del parentDoc (copy-forward)");

        const seedIdx = calls.findIndex(c => c[0] === 'saveSettings');
        const markIdx = calls.findIndex(c => c[0] === 'mark');
        testRunner.assert(seedIdx !== -1 && markIdx !== -1 && seedIdx < markIdx,
            "El seed de settings debe ocurrir ANTES de markSchemaVersion(4)");
        testRunner.assertEquals(calls[markIdx][1], 4, "markSchemaVersion debe recibir 4 (TARGET vigente)");
    },

    async "snapshot pre-migración se toma ANTES de sembrar settings o de marcar versión"() {
        const calls = [];
        const deps = makeDeps({
            createSnapshot:    jest.fn().mockImplementation(async () => { calls.push('snapshot'); }),
            saveSettings:      jest.fn().mockImplementation(async () => { calls.push('saveSettings'); }),
            markSchemaVersion: jest.fn().mockImplementation(async () => { calls.push('mark'); })
        });
        await runMigrationIfNeeded({ parentDoc: PARENT_V3_ONLY, ...deps });

        testRunner.assertEquals(calls.join(','), 'snapshot,saveSettings,mark',
            "Orden estricto: snapshot (red de seguridad) → saveSettings → markSchemaVersion");
    },

    async "sync:migration-start se dispara UNA vez, al entrar a la rama v4"() {
        const deps = makeDeps();
        await runMigrationIfNeeded({ parentDoc: PARENT_V3_ONLY, ...deps });
        testRunner.assertEquals(deps.notifyMigrationStart.mock.calls.length, 1);
    },

    async "no-destructivo: parentDoc.settings NO se muta ni se borra tras migrar"() {
        const original = JSON.parse(JSON.stringify(PARENT_V3_ONLY.settings));
        const parentDocClone = JSON.parse(JSON.stringify(PARENT_V3_ONLY));
        const deps = makeDeps();

        await runMigrationIfNeeded({ parentDoc: parentDocClone, ...deps });

        testRunner.assertEquals(JSON.stringify(parentDocClone.settings), JSON.stringify(original),
            "El espejo debe conservar su copia inline de settings intacta (compat v3)");
    },

    async "si saveSettings falla, NO marca schemaVersion (permite reintento)"() {
        const deps = makeDeps({
            saveSettings: jest.fn().mockRejectedValue(new Error('settings-write-fail'))
        });
        let threw = false;
        try {
            await runMigrationIfNeeded({ parentDoc: PARENT_V3_ONLY, ...deps });
        } catch (e) { threw = true; }
        testRunner.assert(threw, "Debe propagar el error de saveSettings");
        testRunner.assertEquals(deps.markSchemaVersion.mock.calls.length, 0,
            "Sin sembrar settings, no se marca como migrada — permite reintentar");
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
