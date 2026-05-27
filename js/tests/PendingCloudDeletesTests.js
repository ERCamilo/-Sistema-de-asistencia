/**
 * 🧪 PendingCloudDeletesTests (Tarea #18)
 *
 * Cola de ids de empleados a borrar de la subcolección de Firebase tras
 * el próximo saveApplicationData. Usada por el wizard de duplicados
 * cuando consume un duplicado cloud-only o cloud+local — el state
 * local ya está sin él, pero su doc remoto sigue ahí.
 *
 * Contrato:
 *   - enqueueCloudEmployeeDelete(id) agrega el id a la cola.
 *   - Duplicados se ignoran (Set, no array).
 *   - getPendingCloudDeletes() devuelve los ids pendientes.
 *   - saveApplicationData drena la cola con EmployeeRepository.deleteOne
 *     SOLO si state.settings.schemaVersion >= 2.
 *   - Si un delete falla, los demás siguen y los fallidos se reencolan.
 */

import {
    enqueueCloudEmployeeDelete,
    getPendingCloudDeletes,
    clearPendingCloudDeletes
} from '../modules/services/PersistenceService.js';

testRunner.addSuite("PersistenceService — _pendingCloudDeletes (Tarea #18)", {

    "enqueue agrega el id a la cola"() {
        clearPendingCloudDeletes();
        enqueueCloudEmployeeDelete('e1');
        const ids = getPendingCloudDeletes();
        testRunner.assertEquals(ids.length, 1);
        testRunner.assertEquals(ids[0], 'e1');
        clearPendingCloudDeletes();
    },

    "enqueue dedupea: dos veces el mismo id deja un solo elemento"() {
        clearPendingCloudDeletes();
        enqueueCloudEmployeeDelete('e1');
        enqueueCloudEmployeeDelete('e1');
        enqueueCloudEmployeeDelete('e2');
        const ids = getPendingCloudDeletes();
        testRunner.assertEquals(ids.length, 2);
        clearPendingCloudDeletes();
    },

    "enqueue ignora ids vacíos o falsy"() {
        clearPendingCloudDeletes();
        enqueueCloudEmployeeDelete('');
        enqueueCloudEmployeeDelete(null);
        enqueueCloudEmployeeDelete(undefined);
        enqueueCloudEmployeeDelete(0);
        const ids = getPendingCloudDeletes();
        testRunner.assertEquals(ids.length, 0,
            'Solo ids no-vacíos deben agregarse');
        clearPendingCloudDeletes();
    },

    "clearPendingCloudDeletes vacía la cola"() {
        clearPendingCloudDeletes();
        enqueueCloudEmployeeDelete('e1');
        enqueueCloudEmployeeDelete('e2');
        clearPendingCloudDeletes();
        testRunner.assertEquals(getPendingCloudDeletes().length, 0);
    },

    "getPendingCloudDeletes retorna una copia, no referencia"() {
        clearPendingCloudDeletes();
        enqueueCloudEmployeeDelete('e1');
        const list1 = getPendingCloudDeletes();
        list1.push('e_intruder'); // mutar la copia
        const list2 = getPendingCloudDeletes();
        testRunner.assertEquals(list2.length, 1,
            'Mutar la copia no debe afectar la cola interna');
        clearPendingCloudDeletes();
    }

});

// ─────────────────────────────────────────────────────────────
// Suite: drain en saveApplicationData
// ─────────────────────────────────────────────────────────────

import { state } from '../modules/core/AppState.js';
import { saveApplicationData, flushPendingSave } from '../modules/services/PersistenceService.js';
import { deleteDoc } from '../modules/data/firebase.js';
import { auth } from '../modules/data/firebase.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

testRunner.addSuite("PersistenceService — drain de _pendingCloudDeletes (Tarea #18)", {

    async "drain con schemaVersion>=2 y user autenticado → deleteDoc por cada id"() {
        clearPendingCloudDeletes();
        deleteDoc.mockClear();
        auth.currentUser = { uid: 'test-drain-1' };
        globalThis.currentUser = auth.currentUser;
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = state.settings || {};
        state.settings.schemaVersion = 2;

        enqueueCloudEmployeeDelete('eDel1');
        enqueueCloudEmployeeDelete('eDel2');

        saveApplicationData({ skipValidation: true });
        flushPendingSave();
        await sleep(30);

        testRunner.assert(deleteDoc.mock.calls.length >= 2,
            `deleteDoc debe llamarse al menos 2 veces. Recibido: ${deleteDoc.mock.calls.length}`);
        testRunner.assertEquals(getPendingCloudDeletes().length, 0,
            'La cola debe quedar vacía tras drain exitoso');

        auth.currentUser = null;
        globalThis.currentUser = null;
        delete state.settings.schemaVersion;
    },

    async "drain NO ocurre si schemaVersion < 2 (cuenta legacy)"() {
        clearPendingCloudDeletes();
        deleteDoc.mockClear();
        auth.currentUser = { uid: 'test-drain-2' };
        globalThis.currentUser = auth.currentUser;
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = state.settings || {};
        delete state.settings.schemaVersion; // legacy

        enqueueCloudEmployeeDelete('eNoDel');
        saveApplicationData({ skipValidation: true });
        flushPendingSave();
        await sleep(30);

        testRunner.assertEquals(deleteDoc.mock.calls.length, 0,
            'En cuenta legacy NO debe tocar la subcolección');
        // La cola NO se vacía (queda para cuando migre)
        testRunner.assertEquals(getPendingCloudDeletes().length, 1,
            'Los ids quedan encolados para futuro');

        clearPendingCloudDeletes();
        auth.currentUser = null;
        globalThis.currentUser = null;
    },

    async "drain NO ocurre sin usuario autenticado"() {
        clearPendingCloudDeletes();
        deleteDoc.mockClear();
        auth.currentUser = null;
        globalThis.currentUser = null;
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = state.settings || {};
        state.settings.schemaVersion = 2;

        enqueueCloudEmployeeDelete('eSinAuth');
        saveApplicationData({ skipValidation: true });
        flushPendingSave();
        await sleep(30);

        testRunner.assertEquals(deleteDoc.mock.calls.length, 0,
            'Sin sesión no debe escribir a Firestore');

        clearPendingCloudDeletes();
        delete state.settings.schemaVersion;
    }

});

console.log('🧪 PendingCloudDeletes tests cargados.');
