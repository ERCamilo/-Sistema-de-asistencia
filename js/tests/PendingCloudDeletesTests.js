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
 *
 * U9 — ADEMÁS de la cola Set+localStorage (que sigue siendo el camino
 * primario, drenado en cada save), cada enqueue TAMBIÉN encola en
 * MainSyncStore: le da a los borrados la MISMA durabilidad extra que el
 * resto (reintento en 'online' + dead-lettering de una entrada envenenada
 * sin bloquear las demás para siempre). Ambos caminos conviven a propósito
 * — un delete ya drenado por uno es un no-op inofensivo para el otro
 * (deleteDoc sobre un doc ya borrado no falla).
 */

import {
    enqueueCloudEmployeeDelete,
    enqueueCloudEmployeeDeleteBatch,
    getPendingCloudDeletes,
    clearPendingCloudDeletes
} from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

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
import { saveApplicationData, flushPendingSave, loadApplicationData } from '../modules/services/PersistenceService.js';
import { deleteDoc } from '../modules/data/firebase.js';
import { auth } from '../modules/data/firebase.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

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

// ─────────────────────────────────────────────────────────────
// Schema v3: colas de borrado para CARGOS y LÍDERES.
// Igual que empleados, pero el drain ocurre solo con schemaVersion >= 3
// (es cuando cargos/líderes viven en su subcolección per-doc).
// ─────────────────────────────────────────────────────────────

import {
    enqueueCloudPositionDelete,
    getPendingCloudPositionDeletes,
    clearPendingCloudPositionDeletes,
    enqueueCloudLeaderDelete,
    getPendingCloudLeaderDeletes,
    clearPendingCloudLeaderDeletes
} from '../modules/services/PersistenceService.js';

testRunner.addSuite("PersistenceService — colas de borrado cargos/líderes (v3)", {

    "enqueueCloudPositionDelete agrega y dedupea"() {
        clearPendingCloudPositionDeletes();
        enqueueCloudPositionDelete('p1');
        enqueueCloudPositionDelete('p1');
        enqueueCloudPositionDelete('p2');
        testRunner.assertEquals(getPendingCloudPositionDeletes().length, 2);
        clearPendingCloudPositionDeletes();
    },

    "enqueueCloudPositionDelete ignora falsy"() {
        clearPendingCloudPositionDeletes();
        enqueueCloudPositionDelete('');
        enqueueCloudPositionDelete(null);
        enqueueCloudPositionDelete(undefined);
        testRunner.assertEquals(getPendingCloudPositionDeletes().length, 0);
    },

    "enqueueCloudLeaderDelete agrega y dedupea"() {
        clearPendingCloudLeaderDeletes();
        enqueueCloudLeaderDelete('l1');
        enqueueCloudLeaderDelete('l1');
        testRunner.assertEquals(getPendingCloudLeaderDeletes().length, 1);
        clearPendingCloudLeaderDeletes();
    }

});

testRunner.addSuite("PersistenceService — drain cargos/líderes (v3)", {

    async "drain de cargos con schemaVersion>=3 → deleteDoc"() {
        clearPendingCloudPositionDeletes();
        deleteDoc.mockClear();
        auth.currentUser = { uid: 'test-pos-drain' };
        globalThis.currentUser = auth.currentUser;
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = state.settings || {};
        state.settings.schemaVersion = 3;

        enqueueCloudPositionDelete('pDel1');
        enqueueCloudPositionDelete('pDel2');

        saveApplicationData({ skipValidation: true });
        flushPendingSave();
        await sleep(30);

        testRunner.assert(deleteDoc.mock.calls.length >= 2,
            `deleteDoc debe llamarse >=2. Recibido: ${deleteDoc.mock.calls.length}`);
        testRunner.assertEquals(getPendingCloudPositionDeletes().length, 0,
            'La cola de cargos debe quedar vacía tras drain');

        auth.currentUser = null;
        globalThis.currentUser = null;
        delete state.settings.schemaVersion;
    },

    async "drain de cargos NO ocurre con schemaVersion=2 (aún no granular)"() {
        clearPendingCloudPositionDeletes();
        deleteDoc.mockClear();
        auth.currentUser = { uid: 'test-pos-v2' };
        globalThis.currentUser = auth.currentUser;
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.settings = state.settings || {};
        state.settings.schemaVersion = 2; // cargos todavía en el doc padre

        enqueueCloudPositionDelete('pNoDel');
        saveApplicationData({ skipValidation: true });
        flushPendingSave();
        await sleep(30);

        testRunner.assertEquals(deleteDoc.mock.calls.length, 0,
            'En v2 los cargos no son granulares → no se borra de subcolección');
        testRunner.assertEquals(getPendingCloudPositionDeletes().length, 1,
            'Los ids quedan encolados para cuando migre a v3');

        clearPendingCloudPositionDeletes();
        auth.currentUser = null;
        globalThis.currentUser = null;
        delete state.settings.schemaVersion;
    }

});

