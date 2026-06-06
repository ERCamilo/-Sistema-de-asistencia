/**
 * 🧪 LastCloudSavedAtTests (Task #5)
 *
 * Verifies that when SyncStatus.markSynced() fires after a successful
 * cloud write, the timestamp is persisted to state.settings.lastCloudSavedAt
 * so it survives a page reload (it's in IndexedDB via the normal save cycle).
 *
 * Contract:
 *   1. initSyncPersistence() + markSynced(ts) → state.settings.lastCloudSavedAt === ts.
 *   2. Multiple calls → the latest ts wins.
 *   3. SyncStatus.reset() does NOT erase lastCloudSavedAt.
 *   4. initSyncPersistence() is idempotent: calling it twice doesn't
 *      double-fire updates.
 */

import { initSyncPersistence, warmUpSyncStatus } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import { SyncStatus } from '../modules/services/SyncStatus.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function setup() {
    if (!state.settings) state.settings = {};
    delete state.settings.lastCloudSavedAt;
    SyncStatus.reset();
    initSyncPersistence();
}

// ─────────────────────────────────────────────────────────────

testRunner.addSuite("LastCloudSavedAt — wiring via initSyncPersistence (Task #5)", {

    "markSynced() populates state.settings.lastCloudSavedAt"() {
        setup();
        const before = Date.now();
        SyncStatus.markSynced();
        const after = Date.now();

        const saved = state.settings?.lastCloudSavedAt;
        testRunner.assert(typeof saved === 'number', 'lastCloudSavedAt must be a number');
        testRunner.assert(saved >= before && saved <= after,
            `lastCloudSavedAt (${saved}) should be between ${before} and ${after}`);
    },

    "markSynced(explicitTs) stores the explicit timestamp"() {
        setup();
        SyncStatus.markSynced(1234567890123);
        testRunner.assertEquals(state.settings.lastCloudSavedAt, 1234567890123);
    },

    "second markSynced overrides with the newer timestamp"() {
        setup();
        SyncStatus.markSynced(1000);
        SyncStatus.markSynced(2000);
        testRunner.assertEquals(state.settings.lastCloudSavedAt, 2000);
    },

    "SyncStatus.reset() does NOT clear lastCloudSavedAt"() {
        setup();
        SyncStatus.markSynced(9999);
        SyncStatus.reset();
        // reset() fires null to subscribers — we intentionally keep the last
        // value so the user sees "last sync was at..." even after logout.
        testRunner.assertEquals(state.settings.lastCloudSavedAt, 9999,
            'lastCloudSavedAt must be preserved after SyncStatus.reset()');
    }

});

testRunner.addSuite("LastCloudSavedAt — idempotence of initSyncPersistence (Task #5)", {

    "calling initSyncPersistence() twice still sets the correct value"() {
        if (!state.settings) state.settings = {};
        delete state.settings.lastCloudSavedAt;
        SyncStatus.reset();

        initSyncPersistence();
        initSyncPersistence(); // second call should replace, not add, the listener

        SyncStatus.markSynced(42);

        // The value must be correct (42), not wrong due to a doubled listener.
        testRunner.assertEquals(state.settings.lastCloudSavedAt, 42);
    }

});

testRunner.addSuite("LastCloudSavedAt — warmUpSyncStatus on reload (Task #5)", {

    "warmUpSyncStatus with a saved ts pre-loads SyncStatus so badge is correct from frame 1"() {
        SyncStatus.reset();
        if (!state.settings) state.settings = {};
        state.settings.lastCloudSavedAt = 8888888;

        warmUpSyncStatus(state.settings);

        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), 8888888,
            'SyncStatus should be pre-loaded with the persisted timestamp');
    },

    "warmUpSyncStatus with no saved ts leaves SyncStatus as null (first-run)"() {
        SyncStatus.reset();
        if (!state.settings) state.settings = {};
        delete state.settings.lastCloudSavedAt;

        warmUpSyncStatus(state.settings);

        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), null,
            'SyncStatus should stay null when no persisted timestamp exists');
    },

    "warmUpSyncStatus with invalid value is a no-op"() {
        SyncStatus.reset();
        warmUpSyncStatus({ lastCloudSavedAt: 'bad' });
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), null);
        warmUpSyncStatus(null);
        testRunner.assertEquals(SyncStatus.getLastSyncedAt(), null);
    }

});

console.log('🧪 LastCloudSavedAt tests cargados.');
