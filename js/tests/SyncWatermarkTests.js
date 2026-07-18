/**
 * 🧪 SyncWatermarkTests
 *
 * Política de aceptación de datos remotos (watermark) para subscribeToChanges.
 *
 * Bug que corrige: en un navegador fresco (sin datos locales), un guardado
 * prematuro estampa localUpdatedAt = ahora. Cuando llega la nube (más vieja),
 * el watermark "localTime > remoteTime" la DESCARTABA → empleados/cargos/
 * líderes nunca cargaban (quedaban en 0) aunque estuvieran en la subcolección.
 *
 * Regla corregida:
 *   - Si el estado local está VACÍO (sin employees/positions/leaders) NO hay
 *     nada que proteger → aceptar la nube siempre.
 *   - Si hay datos locales, aplicar el watermark normal: aceptar solo si la
 *     nube es igual o más reciente (remoteTime >= localTime).
 */

import { localStateIsEmpty, shouldAcceptRemote, mergeCloudWatermark, createWatermarkCache } from '../modules/services/SyncWatermark.js';

testRunner.addSuite("SyncWatermark — localStateIsEmpty", {

    "true cuando no hay employees/positions/leaders"() {
        testRunner.assertEquals(localStateIsEmpty({ employees: [], positions: [], leaders: [] }), true);
    },

    "true con arreglos undefined / state nulo"() {
        testRunner.assertEquals(localStateIsEmpty({}), true);
        testRunner.assertEquals(localStateIsEmpty(null), true);
        testRunner.assertEquals(localStateIsEmpty(undefined), true);
    },

    "false si hay al menos un empleado"() {
        testRunner.assertEquals(localStateIsEmpty({ employees: [{ id: 'e1' }], positions: [], leaders: [] }), false);
    },

    "false si solo hay cargos"() {
        testRunner.assertEquals(localStateIsEmpty({ employees: [], positions: [{ id: 'p1' }], leaders: [] }), false);
    },

    "false si solo hay líderes"() {
        testRunner.assertEquals(localStateIsEmpty({ employees: [], positions: [], leaders: [{ id: 'l1' }] }), false);
    }

});

testRunner.addSuite("SyncWatermark — shouldAcceptRemote", {

    "local vacío → acepta aunque la nube sea más vieja (el bug)"() {
        testRunner.assertEquals(
            shouldAcceptRemote({ localTime: 9999, remoteTime: 1, localEmpty: true }),
            true,
            'sin datos locales no hay nada que proteger → aceptar la nube'
        );
    },

    "local con datos y nube más reciente → acepta"() {
        testRunner.assertEquals(
            shouldAcceptRemote({ localTime: 100, remoteTime: 200, localEmpty: false }),
            true
        );
    },

    "local con datos y nube más vieja → rechaza (watermark protege)"() {
        testRunner.assertEquals(
            shouldAcceptRemote({ localTime: 200, remoteTime: 100, localEmpty: false }),
            false
        );
    },

    "tiempos iguales con datos locales → acepta (no es más vieja)"() {
        testRunner.assertEquals(
            shouldAcceptRemote({ localTime: 100, remoteTime: 100, localEmpty: false }),
            true
        );
    },

    "tolera timestamps faltantes (0)"() {
        // local vacío domina
        testRunner.assertEquals(shouldAcceptRemote({ localEmpty: true }), true);
        // con datos y ambos 0 → 0>=0 acepta
        testRunner.assertEquals(shouldAcceptRemote({ localEmpty: false }), true);
    }

});

// Fase 2B U2: el watermark de conflictos ahora se alimenta de DOS fuentes —
// el doc per-registro de settings (users/{uid}/data/settings, su propio
// onSnapshot un-throttled) y el espejo (users/{uid}/data/current, cuya
// cadencia se reduce en Change B) — y ninguna de las dos debe "atrasar" a la
// otra. mergeCloudWatermark combina ambas por MAX, con `current` (el
// watermark ya conocido) como piso: nunca retrocede aunque una fuente
// reporte algo más viejo que lo que ya sabíamos.
testRunner.addSuite("SyncWatermark — mergeCloudWatermark (Fase 2B, U2)", {

    "ambas fuentes ausentes → devuelve el watermark actual (current)"() {
        testRunner.assertEquals(mergeCloudWatermark(500, undefined, undefined), 500);
    },

    "ambas fuentes ausentes y current en 0 → devuelve 0"() {
        testRunner.assertEquals(mergeCloudWatermark(0, undefined, undefined), 0);
    },

    "solo settings presente → devuelve fromSettings"() {
        testRunner.assertEquals(mergeCloudWatermark(0, 800, undefined), 800);
    },

    "solo mirror presente → devuelve fromMirror (settings ausente, v3/legacy sin doc de settings)"() {
        testRunner.assertEquals(mergeCloudWatermark(0, null, 650), 650);
    },

    "ambas presentes, settings más nuevo → elige el mayor (settings)"() {
        testRunner.assertEquals(mergeCloudWatermark(0, 900, 700), 900);
    },

    "ambas presentes, mirror más nuevo → elige el mayor (mirror)"() {
        testRunner.assertEquals(mergeCloudWatermark(0, 300, 750), 750);
    },

    "null se trata como 0 en ambas fuentes"() {
        testRunner.assertEquals(mergeCloudWatermark(0, null, null), 0);
        testRunner.assertEquals(mergeCloudWatermark(0, null, 500), 500);
    },

    "undefined se trata como 0 en ambas fuentes"() {
        testRunner.assertEquals(mergeCloudWatermark(0, undefined, undefined), 0);
        testRunner.assertEquals(mergeCloudWatermark(0, 400, undefined), 400);
    },

    "timestamps iguales entre las dos fuentes → devuelve ese valor"() {
        testRunner.assertEquals(mergeCloudWatermark(0, 1000, 1000), 1000);
    },

    "current más alto que ambas fuentes → NO retrocede (devuelve current)"() {
        testRunner.assertEquals(mergeCloudWatermark(2000, 500, 800), 2000);
    },

    "current ausente (undefined) se trata como 0"() {
        testRunner.assertEquals(mergeCloudWatermark(undefined, 500, 300), 500);
    }

});