testRunner.addSuite("PersistenceService — los borrados TAMBIÉN encolan en MainSyncStore (U9)", {

    "enqueueCloudEmployeeDelete encola también en MainSyncStore con el schemaVersion actual"() {
        clearPendingCloudDeletes();
        const spy = jest.spyOn(MainSyncStore, 'enqueueDelete').mockResolvedValue(undefined);
        state.settings = state.settings || {};
        const prevSchema = state.settings.schemaVersion;
        try {
            state.settings.schemaVersion = 2;
            enqueueCloudEmployeeDelete('eX1');
            testRunner.assert(
                spy.mock.calls.some(c => c[0] === 'employee' && c[1] === 'eX1' && c[2] === 2),
                'debe encolar también en el outbox durable (entity, id, schemaVersion)'
            );
        } finally {
            spy.mockRestore();
            clearPendingCloudDeletes();
            state.settings.schemaVersion = prevSchema;
        }
    },

    "enqueueCloudPositionDelete y enqueueCloudLeaderDelete también encolan en MainSyncStore"() {
        clearPendingCloudPositionDeletes();
        clearPendingCloudLeaderDeletes();
        const spy = jest.spyOn(MainSyncStore, 'enqueueDelete').mockResolvedValue(undefined);
        state.settings = state.settings || {};
        const prevSchema = state.settings.schemaVersion;
        try {
            state.settings.schemaVersion = 3;
            enqueueCloudPositionDelete('pX1');
            enqueueCloudLeaderDelete('lX1');
            testRunner.assert(spy.mock.calls.some(c => c[0] === 'position' && c[1] === 'pX1' && c[2] === 3));
            testRunner.assert(spy.mock.calls.some(c => c[0] === 'leader' && c[1] === 'lX1' && c[2] === 3));
        } finally {
            spy.mockRestore();
            clearPendingCloudPositionDeletes();
            clearPendingCloudLeaderDeletes();
            state.settings.schemaVersion = prevSchema;
        }
    },

    "un delete falsy/vacío NO llega a MainSyncStore.enqueueDelete (mismo guard que la cola legacy)"() {
        clearPendingCloudDeletes();
        const spy = jest.spyOn(MainSyncStore, 'enqueueDelete').mockResolvedValue(undefined);
        try {
            enqueueCloudEmployeeDelete('');
            enqueueCloudEmployeeDelete(null);
            testRunner.assertEquals(spy.mock.calls.length, 0);
        } finally {
            spy.mockRestore();
        }
    },

    "enqueueCloudEmployeeDeleteBatch también encola cada id en MainSyncStore (Judgment Day #2)"() {
        // El wizard de duplicados usa el batch (no el singular) al fusionar varios
        // a la vez — sin esto, esos ids sólo tenían la durabilidad extra del outbox
        // si sobrevivían hasta el próximo loadApplicationData (que los siembra desde
        // la cola legacy). Debe tener la MISMA paridad que enqueueCloudEmployeeDelete.
        clearPendingCloudDeletes();
        const spy = jest.spyOn(MainSyncStore, 'enqueueDelete').mockResolvedValue(undefined);
        state.settings = state.settings || {};
        const prevSchema = state.settings.schemaVersion;
        try {
            state.settings.schemaVersion = 2;
            enqueueCloudEmployeeDeleteBatch(['eB1', 'eB2']);
            testRunner.assert(
                spy.mock.calls.some(c => c[0] === 'employee' && c[1] === 'eB1' && c[2] === 2),
                'debe encolar eB1 en MainSyncStore'
            );
            testRunner.assert(
                spy.mock.calls.some(c => c[0] === 'employee' && c[1] === 'eB2' && c[2] === 2),
                'debe encolar eB2 en MainSyncStore'
            );
        } finally {
            spy.mockRestore();
            clearPendingCloudDeletes();
            state.settings.schemaVersion = prevSchema;
        }
    },

    async "loadApplicationData siembra el outbox con los ids YA pendientes de antes de esta actualización"() {
        // Un usuario que actualiza la app puede tener ids pendientes desde ANTES
        // de que existiera el outbox (persistidos sólo en la cola Set+localStorage
        // legacy). Sin esto, esos ids nunca ganarían el retry-en-'online' ni el
        // dead-lettering — sólo drenarían en el próximo save (como siempre).
        clearPendingCloudDeletes();
        try { localStorage.setItem('asistencia_pending_cloud_deletes', JSON.stringify({
            employees: ['eLegacyOld'], positions: [], leaders: []
        })); } catch (_) { /* noop */ }

        const spy = jest.spyOn(MainSyncStore, 'enqueueDelete').mockResolvedValue(undefined);
        indexedDBService.loadFullState.mockResolvedValueOnce({
            employees: [{ id: 'e1', name: 'Test', active: true, positions: [] }],
            positions: [], leaders: [], attendance: {}, settings: { schemaVersion: 2 }
        });
        try {
            await loadApplicationData();

            testRunner.assert(
                spy.mock.calls.some(c => c[0] === 'employee' && c[1] === 'eLegacyOld' && c[2] === 2),
                'debe sembrar el outbox con el id legacy pendiente usando el schemaVersion recién cargado'
            );
        } finally {
            spy.mockRestore();
            clearPendingCloudDeletes();
            try { localStorage.removeItem('asistencia_pending_cloud_deletes'); } catch (_) { /* noop */ }
        }
    }

});

console.log('🧪 PendingCloudDeletes tests cargados.');
