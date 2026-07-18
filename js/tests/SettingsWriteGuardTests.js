/**
 * 🧪 SettingsWriteGuardTests
 *
 * Judgment Day Fase 2B, fix B1: política pura LWW para
 * FirebaseService.saveSettings — decide si un payload local debe
 * sobreescribir el doc remoto per-registro de settings, o si el remoto es
 * más nuevo y el write debe omitirse (evita que una entrada STALE del
 * outbox 'settings' pise un settings más nuevo de otro dispositivo).
 */

import { shouldWriteSettings, resolveSettingsWrite } from '../modules/services/SettingsWriteGuard.js';

testRunner.addSuite("SettingsWriteGuard — shouldWriteSettings (Fase 2B, fix B1)", {

    "payload más NUEVO que el remoto → escribe (true)"() {
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: 2000, remoteUpdatedAt: 1000 }),
            true
        );
    },

    "payload más VIEJO que el remoto → NO escribe (false) — protege contra el outbox stale"() {
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: 100, remoteUpdatedAt: 5000 }),
            false
        );
    },

    "timestamps iguales → escribe (el local gana el empate, full-replace)"() {
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: 1000, remoteUpdatedAt: 1000 }),
            true
        );
    },

    "sin remoteUpdatedAt (doc remoto nuevo/sin ts) → escribe"() {
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: 500, remoteUpdatedAt: 0 }),
            true
        );
    },

    "valores no finitos se tratan como 0"() {
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: undefined, remoteUpdatedAt: undefined }),
            true,
            '0 >= 0 → escribe'
        );
        testRunner.assertEquals(
            shouldWriteSettings({ payloadUpdatedAt: NaN, remoteUpdatedAt: 100 }),
            false,
            '0 >= 100 es falso → no escribe'
        );
    },

    "sin argumentos no revienta (todo 0 → escribe)"() {
        testRunner.assertEquals(shouldWriteSettings(), true);
    }

});

testRunner.addSuite("SettingsWriteGuard — resolveSettingsWrite (Fase 2B JD Ronda 2, fix F1)", {

    "force:true escribe SIEMPRE, aunque el remoto sea más nuevo (override explícito no debe ser silenciado por el guard LWW)"() {
        testRunner.assertEquals(
            resolveSettingsWrite({
                force: true,
                remoteExists: true,
                payloadUpdatedAt: 100,
                remoteUpdatedAt: 999999
            }),
            true,
            'force:true debe ignorar por completo la comparación LWW'
        );
    },

    "force:true escribe aunque no haya remoteExists ni timestamps"() {
        testRunner.assertEquals(resolveSettingsWrite({ force: true }), true);
    },

    "force:false + remoto no existe → escribe (mismo comportamiento que antes de F1)"() {
        testRunner.assertEquals(
            resolveSettingsWrite({ force: false, remoteExists: false, payloadUpdatedAt: 0, remoteUpdatedAt: 0 }),
            true
        );
    },

    "force:false + remoto existe y es más nuevo → NO escribe (el guard LWW de B1 sigue activo)"() {
        testRunner.assertEquals(
            resolveSettingsWrite({
                force: false,
                remoteExists: true,
                payloadUpdatedAt: 100,
                remoteUpdatedAt: 5000
            }),
            false
        );
    },

    "force:false + remoto existe pero el payload es igual o más nuevo → escribe"() {
        testRunner.assertEquals(
            resolveSettingsWrite({
                force: false,
                remoteExists: true,
                payloadUpdatedAt: 5000,
                remoteUpdatedAt: 1000
            }),
            true
        );
    },

    "sin argumentos no revienta (force ausente se trata como false, remoto no existe → escribe)"() {
        testRunner.assertEquals(resolveSettingsWrite(), true);
    }

});

console.log('🧪 SettingsWriteGuardTests cargados.');
