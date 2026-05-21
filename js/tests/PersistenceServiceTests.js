/**
 * 🧪 PersistenceServiceTests — Tests for the persistence orchestrator
 *
 * Covers:
 *   - saveApplicationData() debounces multiple rapid calls into one save
 *   - saveApplicationData() respects isDataLoaded gate
 *   - saveApplicationData() with dateKey triggers granular Firebase sync
 *   - saveApplicationData() persists to IndexedDB when useIndexedDB is true
 *   - saveApplicationData() falls back to localStorage when IndexedDB is off
 *   - loadApplicationData() prefers IndexedDB when it has data
 *   - loadApplicationData() falls back to LocalStorage when IndexedDB is empty
 *   - loadApplicationData() returns false when no data anywhere
 *   - loadApplicationData() always sets state.isDataLoaded = true
 */

import { saveApplicationData, loadApplicationData, flushPendingSave } from '../modules/services/PersistenceService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import dataService from '../modules/services/DataService.js';
import FirebaseService from '../modules/services/FirebaseService.js';

// ─────────────────────────────────────────────────────────────
// Helpers — snapshot & restore state between tests
// ─────────────────────────────────────────────────────────────

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees,
        positions: state.positions,
        leaders: state.leaders,
        attendance: state.attendance,
        isDataLoaded: state.isDataLoaded,
        useIndexedDB: state.useIndexedDB,
        settings: state.settings
    }));
}

function restoreState(snap) {
    state.employees = snap.employees;
    state.positions = snap.positions;
    state.leaders = snap.leaders;
    state.attendance = snap.attendance;
    state.isDataLoaded = snap.isDataLoaded;
    state.useIndexedDB = snap.useIndexedDB;
    state.settings = snap.settings;
}

