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
    },

    async "el snapshot pasado a enqueueMirror es un clon, no la referencia viva de state (Judgment Day #6)"() {
        // enqueueMirror es async (await _getAll() antes de escribir a IndexedDB)
        // — si se le pasa la referencia VIVA de stateManager.getState(), una
        // mutación de state que ocurra en ese hueco (otro guardado, otra
        // acción del usuario) podría filtrarse en lo que termina subiendo a
        // la nube, mezclando datos de dos momentos distintos. El comentario
        // en el call site decía "foto INMUTABLE" pero era sólo una referencia
        // raw (sin proxy), no un clon — este test exige que sea de verdad
        // inmutable ante mutaciones posteriores.
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            state.employees = [{ id: 'e1', name: 'Original' }];

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(spies.enqueueMirror.mock.calls.length >= 1, 'debe haber encolado el mirror');
            const passedSnapshot = spies.enqueueMirror.mock.calls[0][0];

            // Mutar state DESPUÉS de que ya se llamó a enqueueMirror.
            state.employees[0].name = 'MUTADO';

            testRunner.assertEquals(passedSnapshot.employees[0].name, 'Original',
                'el snapshot ya encolado no debe reflejar mutaciones posteriores de state — debe ser un clon, no una referencia viva');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "un error al clonar el snapshot (valor no serializable) NO debe abortar el guardado LOCAL (Judgment Day ronda 2, Juez A)"() {
        // El fix de JD#6 agregó JSON.parse(JSON.stringify(...)) en el call site,
        // SIN try/catch, dentro de _executeSave — que se invoca fire-and-forget
        // (sin .catch()) desde el debounce y desde flushPendingSave. Si state
        // tiene algo no serializable (p.ej. un BigInt — una referencia circular
        // no puede sobrevivir a toRaw(), que ya la rechaza al asignarla), el
        // throw síncrono de JSON.stringify aborta TODO el resto de _executeSave,
        // incluido el guardado LOCAL (que va MÁS ABAJO en la función) —
        // exactamente el escenario de pérdida de datos que esta feature entera
        // existe para evitar.
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);
            indexedDBService.saveState.mockClear();

            state.employees = [{ id: 'e1', weirdValue: 10n }];

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1,
                'el guardado LOCAL debe seguir ocurriendo aunque el clon del snapshot para la nube falle');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "los registros pasados a enqueueDaily son un clon, no una referencia viva de state.attendance (Judgment Day ronda 2, Juez A)"() {
        // Mismo hueco async que JD#6 cerró para el mirror (enqueueDaily también
        // hace await _getAll() antes de escribir a IndexedDB) pero no se había
        // aplicado a la ruta 'daily' — dayRecords[key] = record guardaba la
        // referencia PROXY (viva) de state.attendance[key], no una copia.
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01', present: true, hoursWorked: 8 }
            };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            saveApplicationData({ dateKey: '2026-07-01' });
            await waitForSave();

            testRunner.assert(spies.enqueueDaily.mock.calls.length >= 1, 'debe haber encolado la asistencia diaria');
            const passedRecords = spies.enqueueDaily.mock.calls[0][1];

            // Mutar state DESPUÉS de que ya se llamó a enqueueDaily.
            state.attendance['emp1-2026-07-01'].hoursWorked = 999;

            testRunner.assertEquals(passedRecords['emp1-2026-07-01'].hoursWorked, 8,
                'los registros ya encolados no deben reflejar mutaciones posteriores de state.attendance — deben ser un clon, no una referencia viva');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    }

});
