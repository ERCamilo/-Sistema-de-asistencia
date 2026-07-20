/**
 * 🧪 SettingsLiveSyncTests (Fase 2B, U2 — fix de cobertura)
 *
 * Antes de este archivo, la decisión accept/reject del listener en vivo de
 * settings (FirebaseService.subscribeToSettings, cableado en app.js) solo
 * tenía cobertura por regex sobre el texto fuente (ver
 * SettingsLiveSyncWiringTests.js) — nada EJECUTABA la rama accept/reject de
 * verdad. Sacar el guard `if (accept)` (merge incondicional) o invertir
 * localTime/remoteTime dejaba pasar un doc remoto VIEJO que pisara settings
 * más nuevos en local, y la suite seguía en verde.
 *
 * Estos tests ejecutan handleRemoteSettings (SettingsLiveSync.js) de forma
 * aislada, sin Firestore real — las dependencias puras (shouldAcceptRemote,
 * mergeCloudWatermark, localStateIsEmpty, getDeviceId) están inyectadas.
 */

import { handleRemoteSettings } from '../modules/services/SettingsLiveSync.js';

const LOCAL_DEVICE = 'device-local';
const REMOTE_DEVICE = 'device-remote';

/** state con `employees` no vacío: fuerza localStateIsEmpty(state) === false,
 * así el criterio newer-wins de shouldAcceptRemote entra en juego de verdad
 * (con local vacío, shouldAcceptRemote acepta siempre, sin importar el ts). */
function makeLocalState(settingsOverrides = {}) {
    return {
        employees: [{ id: 'e1', name: 'Ana' }],
        positions: [],
        leaders: [],
        settings: { localUpdatedAt: 1000, theme: 'light', ...settingsOverrides }
    };
}

function makeBatchSetState() {
    const spy = jest.fn((cb) => cb());
    return spy;
}

testRunner.addSuite("SettingsLiveSync — handleRemoteSettings (Fase 2B, U2)", {

    "(a) acepta un doc remoto más NUEVO → mergea las claves remotas en state.settings"() {
        const state = makeLocalState();
        const batchSetState = makeBatchSetState();

        const result = handleRemoteSettings({
            remoteDoc: {
                settings: { localUpdatedAt: 2000, theme: 'dark', newKey: 'x' },
                lastChangedBy: REMOTE_DEVICE
            },
            state,
            batchSetState,
            deps: { getDeviceId: () => LOCAL_DEVICE }
        });

        testRunner.assertEquals(result.accepted, true, 'un doc remoto más nuevo debe aceptarse');
        testRunner.assertEquals(state.settings.theme, 'dark', 'debe mergear la clave remota más nueva');
        testRunner.assertEquals(state.settings.newKey, 'x', 'debe incorporar claves nuevas del remoto');
        testRunner.assertEquals(state.settings.localUpdatedAt, 2000, 'localUpdatedAt debe quedar en el del remoto aceptado');
        testRunner.assertEquals(batchSetState.mock.calls.length, 1, 'debe envolver la escritura en batchSetState');
    },

    "(b) rechaza un doc remoto más VIEJO (stale) → state.settings queda SIN CAMBIOS"() {
        const state = makeLocalState({ localUpdatedAt: 5000, theme: 'light' });
        const batchSetState = makeBatchSetState();

        const result = handleRemoteSettings({
            remoteDoc: {
                settings: { localUpdatedAt: 100, theme: 'dark' },
                lastChangedBy: REMOTE_DEVICE
            },
            state,
            batchSetState,
            deps: { getDeviceId: () => LOCAL_DEVICE }
        });

        testRunner.assertEquals(result.accepted, false, 'un doc remoto más viejo que lo local NO debe aceptarse');
        testRunner.assertEquals(state.settings.theme, 'light',
            'state.settings NO debe cambiar cuando el doc remoto es más viejo (si se quita el guard `if (accept)`, este test falla)');
        testRunner.assertEquals(state.settings.localUpdatedAt, 5000, 'localUpdatedAt local no debe retroceder');
    },

    "(b2) aunque se rechace el merge, el watermark de nube se actualiza igual (mergeCloudWatermark)"() {
        const state = makeLocalState({ localUpdatedAt: 5000 });
        state._lastKnownCloudUpdatedAt = 4000;
        const batchSetState = makeBatchSetState();

        handleRemoteSettings({
            remoteDoc: { settings: { localUpdatedAt: 100 }, lastChangedBy: REMOTE_DEVICE },
            state,
            lastKnownMirrorTs: 0,
            batchSetState,
            deps: { getDeviceId: () => LOCAL_DEVICE }
        });

        testRunner.assertEquals(state._lastKnownCloudUpdatedAt, 4000,
            'el watermark nunca retrocede (mergeCloudWatermark usa MAX contra el piso actual)');
    },

    "(c) filtro de eco: un doc con lastChangedBy === este dispositivo se IGNORA (sin merge)"() {
        const state = makeLocalState({ theme: 'light' });
        const batchSetState = makeBatchSetState();

        const result = handleRemoteSettings({
            remoteDoc: {
                // ts mucho más nuevo: si el filtro de eco fallara, este doc
                // sería aceptado igual por shouldAcceptRemote (newer-wins).
                settings: { localUpdatedAt: 999999, theme: 'dark' },
                lastChangedBy: LOCAL_DEVICE
            },
            state,
            batchSetState,
            deps: { getDeviceId: () => LOCAL_DEVICE }
        });

        testRunner.assertEquals(result.echo, true, 'un doc cuyo lastChangedBy es este dispositivo debe marcarse como eco');
        testRunner.assertEquals(result.accepted, false, 'un eco nunca se acepta');
        testRunner.assertEquals(state.settings.theme, 'light', 'un eco no debe mergear nada en state.settings');
        testRunner.assertEquals(batchSetState.mock.calls.length, 0,
            'un eco no debe ni siquiera abrir un batchSetState (si se quita el filtro de eco, este test falla)');
    },

    "(d) merge whole-object: una clave SOLO local (no presente en el doc remoto) sobrevive al merge"() {
        const state = makeLocalState({ theme: 'light', legacyKey: 'keepme' });
        const batchSetState = makeBatchSetState();

        const result = handleRemoteSettings({
            remoteDoc: {
                // El remoto no conoce `legacyKey` (p.ej. otro dispositivo con
                // una versión vieja de settings) — el merge es un overlay
                // sobre una copia de state.settings, no un reemplazo total.
                settings: { localUpdatedAt: 2000, theme: 'dark' },
                lastChangedBy: REMOTE_DEVICE
            },
            state,
            batchSetState,
            deps: { getDeviceId: () => LOCAL_DEVICE }
        });

        testRunner.assertEquals(result.accepted, true, 'doc remoto más nuevo debe aceptarse');
        testRunner.assertEquals(state.settings.theme, 'dark', 'la clave presente en ambos toma el valor remoto');
        testRunner.assertEquals(state.settings.legacyKey, 'keepme',
            'una clave solo-local debe sobrevivir al merge whole-object (overlay, no reemplazo total)');
    },

    "sin remoteDoc (null) no hace nada y no revienta"() {
        const state = makeLocalState();
        const batchSetState = makeBatchSetState();

        const result = handleRemoteSettings({ remoteDoc: null, state, batchSetState });

        testRunner.assertEquals(result.accepted, false, 'sin doc remoto no hay nada que aceptar');
        testRunner.assertEquals(batchSetState.mock.calls.length, 0, 'sin doc remoto no debe abrir batchSetState');
    }

});

console.log('🧪 SettingsLiveSyncTests cargados.');
