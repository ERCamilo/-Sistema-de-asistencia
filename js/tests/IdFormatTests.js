/**
 * 🧪 IdFormatTests
 *
 * Clasifica ids de empleado y los rankea para tiebreaker. Display-only:
 * el id es siempre inmutable; el formato es solo una pista visual.
 */

import { classifyEmployeeId, idFormatRank, idFormatLabel } from '../modules/services/IdFormat.js';

testRunner.addSuite("IdFormat — clasificación de formatos", {

    "EMP{timestamp} → emp-modern (sistema actual)"() {
        testRunner.assertEquals(classifyEmployeeId('EMP1769317074330'), 'emp-modern');
        testRunner.assertEquals(classifyEmployeeId('EMP1'), 'emp-modern');
    },

    "UUID v4 → emp-legacy"() {
        testRunner.assertEquals(classifyEmployeeId('13c3f7db-1234-4567-89ab-cdef12345678'), 'emp-legacy');
        testRunner.assertEquals(classifyEmployeeId('B8012841-AAAA-4BBB-9CCC-DDDDDDDDDDDD'), 'emp-legacy');
    },

    "emp-NNN / emp-conflict-NNN → emp-seed"() {
        testRunner.assertEquals(classifyEmployeeId('emp-001'), 'emp-seed');
        testRunner.assertEquals(classifyEmployeeId('emp-conflict-001'), 'emp-seed');
    },

    "cualquier otra cosa → emp-unknown"() {
        testRunner.assertEquals(classifyEmployeeId(''), 'emp-unknown');
        testRunner.assertEquals(classifyEmployeeId(null), 'emp-unknown');
        testRunner.assertEquals(classifyEmployeeId(undefined), 'emp-unknown');
        testRunner.assertEquals(classifyEmployeeId(12345), 'emp-unknown');
        testRunner.assertEquals(classifyEmployeeId('weird-id'), 'emp-unknown');
    }

});

testRunner.addSuite("IdFormat — ranking numérico", {

    "modern > seed > legacy > unknown"() {
        testRunner.assert(idFormatRank('EMP1') > idFormatRank('emp-001'));
        testRunner.assert(idFormatRank('emp-001') > idFormatRank('uuid-fake-format'));
        testRunner.assert(idFormatRank('13c3f7db-1234-4567-89ab-cdef12345678') > idFormatRank(null));
    },

    "todos los modernos rankean igual entre sí"() {
        testRunner.assertEquals(idFormatRank('EMP1'), idFormatRank('EMP1769317074330'));
    }

});

testRunner.addSuite("IdFormat — etiquetas", {

    "labels son human-friendly"() {
        testRunner.assertEquals(idFormatLabel('EMP1'), 'Sistema actual');
        testRunner.assertEquals(idFormatLabel('emp-001'), 'Datos de demo');
        testRunner.assertEquals(idFormatLabel('13c3f7db-1234-4567-89ab-cdef12345678'), 'Sistema legacy');
        testRunner.assertEquals(idFormatLabel(null), 'Formato desconocido');
    }

});

console.log('🧪 IdFormat tests cargados.');
