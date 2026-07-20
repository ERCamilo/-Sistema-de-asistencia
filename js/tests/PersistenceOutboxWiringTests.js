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

import {
    saveApplicationData,
    drainMainSyncOutbox,
    retryFailedCloudSync,
    syncFirebaseMirrorDebounced
} from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import FirebaseService from '../modules/services/FirebaseService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { saveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';

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
    syncFirebaseMirrorDebounced.discard();
    return {
        enqueueMirror: jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined),
        enqueueDaily: jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined),
        enqueueEntities: jest.spyOn(MainSyncStore, 'enqueueEntities').mockResolvedValue(undefined),
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A Ronda 2: el purge multi-fecha hacía N
    // saveApplicationData({dateKey, immediate:true}) → N _executeSave → N
    // enqueueMirror completos (write amplification). Con dateKeys (array), un
    // solo _executeSave encola un daily por fecha y UN solo mirror/entities.
    async "_executeSave con dateKeys encola un daily por fecha y UN solo mirror (no amplifica)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01' },
                'emp1-2026-06-30': { employeeId: 'emp1', date: '2026-06-30' },
                'emp1-2026-06-29': { employeeId: 'emp1', date: '2026-06-29' }
            };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            await saveApplicationData({ dateKeys: ['2026-07-01', '2026-06-30', '2026-06-29'], immediate: true });
            await waitForSave();

            testRunner.assertEquals(spies.enqueueDaily.mock.calls.length, 3,
                'un enqueueDaily por fecha (3), sin colapso de debounce');
            const dates = spies.enqueueDaily.mock.calls.map(c => c[0]).sort();
            testRunner.assertEquals(dates.join(','), '2026-06-29,2026-06-30,2026-07-01');
            testRunner.assertEquals(spies.enqueueMirror.mock.calls.length, 1,
                'UN solo mirror para todo el lote (no N — sin amplificación de escritura)');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A Ronda 3 (Juez A): el guard "saltar validación
    // pesada en guardados granulares" solo miraba options.dateKey — un save
    // con dateKeys corría validateDataIntegrity completo en cada purge (puede
    // estampar/re-subir empleados no relacionados = costo de cuota).
    async "un save granular con dateKeys NO corre la validación de integridad completa"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        const prevEmployees = state.employees;
        const prevPositions = state.positions;
        const prevLeaders = state.leaders;
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.positions = [{ id: 'pos-viva', name: 'Válida' }];
            state.leaders = [];
            state.attendance = { 'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01' } };
            state.employees = [{ id: 'e1', name: 'Ana', updatedAt: 1000, positions: ['pos-viva', 'pos-huerfana'] }];
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            await saveApplicationData({ dateKeys: ['2026-07-01'], immediate: true });
            await waitForSave();

            const emp = state.employees.find(e => e.id === 'e1');
            testRunner.assertEquals(emp.positions.length, 2,
                'el save granular (dateKeys) no debe correr validateDataIntegrity — el huérfano queda para el próximo save completo');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            state.employees = prevEmployees;
            state.positions = prevPositions;
            state.leaders = prevLeaders;
            restoreState(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A Ronda 4 (ambos jueces): la reescritura del
    // accumulate (para unir dateKeys) pisaba el `announce` pegajoso. Si una
    // llamada previa de la misma ventana pidió anunciar y la siguiente no,
    // el label se perdía → _executeSave no reportaba el resultado local → el
    // toast "Guardando…" quedaba colgado hasta el failsafe de 12s (que puede
    // mostrar un estado FALSO). announce debe sobrevivir (los flags NO — eso
    // arrastraría clearFirst/immediate a un save de asistencia).
    async "el announce pegajoso sobrevive a una segunda llamada sin announce en la misma ventana"() {
        const snap = snapshotState();
        const startedSpy = jest.spyOn(saveOutcomeNotifier, 'recordSaveStarted').mockImplementation(() => {});
        const localSpy = jest.spyOn(saveOutcomeNotifier, 'recordLocalResult').mockImplementation(() => {});
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'u1' };
            globalThis._isApplyingRemoteData = false;
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            saveApplicationData({ dateKey: '2026-07-01', announce: 'Cambio con anuncio' }); // debounced, anuncia
            saveApplicationData({ dateKey: '2026-06-30' }); // sin announce, misma ventana
            await sleep(450);

            testRunner.assert(localSpy.mock.calls.length >= 1,
                'el resultado local debe reportarse — el announce de la 1ra llamada no debe perderse por la 2da');
            testRunner.assertEquals(localSpy.mock.calls[0][0].label, 'Cambio con anuncio',
                'conserva la etiqueta del announce original');
        } finally {
            startedSpy.mockRestore();
            localSpy.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A Ronda 3 (ambos jueces): la acumulación de
    // _pendingSaveOptions no conocía dateKeys. Un save inmediato con dateKeys
    // (purge de historial) dentro de la ventana de debounce PISABA el dateKey
    // pendiente y cancelaba su timer → esa fecha nunca se encolaba en 'daily',
    // y como el mirror excluye attendance, nada la reintentaba jamás.
    async "un save inmediato con dateKeys NO cancela la fecha debounced pendiente (une las fechas)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1-2026-07-01': { employeeId: 'emp1', date: '2026-07-01' },
                'emp1-2026-06-30': { employeeId: 'emp1', date: '2026-06-30' }
            };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            saveApplicationData({ dateKey: '2026-07-01' }); // debounced, queda pendiente
            await saveApplicationData({ dateKeys: ['2026-06-30'], immediate: true }); // pisa la ventana
            await waitForSave();

            const dates = spies.enqueueDaily.mock.calls.map(c => c[0]);
            testRunner.assert(dates.includes('2026-07-01'),
                'la fecha debounced pendiente NO debe perderse cuando un save inmediato con dateKeys la pisa');
            testRunner.assert(dates.includes('2026-06-30'),
                'la fecha del save inmediato también debe subir');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // 🐛 Judgment Day Fase 2A Ronda 4 (Juez B): el filtro incremental de
    // IndexedDBService.saveState acepta sufijos con guion (-) y guion bajo (_),
    // pero el enqueue diario de _executeSave solo aceptaba guion → un registro
    // con clave de guion bajo se guardaba local pero NUNCA se encolaba a la
    // nube. Los dos filtros deben ser simétricos.
    async "_executeSave encola también la asistencia con sufijo de guion BAJO (simetría con saveState)"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.attendance = {
                'emp1_2026-07-01': { employeeId: 'emp1', date: '2026-07-01' }, // guion BAJO
                'emp2-2026-07-01': { employeeId: 'emp2', date: '2026-07-01' }  // guion normal
            };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);

            await saveApplicationData({ dateKey: '2026-07-01', immediate: true });
            await waitForSave();

            testRunner.assert(spies.enqueueDaily.mock.calls.length >= 1, 'debe encolar la fecha');
            const records = spies.enqueueDaily.mock.calls[0][1];
            const keys = Object.keys(records).sort();
            testRunner.assertEquals(keys.join(','), 'emp1_2026-07-01,emp2-2026-07-01',
                'ambos registros (guion y guion bajo) de la fecha deben encolarse a la nube');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    async "_executeSave encola las entidades (no llama FirebaseService.saveEntities directo) — Fase 2 U1"() {
        // Las entidades (empleados/puestos/líderes) viajan APARTE del mirror,
        // desacopladas de su gate de watermark (ver MainSyncStore.enqueueEntities).
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.employees = [{ id: 'e1', name: 'Ana' }];
            state.positions = [{ id: 'p1', name: 'Cajero' }];
            state.leaders = [{ id: 'l1', name: 'Jefe' }];
            state.settings = { ...state.settings, schemaVersion: 3 };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);
            FirebaseService.saveEntities.mockClear();

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(spies.enqueueEntities.mock.calls.length >= 1,
                'debe encolar las entidades vía MainSyncStore.enqueueEntities');
            const [empArg, posArg, leadArg, schemaArg] = spies.enqueueEntities.mock.calls[0];
            testRunner.assertEquals(empArg.length, 1, 'debe pasar los empleados actuales');
            testRunner.assertEquals(empArg[0].id, 'e1');
            testRunner.assertEquals(posArg[0].id, 'p1', 'debe pasar los puestos actuales');
            testRunner.assertEquals(leadArg[0].id, 'l1', 'debe pasar los líderes actuales');
            testRunner.assertEquals(schemaArg, 3, 'debe pasar el schemaVersion actual');
            testRunner.assertEquals(FirebaseService.saveEntities.mock.calls.length, 0,
                '_executeSave NO debe llamar a FirebaseService.saveEntities directo — sólo el outbox lo hace al flushear');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // Fase 2B U2: settings (preferencias del dispositivo) viaja por su propio
    // kind del outbox, DESACOPLADO del espejo — mismo espíritu que 'entities'
    // (Fase 2 U1). Unit 1 dejó MainSyncStore.enqueueSettings + el guard
    // saveSettings en _resolveCloudCall listos pero SIN productor real: nada
    // llamaba a enqueueSettings todavía.
    async "_executeSave encola los settings (no llama FirebaseService.saveSettings directo) — Fase 2B U2"() {
        const snap = snapshotState();
        const spies = spyMainSyncStore();
        const enqueueSettingsSpy = jest.spyOn(MainSyncStore, 'enqueueSettings').mockResolvedValue(undefined);
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            state.settings = { ...state.settings, theme: 'dark' };
            globalThis.currentUser = { uid: 'u1' };
            indexedDBService.getAll.mockReset().mockResolvedValue([]);
            indexedDBService.update.mockReset().mockResolvedValue(1);
            indexedDBService.delete.mockReset().mockResolvedValue(undefined);
            FirebaseService.saveSettings.mockClear();

            saveApplicationData({ skipValidation: true });
            await waitForSave();

            testRunner.assert(enqueueSettingsSpy.mock.calls.length >= 1,
                'debe encolar los settings vía MainSyncStore.enqueueSettings');
            testRunner.assertEquals(enqueueSettingsSpy.mock.calls[0][0].theme, 'dark',
                'debe pasar el mapa de settings actual');
            testRunner.assertEquals(FirebaseService.saveSettings.mock.calls.length, 0,
                '_executeSave NO debe llamar a FirebaseService.saveSettings directo — sólo el outbox lo hace al flushear');
        } finally {
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            enqueueSettingsSpy.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // Confirma que _resolveCloudCall's settings branch (agregada en Unit 1)
    // efectivamente SE ALCANZA ahora que _mainSyncGuards() expone el guard —
    // usa el flush REAL (como el test de saveMirror/skipEntities de abajo),
    // no un spy, para ejercitar el cableado de punta a punta.
    async "_mainSyncGuards().saveSettings llama a FirebaseService.saveSettings con el mapa encolado — Fase 2B U2"() {
        const prevApplyingRemote = globalThis._isApplyingRemoteData;
        globalThis.currentUser = { uid: 'u1' };
        globalThis._isApplyingRemoteData = false;
        const settingsMap = { theme: 'dark', localUpdatedAt: 123 };
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 1, kind: 'settings', settings: settingsMap, status: 'pending' }
        ]);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        FirebaseService.saveSettings.mockClear().mockResolvedValue(undefined);

        try {
            await drainMainSyncOutbox();

            testRunner.assertEquals(FirebaseService.saveSettings.mock.calls.length, 1,
                'debe llamar a FirebaseService.saveSettings exactamente una vez al drenar la entrada settings pendiente');
            testRunner.assertEquals(FirebaseService.saveSettings.mock.calls[0][0], settingsMap,
                'debe pasar el mapa de settings encolado');
        } finally {
            globalThis.currentUser = null;
            globalThis._isApplyingRemoteData = prevApplyingRemote;
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
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
            spies.enqueueMirror.mockRestore(); spies.enqueueDaily.mockRestore(); spies.enqueueEntities.mockRestore(); spies.flush.mockRestore();
            globalThis.currentUser = null;
            restoreState(snap);
        }
    },

    // Fase 2 U1 — fix de regresión: saveFullState volvió a escribir las
    // entidades ella misma (para los 5 llamadores DIRECTOS que la invocan
    // fuera del outbox). Pero el thunk 'mirror' del outbox (_mainSyncGuards().
    // saveMirror) NO debe pedirle eso — la entrada 'entities' (encolada aparte
    // en _executeSave, ver arriba) ya escribe las entidades por su cuenta; sin
    // {skipEntities:true} acá, cada guardado normal las subiría DOS veces.
    // A diferencia de los tests de arriba, este NO mockea MainSyncStore.flush:
    // usa el flush REAL para ejercitar de verdad el guard saveMirror interno.
    async "_mainSyncGuards().saveMirror pasa {skipEntities:true} a FirebaseService.saveFullState (Fase 2 U1, fix de regresión)"() {
        const prevCloudWatermark = state._lastKnownCloudUpdatedAt;
        const prevApplyingRemote = globalThis._isApplyingRemoteData;
        const snapshot = { employees: [{ id: 'e1' }], settings: { schemaVersion: 3, localUpdatedAt: 1 } };
        globalThis.currentUser = { uid: 'u1' };
        globalThis._isApplyingRemoteData = false;
        state._lastKnownCloudUpdatedAt = 0;
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 1, kind: 'mirror', snapshot, status: 'pending' }
        ]);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        FirebaseService.saveFullState.mockClear().mockResolvedValue(undefined);

        try {
            await drainMainSyncOutbox();

            testRunner.assertEquals(FirebaseService.saveFullState.mock.calls.length, 1,
                'debe llamar a saveFullState exactamente una vez al drenar la entrada mirror pendiente');
            testRunner.assertEquals(FirebaseService.saveFullState.mock.calls[0][0], snapshot,
                'debe pasar el snapshot encolado');
            const optsArg = FirebaseService.saveFullState.mock.calls[0][1];
            testRunner.assert(!!optsArg && optsArg.skipEntities === true,
                'saveMirror debe pasar {skipEntities:true} — la entrada "entities" (aparte) ya escribe per-entidad; sin esto se duplicaría el write');
        } finally {
            globalThis.currentUser = null;
            globalThis._isApplyingRemoteData = prevApplyingRemote;
            state._lastKnownCloudUpdatedAt = prevCloudWatermark;
        }
    }

});

