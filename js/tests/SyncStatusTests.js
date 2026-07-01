/**
 * 🧪 SyncStatusTests (Fase 3.2 — estado de sincronización)
 *
 * Estado puro que rastrea la última sincronización exitosa con Firebase.
 * La UI lee de aquí para mostrar el badge "Sincronizado hace Xs".
 *
 * Contrato:
 *   - getLastSyncedAt() retorna null si nunca se ha sincronizado.
 *   - markSynced() actualiza el timestamp a now() (o uno explícito).
 *   - markSynced() emite un evento a todos los suscriptores con el ts.
 *   - subscribe(cb) registra un callback y devuelve una función para cancelar.
 *   - reset() limpia el estado (útil en logout / tests).
 *   - El timestamp es un número (ms), no Date, para serializar fácil.
 *   - Suscriptores múltiples reciben el mismo evento.
 *   - Si un callback lanza, no rompe los demás.
 */

import { SyncStatus } from '../modules/services/SyncStatus.js';

testRunner.addSuite("SyncStatus — getLastSyncedAt / markSynced (Fase 3.2)", {

    "getLastSyncedAt: null antes de cualquier sync"() {
        SyncStatus.reset();
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), null);
    },

    "markSynced sin argumento usa Date.now()"() {
        SyncStatus.reset();
        const before = Date.now();
        SyncStatus.markSynced();
        const after = Date.now();
        const ts = SyncStatus.getLastSyncedAt();
        testRunner.assert(typeof ts === 'number', 'Debe ser número');
        testRunner.assert(ts >= before && ts <= after, 'Debe estar entre before y after');
    },

    "markSynced con timestamp explícito lo respeta"() {
        SyncStatus.reset();
        SyncStatus.markSynced(1234567890);
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), 1234567890);
    },

    "markSynced ignora valores no numéricos (defensivo)"() {
        SyncStatus.reset();
        SyncStatus.markSynced(); // first marks now
        const valid = SyncStatus.getLastSyncedAt();
        SyncStatus.markSynced('not a number');
        SyncStatus.markSynced(null);
        SyncStatus.markSynced(NaN);
        // El timestamp NO debe haberse corrompido
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), valid,
            'Valores inválidos no deben sobrescribir el ts');
    },

    "reset() limpia el estado"() {
        SyncStatus.markSynced();
        SyncStatus.reset();
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), null);
    }

});

testRunner.addSuite("SyncStatus — subscribe / eventos (Fase 3.2)", {

    "subscribe(cb) recibe el ts al llamar markSynced"() {
        SyncStatus.reset();
        let received = null;
        const unsub = SyncStatus.subscribe((ts) => { received = ts; });
        try {
            SyncStatus.markSynced(99999);
            testRunner.assertEquals(received, 99999);
        } finally { unsub(); }
    },

    "subscribe devuelve una función que cancela el callback"() {
        SyncStatus.reset();
        let called = 0;
        const unsub = SyncStatus.subscribe(() => called++);
        SyncStatus.markSynced();
        testRunner.assertEquals(called, 1);
        unsub();
        SyncStatus.markSynced();
        testRunner.assertEquals(called, 1, 'Tras unsubscribe no debe seguir recibiendo');
    },

    "múltiples suscriptores reciben el mismo evento"() {
        SyncStatus.reset();
        let a = 0, b = 0, c = 0;
        const u1 = SyncStatus.subscribe(() => a++);
        const u2 = SyncStatus.subscribe(() => b++);
        const u3 = SyncStatus.subscribe(() => c++);
        try {
            SyncStatus.markSynced();
            testRunner.assertEquals(a, 1);
            testRunner.assertEquals(b, 1);
            testRunner.assertEquals(c, 1);
        } finally { u1(); u2(); u3(); }
    },

    "si un callback lanza, los demás siguen recibiendo"() {
        SyncStatus.reset();
        let ok = 0;
        const u1 = SyncStatus.subscribe(() => { throw new Error('boom'); });
        const u2 = SyncStatus.subscribe(() => { ok++; });
        try {
            let threw = false;
            try { SyncStatus.markSynced(); } catch (_) { threw = true; }
            testRunner.assertEquals(threw, false, 'markSynced no debe propagar errores de callbacks');
            testRunner.assertEquals(ok, 1, 'El callback OK debe haber recibido');
        } finally { u1(); u2(); }
    },

    "reset() también notifica a suscriptores (con null)"() {
        SyncStatus.reset();
        SyncStatus.markSynced();
        let received = 'unset';
        const unsub = SyncStatus.subscribe((ts) => { received = ts; });
        try {
            SyncStatus.reset();
            testRunner.assertEquals(received, null,
                'Reset debe notificar con null para que la UI borre el badge');
        } finally { unsub(); }
    }

});

testRunner.addSuite("SyncStatus — clearError() (U10)", {
    // Un retry manual exitoso (botón "Reintentar", U12) debe poder apagar el
    // badge rojo de error incluso cuando la operación que tuvo éxito no llama
    // a markSynced() (p. ej. sólo se drenaron borrados del outbox).

    "clearError limpia el error y notifica a los suscriptores"() {
        SyncStatus.reset();
        SyncStatus.markSynced(1000);
        SyncStatus.markError(new Error('boom'));
        testRunner.assert(SyncStatus.hasError(), 'precondición: debe haber error');

        let notified = false;
        const unsub = SyncStatus.subscribe(() => { notified = true; });
        try {
            SyncStatus.clearError();
            testRunner.assertEquals(SyncStatus.hasError(), false, 'hasError debe volver a false');
            testRunner.assert(notified, 'debe notificar a los suscriptores para que el badge se re-renderice');
        } finally { unsub(); }
    },

    "clearError sin error pendiente es no-op (no notifica)"() {
        SyncStatus.reset();
        SyncStatus.markSynced(1000);
        testRunner.assert(!SyncStatus.hasError(), 'precondición: sin error');

        let notified = false;
        const unsub = SyncStatus.subscribe(() => { notified = true; });
        try {
            SyncStatus.clearError();
            testRunner.assertEquals(notified, false, 'sin error que limpiar, no debe notificar (evita re-renders de más)');
        } finally { unsub(); }
    },

    "clearError preserva lastSyncedAt (no lo borra ni lo bumpa a ahora)"() {
        SyncStatus.reset();
        SyncStatus.markSynced(1234);
        SyncStatus.markError(new Error('boom'));
        SyncStatus.clearError();
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), 1234,
            'clearError es la versión que preserva el timestamp — a diferencia de markSynced, no lo actualiza a ahora');
    }
});

console.log('🧪 SyncStatus tests cargados.');
