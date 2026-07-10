/**
 * 🧪 LocalDataWipeTests (Fase 0.5, U2)
 *
 * Carrera del pagehide en "Borrar Local" / "Descargar y Reemplazar": ambas
 * operaciones limpian los stores y llaman location.reload(). El reload
 * dispara pagehide → flushPendingSave() → que puede RE-PERSISTIR el estado
 * en memoria (BatchedSaver, debounce pendiente) y RE-ENCOLAR un mirror
 * pre-borrado en el outbox recién purgado — deshaciendo parcialmente el
 * borrado que el usuario acaba de confirmar.
 *
 * Contrato: beginLocalDataWipe() levanta un flag que convierte a
 * flushPendingSave() y saveApplicationData() en no-ops hasta que la página
 * se recargue (o hasta endLocalDataWipe(), para flujos que abortan a mitad
 * de camino, p.ej. "Descargar y Reemplazar" con la red caída).
 */

import {
    saveApplicationData,
    saveToIndexedDB,
    flushPendingSave,
    beginLocalDataWipe,
    endLocalDataWipe,
    isLocalDataWipeInProgress
} from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

testRunner.addSuite("PersistenceService — guard de borrado local en curso (Fase 0.5, U2)", {

    "beginLocalDataWipe / endLocalDataWipe controlan el flag"() {
        try {
            testRunner.assertEquals(isLocalDataWipeInProgress(), false, 'arranca en false');
            beginLocalDataWipe();
            testRunner.assertEquals(isLocalDataWipeInProgress(), true, 'begin lo levanta');
            endLocalDataWipe();
            testRunner.assertEquals(isLocalDataWipeInProgress(), false, 'end lo baja (flujos que abortan)');
        } finally {
            endLocalDataWipe();
        }
    },

    "con el wipe en curso, flushPendingSave es un no-op (no drena BatchedSaver ni outbox)"() {
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        const fakeSaver = { flushNow: jest.fn(), isActive: false };
        const prevSaver = window._attendanceBatchedSaver;
        window._attendanceBatchedSaver = fakeSaver;
        try {
            beginLocalDataWipe();

            const result = flushPendingSave();

            testRunner.assertEquals(result, false, 'debe reportar que no hizo nada');
            testRunner.assertEquals(fakeSaver.flushNow.mock.calls.length, 0,
                'NO debe drenar el BatchedSaver — re-escribiría asistencia recién borrada a IndexedDB');
            testRunner.assertEquals(flushSpy.mock.calls.length, 0,
                'NO debe disparar el flush del outbox — subiría datos pre-borrado a la nube');
        } finally {
            endLocalDataWipe();
            flushSpy.mockRestore();
            window._attendanceBatchedSaver = prevSaver;
        }
    },

    async "con el wipe en curso, saveApplicationData({immediate}) es un no-op (no persiste ni encola)"() {
        const enqueueSpy = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const prevLoaded = state.isDataLoaded;
        const prevIdb = state.useIndexedDB;
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            indexedDBService.saveState.mockClear();
            beginLocalDataWipe();

            await saveApplicationData({ immediate: true, skipValidation: true });
            await sleep(50);

            testRunner.assertEquals(indexedDBService.saveState.mock.calls.length, 0,
                'NO debe re-persistir el estado en memoria durante un borrado local');
            testRunner.assertEquals(enqueueSpy.mock.calls.length, 0,
                'NO debe encolar un mirror pre-borrado en el outbox');
        } finally {
            endLocalDataWipe();
            enqueueSpy.mockRestore();
            state.isDataLoaded = prevLoaded;
            state.useIndexedDB = prevIdb;
        }
    },

    async "con el wipe en curso, saveToIndexedDB DIRECTO también es no-op (JD-F4, ALTO)"() {
        // El guard U2 cubría saveApplicationData y flushPendingSave, pero el
        // flush del BatchedSaver (app.js) llama saveToIndexedDB DIRECTO —
        // bypass total. Un flush ya agendado por requestIdleCallback (hasta
        // 1000ms antes) podía dispararse DENTRO de la ventana del wipe y
        // re-escribir el state en memoria a IndexedDB, resucitando datos
        // recién borrados. El guard va en la primitiva, no sólo en callers.
        const prevIdb = state.useIndexedDB;
        try {
            state.useIndexedDB = true;
            indexedDBService.saveState.mockClear();
            beginLocalDataWipe();

            await saveToIndexedDB({ skipValidation: true });

            testRunner.assertEquals(indexedDBService.saveState.mock.calls.length, 0,
                'la primitiva de persistencia NO debe escribir durante un borrado local');
        } finally {
            endLocalDataWipe();
            state.useIndexedDB = prevIdb;
        }
    },

    async "tras endLocalDataWipe, el guardado vuelve a funcionar normalmente"() {
        // Un flujo que aborta (p.ej. red caída en Descargar y Reemplazar) debe
        // poder restaurar el guardado — si no, la sesión queda muda hasta el F5.
        const prevLoaded = state.isDataLoaded;
        const prevIdb = state.useIndexedDB;
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            beginLocalDataWipe();
            endLocalDataWipe();
            indexedDBService.saveState.mockClear();

            await saveApplicationData({ immediate: true, skipValidation: true });
            await sleep(50);

            testRunner.assert(indexedDBService.saveState.mock.calls.length >= 1,
                'el guardado local debe volver a operar tras cancelar el wipe');
        } finally {
            endLocalDataWipe();
            state.isDataLoaded = prevLoaded;
            state.useIndexedDB = prevIdb;
        }
    }

});

console.log('🧪 LocalDataWipe tests cargados.');