// Fase 2 U4 — badge "pendiente de subir": cuando una entrada 'entities' del
// outbox se sube con éxito, onCloudResult debe estampar la marca de agua
// (EntitiesSyncStamp.recordEntitiesSyncOk con el ts del ENQUEUE de la
// entrada, no Date.now del flush). El ledger usa esa marca para saber qué
// préstamos tienen cambios sin confirmar en la nube.
testRunner.addSuite("PersistenceService — onCloudResult estampa la marca de entities subidas (Fase 2, U4)", {

    async "un flush exitoso de una entrada 'entities' registra su ts como última subida confirmada"() {
        const { clearEntitiesSyncStamp, getLastEntitiesSyncOk } = await import('../modules/services/EntitiesSyncStamp.js');
        const prevApplyingRemote = globalThis._isApplyingRemoteData;
        clearEntitiesSyncStamp();
        globalThis.currentUser = { uid: 'u1' };
        globalThis._isApplyingRemoteData = false;
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 1, kind: 'entities', employees: [{ id: 'e1' }], positions: [], leaders: [], schemaVersion: 3, ts: 777001, status: 'pending' }
        ]);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        FirebaseService.saveEntities.mockClear().mockResolvedValue(undefined);

        try {
            await drainMainSyncOutbox();
            testRunner.assertEquals(getLastEntitiesSyncOk(), 777001,
                'debe estamparse el ts del ENQUEUE de la entrada subida — todo lo editado después de ese momento sigue pendiente');
        } finally {
            clearEntitiesSyncStamp();
            globalThis.currentUser = null;
            globalThis._isApplyingRemoteData = prevApplyingRemote;
        }
    },

    async "un flush FALLIDO de 'entities' NO estampa la marca"() {
        const { clearEntitiesSyncStamp, getLastEntitiesSyncOk } = await import('../modules/services/EntitiesSyncStamp.js');
        const prevApplyingRemote = globalThis._isApplyingRemoteData;
        clearEntitiesSyncStamp();
        globalThis.currentUser = { uid: 'u1' };
        globalThis._isApplyingRemoteData = false;
        indexedDBService.getAll.mockReset().mockResolvedValue([
            { key: 1, kind: 'entities', employees: [], positions: [], leaders: [], schemaVersion: 3, ts: 888001, status: 'pending' }
        ]);
        indexedDBService.update.mockReset().mockResolvedValue(1);
        FirebaseService.saveEntities.mockClear().mockRejectedValue(Object.assign(new Error('quota'), { code: 'resource-exhausted' }));

        try {
            await drainMainSyncOutbox();
            testRunner.assertEquals(getLastEntitiesSyncOk(), 0,
                'una subida fallida no confirma nada — la marca no debe moverse');
        } finally {
            clearEntitiesSyncStamp();
            globalThis.currentUser = null;
            globalThis._isApplyingRemoteData = prevApplyingRemote;
        }
    }

});

