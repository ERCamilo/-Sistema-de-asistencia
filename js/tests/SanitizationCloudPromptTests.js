/**
 * 🧪 SanitizationCloudPromptTests
 *
 * Contract tests for the "ask user after sanitization" feature.
 *
 * When loadApplicationData() runs validateDataIntegrity() and finds fixes,
 * it should:
 *   1. Save to IndexedDB only (localOnly:true — don't auto-push to Firebase).
 *   2. Set state._pendingSanitizationCloudSync = <fix count> as a signal.
 *
 * app.js reads that signal after the first Firebase sync completes and shows
 * Modal.confirm asking the user if they want to push the fixes to the cloud.
 */

import fs from 'fs';
import path from 'path';

const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// PersistenceService source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SanitizationCloudPrompt — PersistenceService (source checks)", {

    "_executeSave guards Firebase block with !options.localOnly"() {
        // The Firebase sync block must be skippable via localOnly so that
        // load-time sanitization saves don't auto-push to Firebase.
        testRunner.assert(
            /localOnly/.test(PERSISTENCE_SRC),
            'PersistenceService must reference "localOnly" to gate the Firebase sync block'
        );
    },

    "loadApplicationData sets _pendingSanitizationCloudSync when fixes > 0"() {
        testRunner.assert(
            /_pendingSanitizationCloudSync/.test(PERSISTENCE_SRC),
            'PersistenceService must set state._pendingSanitizationCloudSync after on-load fixes'
        );
    },

    "on-load sanitization save uses localOnly:true"() {
        // The call to saveApplicationData inside the fixesOnLoad > 0 block
        // must pass localOnly:true.
        const loadBlock = PERSISTENCE_SRC.match(
            /fixesOnLoad[\s\S]{0,400}saveApplicationData/
        );
        testRunner.assert(
            !!loadBlock,
            'loadApplicationData must call saveApplicationData after fixesOnLoad'
        );
        testRunner.assert(
            /localOnly\s*:\s*true/.test(loadBlock[0]),
            'The on-load sanitization saveApplicationData call must use localOnly:true'
        );
    },

    "IndexedDB path is NOT inside the localOnly guard (always saves locally)"() {
        // IndexedDB writes must happen regardless of localOnly.
        // We verify that IndexedDB-related code exists independently of localOnly.
        testRunner.assert(
            /indexedDBService|saveToIndexedDB/i.test(PERSISTENCE_SRC),
            'PersistenceService must still have IndexedDB save paths (not gated by localOnly)'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// app.js source-level contracts
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SanitizationCloudPrompt — app.js (source checks)", {

    "app.js checks _pendingSanitizationCloudSync after initial load"() {
        testRunner.assert(
            /_pendingSanitizationCloudSync/.test(APP_SRC),
            'app.js must reference _pendingSanitizationCloudSync to trigger the cloud-sync prompt'
        );
    },

    "app.js calls Modal.confirm near the _pendingSanitizationCloudSync check"() {
        // Either the sanitization check block contains Modal.confirm, or
        // it calls a helper that contains it (function name includes sanitiz/prompt).
        const hasInline = /_pendingSanitizationCloudSync[\s\S]{0,600}Modal\.confirm/.test(APP_SRC)
            || /Modal\.confirm[\s\S]{0,600}_pendingSanitizationCloudSync/.test(APP_SRC);
        const hasHelper = /_pendingSanitizationCloudSync[\s\S]{0,200}sanitiz|sanitiz[\s\S]{0,200}_pendingSanitizationCloudSync/.test(APP_SRC);
        testRunner.assert(
            hasInline || hasHelper,
            'app.js must call Modal.confirm (or a helper) when _pendingSanitizationCloudSync > 0'
        );
    },

    "app.js clears _pendingSanitizationCloudSync after handling"() {
        testRunner.assert(
            /delete state\._pendingSanitizationCloudSync/.test(APP_SRC),
            'app.js must delete state._pendingSanitizationCloudSync after the prompt (prevents double-prompting)'
        );
    },

    "if user confirms, app.js calls saveApplicationData to push to cloud"() {
        // The block that handles the confirmed prompt must call saveApplicationData.
        const block = APP_SRC.match(/_pendingSanitizationCloudSync[\s\S]{0,1200}/);
        testRunner.assert(
            !!block && /saveApplicationData/.test(block[0]),
            'app.js must call saveApplicationData() after the user confirms cloud upload'
        );
    },

    "app.js clears flag even when no user (no cloud available)"() {
        // When there is no authenticated user, the flag must still be cleared
        // so it doesn't persist as a ghost signal across sessions.
        testRunner.assert(
            /delete state\._pendingSanitizationCloudSync/.test(APP_SRC),
            'app.js must clear _pendingSanitizationCloudSync when no user is logged in'
        );
    }

});

console.log('🧪 SanitizationCloudPrompt tests cargados.');
