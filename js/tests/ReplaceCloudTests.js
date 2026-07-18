/**
 * 🧪 ReplaceCloudTests
 *
 * Contract tests for "true overwrite" of the cloud.
 *
 * When the user confirms "Sí, reemplazar nube con mis datos" in the
 * outgoing-conflict modal, the system must:
 *
 *   1. Read the list of cloud employee IDs
 *   2. Delete any cloud employee docs NOT present locally (orphans)
 *   3. Write the main doc WITHOUT merge:true (true overwrite, not merge)
 *   4. Write all local employees to the cloud
 *
 * Source-level contracts:
 *
 *   FirebaseService:
 *     - Must expose a replaceCloudFull(state) method
 *     - That method must call setDoc WITHOUT { merge: true }
 *     - That method must delete orphan cloud employee docs
 *
 *   app.js:
 *     - The outgoing-conflict "confirmed" path must call replaceCloudFull
 *       instead of saveApplicationData (which uses merge:true)
 */

import fs from 'fs';
import path from 'path';

const FIREBASE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// FirebaseService — replaceCloudFull method
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ReplaceCloud — FirebaseService.replaceCloudFull (source checks)", {

    "FirebaseService exposes a replaceCloudFull method"() {
        testRunner.assert(
            /replaceCloudFull\s*\(/.test(FIREBASE_SRC),
            'FirebaseService must define a replaceCloudFull() method for true overwrite'
        );
    },

    "replaceCloudFull calls setDoc WITHOUT merge:true (true overwrite)"() {
        // Find the replaceCloudFull method body and check that at least one
        // setDoc call does NOT use { merge: true }.
        const method = FIREBASE_SRC.match(
            /replaceCloudFull[\s\S]{0,4000}/
        );
        testRunner.assert(!!method, 'replaceCloudFull must exist');
        // It should have a setDoc call.  We check there is at least one setDoc
        // that either has no second options arg, or explicitly has merge: false,
        // or simply no merge property at all.
        testRunner.assert(
            /setDoc\s*\(/.test(method[0]),
            'replaceCloudFull must call setDoc'
        );
        // The method MUST NOT use { merge: true } on the main doc write.
        // We look for setDoc that does NOT have merge: true nearby.
        // A simple check: there should be at least one setDoc without merge: true
        // within the method.
        const setDocCalls = method[0].match(/setDoc\s*\([^)]+\)/g) || [];
        const nonMergeCalls = setDocCalls.filter(c => !/merge\s*:\s*true/.test(c));
        testRunner.assert(
            nonMergeCalls.length > 0,
            'replaceCloudFull must have at least one setDoc call without { merge: true }'
        );
    },

    "replaceCloudFull deletes orphan cloud employee docs"() {
        // The method must reference EmployeeRepository.loadAll (to read cloud IDs)
        // and EmployeeRepository.deleteOne or deleteDoc (to remove orphans).
        const method = FIREBASE_SRC.match(
            /replaceCloudFull[\s\S]{0,3000}/
        );
        testRunner.assert(!!method, 'replaceCloudFull must exist');
        testRunner.assert(
            /loadAll|getDocs/.test(method[0]),
            'replaceCloudFull must read cloud employee docs to find orphans'
        );
        testRunner.assert(
            /deleteOne|deleteDoc/.test(method[0]),
            'replaceCloudFull must delete orphan cloud employee docs'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// FirebaseService — replaceCloudFull también escribe el doc per-registro
// de settings (Judgment Day Fase 2B, fix A2)
// ─────────────────────────────────────────────────────────────
//
// Bug: replaceCloudFull sobreescribe el espejo (users/{uid}/data/current)
// pero nunca escribía users/{uid}/data/settings (Fase 2B U1). Tras elegir
// "reemplazar nube con mis datos", el doc de settings quedaba stale
// (podía tener el settings descartado de OTRO dispositivo) aunque el
// espejo ya reflejara los datos locales correctos.

testRunner.addSuite("ReplaceCloud — FirebaseService.replaceCloudFull escribe settings (Fase 2B, fix A2)", {

    "replaceCloudFull llama a this.saveSettings(state.settings) tras el overwrite del espejo"() {
        const method = FIREBASE_SRC.match(
            /async\s+replaceCloudFull[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/
        );
        testRunner.assert(!!method, 'replaceCloudFull debe ser localizable');
        testRunner.assert(
            /this\.saveSettings\(\s*state\.settings\s*\)/.test(method[0]),
            'replaceCloudFull debe reutilizar this.saveSettings(state.settings) (writer de U1) para que el doc de settings quede consistente con "local wins", no stale'
        );
    },

    "la llamada a saveSettings ocurre DESPUÉS del setDoc del espejo (data/current)"() {
        const method = FIREBASE_SRC.match(
            /async\s+replaceCloudFull[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/
        );
        testRunner.assert(!!method, 'replaceCloudFull debe ser localizable');
        const txt = method[0];
        const mirrorSetDocIdx = txt.search(/await\s+setDoc\s*\(\s*docRef/);
        const saveSettingsIdx = txt.search(/this\.saveSettings\(\s*state\.settings\s*\)/);
        testRunner.assert(mirrorSetDocIdx >= 0, 'debe existir el setDoc del espejo');
        testRunner.assert(saveSettingsIdx >= 0, 'debe existir la llamada a saveSettings');
        testRunner.assert(
            saveSettingsIdx > mirrorSetDocIdx,
            'saveSettings debe llamarse DESPUÉS de que el overwrite del espejo se haya escrito'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js — outgoing conflict uses replaceCloudFull
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("ReplaceCloud — app.js outgoing-conflict uses replaceCloudFull", {

    "outgoing-conflict confirmed path calls replaceCloudFull"() {
        // The handler for the confirmed case must call replaceCloudFull
        // instead of (or in addition to) saveApplicationData.
        const block = APP_SRC.match(
            /sync:outgoing-conflict[\s\S]{0,3000}/
        );
        testRunner.assert(
            !!block && /replaceCloudFull/.test(block[0]),
            'The outgoing-conflict confirmed path must call replaceCloudFull for a true overwrite'
        );
    }

});

console.log('🧪 ReplaceCloud tests cargados.');