function clearAllMocks() {
    indexedDBService.saveState.mockClear();
    indexedDBService.loadFullState.mockClear();
    indexedDBService.isSupported.mockClear();
    dataService.saveAll.mockClear();
    dataService.loadAll.mockClear();
    FirebaseService.saveFullState.mockClear();
    FirebaseService.saveDailyAttendance.mockClear();
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Wait for the 300ms debounce in saveApplicationData to fire, plus margin
async function waitForSave() {
    await sleep(400);
}

// ─────────────────────────────────────────────────────────────
// Suite: saveApplicationData
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("PersistenceService — saveApplicationData", {

    async "debounces multiple rapid calls into a single save"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            // Fire 5 rapid saves
            saveApplicationData();
            saveApplicationData();
            saveApplicationData();
            saveApplicationData();
            saveApplicationData();

            // Still within debounce window — should not have saved yet
            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                0,
                "Save should not have executed during debounce window"
            );

            await waitForSave();

            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                1,
                "5 rapid calls should collapse into 1 save"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "skips save when isDataLoaded is false"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = false;
            state.useIndexedDB = true;

            saveApplicationData();
            await waitForSave();

            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                0,
                "Save should be skipped when data is not yet loaded"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "persists to IndexedDB when useIndexedDB is true"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(
                indexedDBService.saveState.mock.calls.length >= 1,
                "indexedDBService.saveState should have been called"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "falls back to localStorage when useIndexedDB is false"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = false;

            saveApplicationData();
            await waitForSave();

            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                0,
                "IndexedDB should NOT be called when useIndexedDB is false"
            );
            testRunner.assert(
                dataService.saveAll.mock.calls.length >= 1,
                "dataService.saveAll (localStorage) should have been called as fallback"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "with dateKey, triggers granular Firebase sync"() {
        const snap = snapshotState();
        const prevUser = globalThis.currentUser;
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1-2026-05-15': { employeeId: 'emp1', date: '2026-05-15', present: true },
                'emp2-2026-05-15': { employeeId: 'emp2', date: '2026-05-15', present: true },
                'emp1-2026-05-16': { employeeId: 'emp1', date: '2026-05-16', present: false }
            };
            globalThis.currentUser = { uid: 'test-user' };

            saveApplicationData({ dateKey: '2026-05-15' });
            await waitForSave();

            testRunner.assertEquals(
                FirebaseService.saveDailyAttendance.mock.calls.length,
                1,
                "saveDailyAttendance should be called exactly once"
            );
            const [calledDateKey, calledRecords] = FirebaseService.saveDailyAttendance.mock.calls[0];
            testRunner.assertEquals(calledDateKey, '2026-05-15', "Called with the right dateKey");
            testRunner.assertEquals(
                Object.keys(calledRecords).length,
                2,
                "Should pass only records ending in -2026-05-15 (2 of them)"
            );
        } finally {
            globalThis.currentUser = prevUser;
            restoreState(snap);
        }
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: loadApplicationData
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("PersistenceService — loadApplicationData", {

    async "loads from IndexedDB when it has data"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            indexedDBService.loadFullState.mockResolvedValueOnce({
                employees: [{ id: 'e1', name: 'Test Employee', active: true, positions: [] }],
                positions: [{ id: 'p1', name: 'Pos1', active: true }],
                leaders: [],
                attendance: {},
                settings: {}
            });

            const result = await loadApplicationData();

            testRunner.assertEquals(result, true, "Should return true when data loaded");
            testRunner.assert(state.isDataLoaded, "state.isDataLoaded should be true");
            testRunner.assertEquals(state.useIndexedDB, true, "state.useIndexedDB should be true");
            testRunner.assert(state.employees.length >= 1, "Employees should be populated");
            testRunner.assertEquals(state.employees[0].id, 'e1', "Employee ID should match");
        } finally {
            restoreState(snap);
        }
    },

    async "falls back to LocalStorage when IndexedDB is empty"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            indexedDBService.loadFullState.mockResolvedValueOnce(null);
            dataService.loadAll.mockReturnValueOnce(true);

            const result = await loadApplicationData();

            testRunner.assertEquals(result, true, "Should return true when LocalStorage has data");
            testRunner.assert(
                dataService.loadAll.mock.calls.length >= 1,
                "dataService.loadAll should have been called"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "returns false when no data anywhere"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            indexedDBService.loadFullState.mockResolvedValueOnce(null);
            dataService.loadAll.mockReturnValueOnce(false);

            const result = await loadApplicationData();

            testRunner.assertEquals(result, false, "Should return false when no data exists");
            testRunner.assert(state.isDataLoaded, "isDataLoaded should still be true (don't block UI)");
        } finally {
            restoreState(snap);
        }
    },

    async "always sets state.isDataLoaded = true, even on error"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = false;
            indexedDBService.loadFullState.mockRejectedValueOnce(new Error('boom'));

            const result = await loadApplicationData();

            testRunner.assertEquals(result, false, "Should return false on error");
            testRunner.assert(
                state.isDataLoaded,
                "isDataLoaded must be true even after error (so UI is not blocked)"
            );
        } finally {
            restoreState(snap);
        }
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: immediate-save mode (bypass debounce on critical writes)
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("PersistenceService — immediate save", {

    async "immediate: true bypasses the 300ms debounce"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ immediate: true, skipValidation: true });

            // Should have fired synchronously (or within a microtask) — no waiting.
            // We give one tick for the async chain inside _executeSave.
            await sleep(10);

            testRunner.assert(
                indexedDBService.saveState.mock.calls.length >= 1,
                "Immediate save should have called IndexedDB without waiting for debounce"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "immediate: true cancels a pending debounced save (no duplicate writes)"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ skipValidation: true });   // debounced
            saveApplicationData({ immediate: true, skipValidation: true });

            await waitForSave();

            // Exactly one save should have fired (the immediate one), not two.
            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                1,
                "Pending debounced save should have been canceled by the immediate save"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "flushPendingSave forces a pending debounced save to fire now"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ skipValidation: true });
            // Immediately flush — should fire before the 300ms timer would have.
            const flushed = flushPendingSave();
            await sleep(10);

            testRunner.assertEquals(flushed, true, "flushPendingSave returns true when something was pending");
            testRunner.assert(
                indexedDBService.saveState.mock.calls.length >= 1,
                "Flush should have triggered the save synchronously"
            );
        } finally {
            restoreState(snap);
        }
    },

    "flushPendingSave returns false when nothing is pending"() {
        // No pending save — must not throw and must return false.
        const result = flushPendingSave();
        testRunner.assertEquals(result, false, "Returns false when nothing to flush");
    }
});

console.log('🧪 PersistenceService tests cargados.');
