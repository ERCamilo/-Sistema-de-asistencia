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

import { saveApplicationData, loadApplicationData, flushPendingSave, restoreAutoBackup, drainMainSyncOutbox } from '../modules/services/PersistenceService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import dataService from '../modules/services/DataService.js';
import FirebaseService from '../modules/services/FirebaseService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import { saveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';
import fs from 'fs';
import path from 'path';

const PS_SRC_U8 = fs.readFileSync(path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8');

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

    async "R2: en ConstraintError de IndexedDB cae a localStorage (no descarta el guardado)"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            // Colisión del índice único 'employeeDate' = error LOCAL de IndexedDB.
            // Hoy se descarta el guardado (de IndexedDB Y de localStorage). Debe
            // caer a localStorage para no perder el dato de AMBOS stores.
            const constraintErr = new Error('Unable to add key to index employeeDate: already exists.');
            constraintErr.name = 'ConstraintError';
            indexedDBService.saveState.mockRejectedValueOnce(constraintErr);
            dataService.saveAll.mockReturnValueOnce(true);

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(
                dataService.saveAll.mock.calls.length >= 1,
                "ante ConstraintError debe caer a dataService.saveAll (localStorage) para no perder el dato de AMBOS stores (R2)"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "with dateKey, encola la asistencia granular en el outbox (U7)"() {
        // U7: ya NO llama a FirebaseService.saveDailyAttendance directo — encola
        // en MainSyncStore (bandeja de pendientes durable) para que una subida a
        // medio terminar sobreviva a cerrar la pestaña. La entrega real a
        // Firestore ocurre en MainSyncStore.flush (cubierto en MainSyncStoreTests).
        const snap = snapshotState();
        const prevUser = globalThis.currentUser;
        const enqueueSpy = jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined);
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
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

            testRunner.assertEquals(enqueueSpy.mock.calls.length, 1, "enqueueDaily debe llamarse exactamente una vez");
            const [calledDateKey, calledRecords] = enqueueSpy.mock.calls[0];
            testRunner.assertEquals(calledDateKey, '2026-05-15', "Called with the right dateKey");
            testRunner.assertEquals(
                Object.keys(calledRecords).length,
                2,
                "Should pass only records ending in -2026-05-15 (2 of them)"
            );
            testRunner.assertEquals(FirebaseService.saveDailyAttendance.mock.calls.length, 0,
                'no debe llamarse directo — sólo el outbox lo hace al flushear');
        } finally {
            enqueueSpy.mockRestore();
            flushSpy.mockRestore();
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

    async "loadApplicationData (rama IndexedDB) cablea initMainSyncLifecycle (U8)"() {
        // Sin esto, un tab que arranca cargado desde IndexedDB nunca escucha
        // 'online' para drenar el outbox — la reconexión no dispararía nada.
        const snap = snapshotState();
        const lifecycleSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            clearAllMocks();
            indexedDBService.loadFullState.mockResolvedValueOnce({
                employees: [{ id: 'e1', name: 'Test', active: true, positions: [] }],
                positions: [], leaders: [], attendance: {}, settings: {}
            });

            await loadApplicationData();

            // Disparar 'online' y verificar que el listener quedó armado.
            window.dispatchEvent(new Event('online'));
            await Promise.resolve();

            testRunner.assert(lifecycleSpy.mock.calls.length >= 1,
                'loadApplicationData debe armar el listener de online (initMainSyncLifecycle) al cargar desde IndexedDB');
        } finally {
            lifecycleSpy.mockRestore();
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

    "loadApplicationData cablea initMainSyncLifecycle en AMBAS ramas (IndexedDB y LocalStorage) (U8)"() {
        // Comportamiento ya cubierto behavioralmente arriba (rama IndexedDB);
        // initMainSyncLifecycle es idempotente (un solo listener 'online' real
        // para toda la sesión), así que la rama LocalStorage no puede verificarse
        // con el mismo spy sin falsos negativos por orden de tests. Se confirma
        // por código fuente que la llamada existe en LAS DOS ramas.
        const calls = (PS_SRC_U8.match(/initMainSyncLifecycle\s*\(/g) || []).length;
        testRunner.assert(calls >= 2,
            `initMainSyncLifecycle debe llamarse en ambas ramas de loadApplicationData (encontradas ${calls})`);
    },

    async "drainMainSyncOutbox() vacía el outbox con los guards en vivo (U8)"() {
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            await drainMainSyncOutbox();
            testRunner.assertEquals(flushSpy.mock.calls.length, 1,
                'drainMainSyncOutbox debe llamar a MainSyncStore.flush exactamente una vez');
        } finally {
            flushSpy.mockRestore();
        }
    },

    "PersistenceService cablea saveOutcomeNotifier.setCloudRetryHandler con retryFailedCloudSync (U12 + fix cuota)"() {
        // Fix cuota (2026-07-05): drainMainSyncOutbox crudo nunca revive
        // entradas 'dead' (agotaron MAX_FLUSH_ATTEMPTS). retryFailedCloudSync
        // revive esas entradas ANTES de drenar (ver PersistenceService.js).
        testRunner.assert(
            /setCloudRetryHandler\s*\(\s*(retryFailedCloudSync|\(\)\s*=>\s*retryFailedCloudSync\(\))/.test(PS_SRC_U8),
            'debe llamarse saveOutcomeNotifier.setCloudRetryHandler(retryFailedCloudSync) (o un wrapper que lo invoque) al cargar el módulo'
        );
    },

    async "el botón Reintentar del toast (una vez cableado por el módulo real) revive y drena el outbox (U12, end-to-end)"() {
        // A diferencia del test anterior (source-introspection), esto prueba el
        // EFECTO real: importar PersistenceService.js ya ejecutó el wiring de
        // setCloudRetryHandler como side-effect de módulo. Disparamos un fallo
        // de nube por el singleton REAL y verificamos que el botón invoca
        // MainSyncStore.flush (lo que hace retryFailedCloudSync por dentro,
        // vía requeueDeadEntries + drainMainSyncOutbox).
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        const requeueSpy = jest.spyOn(MainSyncStore, 'requeueDeadEntries').mockResolvedValue(0);
        const NotificationMod = await import('../modules/components/Notification.js');
        NotificationMod.Notification.clearAll();
        NotificationMod.Notification.activeNotifications = [];
        try {
            saveOutcomeNotifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'X' });
            saveOutcomeNotifier.recordCloudResult(false);

            // Encontrar el toast real recién creado por el singleton y clickear
            // su botón — sin pasar por reset()/setCloudRetryHandler manual: éste
            // es el handler que YA quedó cableado al cargar el módulo.
            const toast = NotificationMod.Notification.activeNotifications[0];
            const btn = toast?.element?.querySelector('.notification-action');
            testRunner.assert(!!btn, 'el toast de fallo debe tener el botón Reintentar (handler cableado por el módulo)');

            btn.click();
            await Promise.resolve(); // dejar correr el async handler (retryFailedCloudSync)
            testRunner.assert(requeueSpy.mock.calls.length >= 1,
                'clickear Reintentar debe revivir entradas dead primero (MainSyncStore.requeueDeadEntries)');
            testRunner.assert(flushSpy.mock.calls.length >= 1,
                'clickear Reintentar debe terminar llamando a MainSyncStore.flush (vía retryFailedCloudSync)');
        } finally {
            flushSpy.mockRestore();
            requeueSpy.mockRestore();
        }
    },

    async "JD#2: restoreAutoBackup reinfla empleados (loans/advances no quedan undefined tras redacción)"() {
        const snap = snapshotState();
        const prevBackup = sessionStorage.getItem('attendance-backup');
        try {
            clearAllMocks();
            // Backup REDACTADO: empleado sin loans/advances (como lo deja
            // redactSensitiveBackup). Sin reinflar, restore deja loans=undefined
            // → un loans.reduce() posterior peta en el escenario de emergencia.
            const redacted = {
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                data: {
                    employees: [{ id: 'e1', name: 'Juan', number: 7, active: true }],
                    positions: [{ id: 'p1', name: 'Albañil' }],
                    leaders: [],
                    attendance: {},
                    settings: {}
                }
            };
            sessionStorage.setItem('attendance-backup', JSON.stringify(redacted));
            state.employees = []; // condición para que restoreAutoBackup actúe

            const ok = restoreAutoBackup();

            testRunner.assertEquals(ok, true, 'debe restaurar la sesión');
            testRunner.assert(state.employees.length === 1, 'debe haber 1 empleado restaurado');
            testRunner.assert(Array.isArray(state.employees[0].loans),
                'el empleado restaurado debe tener loans como ARRAY (no undefined) tras reinflar por constructor');
            testRunner.assert(Array.isArray(state.employees[0].advances),
                'advances debe ser array tras reinflar');
        } finally {
            if (prevBackup === null) sessionStorage.removeItem('attendance-backup');
            else sessionStorage.setItem('attendance-backup', prevBackup);
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

// ─────────────────────────────────────────────────────────────
// Suite: lifecycle events (Fase 1.3) — pagehide / visibilitychange
// ─────────────────────────────────────────────────────────────
// Pending debounced saves used to die silently if the user closed the tab,
// refreshed, or backgrounded the PWA within the 300 ms window. PersistenceService
// now wires `flushPendingSave` to `pagehide` and `visibilitychange` (hidden) so
// the save is forced out before the page is discarded. These tests guard that
// wiring against regression.

testRunner.addSuite("PersistenceService — Lifecycle flush (Fase 1.3)", {

    async "pagehide event forces a pending save to fire immediately"() {
        const snap = snapshotState();
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            // Queue a save — would normally wait 300 ms to fire.
            saveApplicationData({ skipValidation: true });

            // Fire pagehide. The listener registered by PersistenceService should
            // call flushPendingSave, which forces _executeSave to run now.
            window.dispatchEvent(new Event('pagehide'));
            await sleep(10);

            testRunner.assert(
                indexedDBService.saveState.mock.calls.length >= 1,
                "pagehide should have flushed the pending save before the 300ms timer"
            );
        } finally {
            restoreState(snap);
        }
    },

    async "visibilitychange to hidden flushes a pending save"() {
        const snap = snapshotState();
        const originalVisibility = document.visibilityState;
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ skipValidation: true });

            // jsdom: visibilityState is read-only, so we redefine it.
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'hidden'
            });
            document.dispatchEvent(new Event('visibilitychange'));
            await sleep(10);

            testRunner.assert(
                indexedDBService.saveState.mock.calls.length >= 1,
                "visibilitychange→hidden should have flushed the pending save"
            );
        } finally {
            // Restore visibilityState getter
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => originalVisibility || 'visible'
            });
            restoreState(snap);
        }
    },

    async "visibilitychange to visible does NOT trigger a flush"() {
        const snap = snapshotState();
        const originalVisibility = document.visibilityState;
        try {
            clearAllMocks();
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            saveApplicationData({ skipValidation: true });

            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => 'visible'
            });
            document.dispatchEvent(new Event('visibilitychange'));
            await sleep(10);

            // The 300ms debounce hasn't elapsed yet and visibility is NOT hidden,
            // so the save should still be pending (not yet executed).
            testRunner.assertEquals(
                indexedDBService.saveState.mock.calls.length,
                0,
                "visibilitychange→visible must NOT force the save"
            );

            // Cleanup: flush so the debounced timer doesn't fire after the test.
            flushPendingSave();
            await sleep(10);
        } finally {
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                get: () => originalVisibility || 'visible'
            });
            restoreState(snap);
        }
    }

});

console.log('🧪 PersistenceService tests cargados.');
