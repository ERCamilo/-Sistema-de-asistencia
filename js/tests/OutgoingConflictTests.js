/**
 * 🧪 OutgoingConflictTests
 *
 * Contract for the outgoing-conflict guard:
 *
 *   SCENARIO: Device A has local data (localUpdatedAt = T_a).
 *             Device B writes to cloud   (cloud's localUpdatedAt = T_b, T_b > T_a + GRACE).
 *             Device A's debounced save fires before the user accepts the incoming
 *             change modal → WITHOUT the guard, Device A would silently overwrite T_b.
 *             WITH the guard:
 *               - Firebase push is skipped.
 *               - eventBus emits 'sync:outgoing-conflict' {localTime, cloudTime}.
 *               - app.js shows Modal.confirm asking the user.
 *               - If confirmed → force push (local wins).
 *               - If cancelled  → don't push (cloud wins, wait for incoming detection).
 *
 * Contracts:
 *   PersistenceService._executeSave:
 *     - Must track and compare _lastKnownCloudUpdatedAt before Firebase sync.
 *     - Must emit 'sync:outgoing-conflict' via globalThis.eventBus when conflict.
 *     - Must skip Firebase when hasOutgoingConflict (and _outgoingConflictReviewPending).
 *     - Must NOT skip when options.force = true.
 *     - Must NOT skip when options.localOnly = true (Firebase is already skipped).
 *
 *   app.js:
 *     - Must track state._lastKnownCloudUpdatedAt from subscribeToChanges.
 *     - Must listen for 'sync:outgoing-conflict'.
 *     - Near that listener, must call Modal.confirm.
 *     - If confirmed → saveApplicationData({force:true}) so local wins.
 *     - Must clear state._outgoingConflictReviewPending after responding.
 */

import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';

