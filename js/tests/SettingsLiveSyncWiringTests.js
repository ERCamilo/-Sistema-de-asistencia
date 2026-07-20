/**
 * 🧪 SettingsLiveSyncWiringTests (Fase 2B, U2)
 *
 * app.js debe cablear FirebaseService.subscribeToSettings junto a
 * subscribeToChanges dentro de onAuthStateChanged. La decisión accept/reject
 * (mergeCloudWatermark + shouldAcceptRemote + merge whole-object) se extrajo
 * a SettingsLiveSync.js (fix de cobertura — ver SettingsLiveSyncTests.js
 * para los tests BEHAVIORALES que ejecutan esa lógica de verdad); estos
 * tests solo verifican el CABLEADO: que app.js delega en handleRemoteSettings
 * en vez de duplicar la decisión inline.
 *
 * app.js no tiene un harness que ejecute onAuthStateChanged de verdad (es un
 * IIFE gigante que depende del SDK real de Firebase) — igual que
 * OutgoingConflictTests.js, estos son contratos SOURCE-LEVEL sobre el texto
 * del archivo.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SETTINGS_LIVE_SYNC_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/SettingsLiveSync.js'), 'utf8'
);

function subscribeToSettingsCallSite() {
    const idx = APP_SRC.indexOf('FirebaseService.subscribeToSettings(');
    return idx === -1 ? '' : APP_SRC.slice(idx, idx + 1600);
}

function subscribeToChangesCallSite() {
    const idx = APP_SRC.indexOf('FirebaseService.subscribeToChanges(');
    return idx === -1 ? '' : APP_SRC.slice(idx, idx + 900);
}

testRunner.addSuite("SettingsLiveSync — app.js cablea subscribeToSettings (Fase 2B, U2)", {

    "app.js importa mergeCloudWatermark desde SyncWatermark.js"() {
        testRunner.assert(
            /import\s*\{[^}]*mergeCloudWatermark[^}]*\}\s*from\s+['"]\.\/modules\/services\/SyncWatermark\.js['"]/.test(APP_SRC),
            'app.js debe importar mergeCloudWatermark de SyncWatermark.js'
        );
    },

    "app.js llama a FirebaseService.subscribeToSettings"() {
        testRunner.assert(
            /FirebaseService\.subscribeToSettings\s*\(/.test(APP_SRC),
            'app.js debe suscribirse a FirebaseService.subscribeToSettings junto a subscribeToChanges'
        );
    },

    "subscribeToSettings se cablea DESPUÉS de subscribeToChanges (mismo bloque de onAuthStateChanged)"() {
        const changesIdx = APP_SRC.indexOf('FirebaseService.subscribeToChanges(');
        const settingsIdx = APP_SRC.indexOf('FirebaseService.subscribeToSettings(');
        testRunner.assert(changesIdx !== -1 && settingsIdx !== -1, 'ambas suscripciones deben existir');
        testRunner.assert(settingsIdx > changesIdx,
            'subscribeToSettings debe cablearse junto a (después de) subscribeToChanges, dentro del mismo onAuthStateChanged');
    },

    "el callback de subscribeToSettings delega la decisión en handleRemoteSettings (SettingsLiveSync.js)"() {
        const block = subscribeToSettingsCallSite();
        testRunner.assert(!!block, 'debe existir el call site de subscribeToSettings');
        testRunner.assert(/handleRemoteSettings\s*\(/.test(block),
            'debe delegar en handleRemoteSettings en vez de duplicar la decisión accept/reject inline');
        testRunner.assert(
            /import\s*\{[^}]*handleRemoteSettings[^}]*\}\s*from\s+['"]\.\/modules\/services\/SettingsLiveSync\.js['"]/.test(APP_SRC),
            'app.js debe importar handleRemoteSettings de SettingsLiveSync.js'
        );
    },

    "SettingsLiveSync.js combina el watermark vía mergeCloudWatermark y mergea vía shouldAcceptRemote (whole-object, newer wins)"() {
        testRunner.assert(/mergeCloudWatermark\s*\(/.test(SETTINGS_LIVE_SYNC_SRC),
            'debe combinar el watermark del doc de settings con mergeCloudWatermark, no pisarlo directo');
        testRunner.assert(/shouldAcceptRemote\s*\(/.test(SETTINGS_LIVE_SYNC_SRC),
            'debe reutilizar shouldAcceptRemote para decidir si aceptar el settings remoto');
        testRunner.assert(/state\.settings\s*=\s*\{\s*\.\.\.state\.settings/.test(SETTINGS_LIVE_SYNC_SRC),
            'debe mergear state.settings de forma whole-object (mismo patrón que el espejo)');
    },

    "las mutaciones de state dentro del callback de subscribeToSettings van en stateManager.batchSetState"() {
        const block = subscribeToSettingsCallSite();
        testRunner.assert(!!block, 'debe existir el call site de subscribeToSettings');
        testRunner.assert(/stateManager\.batchSetState\s*\(/.test(block),
            'las escrituras a state deben ir dentro de un batchSetState (guard de deuda de escrituras directas)');
    },

    "el mirror onSnapshot combina su watermark vía mergeCloudWatermark (no lo pisa directo)"() {
        const block = subscribeToChangesCallSite();
        testRunner.assert(!!block, 'debe existir el call site de subscribeToChanges');
        testRunner.assert(/mergeCloudWatermark\s*\(/.test(block),
            'la línea state._lastKnownCloudUpdatedAt = remoteData?.settings?.localUpdatedAt debe pasar por mergeCloudWatermark, para que el espejo no atrase el watermark del doc de settings');
    }

});

console.log('🧪 SettingsLiveSyncWiringTests cargados.');