// Hallazgo del test de campo (2026-07-05, cuota de Firestore agotada): con
// MAX_FLUSH_ATTEMPTS=5, una entrada que falla repetidamente contra un error
// transitorio (ej. resource-exhausted) termina 'dead' — y flush() SOLO
// procesa entradas 'pending' (MainSyncStore.js:205), nunca 'dead'. El botón
// "Reintentar" (badge + toast) llamaba a drainMainSyncOutbox() crudo, que
// jamás revivía esas entradas: el usuario podía tocar "Reintentar" para
// siempre sin que la subida vencida volviera a intentarse.
testRunner.addSuite("PersistenceService — retryFailedCloudSync revive entradas 'dead' antes de drenar", {

    async "llama a MainSyncStore.requeueDeadEntries() ANTES de flush()"() {
        const order = [];
        const requeue = jest.spyOn(MainSyncStore, 'requeueDeadEntries')
            .mockImplementation(async () => { order.push('requeue'); return 2; });
        const flush = jest.spyOn(MainSyncStore, 'flush')
            .mockImplementation(async () => { order.push('flush'); });
        try {
            await retryFailedCloudSync();
            testRunner.assertEquals(order.join(','), 'requeue,flush',
                'requeueDeadEntries debe completarse ANTES de que arranque flush — si no, las entradas recién revividas a "pending" podrían no alcanzar a subirse en este mismo ciclo');
        } finally {
            requeue.mockRestore();
            flush.mockRestore();
        }
    },

    async "sigue drenando aunque no haya ninguna entrada 'dead' (requeueDeadEntries devuelve 0)"() {
        const requeue = jest.spyOn(MainSyncStore, 'requeueDeadEntries').mockResolvedValue(0);
        const flush = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            await retryFailedCloudSync();
            testRunner.assertEquals(flush.mock.calls.length, 1, 'flush debe correr igual, para las pending normales');
        } finally {
            requeue.mockRestore();
            flush.mockRestore();
        }
    }

});