const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// PersistenceService — source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — PersistenceService (source checks)", {

    "_executeSave references _lastKnownCloudUpdatedAt"() {
        testRunner.assert(
            /_lastKnownCloudUpdatedAt/.test(PERSISTENCE_SRC),
            'PersistenceService must read state._lastKnownCloudUpdatedAt for conflict detection'
        );
    },

    "_executeSave emits sync:outgoing-conflict via eventBus"() {
        testRunner.assert(
            /sync:outgoing-conflict/.test(PERSISTENCE_SRC),
            "PersistenceService must emit 'sync:outgoing-conflict' when cloud is newer than local"
        );
    },

    "_executeSave has an outgoing conflict grace period constant"() {
        // A numeric constant (ms) separating "same-session echo" from "real conflict"
        testRunner.assert(
            /CONFLICT_GRACE|OUTGOING_CONFLICT_GRACE|GRACE_MS|grace/i.test(PERSISTENCE_SRC),
            'PersistenceService must define a grace-period constant to avoid race-condition false positives'
        );
    },

    "Firebase sync block is guarded so it skips when conflict is pending"() {
        // The Firebase block condition must include a check that prevents the push
        // when a conflict review is pending.
        testRunner.assert(
            /_hasOutgoingConflict|_outgoingConflictReviewPending|outgoingConflict/.test(PERSISTENCE_SRC),
            'Firebase sync block must be guarded against outgoing conflicts'
        );
    },

    "force:true bypasses the outgoing conflict check"() {
        // When options.force = true the caller explicitly wants to override,
        // so the conflict check must respect that.
        const block = PERSISTENCE_SRC.match(/_hasOutgoingConflict[\s\S]{0,200}/);
        testRunner.assert(
            block ? /options\.force/.test(block[0]) : /options\.force.*outgoing|outgoing.*options\.force/.test(PERSISTENCE_SRC),
            'Outgoing conflict check must be bypassed when options.force = true'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — app.js (source checks)", {

    "subscribeToChanges tracks _lastKnownCloudUpdatedAt"() {
        // Inside the subscribeToChanges callback, app.js must save the cloud's
        // localUpdatedAt so PersistenceService can compare it on the next save.
        testRunner.assert(
            /_lastKnownCloudUpdatedAt/.test(APP_SRC),
            'app.js must assign state._lastKnownCloudUpdatedAt inside subscribeToChanges'
        );
    },

    "app.js listens for sync:outgoing-conflict event"() {
        testRunner.assert(
            /sync:outgoing-conflict/.test(APP_SRC),
            "app.js must register an eventBus.on('sync:outgoing-conflict', ...) handler"
        );
    },

    "app.js routes outgoing conflicts through the dedicated modal"() {
        const block = APP_SRC.match(/sync:outgoing-conflict[\s\S]{0,5000}/);
        testRunner.assert(
            !!block && /OutgoingConflictModal\.show/.test(block[0]),
            'outgoing-conflict handler must show the dedicated conflict modal'
        );
    },

    "the handler exposes cloud, merge, and device actions without replaceCloudFull"() {
        const block = APP_SRC.match(/sync:outgoing-conflict[\s\S]{0,5000}/);
        testRunner.assert(
            !!block && /onUseCloud/.test(block[0]) && /onCombine/.test(block[0]) && /onUseDevice/.test(block[0]),
            'handler must expose the three explicit conflict actions'
        );
        testRunner.assert(
            !!block && /replaceLocalWithCloud/.test(block[0]) && /mergeMainDataFromCloud/.test(block[0]) && /replaceCloudWithLocal/.test(block[0]),
            'handler must route each action through its primary-domain operation'
        );
        testRunner.assert(
            !!block && !/replaceCloudFull/.test(block[0]),
            'outgoing conflict must not use the global cloud replacement path'
        );
    },

    "usar nube actualiza la pantalla sin programar una recarga"() {
        const block = APP_SRC.match(/onUseCloud\s*:[\s\S]{0,1800}onCombine\s*:/);
        testRunner.assert(!!block, 'debe existir la acción usar nube');
        testRunner.assert(
            /replaceLocalWithCloud\(\{\s*reload:\s*\(\)\s*=>\s*render\(\)\s*\}\)/.test(block[0]),
            'usar nube debe actualizar la pantalla sin navegar antes de reanudar la sincronización'
        );
        testRunner.assert(!/location\.reload/.test(block[0]), 'usar nube no debe programar una recarga');
    },

    "handler clears _outgoingConflictReviewPending after responding"() {
        testRunner.assert(
            /_outgoingConflictReviewPending\s*=\s*false/.test(APP_SRC),
            'Handler must clear _outgoingConflictReviewPending so future conflicts can show again'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// AppState — _lastKnownCloudUpdatedAt does not pollute state defaults
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("OutgoingConflict — state flag isolation", {

    "state does not pre-define _lastKnownCloudUpdatedAt (runtime-only)"() {
        // It is set at runtime from subscribeToChanges.
        // The default state should NOT have it pre-set to avoid stale values surviving reloads.
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(state, '_lastKnownCloudUpdatedAt'),
            'state._lastKnownCloudUpdatedAt must be a runtime-only flag, not pre-defined in AppState'
        );
    },

    "state does not pre-define _outgoingConflictReviewPending"() {
        testRunner.assert(
            !Object.prototype.hasOwnProperty.call(state, '_outgoingConflictReviewPending'),
            'state._outgoingConflictReviewPending must be a runtime-only flag'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — watermark cache compartido (Judgment Day Fase 2B, fix A1)
// ─────────────────────────────────────────────────────────────
//
// Bug: _lastKnownSettingsDocTs / _lastKnownMirrorTs vivían como `let` de
// closure en un scope DISTINTO al de _initOutgoingConflictGuard, así que el
// reset de "local wins" no los limpiaba y un snapshot remoto legítimo
// posterior los volvía a MAXear (resucitando el watermark ya resuelto).
// Fix: promover ambos a outgoingWatermarkCache (SyncWatermark.js) e
// invocar su reset() atómico junto con state._lastKnownCloudUpdatedAt.

testRunner.addSuite("OutgoingConflict — app.js usa outgoingWatermarkCache (Fase 2B, fix A1)", {

    "app.js importa outgoingWatermarkCache de SyncWatermark.js"() {
        testRunner.assert(
            /import\s*\{[^}]*outgoingWatermarkCache[^}]*\}\s*from\s*['"]\.\/modules\/services\/SyncWatermark\.js['"]/.test(APP_SRC),
            'app.js debe importar outgoingWatermarkCache desde SyncWatermark.js'
        );
    },

    "app.js importa resetOutgoingWatermark de SyncWatermark.js (Fase 2B, JD Ronda 3, fix F2 completo)"() {
        testRunner.assert(
            /import\s*\{[^}]*resetOutgoingWatermark[^}]*\}\s*from\s*['"]\.\/modules\/services\/SyncWatermark\.js['"]/.test(APP_SRC),
            'app.js debe importar resetOutgoingWatermark desde SyncWatermark.js'
        );
    },

    // 🐛 Mutación mental: si alguno de los 3 sitios de reset volviera a llamar
    // outgoingWatermarkCache.reset(...) SIN pasar por resetOutgoingWatermark,
    // esta cuenta detectaría la regresión — deben ser EXACTAMENTE 3 llamadas
    // a resetOutgoingWatermark(state, outgoingWatermarkCache, ...) y CERO
    // llamadas sueltas a outgoingWatermarkCache.reset(...) fuera del helper.
    "los 3 sitios de reset (local-wins, login, logout) llaman a resetOutgoingWatermark — no queda ningún outgoingWatermarkCache.reset(...) suelto"() {
        const helperCalls = APP_SRC.match(/resetOutgoingWatermark\(\s*state\s*,\s*outgoingWatermarkCache\s*,/g) || [];
        testRunner.assertEquals(helperCalls.length, 3, 'deben existir exactamente 3 llamadas a resetOutgoingWatermark(state, outgoingWatermarkCache, ...) en app.js');

        // Cualquier `outgoingWatermarkCache.reset(` en app.js debe ser DENTRO
        // de la definición del helper (SyncWatermark.js), nunca inline en app.js.
        testRunner.assert(
            !/outgoingWatermarkCache\.reset\(/.test(APP_SRC),
            'app.js no debe llamar a outgoingWatermarkCache.reset(...) directamente — debe pasar siempre por resetOutgoingWatermark'
        );
    },

    "app.js YA NO declara _lastKnownSettingsDocTs / _lastKnownMirrorTs como variables de closure sueltas"() {
        testRunner.assert(
            !/let\s+_lastKnownSettingsDocTs/.test(APP_SRC) && !/let\s+_lastKnownMirrorTs/.test(APP_SRC),
            'Los dos caches sueltos deben eliminarse — ahora viven en outgoingWatermarkCache'
        );
    },

    "la acción usar dispositivo resetea AMBAS piezas vía resetOutgoingWatermark"() {
        const block = APP_SRC.match(/onUseDevice[\s\S]{0,1500}/);
        testRunner.assert(!!block, 'debe existir la acción explícita "onUseDevice"');
        testRunner.assert(
            /resetOutgoingWatermark\(\s*state\s*,\s*outgoingWatermarkCache\s*,\s*state\.settings\?\.localUpdatedAt/.test(block[0]),
            'onUseDevice debe resetear ambos watermarks atómicamente antes de reemplazar los datos principales'
        );
    },

    "el listener del espejo (subscribeToChanges) lee/escribe vía outgoingWatermarkCache"() {
        testRunner.assert(
            /outgoingWatermarkCache\.setMirrorTs\(/.test(APP_SRC),
            'el listener del espejo debe escribir el ts vía outgoingWatermarkCache.setMirrorTs'
        );
    },

    "la suscripción a settings (subscribeToSettings) lee/escribe vía outgoingWatermarkCache"() {
        testRunner.assert(
            /outgoingWatermarkCache\.setSettingsDocTs\(/.test(APP_SRC),
            'la suscripción de settings debe escribir el ts vía outgoingWatermarkCache.setSettingsDocTs'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — outgoingWatermarkCache se resetea en CADA transición de auth
// (Judgment Day Fase 2B JD Ronda 2, fix F2)
// ─────────────────────────────────────────────────────────────
//
// Bug: antes de la promoción a singleton (fix A1), settingsDocTs/mirrorTs
// eran `let` de closure DENTRO del callback de onAuthStateChanged, así que
// se reseteaban implícitamente en cada transición de auth (login, re-login,
// cambio de cuenta en la misma pestaña). El fix A1 promovió ambos al
// singleton outgoingWatermarkCache pero solo lo reseteaba en el branch
// "local wins" — nunca al cerrar sesión ni al iniciar una nueva. Fuga
// alcanzable: usuario A inicia sesión (cache poblado con timestamps de A),
// cierra sesión vía window.syncCenterLogout (FirebaseService.logout(), SIN
// reload de página ni wipe de estado), usuario B inicia sesión en la misma
// pestaña; si los datos locales de B están vacíos, LocalDataOwner no fuerza
// un wipe/reload, y el cache stale de A sobrevive → mergeCloudWatermark MAX
// conserva el valor de A → B recibe prompts de conflicto saliente espurios
// con timestamps de OTRA cuenta.

testRunner.addSuite("OutgoingConflict — outgoingWatermarkCache se resetea en cada transición de auth (Fase 2B JD Ronda 2, fix F2)", {

    "onAuthStateChanged resetea AMBAS piezas del watermark (vía resetOutgoingWatermark) al INICIO del branch 'user presente', antes de recablear los listeners del espejo/settings"() {
        // Judgment Day Fase 2B, Ronda 3 (fix F2 completo): outgoingWatermarkCache.reset(0)
        // solo no alcanza — debe pasar por resetOutgoingWatermark(state, outgoingWatermarkCache, 0)
        // para también limpiar state._lastKnownCloudUpdatedAt (el piso real que lee PersistenceService).
        const block = APP_SRC.match(/onAuthStateChanged\s*\(\s*async\s*\(\s*user\s*\)\s*=>\s*\{[\s\S]{0,6000}/);
        testRunner.assert(!!block, 'debe existir el callback de onAuthStateChanged');
        const ifUserIdx = block[0].search(/if\s*\(\s*user\s*\)\s*\{/);
        testRunner.assert(ifUserIdx >= 0, 'debe existir el branch "if (user) {"');
        const afterIfUser = block[0].slice(ifUserIdx);
        const resetIdx = afterIfUser.search(/resetOutgoingWatermark\(\s*state\s*,\s*outgoingWatermarkCache\s*,\s*0\s*\)/);
        const mirrorSubIdx = afterIfUser.search(/subscribeToChanges\(/);
        testRunner.assert(
            resetIdx >= 0,
            'el branch "if (user)" debe llamar a resetOutgoingWatermark(state, outgoingWatermarkCache, 0) al iniciar sesión'
        );
        testRunner.assert(
            mirrorSubIdx < 0 || resetIdx < mirrorSubIdx,
            'el reset debe ocurrir ANTES de recablear subscribeToChanges (espejo)'
        );
    },

    "onAuthStateChanged resetea AMBAS piezas del watermark también en el branch 'user ausente' (logout, cubre window.syncCenterLogout)"() {
        const block = APP_SRC.match(/onAuthStateChanged\s*\(\s*async\s*\(\s*user\s*\)\s*=>\s*\{[\s\S]*?\n\s{8}\}\s*\)\s*;/);
        testRunner.assert(!!block, 'debe existir el callback completo de onAuthStateChanged');
        const elseMatch = block[0].match(/\}\s*else\s*\{[\s\S]*$/);
        testRunner.assert(!!elseMatch, 'debe existir el branch else (user ausente) de onAuthStateChanged');
        testRunner.assert(
            /resetOutgoingWatermark\(\s*state\s*,\s*outgoingWatermarkCache\s*,\s*0\s*\)/.test(elseMatch[0]),
            'el branch "else" (sin usuario / logout) debe llamar a resetOutgoingWatermark(state, outgoingWatermarkCache, 0) para no arrastrar timestamps de la cuenta anterior a la próxima sesión'
        );
    },

    "window.syncCenterLogout dispara FirebaseService.logout() (que a su vez dispara onAuthStateChanged con user=null, cubierto por el reset de arriba)"() {
        const block = APP_SRC.match(/window\.syncCenterLogout\s*=[\s\S]{0,400}/);
        testRunner.assert(!!block, 'debe existir window.syncCenterLogout');
        testRunner.assert(
            /logoutFirebase|FirebaseService\.logout/.test(block[0]),
            'syncCenterLogout debe invocar el logout de FirebaseService, cuyo signOut dispara onAuthStateChanged(null)'
        );
    }

});

console.log('🧪 OutgoingConflict tests cargados.');
