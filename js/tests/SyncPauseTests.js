/**
 * 🧪 SyncPauseTests (Task: cloud-upload pause)
 *
 * La pausa es POR DISPOSITIVO: vive en localStorage, NUNCA en state.settings
 * (que se sincroniza a Firebase). Esto evita que un flag viejo en la nube
 * re-pause el equipo, y que pausar aquí afecte a otros dispositivos.
 *
 * Contract for SyncPauseService:
 *   - isSyncPaused() reads the localStorage flag (device-local).
 *   - pauseCloudUpload() writes the flag to localStorage.
 *   - resumeCloudUpload() clears the flag and re-queues a full save.
 *   - isSyncPaused() returns false when the flag is absent.
 *
 * Contract for _executeSave integration (source-level check):
 *   - PersistenceService source must gate the Firebase sync block via
 *     isSyncPaused() so the device-local pause is respected.
 */

import { isSyncPaused, pauseCloudUpload, resumeCloudUpload, SYNC_PAUSE_ENABLED } from '../modules/services/SyncPauseService.js';

import fs from 'fs';
import path from 'path';
const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

const _PAUSE_LS_KEY = 'asistencia_cloud_upload_paused';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clearPauseFlag() {
    try { localStorage.removeItem(_PAUSE_LS_KEY); } catch (_) {}
}

function setPauseFlag() {
    try { localStorage.setItem(_PAUSE_LS_KEY, 'true'); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────

testRunner.addSuite("SyncPauseService — isSyncPaused (device-local pause)", {

    "returns false when flag absent"() {
        clearPauseFlag();
        testRunner.assertEquals(isSyncPaused(), false);
    },

    "returns true when localStorage flag is set"() {
        setPauseFlag();
        testRunner.assertEquals(isSyncPaused(), true);
        clearPauseFlag();
    },

    "returns false after the flag is removed"() {
        setPauseFlag();
        clearPauseFlag();
        testRunner.assertEquals(isSyncPaused(), false);
    }

});

testRunner.addSuite("SyncPauseService — pauseCloudUpload (device-local pause)", {

    "writes the pause flag to localStorage"() {
        clearPauseFlag();
        pauseCloudUpload();
        testRunner.assertEquals(localStorage.getItem(_PAUSE_LS_KEY), 'true');
        clearPauseFlag();
    },

    "isSyncPaused() returns true after pauseCloudUpload()"() {
        clearPauseFlag();
        pauseCloudUpload();
        testRunner.assertEquals(isSyncPaused(), true);
        clearPauseFlag();
    },

    "does NOT touch Firebase-synced state (no cloudUploadPaused in SyncPauseService source)"() {
        const SVC_SRC = fs.readFileSync(
            path.resolve(__dirname, '../modules/services/SyncPauseService.js'), 'utf8'
        );
        testRunner.assert(
            !/state\.settings\.cloudUploadPaused/.test(SVC_SRC),
            'SyncPauseService must NOT write the pause flag into state.settings (it would sync to Firebase)'
        );
    }

});

testRunner.addSuite("SyncPauseService — resumeCloudUpload (device-local pause)", {

    "clears the pause flag"() {
        setPauseFlag();
        resumeCloudUpload();
        testRunner.assertEquals(isSyncPaused(), false,
            'Flag must be cleared after resume');
    },

    "removes the localStorage key entirely"() {
        setPauseFlag();
        resumeCloudUpload();
        testRunner.assertEquals(localStorage.getItem(_PAUSE_LS_KEY), null,
            'After resume the device-local pause key must be removed');
    },

    "isSyncPaused() returns false after resumeCloudUpload()"() {
        setPauseFlag();
        resumeCloudUpload();
        testRunner.assertEquals(isSyncPaused(), false);
    },

    "resumeCloudUpload() is safe to call when not paused"() {
        clearPauseFlag();
        let threw = false;
        try { resumeCloudUpload(); } catch (_) { threw = true; }
        testRunner.assertEquals(threw, false);
        testRunner.assertEquals(isSyncPaused(), false);
    }

});

testRunner.addSuite("SyncPauseService — PersistenceService integration (source check)", {

    "PersistenceService gates Firebase sync via isSyncPaused()"() {
        testRunner.assert(
            /isSyncPaused\(\)/.test(PERSISTENCE_SRC),
            'PersistenceService must call isSyncPaused() to gate the Firebase sync block'
        );
    },

    "PersistenceService does NOT read the pause flag from synced state.settings"() {
        testRunner.assert(
            !/state\.settings\??\.cloudUploadPaused/.test(PERSISTENCE_SRC),
            'PersistenceService must not read the pause flag from state.settings (device-local now)'
        );
    }

});

// ─────────────────────────────────────────────────────────────
// ✅ Kill-switch reactivado (2026-06-06).
// Precondiciones satisfechas: Phase 1 (errores visibles), Phase 2
// (queues persistidos), Schema v3 posiciones cableadas.
// Estos tests verifican que la pausa está ACTIVA y que todos los
// puntos de integración respetan SYNC_PAUSE_ENABLED.
// ─────────────────────────────────────────────────────────────
testRunner.addSuite("SyncPauseService — kill-switch (Schema v3 verificado)", {

    "SYNC_PAUSE_ENABLED está activo (true)"() {
        testRunner.assertEquals(SYNC_PAUSE_ENABLED, true,
            'El sistema de pausa debe estar activo — precondiciones Schema v3 satisfechas');
    },

    "el gate de Firebase en PersistenceService respeta SYNC_PAUSE_ENABLED"() {
        testRunner.assert(
            /SYNC_PAUSE_ENABLED/.test(PERSISTENCE_SRC),
            'El gate de subida debe consultar SYNC_PAUSE_ENABLED para poder desactivar la pausa'
        );
    },

    "el badge (getUploadPaused) en app.js respeta SYNC_PAUSE_ENABLED"() {
        testRunner.assert(
            /SYNC_PAUSE_ENABLED/.test(APP_SRC),
            'app.js debe consultar SYNC_PAUSE_ENABLED para que el badge muestre pausa cuando está activo'
        );
    }

});

console.log('🧪 SyncPause tests cargados.');
