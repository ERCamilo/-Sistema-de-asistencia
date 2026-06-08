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

import { localStateIsEmpty, shouldAcceptRemote } from '../modules/services/SyncWatermark.js';

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

console.log('🧪 SyncWatermark tests cargados.');
