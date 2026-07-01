/**
 * 🧪 SyncErrorClassifierTests
 *
 * Clasifica un error de sincronización (Firestore u otro) como TRANSITORIO
 * (reintentar) o PERMANENTE (dead-letter de inmediato, sin gastar los 5
 * intentos). Un permission-denied o invalid-argument nunca se va a resolver
 * solo reintentando; una red caída (unavailable) sí.
 *
 * `nextEntryState` es la decisión pura completa para una entrada del outbox
 * tras un fallo: cuántos intentos lleva y si pasa a 'dead'.
 */

import { classifySyncError, nextEntryState, PERMANENT_CODES } from '../modules/services/SyncErrorClassifier.js';

testRunner.addSuite("SyncErrorClassifier — clasificación transitorio/permanente", {

    "permission-denied es permanente"() {
        testRunner.assertEquals(classifySyncError({ code: 'permission-denied' }), 'permanent',
            'permission-denied nunca se resuelve reintentando');
    },

    "invalid-argument, failed-precondition y not-found también son permanentes"() {
        testRunner.assertEquals(classifySyncError({ code: 'invalid-argument' }), 'permanent');
        testRunner.assertEquals(classifySyncError({ code: 'failed-precondition' }), 'permanent');
        testRunner.assertEquals(classifySyncError({ code: 'not-found' }), 'permanent');
    },

    "unavailable es transitorio"() {
        testRunner.assertEquals(classifySyncError({ code: 'unavailable' }), 'transient',
            'un problema de red sí se puede resolver reintentando');
    },

    "deadline-exceeded es transitorio"() {
        testRunner.assertEquals(classifySyncError({ code: 'deadline-exceeded' }), 'transient');
    },

    "error sin code es transitorio (por defecto, no asumir lo peor)"() {
        testRunner.assertEquals(classifySyncError(new Error('boom')), 'transient');
    },

    "error null/undefined no peta y es transitorio"() {
        testRunner.assertEquals(classifySyncError(null), 'transient');
        testRunner.assertEquals(classifySyncError(undefined), 'transient');
    },

    "PERMANENT_CODES exporta la lista usada"() {
        testRunner.assert(Array.isArray(PERMANENT_CODES) && PERMANENT_CODES.includes('permission-denied'),
            'PERMANENT_CODES debe existir y listar permission-denied');
    }

});

testRunner.addSuite("SyncErrorClassifier — nextEntryState (decisión pura por entrada)", {

    "permanente marca dead de una, sin importar los intentos previos"() {
        const r = nextEntryState({ attempts: 0 }, { code: 'invalid-argument' }, 5);
        testRunner.assertEquals(r.status, 'dead', 'un error permanente dead-letterea de inmediato');
        testRunner.assertEquals(r.attempts, 1, 'igual se cuenta el intento');
    },

    "transitorio bajo el máximo sigue pending e incrementa attempts"() {
        const r = nextEntryState({ attempts: 1 }, { code: 'unavailable' }, 5);
        testRunner.assertEquals(r.status, 'pending');
        testRunner.assertEquals(r.attempts, 2);
    },

    "transitorio que alcanza el máximo pasa a dead"() {
        const r = nextEntryState({ attempts: 4 }, { code: 'unavailable' }, 5);
        testRunner.assertEquals(r.status, 'dead', 'al llegar a MAX_FLUSH_ATTEMPTS debe dead-letterear igual (no bloquear la cola para siempre)');
        testRunner.assertEquals(r.attempts, 5);
    },

    "lastError se registra con el mensaje del error"() {
        const r = nextEntryState({ attempts: 0 }, { message: 'boom' }, 5);
        testRunner.assert(typeof r.lastError === 'string' && r.lastError.includes('boom'),
            'lastError debe incluir el mensaje para poder diagnosticar después');
    },

    "attempts ausente en la entrada se trata como 0"() {
        const r = nextEntryState({}, { code: 'unavailable' }, 5);
        testRunner.assertEquals(r.attempts, 1);
        testRunner.assertEquals(r.status, 'pending');
    }

});
