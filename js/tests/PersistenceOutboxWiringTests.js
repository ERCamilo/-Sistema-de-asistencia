/**
 * 🧪 PersistenceOutboxWiringTests (U7)
 *
 * _executeSave ya NO llama directo a FirebaseService.saveFullState/
 * saveDailyAttendance — encola en MainSyncStore (bandeja de pendientes
 * durable) y dispara un flush. Así, si la pestaña se cierra antes de que la
 * subida termine, la entrada sigue en IndexedDB y se reintenta sola al
 * reconectar/volver a entrar (MainSyncStore ya cubre eso, U1-U6).
 *
 * Behavioral: MainSyncStore es REAL (no está en el mapa de mocks de Jest) —
 * espiamos sus métodos con jest.spyOn para verificar el cableado sin
 * depender de regex frágiles sobre el código fuente.
 */

import { saveApplicationData } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import FirebaseService from '../modules/services/FirebaseService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, isDataLoaded: state.isDataLoaded,
        useIndexedDB: state.useIndexedDB, settings: state.settings
    }));
}
function restoreState(snap) {
    state.employees = snap.employees; state.positions = snap.positions; state.leaders = snap.leaders;
    state.attendance = snap.attendance; state.isDataLoaded = snap.isDataLoaded;
    state.useIndexedDB = snap.useIndexedDB; state.settings = snap.settings;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForSave() { await sleep(400); }

function spyMainSyncStore() {
    return {
        enqueueMirror: jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined),
        enqueueDaily: jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined),
        flush: jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined)
    };
}

testRunner.addSuite("PersistenceService — outbox es el único camino a la nube (U7)", {

    async "_executeSave encola el mirror (no llama FirebaseService.saveFullState directo)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);
            FirebaseService.saveFullState.mockClear();

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(spies.enqueueMirror.mock.calls.length >= 1, 'debe encolar el mirror vía MainSyncStore.enqueueMirror');
            testRunner.assertEquals(FirebaseService.saveFullState.mock.calls.length, 0,
                '_executeSave NO debe llamar a FirebaseService.saveFullState directo — sólo el outbox lo hace al flushear');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "_executeSave encola la asistencia diaria (no llama saveDailyAttendance directo)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01', present: true },
                'emp2-2026-07-01': { employeeId: 'emp2', date: '2026-07-01', present: true },
                'emp1-2026-06-30': { employeeId: 'emp1', date: '2026-06-30', present: false }
            };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);
            FirebaseService.saveDailyAttendance.mockClear();

            saveApplicationData({ dateKey: '2026-07-01' });
            await waitForSave();

            testRunner.assertEquals(spies.enqueueDaily.mock.calls.length, 1, 'debe encolar exactamente una vez');
            testRunner.assertEquals(spies.enqueueDaily.mock.calls[0][0], '2026-07-01');
            testRunner.assertEquals(Object.keys(spies.enqueueDaily.mock.calls[0][1]).length, 2,
                'sólo los registros que terminan en -2026-07-01 (2 de ellos)');
            testRunner.assertEquals(FirebaseService.saveDailyAttendance.mock.calls.length, 0,
                '_executeSave NO debe llamar a FirebaseService.saveDailyAttendance directo');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "_executeSave dispara MainSyncStore.flush tras encolar"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(spies.flush.mock.calls.length >= 1, 'debe disparar flush() para que el drenado ocurra ya, no sólo en el próximo online/login');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "sin sesión, _executeSave NO encola nada al outbox (guardado local-only)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = null; // sin sesión

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assertEquals(spies.enqueueMirror.mock.calls.length, 0, 'sin sesión no hay nada que subir a la nube');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            restoreState(snap);
        }
    }

});
