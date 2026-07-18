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

import { localStateIsEmpty, shouldAcceptRemote, mergeCloudWatermark } from '../modules/services/SyncWatermark.js';

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

console.log('🧪 SyncWatermark tests cargados.');
