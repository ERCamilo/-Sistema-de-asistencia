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
import { createCrossTabLock } from './CrossTabLock.js';

const OUTBOX = 'mainSyncOutbox';

// Judgment Day #1 (CRÍTICO): flush() se dispara desde guardado normal, 'online'
// y login/retry manual — pueden coincidir en el tiempo. Sin este guard, dos
// flush() concurrentes leen el mismo pending y suben la MISMA entrada dos
// veces; ante un fallo compartido, cada uno hace put() (last-write-wins) sobre
// `attempts` con su propia copia stale y uno de los dos incrementos se pierde,
// debilitando el dead-lettering. Mismo patrón que PettyCashStore ya usa.
let _flushing = false;
const _crossTabLock = createCrossTabLock({ leaseStore: indexedDBService });
const OUTBOX_LOCK = 'attendance-app-main-sync-outbox';

// JD-F5 (ALTO): flush() lee la lista pending a memoria UNA vez y la itera
// awaiteando la red por entrada. clearAll() incrementa esta generación; el
// bucle la re-chequea entre entradas y corta si cambió — sin esto, una purga
// disparada a mitad de un flush en vuelo (usuario tocó Borrar Local /
// Descargar y Reemplazar) vaciaba el store pero la copia stale en memoria
// seguía subiéndose, re-creando exactamente lo que la purga debía impedir.
let _purgeGeneration = 0;

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
    if (entry.kind === 'entities') {
        // Sin gate de watermark: cada saveOne per-entidad hace su propio LWW por
        // updatedAt — el gate grueso del espejo no debe frenar estos writes.
        return () => guards.saveEntities(entry.employees, entry.positions, entry.leaders, entry.schemaVersion);
    }
    if (entry.kind === 'settings') {
        // Sin gate de watermark: saveSettings() hace su propio read-compare-write
        // LWW por localUpdatedAt (Fase 2B JD-B1, ver FirebaseService.saveSettings +
        // SettingsWriteGuard.shouldWriteSettings) — igual que 'entities', el gate
        // grueso del espejo no debe frenar este write; la comparación fina ya
        // vive dentro del propio writer.
        return () => guards.saveSettings(entry.settings);
    }
    if (entry.kind === 'payrollClosure') {
        return () => guards.savePayrollClosure(entry.closure);
    }
    if (entry.kind === 'payrollClosureBundle') {
        return async () => {
            const schemaVersion = Number(entry.schemaVersion) || 0;
            if (schemaVersion < 2) {
                throw new TypeError('Unsupported payroll employee schema in sync bundle');
            }
            if (typeof guards.savePayrollEmployees !== 'function') {
                throw new TypeError('Payroll employee sync guard is required');
            }
            await guards.savePayrollEmployees(entry.employees || [], schemaVersion);
            await guards.savePayrollClosure(entry.closure);
        };
    }
    if (entry.kind === 'delete') {
        const minSchema = DELETE_SCHEMA_MIN[entry.entity];
        // Cuenta legacy: el doc per-entidad no existe todavía. Dejar
        // pendiente hasta que la cuenta migre — no es un fallo.
        if (!minSchema || (entry.schemaVersion || 0) < minSchema) return null;
        // deletedAt (opcional): si viene, el borrado es un tombstone (soft) en
        // vez de un hard-delete — el guard decide según la entidad. Empleados
        // usan tombstone (no resucitan); cargos/líderes siguen con hard-delete.
        return () => guards.deleteEntity(entry.entity, entry.id, entry.deletedAt);
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
     * Encola las entidades (empleados/puestos/líderes) para su escritura
     * per-doc, DESACOPLADA del espejo. Coalescing: sólo queda UNA entrada
     * 'entities' pendiente a la vez (la más reciente reemplaza a la anterior).
     *
     * A diferencia de 'mirror', esta entrada NO se gatea por el watermark en
     * _resolveCloudCall — cada saveOne/saveMany per-entidad ya hace su propio
     * LWW por updatedAt (ver PositionRepository.saveOne), así que el gate
     * grueso del espejo sólo difería en silencio ediciones (p.ej. préstamos)
     * que el merge fino ya sabe resolver bien.
     *
     * `employees`/`positions`/`leaders` deben ser arrays INMUTABLES ya
     * clonados por el caller (mismo contrato que `enqueueMirror`).
     */
    async enqueueEntities(employees, positions, leaders, schemaVersion) {
        const all = await _getAll();
        const stalePending = all.filter(e => e && e.kind === 'entities' && e.status === 'pending');
        for (const e of stalePending) await _deleteQuiet(e.key);

        await indexedDBService.update(OUTBOX, {
            kind: 'entities', employees, positions, leaders, schemaVersion, ts: Date.now(), status: 'pending'
        });
    },

    /**
     * Fase 2B U1: encola el mapa de settings completo para su escritura en el
     * doc per-registro (users/{uid}/data/settings), DESACOPLADA del espejo.
     * Coalescing: sólo queda UNA entrada 'settings' pendiente a la vez (la
     * más reciente reemplaza a la anterior), mismo patrón que 'entities'.
     *
     * A diferencia de 'mirror', esta entrada NO se gatea por el watermark en
     * _resolveCloudCall — FirebaseService.saveSettings ya es un full-replace
     * LWW por dispositivo, así que el gate grueso del espejo no aplica acá.
     *
     * `settingsMap` debe ser un objeto INMUTABLE ya clonado por el caller
     * (mismo contrato que `enqueueMirror`/`enqueueEntities`).
     */
    async enqueueSettings(settingsMap) {
        const all = await _getAll();
        const stalePending = all.filter(e => e && e.kind === 'settings' && e.status === 'pending');
        for (const e of stalePending) await _deleteQuiet(e.key);

        await indexedDBService.update(OUTBOX, {
            kind: 'settings', settings: settingsMap, ts: Date.now(), status: 'pending'
        });
    },

    /**
     * Encola un cierre histórico en su documento independiente. La identidad
     * determinista vuelve cada reintento idempotente; el estado más reciente
     * reemplaza cualquier intento pendiente o muerto del mismo cierre.
     */
    async enqueuePayrollClosure(closure) {
        const closureId = String(closure?.id || '').trim();
        if (!closureId) throw new TypeError('Payroll closure id is required');
        const all = await _getAll();
        const stale = all.filter(entry => entry &&
            entry.kind === 'payrollClosure' &&
            entry.closureId === closureId &&
            (entry.status === 'pending' || entry.status === 'dead'));
        for (const entry of stale) await _deleteQuiet(entry.key);
        await indexedDBService.update(OUTBOX, {
            kind: 'payrollClosure',
            closureId,
            closure,
            ts: Date.now(),
            status: 'pending'
        });
    },

    /**
     * Encola el borrado de una entidad en la nube. Dedup: si ya hay un
     * borrado pendiente para la MISMA entidad+id, no duplica.
     *
     * `schemaVersion` se captura AHORA (al enqueuear) para que flush() pueda
     * gatear el drenado sin depender del estado en vivo en ese momento futuro.
     */
    async enqueueDelete(entity, id, schemaVersion, opts = {}) {
        const all = await _getAll();
        const dup = all.some(e => e && e.kind === 'delete' && e.status === 'pending' && e.entity === entity && e.id === id);
        if (dup) return;

        // deletedAt (opcional): marca el borrado como tombstone durable (soft).
        // Persistido en la entrada para que el flush escriba el tombstone con
        // el ts del BORRADO (no el del flush) — el LWW necesita el momento real
        // para que una edición posterior pueda revivir al empleado.
        const entry = {
            kind: 'delete', entity, id, schemaVersion, ts: Date.now(), status: 'pending'
        };
        if (Number.isFinite(opts.deletedAt)) entry.deletedAt = opts.deletedAt;
        await indexedDBService.update(OUTBOX, entry);
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
     *   saveEntities: (employees, positions, leaders, schemaVersion) => Promise,
     *   saveSettings: (settingsMap) => Promise,
     *   savePayrollEmployees: (employees, schemaVersion) => Promise,
     *   savePayrollClosure: (closure) => Promise,
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
            return await _crossTabLock.run(OUTBOX_LOCK, async () => {
                // Los guards pudieron cambiar mientras esta pestaña esperaba el
                // turno de otra. Revalidarlos dentro del lock evita subir tras
                // logout, pausa o una aplicación remota iniciada en la espera.
                if (!guards.hasSession() || guards.isApplyingRemote() || guards.isPaused()) return false;

                const generationAtStart = _purgeGeneration; // JD-F5: foto de la generación
                const all = await _getAll();
                const pending = all
                    .filter(e => e && e.status === 'pending')
                    .sort((a, b) => (a.key || 0) - (b.key || 0));

                for (const entry of pending) {
                    // JD-F5: si hubo una purga desde que arrancó este flush, la
                    // lista en memoria es stale — cortar sin subir nada más.
                    if (generationAtStart !== _purgeGeneration) break;
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
                        // R2-5 (ronda 2): si hubo una purga mientras esta entrada
                        // estaba en vuelo, NO re-escribirla — el update la
                        // resucitaría en el store recién vaciado y el próximo
                        // flush subiría exactamente lo que la purga debía impedir.
                        if (generationAtStart !== _purgeGeneration) break;
                        const next = nextEntryState(entry, err, MAX_FLUSH_ATTEMPTS);
                        await indexedDBService.update(OUTBOX, { ...entry, ...next });
                        if (next.status === 'dead') continue; // envenenada: la cola sigue con la próxima
                        break; // fallo transitorio: cortar el ciclo para no martillar la red
                    }
                }
                return true;
            });
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
     * Judgment Day Fase 1 R1: fechas de asistencia con una subida diaria todavía
     * sin confirmar en la nube (pending o dead). U2d (compactación de
     * tombstones) debe consultar esto antes de borrar un tombstone vencido —
     * si su fecha está acá, borrarlo destruiría la única evidencia local del
     * borrado antes de que llegara a propagarse.
     */
    async getUnconfirmedDailyDateKeys() {
        const all = await _getAll();
        return new Set(
            all.filter(e => e && e.kind === 'daily' && (e.status === 'pending' || e.status === 'dead'))
               .map(e => e.dateKey)
        );
    },

    /**
     * Vacía el outbox COMPLETO (pending + dead). Fase 0.5: las operaciones
     * que adoptan una fuente de verdad nueva ("Descargar y Reemplazar",
     * "Borrar Local", "Borrar Nube") deben purgar los pendientes viejos —
     * si no, el drenado del próximo login/online sube datos de ANTES de la
     * operación y pisa/borra justo lo que el usuario eligió conservar.
     * @returns {Promise<boolean>} true si purgó; false si IndexedDB falló
     *   (nunca lanza — el caller decide si advertir, pero no debe reventar).
     */
    async clearAll() {
        // JD-F5: incrementar la generación ANTES de limpiar, para que un flush
        // en vuelo corte su iteración stale aunque el clear tarde o falle.
        _purgeGeneration++;
        try {
            await indexedDBService.clear(OUTBOX);
            return true;
        } catch (e) {
            console.warn('⚠️ No se pudo vaciar el outbox de sync:', e);
            return false;
        }
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
