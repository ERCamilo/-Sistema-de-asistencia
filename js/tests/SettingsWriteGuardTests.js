/**
 * 🧪 SettingsWriteGuardTests
 *
 * Judgment Day Fase 2B, fix B1: política pura LWW para
 * FirebaseService.saveSettings — decide si un payload local debe
 * sobreescribir el doc remoto per-registro de settings, o si el remoto es
 * más nuevo y el write debe omitirse (evita que una entrada STALE del
 * outbox 'settings' pise un settings más nuevo de otro dispositivo).
 */

import { shouldWriteSettings } from '../modules/services/SettingsWriteGuard.js';

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

console.log('🧪 SettingsWriteGuardTests cargados.');
