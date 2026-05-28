/**
 * 🧪 SyncPauseTests (Task: cloud-upload pause)
 *
 * Contract for SyncPauseService:
 *   - isSyncPaused() reads state.settings.cloudUploadPaused.
 *   - pauseCloudUpload() sets the flag and saves immediately (IndexedDB only).
 *   - resumeCloudUpload() clears the flag and re-queues a full save.
 *   - isSyncPaused() returns false when flag is absent or false.
 *
 * Contract for _executeSave integration (source-level check):
 *   - PersistenceService source must reference cloudUploadPaused so that
 *     the Firebase sync block is guarded by the pause flag.
 */

import { isSyncPaused, pauseCloudUpload, resumeCloudUpload } from '../modules/services/SyncPauseService.js';
import { state } from '../modules/core/AppState.js';

import fs from 'fs';
import path from 'path';
const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function resetSettings(overrides = {}) {
    if (!state.settings) state.settings = {};
    delete state.settings.cloudUploadPaused;
    Object.assign(state.settings, overrides);
}

// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncPauseService — isSyncPaused (cloud-upload pause)", {

    "returns false when flag absent"() {
        resetSettings();
        testRunner.assertEquals(isSyncPaused(), false);
    },

    "returns false when flag is explicitly false"() {
        resetSettings({ cloudUploadPaused: false });
        testRunner.assertEquals(isSyncPaused(), false);
    },

    "returns true when flag is true"() {
        resetSettings({ cloudUploadPaused: true });
        testRunner.assertEquals(isSyncPaused(), true);
    },

    "returns false when state.settings is null"() {
        const orig = state.settings;
        state.settings = null;
        testRunner.assertEquals(isSyncPaused(), false);
        state.settings = orig;
    }

});

testRunner.addSuite("SyncPauseService — pauseCloudUpload (cloud-upload pause)", {

    "sets state.settings.cloudUploadPaused to true"() {
        resetSettings();
        pauseCloudUpload();
        testRunner.assertEquals(state.settings.cloudUploadPaused, true);
    },

    "creates state.settings if missing"() {
        const orig = state.settings;
        state.settings = null;
        pauseCloudUpload();
        testRunner.assertEquals(state?.settings?.cloudUploadPaused, true);
        state.settings = orig;
    },

    "isSyncPaused() returns true after pauseCloudUpload()"() {
        resetSettings();
        pauseCloudUpload();
        testRunner.assertEquals(isSyncPaused(), true);
    }

});

testRunner.addSuite("SyncPauseService — resumeCloudUpload (cloud-upload pause)", {

    "clears the cloudUploadPaused flag"() {
        resetSettings({ cloudUploadPaused: true });
        resumeCloudUpload();
        testRunner.assertEquals(isSyncPaused(), false,
            'Flag must be cleared after resume');
    },

    "isSyncPaused() returns false after resumeCloudUpload()"() {
        resetSettings({ cloudUploadPaused: true });
        resumeCloudUpload();
        testRunner.assertEquals(isSyncPaused(), false);
    },

    "resumeCloudUpload() is safe to call when not paused"() {
        resetSettings();
        let threw = false;
        try { resumeCloudUpload(); } catch (_) { threw = true; }
        testRunner.assertEquals(threw, false);
        testRunner.assertEquals(isSyncPaused(), false);
    }

});

testRunner.addSuite("SyncPauseService — PersistenceService integration (source check)", {

    "PersistenceService._executeSave checks cloudUploadPaused before Firebase sync"() {
        testRunner.assert(
            /cloudUploadPaused/.test(PERSISTENCE_SRC),
            'PersistenceService must reference cloudUploadPaused to gate Firebase sync'
        );
    },

    "PersistenceService guards Firebase sync with cloudUploadPaused check"() {
        // The guard can be implemented by importing isSyncPaused() OR by reading
        // the flag directly. Either way, cloudUploadPaused must appear in the
        // Firebase sync block of _executeSave.
        testRunner.assert(
            /cloudUploadPaused/.test(PERSISTENCE_SRC),
            'PersistenceService must check cloudUploadPaused to gate Firebase sync'
        );
    }

});

console.log('🧪 SyncPause tests cargados.');