// Judgment Day Fase 2B (fix A1): antes de este cache compartido,
// _lastKnownSettingsDocTs / _lastKnownMirrorTs vivían como variables `let`
// de closure en DOS scopes DISTINTOS dentro de app.js (el listener del
// espejo y la suscripción a subscribeToSettings). El reset de "local wins"
// en _initOutgoingConflictGuard solo limpiaba state._lastKnownCloudUpdatedAt
// — no esos dos caches — así que el próximo snapshot remoto legítimo los
// volvía a MAXear vía mergeCloudWatermark y RESUCITABA el watermark que el
// usuario ya había resuelto. createWatermarkCache() centraliza ambos
// valores para que un solo reset() los limpie atómicamente.
testRunner.addSuite("SyncWatermark — createWatermarkCache (Fase 2B, fix A1)", {

    "arranca en 0/0"() {
        const cache = createWatermarkCache();
        testRunner.assertEquals(cache.get().settingsDocTs, 0);
        testRunner.assertEquals(cache.get().mirrorTs, 0);
    },

    "setSettingsDocTs / setMirrorTs actualizan cada fuente de forma independiente"() {
        const cache = createWatermarkCache();
        cache.setSettingsDocTs(500);
        cache.setMirrorTs(300);
        testRunner.assertEquals(cache.get().settingsDocTs, 500);
        testRunner.assertEquals(cache.get().mirrorTs, 300);
    },

    "valores no finitos (NaN/undefined) se tratan como 0"() {
        const cache = createWatermarkCache();
        cache.setSettingsDocTs(undefined);
        cache.setMirrorTs(NaN);
        testRunner.assertEquals(cache.get().settingsDocTs, 0);
        testRunner.assertEquals(cache.get().mirrorTs, 0);
    },

    "reset(value) limpia AMBOS caches al mismo valor atómicamente"() {
        const cache = createWatermarkCache();
        cache.setSettingsDocTs(9000);
        cache.setMirrorTs(8000);
        cache.reset(1000);
        testRunner.assertEquals(cache.get().settingsDocTs, 1000, 'settingsDocTs debe resetearse');
        testRunner.assertEquals(cache.get().mirrorTs, 1000, 'mirrorTs debe resetearse');
    },

    "reset() sin argumento cae a 0"() {
        const cache = createWatermarkCache();
        cache.setSettingsDocTs(500);
        cache.reset();
        testRunner.assertEquals(cache.get().settingsDocTs, 0);
    },

    // 🐛 Reproduce el bug real: reset "local wins" seguido de un snapshot
    // remoto legítimo NO debe resucitar el watermark por encima del reset.
    "REGRESIÓN: tras un reset 'local wins', un snapshot remoto legítimo NO resucita el watermark"() {
        const cache = createWatermarkCache();

        // Estado previo al conflicto: ambas fuentes habían visto timestamps altos.
        cache.setSettingsDocTs(9000);
        cache.setMirrorTs(8500);
        let cloudWatermark = mergeCloudWatermark(0, cache.get().settingsDocTs, cache.get().mirrorTs);
        testRunner.assertEquals(cloudWatermark, 9000);

        // El usuario resuelve el conflicto saliente ("local wins"): el reset
        // debe bajar TODO (watermark + ambos caches) al localUpdatedAt local.
        const LOCAL_WINS_TS = 1000;
        cache.reset(LOCAL_WINS_TS);
        cloudWatermark = LOCAL_WINS_TS;

        // Llega un snapshot remoto legítimo de OTRO dispositivo (ej. el propio
        // eco de la escritura de replaceCloudFull, o un cambio normal
        // posterior) con un ts cercano al reset, NO con el ts viejo de 9000.
        const remoteMirrorTs = 1050;
        cache.setMirrorTs(remoteMirrorTs);
        cloudWatermark = mergeCloudWatermark(cloudWatermark, cache.get().settingsDocTs, cache.get().mirrorTs);

        testRunner.assert(
            cloudWatermark < 9000,
            `El watermark (${cloudWatermark}) NO debe resucitar por encima del reset (bug: el cache de settingsDocTs stale-alto sobrevivía al reset y volvía a MAXearse)`
        );
        testRunner.assertEquals(cloudWatermark, remoteMirrorTs, 'debe reflejar solo el nuevo dato legítimo, sin arrastrar el 9000 stale');
    }

});

console.log('🧪 SyncWatermark tests cargados.');
