/**
 * MainSyncStore.js — bandeja de pendientes para la nube (asistencia/empleados/
 * puestos/líderes/settings). Copia el patrón ya probado de PettyCashStore.js:
 * cada escritura que debía ir directo a Firestore se encola primero en
 * IndexedDB (store 'mainSyncOutbox', durable), y flush() la vacía hacia la
 * nube — al guardar, al iniciar sesión y al volver la conexión. Si la
 * pestaña se cierra antes de que termine de subir, la entrada sigue en el
 * outbox y se reintenta sola cuando vuelve la conexión (no se pierde).
 *
 * Reutiliza el guardado local de IndexedDB (fuente de verdad) — este store
 * SOLO gestiona qué falta empujar a Firestore, no reemplaza saveState().
 */

import { indexedDBService } from './IndexedDBService.js';

const OUTBOX = 'mainSyncOutbox';

/** Lee todas las entradas del outbox (defensivo ante error). */
async function _getAll() {
    try { return (await indexedDBService.getAll(OUTBOX)) || []; }
    catch { return []; }
}

/** Borra por key, sin propagar error (best-effort, igual que PettyCashStore). */
async function _deleteQuiet(key) {
    try { await indexedDBService.delete(OUTBOX, key); } catch { /* noop */ }
}

export const MainSyncStore = {

    /**
     * Encola el espejo de estado completo. Coalescing: sólo queda UNA entrada
     * 'mirror' pendiente a la vez (la más reciente reemplaza a la anterior),
     * así la cola no crece sin límite con guardados en ráfaga.
     *
     * `snapshot` debe ser una foto INMUTABLE capturada por el caller (p.ej.
     * `stateManager.getState()`, el estado raw sin proxy) — este módulo no
     * lee `state` directamente.
     */
    async enqueueMirror(snapshot) {
        const all = await _getAll();
        const stalePending = all.filter(e => e && e.kind === 'mirror' && e.status === 'pending');
        for (const e of stalePending) await _deleteQuiet(e.key);

        const schemaVersion = snapshot?.settings?.schemaVersion;
        await indexedDBService.update(OUTBOX, {
            kind: 'mirror', snapshot, schemaVersion, ts: Date.now(), status: 'pending'
        });
    },

    /**
     * Encola la asistencia de un día puntual. Coalescing por dateKey: una
     * nueva entrada para el MISMO día reemplaza a la anterior; días distintos
     * conviven en la cola sin pisarse.
     *
     * `records` = mapa congelado {claveCanonica: registro} SOLO de ese día
     * (el caller ya filtra por dateKey, igual que hoy hace _executeSave).
     */
    async enqueueDaily(dateKey, records) {
        const all = await _getAll();
        const stalePending = all.filter(e => e && e.kind === 'daily' && e.status === 'pending' && e.dateKey === dateKey);
        for (const e of stalePending) await _deleteQuiet(e.key);

        await indexedDBService.update(OUTBOX, {
            kind: 'daily', dateKey, records, ts: Date.now(), status: 'pending'
        });
    },

    /**
     * Encola el borrado de una entidad en la nube. Dedup: si ya hay un
     * borrado pendiente para la MISMA entidad+id, no duplica.
     *
     * `schemaVersion` se captura AHORA (al enqueuear) para que flush() pueda
     * gatear el drenado sin depender del estado en vivo en ese momento futuro.
     */
    async enqueueDelete(entity, id, schemaVersion) {
        const all = await _getAll();
        const dup = all.some(e => e && e.kind === 'delete' && e.status === 'pending' && e.entity === entity && e.id === id);
        if (dup) return;

        await indexedDBService.update(OUTBOX, {
            kind: 'delete', entity, id, schemaVersion, ts: Date.now(), status: 'pending'
        });
    }

};

export default MainSyncStore;
