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
import { nextEntryState } from './SyncErrorClassifier.js';

const OUTBOX = 'mainSyncOutbox';

// Judgment Day #1 (CRÍTICO): flush() se dispara desde guardado normal, 'online'
// y login/retry manual — pueden coincidir en el tiempo. Sin este guard, dos
// flush() concurrentes leen el mismo pending y suben la MISMA entrada dos
// veces; ante un fallo compartido, cada uno hace put() (last-write-wins) sobre
// `attempts` con su propia copia stale y uno de los dos incrementos se pierde,
// debilitando el dead-lettering. Mismo patrón que PettyCashStore ya usa.
let _flushing = false;

// Espeja PettyCashStore.MAX_FLUSH_ATTEMPTS: tras este número de intentos
// fallidos, la entrada pasa a 'dead' y deja de bloquear el resto de la cola.
export const MAX_FLUSH_ATTEMPTS = 5;

// Mismo margen que el chequeo de conflicto saliente en PersistenceService
// (_executeSave): si la nube es "más nueva" que el snapshot por menos que
// esto, se considera ruido de reloj/latencia y se sube igual.
const OUTGOING_CONFLICT_GRACE_MS = 10_000;

// Requisitos de esquema para que el doc per-entidad exista en la nube
// (mismos umbrales que FirebaseService.saveFullState). Bajo el umbral, el
// path es "muerto" — nada lee ese doc todavía — y el borrado debe esperar.
const DELETE_SCHEMA_MIN = { employee: 2, position: 3, leader: 3 };

/** Lee todas las entradas del outbox (defensivo ante error). */
async function _getAll() {
    try { return (await indexedDBService.getAll(OUTBOX)) || []; }
    catch { return []; }
}

/** Borra por key, sin propagar error (best-effort, igual que PettyCashStore). */
async function _deleteQuiet(key) {
    try { await indexedDBService.delete(OUTBOX, key); } catch { /* noop */ }
}

/**
 * Decide qué llamar a la nube para una entrada, según su `kind`, aplicando
 * los gates que NO son errores (watermark del mirror, schemaVersion del
 * delete). Separado de `flush()` para mantener el bucle simple.
 * @returns {(() => Promise)|null} el thunk a ejecutar, o null si hay que
 *   diferir esta entrada (dejarla pending sin tocarla ni contarla como fallo).
 */
function _resolveCloudCall(entry, guards) {
    if (entry.kind === 'mirror') {
        const localTs = entry.snapshot?.settings?.localUpdatedAt || 0;
        // Diferir, NO es un fallo: la nube ya tiene algo más nuevo que este
        // snapshot. No incrementar attempts ni tocar la entrada.
        if (guards.cloudWatermark() > localTs + OUTGOING_CONFLICT_GRACE_MS) return null;
        return () => guards.saveMirror(entry.snapshot);
    }
    if (entry.kind === 'daily') {
        // Sin gate de watermark: es un merge granular por día, no un
        // overwrite wholesale que el watermark tenga que proteger.
        return () => guards.saveDaily(entry.dateKey, entry.records);
    }
    if (entry.kind === 'delete') {
        const minSchema = DELETE_SCHEMA_MIN[entry.entity];
        // Cuenta legacy: el doc per-entidad no existe todavía. Dejar
        // pendiente hasta que la cuenta migre — no es un fallo.
        if (!minSchema || (entry.schemaVersion || 0) < minSchema) return null;
        return () => guards.deleteEntity(entry.entity, entry.id);
    }
    return null; // kind desconocido — no debería pasar; no tocar la entrada
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
    },

    /**
     * Vacía el outbox hacia la nube. TODOS los chequeos de seguridad se
     * re-evalúan ACÁ, al momento de vaciar — no alcanza con haber sido válidos
     * cuando se encoló la entrada, porque puede haber pasado tiempo (landmine
     * #2): sesión cerrada, sincronización pausada, un apply remoto en curso,
     * o la nube haber avanzado más que el snapshot que se iba a subir.
     *
     * @param {{
     *   hasSession: () => boolean,
     *   isApplyingRemote: () => boolean,
     *   isPaused: () => boolean,
     *   cloudWatermark: () => number,
     *   saveMirror: (snapshot) => Promise,
     *   saveDaily: (dateKey, records) => Promise,
     *   deleteEntity: (entity, id) => Promise,
     *   onCloudResult: (ok) => void
     * }} guards - inyectado por el caller (PersistenceService), evaluado en
     *   vivo — este módulo no lee `state`/`globalThis` directamente.
     */
    async flush(guards) {
        if (_flushing) return; // otro flush ya está en vuelo — evita duplicar subidas
        if (!guards.hasSession() || guards.isApplyingRemote() || guards.isPaused()) return;

        _flushing = true;
        try {
            const all = await _getAll();
            const pending = all
                .filter(e => e && e.status === 'pending')
                .sort((a, b) => (a.key || 0) - (b.key || 0));

            for (const entry of pending) {
                const cloudCall = _resolveCloudCall(entry, guards);
                if (!cloudCall) continue; // diferido (watermark/schemaVersion) — no es un fallo

                try {
                    await cloudCall();
                    await _deleteQuiet(entry.key);
                    // El 3er argumento (entry) es sólo CONTEXTO para que el caller
                    // decida qué hacer según el `kind` — MainSyncStore no conoce esa
                    // lógica de negocio (toasts, eventos de UI), sólo la reenvía.
                    guards.onCloudResult(true, null, entry);
                } catch (err) {
                    // ☠️ M2 (mismo criterio que PettyCashStore): cada fallo suma un
                    // intento y guarda lastError. Un error PERMANENTE (permisos,
                    // argumento inválido) dead-letterea de inmediato sin gastar los
                    // MAX_FLUSH_ATTEMPTS — nunca se va a resolver reintentando.
                    guards.onCloudResult(false, err, entry);
                    const next = nextEntryState(entry, err, MAX_FLUSH_ATTEMPTS);
                    await indexedDBService.update(OUTBOX, { ...entry, ...next });
                    if (next.status === 'dead') continue; // envenenada: la cola sigue con la próxima
                    break; // fallo transitorio: cortar el ciclo para no martillar la red
                }
            }
        } finally {
            _flushing = false;
        }
    },

    /** ¿Cuántas escrituras quedan pendientes? (para UI/diagnóstico) */
    async pendingCount() {
        const all = await _getAll();
        return all.filter(e => e && e.status === 'pending').length;
    },

    /** ¿Cuántas entradas quedaron muertas (descartadas tras N intentos o permanentes)? */
    async deadCount() {
        const all = await _getAll();
        return all.filter(e => e && e.status === 'dead').length;
    },

    /**
     * Revive las entradas 'dead' (attempts en cero) para reintentarlas — p.ej.
     * después de corregir reglas de Firestore o migrar la cuenta. NO dispara
     * flush por sí mismo (flush necesita `guards`, que este método no recibe);
     * el caller decide cuándo llamar a flush(guards) después.
     * @returns {Promise<number>} cuántas revivió
     */
    async requeueDeadEntries() {
        const all = await _getAll();
        let revived = 0;
        for (const e of all) {
            if (!e || e.status !== 'dead') continue;
            try {
                await indexedDBService.update(OUTBOX, { ...e, status: 'pending', attempts: 0, lastError: null });
                revived++;
            } catch { /* noop */ }
        }
        return revived;
    }

};

let _lifecycleInitialized = false;

/**
 * Cablea el drenado del outbox al volver la conexión. `guardsFactory` se
 * llama en CADA evento 'online' (no una sola vez al init) para tomar guards
 * frescos — session/estado pueden cambiar entre que se cablea esto y que
 * efectivamente se reconecta.
 *
 * Idempotente: llamarlo más de una vez (p.ej. loadApplicationData corre en
 * dos ramas) no debe duplicar el listener, o un solo 'online' dispararía
 * flush() dos veces en paralelo.
 *
 * @param {() => Object} guardsFactory - construye el objeto `guards` de flush()
 */
export function initMainSyncLifecycle(guardsFactory) {
    if (_lifecycleInitialized) return;
    _lifecycleInitialized = true;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('online', () => {
        try { MainSyncStore.flush(guardsFactory()); } catch { /* noop */ }
    });
}

export default MainSyncStore;
