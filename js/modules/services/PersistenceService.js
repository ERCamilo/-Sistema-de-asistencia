/**
 * 💾 PersistenceService.js - Central de Persistencia
 * Coordina el guardado de datos entre IndexedDB, LocalStorage y Firebase.
 */

import { state, stateManager } from '../core/AppState.js';
import { buildAttendanceIndex, invalidateEmployeeStats, invalidateAllStats } from '../core/AppState.js';
import FirebaseService from './FirebaseService.js';
import { PayrollClosureRepository } from '../features/payroll/PayrollClosureRepository.js';
import indexedDBService from './IndexedDBService.js';
import dataService from './DataService.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { PositionRepository } from './PositionRepository.js';
import { LeaderRepository } from './LeaderRepository.js';
import { unionById } from './EmployeeMerge.js';
import { backfillNestedIds } from './LoanIdBackfill.js';
import { SyncStatus } from './SyncStatus.js';
import { recordEntitiesSyncOk } from './EntitiesSyncStamp.js';
import { saveOutcomeNotifier } from './SaveOutcomeNotifier.js';
import { SYNC_PAUSE_ENABLED, isSyncPaused } from './SyncPauseService.js';
import { shouldAttemptAutoSnapshot } from './AutoSnapshotPolicy.js';
import { MainSyncStore, initMainSyncLifecycle } from './MainSyncStore.js';
import { createMirrorCadence, getMirrorCadenceMs } from './MirrorCadence.js';
import { redactSensitiveBackup } from './BackupRedaction.js';
import { Notification as NotificationSystem } from '../components/Notification.js';
import { generateUUID, slugify } from '../utils/Helpers.js';
import { regeneratePettyCashIds } from './PettyCashIdRegen.js';
import { PettyCashStore } from '../features/pettycash/PettyCashStore.js';
import { debug } from '../utils/Debug.js';
import { stampAttendanceWrite, tombstoneAttendanceWrite } from '../features/attendance/AttendanceRecordWriter.js';
import { createAttendanceRangeLoader } from './AttendanceRangeLoader.js';
import { createAttendanceCachePruner } from './AttendanceCachePruner.js';
import { peekEntityScope, entityInScope, sameEffectiveProject, effectiveProjectId } from '../features/projects/ProjectContext.js';
import { sanitizeExportConfig } from './ExportConfigSanitizer.js';

// Importar clases de entidad para inflar datos
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';
import { Attendance } from '../features/attendance/Attendance.js';
import { getDemoSeed } from '../data/DemoSeed.js';

// ⚡ Debounce de guardado: colapsa llamadas rápidas en un solo guardado
let _saveDebounceTimer = null;
let _pendingSaveOptions = {};

const _attendanceRangeLoader = createAttendanceRangeLoader({
    fetchRange: (startDate, endDate) => FirebaseService.getAttendanceRange(startDate, endDate),
    readAttendance: () => state.attendance || {},
    writeAttendance: attendance => stateManager.silentSetState({ attendance }),
    persistRecords: records => indexedDBService.batchUpdate('attendance', records),
    onApplied: () => {
        invalidateAllStats();
        buildAttendanceIndex();
    }
});

/** Ensures an explicit date range is complete before navigation/reporting. */
export function ensureAttendanceRange(startDate, endDate) {
    return _attendanceRangeLoader.ensureRange(startDate, endDate);
}

export function ensureAllAttendanceHistory() {
    return _attendanceRangeLoader.ensureAll();
}

const _attendanceCachePruner = createAttendanceCachePruner({
    readAttendance: () => state.attendance || {},
    writeAttendance: attendance => stateManager.silentSetState({ attendance }),
    getProtectedDateKeys: () => MainSyncStore.getUnconfirmedDailyDateKeys(),
    // F1.5 (ADR-008): la retención respeta el alcance activo — nunca evicta
    // registros de otro proyecto efectivo. peekEntityScope es sync y fail-open.
    getScope: () => peekEntityScope(),
    deleteRecords: keys => indexedDBService.batchDelete('attendance', keys),
    onPruned: () => {
        invalidateAllStats();
        buildAttendanceIndex();
    }
});

/** Removes only safe local attendance cache entries; never emits cloud writes. */
export function pruneAttendanceCache() {
    return _attendanceCachePruner.prune();
}

function _notifySyncError(e) {
    // Registra el fallo de nube en SyncStatus (lo refleja el badge de sync de
    // forma persistente). El TOAST de fallo de nube ahora lo emite el
    // SaveOutcomeNotifier — en AMARILLO ("guardado solo en este equipo"), no en
    // rojo — y solo para guardados que el usuario pidió anunciar. Así no se
    // duplica ni se spamea en cada sync de fondo.
    SyncStatus.markError(e);
}

// 🗑️ Cola de ids de empleados a borrar de la subcolección de Firebase
// la próxima vez que saveApplicationData drene (Tarea #18).
// Usada por el wizard de duplicados cuando consume un duplicado cloud-only:
// el state local ya no lo tiene, pero su doc remoto sigue en
// users/{uid}/employees/{id} y hay que limpiarlo.
const _pendingCloudDeletes = new Set();

// 🗑️ Colas análogas para CARGOS y LÍDERES (Schema v3). En el modelo
// granular, borrar un cargo/líder localmente deja huérfano su doc en
// users/{uid}/positions|leaders/{id} (saveMany solo hace upsert, nunca
// borra). Estas colas se drenan en el próximo save, solo con schemaVersion
// >= 3 (que es cuando estas entidades viven en su subcolección per-doc).
const _pendingCloudPositionDeletes = new Set();
const _pendingCloudLeaderDeletes = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// 💾 Persistencia de colas de borrado en localStorage
// Las tres colas son en-memoria; sin persistencia, un page reload descartaría
// ids pendientes y sus docs en Firestore quedarían huérfanos.
// ─────────────────────────────────────────────────────────────────────────────

const _PENDING_DELETES_LS_KEY = 'asistencia_pending_cloud_deletes';
// Marca DEVICE-LOCAL del último INTENTO de snapshot automático (no se mirror-ea
// a la nube, a diferencia de state.settings.lastSnapshotTimestamp). Frena la
// tormenta de reintentos cuando createSnapshot falla persistentemente.
const _SNAPSHOT_ATTEMPT_LS_KEY = 'asistencia_last_snapshot_attempt';

function _persistDeleteQueues() {
    if (typeof localStorage === 'undefined') return;
    const data = {
        employees: [..._pendingCloudDeletes],
        positions: [..._pendingCloudPositionDeletes],
        leaders:   [..._pendingCloudLeaderDeletes]
    };
    const total = data.employees.length + data.positions.length + data.leaders.length;
    try {
        if (total === 0) {
            localStorage.removeItem(_PENDING_DELETES_LS_KEY);
        } else {
            localStorage.setItem(_PENDING_DELETES_LS_KEY, JSON.stringify(data));
        }
    } catch (e) {
        console.warn('⚠️ No se pudo persistir la cola de borrados pendientes:', e);
    }
}

/** Carga los ids pendientes desde localStorage y los agrega a los Sets en-memoria. */
export function loadDeleteQueuesFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
        const raw = localStorage.getItem(_PENDING_DELETES_LS_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        (data.employees || []).forEach(id => { if (id) _pendingCloudDeletes.add(String(id)); });
        (data.positions || []).forEach(id => { if (id) _pendingCloudPositionDeletes.add(String(id)); });
        (data.leaders   || []).forEach(id => { if (id) _pendingCloudLeaderDeletes.add(String(id)); });
        const total = _pendingCloudDeletes.size + _pendingCloudPositionDeletes.size + _pendingCloudLeaderDeletes.size;
        if (total > 0) {
            debug.log(`🗑️ Cola de borrados recuperada del storage: ${total} doc(s) pendiente(s)`);
        }
    } catch (e) {
        console.warn('⚠️ Error al leer la cola de borrados del storage (ignorando):', e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🕒 lastCloudSavedAt — persistir timestamp de la última sync exitosa
// ─────────────────────────────────────────────────────────────────────────────

let _syncPersistenceUnsub = null;

/**
 * Pre-loads SyncStatus with the persisted lastCloudSavedAt timestamp so the
 * sync badge shows the correct "Sincronizado · hace Xm" text from the very
 * first render after a page reload, instead of "Aún no sincronizado".
 *
 * Safe to call multiple times (no-op when the value is missing or invalid).
 *
 * @param {object|null} settings - state.settings object (or null/undefined).
 */
export function warmUpSyncStatus(settings) {
    const ts = settings?.lastCloudSavedAt;
    if (typeof ts === 'number' && Number.isFinite(ts)) {
        SyncStatus.markSynced(ts);
    }
}

/**
 * Subscribes to SyncStatus so that every successful cloud write (markSynced)
 * stores the timestamp in state.settings.lastCloudSavedAt.
 *
 * Idempotent: calling more than once unsubscribes the previous listener
 * first, so the state is only updated once per markSynced call.
 *
 * Call this once from loadApplicationData() after state is populated.
 */
export function initSyncPersistence() {
    if (_syncPersistenceUnsub) {
        _syncPersistenceUnsub();
        _syncPersistenceUnsub = null;
    }
    _syncPersistenceUnsub = SyncStatus.subscribe(ts => {
        // null means reset() was called (e.g. logout). We intentionally
        // keep the last value so the user can still see "last sync was at…".
        if (ts === null) return;
        if (!state.settings) state.settings = {};
        state.settings.lastCloudSavedAt = ts;
    });
}

/**
 * Encolar un id de empleado para borrar del cloud en el próximo save.
 * Defensivo: ignora ids falsy.
 */
export function enqueueCloudEmployeeDelete(id) {
    if (!id) return;
    const key = String(id).trim();
    if (!key) return;
    _pendingCloudDeletes.add(key);
    _persistDeleteQueues();
    // U9: TAMBIÉN encolar en el outbox durable — misma id, misma garantía
    // extra que el resto (retry en 'online' + dead-lettering). La cola
    // Set+localStorage sigue siendo el camino primario (drenado en cada
    // save); esto sólo agrega la red de seguridad del outbox en paralelo.
    MainSyncStore.enqueueDelete('employee', key, state?.settings?.schemaVersion)
        .catch(e => console.warn('⚠️ Error encolando borrado de empleado en el outbox:', e));
}

/**
 * 🪦 Encola el TOMBSTONE (soft-delete) de un empleado en el outbox durable.
 * A diferencia de enqueueCloudEmployeeDelete (hard-delete, usado por el wizard
 * de fusión), este pasa `deletedAt` para que el flush escriba una lápida en
 * vez de borrar el doc — el borrado sobrevive al multi-dispositivo y no
 * resucita desde un dispositivo que estaba offline. El `deletedAt` es el
 * momento REAL del borrado (no el del flush): el LWW lo necesita para que una
 * edición posterior pueda revivir al empleado.
 */
export function enqueueEmployeeTombstone(id, deletedAt) {
    if (!id) return;
    const key = String(id).trim();
    if (!key) return;
    const ts = Number.isFinite(deletedAt) ? deletedAt : Date.now();
    MainSyncStore.enqueueDelete('employee', key, state?.settings?.schemaVersion, { deletedAt: ts })
        .catch(e => console.warn('⚠️ Error encolando tombstone de empleado en el outbox:', e));
}

/** Encola varios ids de empleados con una sola escritura a localStorage. */
export function enqueueCloudEmployeeDeleteBatch(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const schemaVersion = state?.settings?.schemaVersion;
    ids.forEach(id => {
        if (!id) return;
        const key = String(id).trim();
        if (!key) return;
        _pendingCloudDeletes.add(key);
        // Judgment Day #2: el wizard de duplicados fusiona varios ids a la vez
        // con este batch (no con el singular) — sin esto, esos ids sólo tenían
        // la durabilidad extra del outbox si sobrevivían hasta el próximo
        // loadApplicationData (que los siembra desde la cola legacy). Misma
        // paridad que enqueueCloudEmployeeDelete.
        MainSyncStore.enqueueDelete('employee', key, schemaVersion)
            .catch(e => console.warn('⚠️ Error encolando borrado de empleado (batch) en el outbox:', e));
    });
    _persistDeleteQueues();
}

/** Snapshot de la cola actual (copia). */
export function getPendingCloudDeletes() {
    return [..._pendingCloudDeletes];
}

/** Vacía la cola. Llamado tras drenar exitosamente o desde tests. */
export function clearPendingCloudDeletes() {
    _pendingCloudDeletes.clear();
}

/** Encolar un id de CARGO para borrar de la subcolección en el próximo save. */
export function enqueueCloudPositionDelete(id) {
    if (!id) return;
    const key = String(id).trim();
    if (!key) return;
    _pendingCloudPositionDeletes.add(key);
    _persistDeleteQueues();
    // U9: ver comentario en enqueueCloudEmployeeDelete.
    MainSyncStore.enqueueDelete('position', key, state?.settings?.schemaVersion)
        .catch(e => console.warn('⚠️ Error encolando borrado de cargo en el outbox:', e));
}
export function getPendingCloudPositionDeletes() {
    return [..._pendingCloudPositionDeletes];
}
export function clearPendingCloudPositionDeletes() {
    _pendingCloudPositionDeletes.clear();
}

/**
 * Fase 0.5 (U1): purga TODO lo pendiente hacia la nube — las 3 colas legacy
 * (Sets + su clave de localStorage) y el outbox durable de MainSyncStore.
 *
 * La llaman las operaciones que adoptan una fuente de verdad nueva ("Borrar
 * Local", "Descargar y Reemplazar", "Borrar Nube"): sin esta purga, el
 * drenado del próximo login/online sube escrituras y borrados de ANTES de
 * la operación, pisando o borrando justo lo que el usuario eligió conservar
 * (bugs ALTA #1 y #2 de la auditoría 2026-07-01).
 *
 * Best-effort deliberado: las colas legacy se limpian SIEMPRE (son síncronas
 * y no pueden fallar); si la purga del outbox falla, se reporta con false
 * pero nunca se lanza — el caller decide si advertir al usuario.
 * @returns {Promise<boolean>} true si TODO se purgó; false si el outbox falló
 */
export async function purgeAllPendingCloudWrites() {
    _pendingCloudDeletes.clear();
    _pendingCloudPositionDeletes.clear();
    _pendingCloudLeaderDeletes.clear();
    try { localStorage.removeItem(_PENDING_DELETES_LS_KEY); } catch (_) { /* noop */ }
    return MainSyncStore.clearAll();
}

/** Encolar un id de LÍDER para borrar de la subcolección en el próximo save. */
export function enqueueCloudLeaderDelete(id) {
    if (!id) return;
    const key = String(id).trim();
    if (!key) return;
    _pendingCloudLeaderDeletes.add(key);
    _persistDeleteQueues();
    // U9: ver comentario en enqueueCloudEmployeeDelete.
    MainSyncStore.enqueueDelete('leader', key, state?.settings?.schemaVersion)
        .catch(e => console.warn('⚠️ Error encolando borrado de líder en el outbox:', e));
}
export function getPendingCloudLeaderDeletes() {
    return [..._pendingCloudLeaderDeletes];
}
export function clearPendingCloudLeaderDeletes() {
    _pendingCloudLeaderDeletes.clear();
}

/**
 * Drena un Set de ids borrando su doc remoto vía repo.deleteOne(id).
 * Reintentable: los ids que fallen quedan re-encolados en el mismo Set.
 */
async function _drainDeleteSet(set, repo) {
    if (set.size === 0) return;
    const ids = [...set];
    set.clear();
    const failed = [];
    for (const id of ids) {
        try {
            await repo.deleteOne(id);
        } catch (e) {
            console.error(`⚠️ Error borrando doc cloud ${id}, re-encolando:`, e);
            failed.push(id);
        }
    }
    failed.forEach(id => set.add(id));
    // Sync storage: remove drained ids, keep only failed ones.
    _persistDeleteQueues();
}

/**
 * Drena las colas de borrado contra sus subcolecciones remotas.
 *   - Empleados: requiere schemaVersion >= 2.
 *   - Cargos y líderes: requieren schemaVersion >= 3 (granular desde v3).
 * En cuentas por debajo del umbral es noop y los ids quedan encolados
 * para cuando la cuenta migre. Sin sesión, noop total.
 */
async function _drainPendingCloudDeletes() {
    if (!globalThis.currentUser) return;
    const v = state?.settings?.schemaVersion;
    const vNum = typeof v === 'number' ? v : 0;

    if (vNum >= 2) {
        await _drainDeleteSet(_pendingCloudDeletes, EmployeeRepository);
    }
    if (vNum >= 3) {
        await _drainDeleteSet(_pendingCloudPositionDeletes, PositionRepository);
        await _drainDeleteSet(_pendingCloudLeaderDeletes, LeaderRepository);
    }
}

/**
 * 🚚 Guards inyectados para MainSyncStore.flush() (U7 — bandeja de pendientes
 * hacia la nube). Se construyen FRESCOS en cada llamada (no una vez y
 * cacheados): sesión/pausa/estado pueden cambiar entre que una entrada se
 * encoló y el momento en que efectivamente se vacía la cola.
 */
function _mainSyncGuards() {
    const REPO_BY_ENTITY = { employee: EmployeeRepository, position: PositionRepository, leader: LeaderRepository };
    return {
        hasSession: () => !!globalThis.currentUser,
        isApplyingRemote: () => !!globalThis._isApplyingRemoteData,
        isPaused: () => SYNC_PAUSE_ENABLED && isSyncPaused(),
        cloudWatermark: () => state._lastKnownCloudUpdatedAt || 0,
        // Fase 2 U1 (fix de regresión): saveFullState vuelve a escribir las
        // entidades por default (ver FirebaseService.saveFullState) — pero acá
        // se saltan con skipEntities:true porque la entrada 'entities' del
        // outbox (encolada aparte en _executeSave, sin gate de watermark) YA
        // las escribe por su cuenta; sin este flag se subirían dos veces.
        saveMirror: (snapshot) => FirebaseService.saveFullState(snapshot, { skipEntities: true }),
        saveDaily: (dateKey, records, scope) => FirebaseService.saveDailyAttendance(dateKey, records, { scope }),
        saveEntities: (employees, positions, leaders, schemaVersion) => FirebaseService.saveEntities(employees, positions, leaders, schemaVersion),
        // Fase 2B U2: settings viaja por su propio kind del outbox
        // (MainSyncStore.enqueueSettings en _executeSave), sin gate de
        // watermark en _resolveCloudCall — mismo motivo que saveEntities:
        // FirebaseService.saveSettings ya es un full-replace LWW por
        // dispositivo.
        saveSettings: (settingsMap) => FirebaseService.saveSettings(settingsMap),
        savePayrollEmployees: async (employees, schemaVersion) => {
            if (Number(schemaVersion) < 2) {
                throw new TypeError('Unsupported payroll employee schema');
            }
            const expectedIds = [...new Set(
                (employees || []).map(employee => String(employee?.id || '')).filter(Boolean)
            )];
            if (expectedIds.length === 0) return;
            const result = await EmployeeRepository.saveMany(employees, { mergeRemote: true });
            const savedIds = new Set((result?.saved || []).map(employee => String(employee?.id || '')));
            if (expectedIds.some(id => !savedIds.has(id))) {
                throw new Error('No se pudo sincronizar el estado de pagos de la nómina');
            }
        },
        savePayrollClosure: (closure) => PayrollClosureRepository.saveOne(closure),
        deleteEntity: (entity, id, deletedAt) => {
            const repo = REPO_BY_ENTITY[entity];
            if (!repo) return Promise.resolve();
            // 🪦 Empleados con deletedAt → tombstone (soft-delete robusto: no
            // resucita desde un dispositivo que estaba offline al borrar).
            // Cargos/líderes y borrados legacy sin deletedAt → hard-delete.
            if (entity === 'employee' && Number.isFinite(deletedAt) && typeof repo.tombstoneOne === 'function') {
                return repo.tombstoneOne(id, deletedAt);
            }
            return repo.deleteOne(id);
        },
        // Feedback de UI (toast honesto y anillos de asistencia): cualquier escritura
        // al outbox reporta a SaveOutcomeNotifier. Los anillos de asistencia
        // confirman de inmediato con la subida 'daily' o con 'mirror'.
        onCloudResult: (ok, err, entry) => {
            saveOutcomeNotifier.recordCloudResult(ok);
            if (entry?.kind === 'mirror' || entry?.kind === 'daily') {
                globalThis.eventBus?.emit?.('sync:mirror-result', { ok });
            }
            // Fase 2 U4: marca de agua para el badge "pendiente de subir" del
            // ledger de préstamos. Se estampa con el ts del ENQUEUE (momento
            // de la foto del snapshot), no Date.now() — lo editado después de
            // encolar no estaba en esa foto y sigue pendiente.
            if (ok && entry?.kind === 'entities') {
                recordEntitiesSyncOk(entry.ts);
            }
            // Judgment Day #3: deleteOne() y saveDailyAttendance() nunca llaman
            // a SyncStatus.markSynced() (sólo saveFullState/saveOne lo hacen),
            // así que sin esto un borrado o una asistencia granular que drena
            // bien tras un fallo previo dejaba el badge en rojo para siempre.
            // clearError() apaga el badge sin pisar lastSyncedAt (a diferencia
            // de markSynced, que sí lo actualiza a ahora).
            if (ok) SyncStatus.clearError();
            if (!ok && err) _notifySyncError(err);
        }
    };
}

/**
 * 🚚 Fuerza el drenado de la bandeja de pendientes cloud AHORA, sin esperar
 * al próximo 'online' o al próximo save. Se usa al iniciar sesión: si el
 * usuario cerró la pestaña con subidas a medio terminar y vuelve a entrar
 * (en vez de reconectar sin recargar), esto reanuda esas subidas.
 */
export function drainMainSyncOutbox() {
    return MainSyncStore.flush(_mainSyncGuards());
}

/**
 * 🔁 Drenado HASTA VACIAR (Judgment Day 2026-07-11, jueces A+B): un flush()
 * suelto puede ser un no-op silencioso — MainSyncStore.flush tiene un mutex
 * (`_flushing`) y si el drenado fire-and-forget de _executeSave lo agarró
 * primero, la llamada explícita resuelve al instante sin subir nada. La
 * restauración necesita la garantía real ("la nube ya tiene el estado
 * restaurado antes de reanudar la descarga"), así que acá se sondea
 * pendingCount entre flushes hasta que el outbox quede en 0 o se agoten los
 * intentos. Devuelve true si quedó vacío; false si quedaron pendientes (el
 * outbox es durable y reintenta solo — el caller debe AVISAR, no mentir).
 */
export async function drainMainSyncOutboxUntilEmpty({ maxAttempts = 12, delayMs = 500 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await MainSyncStore.flush(_mainSyncGuards());
        } catch (e) {
            console.warn('⚠️ drainMainSyncOutboxUntilEmpty: flush falló (reintenta):', e);
        }
        let pending;
        try {
            pending = await MainSyncStore.pendingCount();
        } catch (e) {
            console.warn('⚠️ drainMainSyncOutboxUntilEmpty: no se pudo leer pendingCount:', e);
            return false;
        }
        if (pending === 0) return true;
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
}

/**
 * 🔁 Reintento EXPLÍCITO del usuario (botón "Reintentar" del badge/toast):
 * revive primero las entradas 'dead' (agotaron MAX_FLUSH_ATTEMPTS contra un
 * error que en su momento parecía transitorio — ej. cuota de Firestore
 * agotada) y RECIÉN DESPUÉS drena. Sin esto, drainMainSyncOutbox() crudo
 * jamás las toca (flush() sólo procesa 'pending', MainSyncStore.js) — el
 * usuario podía tocar "Reintentar" para siempre sin que la subida vencida
 * volviera a intentarse, aunque la causa raíz (ej. la cuota) ya se hubiera
 * resuelto.
 *
 * Deliberadamente NO se llama desde el drenado automático (login, 'online',
 * cada guardado) — requeueDeadEntries() resetea attempts a 0, así que
 * revivir automáticamente una entrada con un error REALMENTE permanente
 * (permisos, etc.) la haría re-morir en cada ciclo pasivo para siempre. Acá
 * es una acción consciente del usuario, sabiendo que puede estar reintentando
 * algo que ya falló varias veces.
 */
export async function retryFailedCloudSync() {
    await MainSyncStore.requeueDeadEntries();
    return drainMainSyncOutbox();
}

// 🔘 U12: cablear el botón "Reintentar" del toast honesto (SaveOutcomeNotifier)
// a retryFailedCloudSync (revive 'dead' + drena). Se hace acá (no dentro de
// SaveOutcomeNotifier.js) para evitar un import circular — SaveOutcomeNotifier.js
// no necesita saber nada de PersistenceService/MainSyncStore, sólo expone un
// setter genérico. PettyCash (que importa el mismo singleton) NUNCA llama
// setCloudRetryHandler, así que sus fallos siguen sin botón — no compite con
// este wiring.
saveOutcomeNotifier.setCloudRetryHandler(retryFailedCloudSync);

/**
 * 🌱 U9: siembra el outbox durable con los ids YA pendientes de la cola
 * legacy (Set + localStorage, rehidratada por loadDeleteQueuesFromStorage()
 * antes de esta carga). Un usuario que actualiza la app puede tener ids
 * pendientes de borrar desde ANTES de que existiera el outbox — sin esto,
 * esos ids nunca ganarían el retry-en-'online' ni el dead-lettering; sólo
 * drenarían en el próximo save (como ya hacían).
 *
 * Se llama DESPUÉS de que `state.settings` está poblado (para capturar el
 * schemaVersion real), en ambas ramas de loadApplicationData. No toca la
 * cola legacy — sólo la LEE (getPendingCloud*Deletes ya devuelve copias).
 */
function _seedMainSyncOutboxFromLegacyDeletes() {
    const schemaVersion = state?.settings?.schemaVersion;
    getPendingCloudDeletes().forEach(id =>
        MainSyncStore.enqueueDelete('employee', id, schemaVersion).catch(() => { /* noop, ya está en la cola legacy */ })
    );
    getPendingCloudPositionDeletes().forEach(id =>
        MainSyncStore.enqueueDelete('position', id, schemaVersion).catch(() => { /* noop */ })
    );
    getPendingCloudLeaderDeletes().forEach(id =>
        MainSyncStore.enqueueDelete('leader', id, schemaVersion).catch(() => { /* noop */ })
    );
}

/**
 * ⚡ SINCRONIZACIÓN CON FIREBASE (Mirror Sync)
 *
 * Change B: el primer snapshot se encola de inmediato y los siguientes se
 * coalescen durante cinco minutos. El trailing conserva sólo el estado más
 * reciente; `.flush()` lo fuerza antes de ocultar/cerrar la página.
 */
export const syncFirebaseMirrorDebounced = (function() {
    const flushOutbox = () => MainSyncStore.flush(_mainSyncGuards()).catch(e => {
        console.warn('⚠️ Error vaciando la bandeja de pendientes cloud:', e);
        return false;
    });
    const cadence = createMirrorCadence({
        intervalMs: () => getMirrorCadenceMs(state?.settings?.mirrorCadence),
        emit: (snapshot) => MainSyncStore.enqueueMirror(snapshot).then(flushOutbox),
        onError: (e) => console.warn('⚠️ Error encolando el mirror diferido:', e)
    });

    const debounced = function(state, options = {}) {
        // El guard de DataOps va ANTES del gate: una operación destructiva no
        // puede dejar un trailing que repueble el outbox después de la purga.
        if (isDataOperationInProgress()) return Promise.resolve(false);
        return cadence.offer(state, options).catch(e => {
            console.warn('⚠️ Error encolando el mirror:', e);
            return false;
        });
    };

    debounced.flush = function(state) {
        if (isDataOperationInProgress()) return Promise.resolve(false);
        // Mantener el drenado inmediato histórico aunque no haya trailing. Si
        // sí lo hay, su emit vuelve a drenar DESPUÉS de encolarlo.
        const draining = flushOutbox();
        const pending = arguments.length > 0 ? cadence.flush(state) : cadence.flush();
        return Promise.all([pending, draining]).then(([emitted]) => emitted).catch(e => {
            console.warn('⚠️ Error vaciando el mirror pendiente:', e);
            return false;
        });
    };
    debounced.discard = () => cadence.discard();

    return debounced;
})();

/**
 * 💾 GUARDADO SEGURO EN INDEXEDDB
 */
export async function saveToIndexedDB(options = {}) {
    // 🧹 JD-F4 (ALTO): el guard U2 va en la PRIMITIVA, no sólo en sus callers.
    // El flush del BatchedSaver (app.js) llama saveToIndexedDB directo — un
    // flush ya agendado por requestIdleCallback podía dispararse dentro de la
    // ventana del wipe y re-escribir el state en memoria a IndexedDB,
    // resucitando datos recién borrados.
    if (_localDataWipeInProgress) return false;
    try {
        // Use raw (non-proxy) state to avoid DataCloneError in IndexedDB structured clone
        const rawState = stateManager.getState();
        await indexedDBService.saveState(rawState, options);
        debug.log('💾 Datos guardados en IndexedDB');
        return true;
    } catch (error) {
        console.error('❌ Error guardando en IndexedDB:', error);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🧹 Fase 0.5 (U2): guard de "borrado local en curso"
// "Borrar Local" y "Descargar y Reemplazar" limpian los stores y llaman
// location.reload(). El reload dispara pagehide → flushPendingSave() → que
// RE-PERSISTÍA el estado en memoria (BatchedSaver, debounce pendiente) y
// RE-ENCOLABA un mirror pre-borrado en el outbox recién purgado, deshaciendo
// parcialmente el borrado. Con el flag levantado, todo guardado implícito es
// un no-op hasta el reload (o hasta endLocalDataWipe, para flujos que abortan
// a mitad de camino — p.ej. red caída en "Descargar y Reemplazar").
// ─────────────────────────────────────────────────────────────────────────────
let _localDataWipeInProgress = false;
let _dataOperationDepth = 0;

/** Bloquea todo guardado implícito (debounce, pagehide) durante un borrado local. */
export function beginLocalDataWipe() {
    syncFirebaseMirrorDebounced.discard();
    _localDataWipeInProgress = true;
}

/** Restaura el guardado normal — para flujos de borrado/reemplazo que abortan. */
export function endLocalDataWipe() { _localDataWipeInProgress = false; }

/** ¿Hay un borrado local en curso? (para diagnósticos y otros guards) */
export function isLocalDataWipeInProgress() { return _localDataWipeInProgress; }

/** Bloquea escrituras cloud implícitas mientras DataOps modifica una fuente completa. */
export function beginDataOperation() {
    syncFirebaseMirrorDebounced.discard();
    _dataOperationDepth += 1;
}

/** Libera un nivel del guard; el contador tolera operaciones anidadas. */
export function endDataOperation() { _dataOperationDepth = Math.max(0, _dataOperationDepth - 1); }

/** ¿Hay una operación destructiva/reemplazo de DataOps en curso? */
export function isDataOperationInProgress() { return _dataOperationDepth > 0; }

/**
 * 💾 FUNCIÓN PRINCIPAL DE PERSISTENCIA
 * Orquesta el guardado local y la sincronización con la nube.
 */
export function saveApplicationData(options = {}) {
    // 🧹 U2: durante un borrado local, NADA debe re-persistir el estado en
    // memoria — re-escribiría a IndexedDB/localStorage justo lo que el
    // usuario acaba de borrar.
    if (_localDataWipeInProgress) return;

    // ⚡ Marcar el estado local como "más reciente" DE INMEDIATO, antes del debounce.
    // Esto impide que Firebase (eco o datos de otro dispositivo) sobrescriba cambios
    // locales durante la ventana de 300 ms en que el guardado aún está en cola.
    // Sin esto, un nuevo empleado/cargo/líder añadido al state puede perderse si
    // el listener de Firebase aplica datos remotos antes de que _executeSave corra.
    if (!globalThis._isApplyingRemoteData && !options.localOnly && !options.requireLocalSuccess) {
        if (!state.settings) state.settings = {};
        state.settings.localUpdatedAt = Date.now();
    }

    // Acumular opciones. Las FECHAS pendientes (dateKey/dateKeys) se UNEN, no
    // se pisan: una llamada nueva dentro de la ventana de debounce — o un save
    // inmediato que la corta — no debe cancelar la subida diaria de otra fecha
    // ya pendiente (Judgment Day R3: un purge con dateKeys+immediate pisaba el
    // dateKey debounced y esa fecha nunca subía; el mirror excluye attendance,
    // así que nada la reintentaba). Para el resto de opciones gana la última
    // llamada (mismo criterio que el overwrite original); `announce` es
    // pegajoso y se maneja aparte, abajo.
    const _pendingDates = new Set([
        ...(Array.isArray(_pendingSaveOptions.dateKeys) ? _pendingSaveOptions.dateKeys : []),
        ...(_pendingSaveOptions.dateKey ? [_pendingSaveOptions.dateKey] : []),
        ...(Array.isArray(options.dateKeys) ? options.dateKeys : []),
        ...(options.dateKey ? [options.dateKey] : [])
    ]);
    // Preservar el `announce` pegajoso ANTES del overwrite: los FLAGS
    // (immediate/clearFirst/skipValidation/force) siguen la última llamada (no
    // deben arrastrarse: p.ej. un clearFirst previo no debe colarse en un save
    // de asistencia), pero `announce` y las FECHAS sí son pegajosos.
    const _prevAnnounce = _pendingSaveOptions.announce;
    _pendingSaveOptions = { ...options };
    if (_pendingDates.size > 0) {
        _pendingSaveOptions.dateKeys = [..._pendingDates];
        delete _pendingSaveOptions.dateKey; // canal unificado: _executeSave lee dateKeys
    }
    // `announce` es PEGAJOSO dentro de la ventana de debounce: si CUALQUIER
    // llamada pidió anunciar el resultado, el guardado colapsado lo anuncia.
    if (options.announce) {
        _pendingSaveOptions.announce = options.announce;
        // 💬 Fase 0 del toast honesto: reconocimiento INSTANTÁNEO ("guardando…")
        // síncrono con la acción del usuario. La escritura local completa puede
        // tardar ~1s; sin esto el usuario no ve nada durante ese tiempo.
        if (state.isDataLoaded && !globalThis._isApplyingRemoteData) {
            saveOutcomeNotifier.recordSaveStarted({
                label: typeof options.announce === 'string' ? options.announce : null
            });
        }
    } else if (_prevAnnounce) {
        // Esta llamada no anuncia, pero una previa de la misma ventana sí:
        // conservar la etiqueta para que el guardado colapsado igual reporte su
        // resultado. NO se re-dispara recordSaveStarted (ya corrió en la 1ra).
        _pendingSaveOptions.announce = _prevAnnounce;
    }

    // ⚡ Immediate-save mode: bypass the 300ms debounce for critical operations
    // (e.g., creating a loan, recording a payment) where data loss on a fast F5
    // would be unacceptable. Without this, a refresh within ~300ms can discard
    // the pending save entirely.
    if (options.immediate) {
        clearTimeout(_saveDebounceTimer);
        const opts = _pendingSaveOptions;
        _pendingSaveOptions = {};
        return _executeSave(opts);
    }

    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
        const opts = _pendingSaveOptions;
        _pendingSaveOptions = {};
        _executeSave(opts);
    }, 300);
}

/**
 * 🚿 Flush any pending debounced save synchronously. Useful before navigation
 * away (beforeunload) or after critical operations.
 */
export function flushPendingSave() {
    // 🧹 U2: durante un borrado local NO drenar nada — este es exactamente el
    // pagehide del location.reload() del borrado, y drenar acá re-persistiría
    // asistencia recién borrada y re-encolaría un mirror pre-borrado en el
    // outbox recién purgado.
    if (_localDataWipeInProgress) return false;

    // R3: drenar PRIMERO el BatchedSaver de asistencia ENTRANTE (ventana idle de
    // hasta 1000ms). Esa asistencia llega de Firebase por una vía separada del
    // debounce local de 300ms y, si la pestaña se cierra dentro de la ventana, se
    // pierde de IndexedDB. Va antes del early-return porque normalmente NO hay un
    // _saveDebounceTimer pendiente cuando sólo se acumuló asistencia entrante.
    // Su saveToIndexedDB no depende de _isApplyingRemoteData, así que drena igual.
    //
    // JD#4 (best-effort honesto): flushNow() es async y NO se await-ea (no se puede:
    // los handlers de pagehide/visibilitychange son síncronos). En visibilitychange
    // (página viva) la escritura a IndexedDB completa sin problema. En un pagehide
    // de cierre duro es best-effort, igual que el _executeSave del save principal —
    // no existe un flush SÍNCRONO para IndexedDB (sendBeacon es sólo para red). Aun
    // así es estrictamente mejor que antes, cuando el BatchedSaver no se drenaba en
    // absoluto en pagehide.
    if (typeof window !== 'undefined' && window._attendanceBatchedSaver) {
        window._attendanceBatchedSaver.flushNow();
    }

    if (!_saveDebounceTimer) {
        syncFirebaseMirrorDebounced.flush();
        return false;
    }
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = null;
    const opts = _pendingSaveOptions;
    _pendingSaveOptions = {};
    // El save aún no ofreció su snapshot a la cadencia. Forzarlo acá garantiza
    // que pagehide/hidden encole el estado más reciente, no sólo el trailing
    // anterior.
    _executeSave({ ...opts, forceMirror: true });
    return true;
}

// Some writes must be durable on this device before they are eligible for
// cloud synchronization. This helper exposes the real local fallback result.
async function _persistLocalState(options = {}) {
    if (globalThis._isApplyingRemoteData) return false;

    let localOk = false;
    if (state.useIndexedDB) {
        try {
            // Granular saves skip the full integrity scan because they only
            // persist a bounded attendance slice.
            const isGranularSave = !!options.dateKey ||
                (Array.isArray(options.dateKeys) && options.dateKeys.length > 0);
            if (!isGranularSave && !options.skipValidation) {
                await validateDataIntegrity();
            }

            const rawState = stateManager.getState();
            await indexedDBService.saveState(rawState, options);
            localOk = true;
        } catch (error) {
            const errorName = error?.name || '';
            const errorMessage = error?.message || 'Error desconocido';

            if (errorName === 'ConstraintError' || errorMessage.includes('ConstraintError')) {
                console.warn('⚡ Conflicto de integridad en IndexedDB; cayendo a localStorage para no perder el dato.');
                const fallbackOk = dataService ? dataService.saveAll() : false;
                localOk = fallbackOk === true;
                NotificationSystem.error(localOk
                    ? '⚠️ Conflicto de datos detectado — guardado en respaldo local'
                    : '❌ Conflicto de datos detectado');
            } else {
                console.error('❌ Error fatal en persistencia local:', error);
                const fallbackOk = dataService ? dataService.saveAll() : false;
                localOk = fallbackOk === true;
                if (!localOk) {
                    NotificationSystem.error('❌ Error al guardar localmente: ' + errorMessage);
                }
            }
        }
    } else {
        const fallbackOk = dataService ? dataService.saveAll() : false;
        localOk = fallbackOk === true;
    }
    return localOk;
}

async function _executeSave(options = {}) {
    if (!state.isDataLoaded) {
        console.warn('⚠️ Intento de guardado ignorado: datos aún no cargados.');
        return { localOk: false, cloudRequested: false };
    }

    const _logDates = Array.isArray(options.dateKeys) ? options.dateKeys.join(', ') : options.dateKey;
    console.log('🔵 PersistenceService: _executeSave() iniciado', _logDates ? `para fecha(s): ${_logDates}` : '');

    // ──────────────────────────────────────────────────────────
    // 🛡️ OUTGOING CONFLICT CHECK
    // Before pushing to Firebase, verify that the cloud's last-known timestamp
    // is not meaningfully newer than the local state.  If it is, another device
    // wrote to Firebase more recently and we'd silently overwrite those changes.
    // Instead: emit an event, let app.js ask the user, and skip Firebase this time.
    //
    // Grace period: 10 s absorbs Firebase's own echo latency (the same-device
    // roundtrip where cloud timestamp == local timestamp ± a few ms).
    //
    // CRITICAL: this check must share ALL the same guards as the Firebase
    // block below — otherwise it fires false positives (e.g. during
    // _isApplyingRemoteData = true, the local timestamp is intentionally NOT
    // refreshed and a stale value would trip the check on every incoming sync).
    //
    // NOTE: we read localUpdatedAt BEFORE updating it so the conflict check
    // compares the cloud's timestamp against the PREVIOUS local save, not NOW.
    // Updating localUpdatedAt first would always make _localTime >= _cloudTime.
    // ──────────────────────────────────────────────────────────
    const OUTGOING_CONFLICT_GRACE_MS = 10_000;
    // ⏸️ La pausa es POR DISPOSITIVO: isSyncPaused() lee de localStorage, no de
    // state.settings (que se sincroniza a Firebase). Así un flag viejo en la
    // nube no puede re-pausar este equipo, y pausar aquí no afecta a los demás.
    // El kill-switch SYNC_PAUSE_ENABLED permite desactivar la función entera.
    const _isPausedEffective = SYNC_PAUSE_ENABLED && isSyncPaused();
    const _canSyncFirebase = globalThis.currentUser
        && !globalThis._isApplyingRemoteData
        && !isDataOperationInProgress()
        && !_isPausedEffective
        && !options.localOnly;
    const _cloudTime = state._lastKnownCloudUpdatedAt || 0;
    // Already set in saveApplicationData(); reflects when save was requested.
    const _localTime = state.settings?.localUpdatedAt || 0;
    const _hasOutgoingConflict = _canSyncFirebase
        && !options.force
        && _cloudTime > _localTime + OUTGOING_CONFLICT_GRACE_MS;

    // Refresh to actual execution time (after conflict check).
    if (!globalThis._isApplyingRemoteData) {
        if (!state.settings) state.settings = {};
        state.settings.localUpdatedAt = Date.now();
    }

    let _localOk = true;
    let _localConfirmed = false;
    if (options.requireLocalSuccess) {
        _localOk = await _persistLocalState(options);
        _localConfirmed = true;
        if (!_localOk && !globalThis._isApplyingRemoteData) {
            stateManager.batchSetState(() => {
                state.settings.localUpdatedAt = _localTime;
            });
        }
    }

    if (_hasOutgoingConflict && !state._outgoingConflictReviewPending) {
        state._outgoingConflictReviewPending = true;
        debug.log(
            `⚠️ PersistenceService: conflicto saliente detectado.` +
            ` Cloud@${new Date(_cloudTime).toISOString()} > Local@${new Date(_localTime).toISOString()}`
        );
        if (globalThis.eventBus) {
            globalThis.eventBus.emit('sync:outgoing-conflict', {
                localTime: _localTime,
                cloudTime: _cloudTime
            });
        }
    }

    // ☀️ Sincronización con Firebase
    // Skipped when not authenticated, applying remote data, paused, localOnly,
    // or an outgoing conflict is pending user review.
    // _cloudAttempted = ¿se está intentando escribir a la nube en este guardado?
    // Lo usa el toast honesto (SaveOutcomeNotifier) para saber si debe esperar
    // el resultado de la nube (verde/amarillo) o anunciar solo el local (verde).
    const _cloudAttempted = _canSyncFirebase && !_hasOutgoingConflict &&
        (!options.requireLocalSuccess || _localOk);
    if (_cloudAttempted) {
        // 1+2. U7 — Bandeja de pendientes hacia la nube (MainSyncStore) en vez
        // de llamar a Firestore directo. Si la pestaña se cierra antes de que
        // la subida termine, la entrada sigue en IndexedDB y se reintenta sola
        // al reconectar/volver a entrar (no se pierde).
        const _outboxEnqueues = [];
        // Un solo guardado puede subir VARIAS fechas (options.dateKeys, p.ej. el
        // purge de historial multi-fecha) o una sola (options.dateKey). Se
        // procesan en UN _executeSave → un daily por fecha pero UN solo mirror/
        // entities/flush, en vez de N _executeSave (Judgment Day Ronda 2: N
        // llamadas immediate encolaban N mirrors completos = write amplification).
        const _dailyDateKeys = Array.isArray(options.dateKeys)
            ? options.dateKeys.filter(Boolean)
            : (options.dateKey ? [options.dateKey] : []);
        // F1.5 (ADR-008 slice 2) — dueño del payload saliente por día: el
        // snapshot síncrono de EntityScope se captura AHORA (momento del
        // guardado) y viaja en la entrada del outbox, para que el flush filtre
        // con el scope DEL REMITENTE aunque el usuario cambie de proyecto
        // antes de que la cola se vacíe. Flag OFF ⇒ scope disabled ⇒
        // entityInScope es identidad (paridad legacy exacta).
        const _dailyScope = peekEntityScope();
        for (const dk of _dailyDateKeys) {
            const dayRecords = {};
            // Guion (-) y guion bajo (_): simétrico con IndexedDBService.saveState.
            // Sin el guion bajo, un registro con esa clave se guardaría local
            // pero jamás se encolaría a la nube (el mirror excluye attendance).
            const suffixes = [`-${dk}`, `_${dk}`];
            Object.entries(state.attendance).forEach(([key, record]) => {
                if (suffixes.some(s => key.endsWith(s)) && entityInScope(record, _dailyScope)) {
                    dayRecords[key] = record;
                }
            });
            // Judgment Day ronda 2 (Juez A): mismo hueco async que JD#6 cerró
            // para el mirror — enqueueDaily también hace await antes de
            // escribir a IndexedDB, y dayRecords guardaba referencias PROXY
            // (vivas) a state.attendance[key], no una copia. Clon con el
            // mismo fallback defensivo que el mirror: si algo no serializa,
            // subir la referencia viva es mejor que abortar el guardado local.
            let _dayRecords = dayRecords;
            try {
                _dayRecords = JSON.parse(JSON.stringify(dayRecords));
            } catch (e) {
                console.warn('⚠️ No se pudo clonar la asistencia diaria para la nube; se sube la referencia viva:', e);
            }
            _outboxEnqueues.push(MainSyncStore.enqueueDaily(dk, _dayRecords, _dailyScope));
        }
        // Foto INMUTABLE capturada AHORA — MainSyncStore coalesce a una sola
        // entrada 'mirror' pendiente (la última gana). Judgment Day #6:
        // enqueueMirror es async (await antes de escribir a IndexedDB), así
        // que pasarle la referencia VIVA de stateManager.getState() dejaba una
        // ventana donde una mutación posterior de state (otro guardado, otra
        // acción) podía filtrarse en lo que termina subiendo a la nube. El
        // clon JSON (mismo patrón que ya usa FirebaseService.saveFullState al
        // subir) la hace inmutable de verdad, no sólo "raw sin proxy".
        //
        // Judgment Day ronda 2 (Juez A): ese JSON.stringify corre SÍNCRONO acá,
        // sin try/catch, dentro de _executeSave (invocada fire-and-forget desde
        // el debounce/flushPendingSave, sin .catch() en la cadena). Un valor no
        // serializable (BigInt, etc.) tiraba una excepción que abortaba TODO el
        // resto de _executeSave — incluido el guardado LOCAL, que va más abajo.
        // Fallback a la referencia viva (el hueco angosto que JD#6 cerraba)
        // antes que perder el guardado local entero.
        let _mirrorSnapshot;
        try {
            _mirrorSnapshot = JSON.parse(JSON.stringify(stateManager.getState()));
            // H-05 A5: mirror egress — exportConfig transitorio nunca al outbox cloud
            sanitizeExportConfig(_mirrorSnapshot);
        } catch (_mirrorErr) {
            _mirrorSnapshot = {};
            try { Object.assign(_mirrorSnapshot, stateManager.getState()); } catch {}
            sanitizeExportConfig(_mirrorSnapshot);
            delete _mirrorSnapshot.exportConfig; // idempotent if helper already did, ensures no live mutation path missed
        }
        _outboxEnqueues.push(syncFirebaseMirrorDebounced(_mirrorSnapshot, {
            force: options.forceMirror || options.awaitOutboxEnqueue
        }));

        // Judgment Day / Fase 2 U1: las entidades (empleados/puestos/líderes) se
        // encolan APARTE del mirror — mismo snapshot ya clonado (_mirrorSnapshot),
        // sin re-serializar. Este canal NO tiene el gate de watermark del mirror
        // (ver MainSyncStore._resolveCloudCall): un dispositivo que estuvo offline
        // y edita un préstamo ya no queda atrapado detrás de "la nube parece más
        // nueva" — cada entidad se mergea fino por su propio updatedAt.
        _outboxEnqueues.push(MainSyncStore.enqueueEntities(
            _mirrorSnapshot.employees || [],
            _mirrorSnapshot.positions || [],
            _mirrorSnapshot.leaders || [],
            _mirrorSnapshot.settings?.schemaVersion
        ));

        // Fase 2B U2: settings (preferencias del dispositivo) también viaja
        // APARTE del mirror, mismo motivo que 'entities' arriba — su propio
        // kind del outbox, sin gate de watermark (FirebaseService.saveSettings
        // ya es un full-replace LWW por dispositivo). Reusa el mismo
        // _mirrorSnapshot ya clonado, sin re-serializar.
        _outboxEnqueues.push(MainSyncStore.enqueueSettings(_mirrorSnapshot.settings || {}));

        // Disparar el drenado recién DESPUÉS de que las entradas terminen de
        // encolarse (evita la carrera de que flush() lea el outbox antes de
        // que el enqueue haya escrito) — pero sin `await` acá: el guardado
        // LOCAL (más abajo) nunca debe esperar a la nube.
        const _outboxReady = Promise.all(_outboxEnqueues)
            .catch(e => console.warn('⚠️ Error encolando al outbox:', e));
        _outboxReady.finally(() => {
            MainSyncStore.flush(_mainSyncGuards()).catch(e =>
                console.warn('⚠️ Error vaciando la bandeja de pendientes cloud:', e)
            );
        });
        // Restauración (Judgment Day 2026-07-11): el caller que va a drenar
        // hasta vaciar necesita garantía de que las entradas YA están en el
        // outbox antes de sondear pendingCount — si no, un sondeo temprano ve
        // 0 y "drena" en falso. Encolar es una escritura LOCAL a IndexedDB;
        // esperar esto NO es esperar a la nube.
        if (options.awaitOutboxEnqueue) await _outboxReady;

        // 2.b Drenar la cola de borrados pendientes en la nube.
        // Ocurre solo si schemaVersion >= 2 (cuentas migradas). Es seguro
        // hacerlo en paralelo con el mirror debounced — operan sobre rutas
        // distintas (data/current vs employees/{id}).
        _drainPendingCloudDeletes().catch(e =>
            console.warn('⚠️ Error drenando cola de cloud deletes (no crítico):', e)
        );

        // 3. Backup Automático (Snapshots)
        const freq = state.settings?.backupFrequency || 'none';
        if (freq !== 'none') {
            const now = Date.now();
            const lastBackup = state.settings?.lastSnapshotTimestamp || 0;
            // Cooldown DEVICE-LOCAL del último intento: sin esto, si createSnapshot
            // falla persistentemente (cuota, doc >1MB, offline), el guard de horario
            // seguía pasando en CADA save y se re-serializaba el estado completo una
            // y otra vez. No usamos state.settings (se mirror-ea a la nube y
            // suprimiría los backups de otros dispositivos).
            let lastAttempt = 0;
            try { lastAttempt = Number(localStorage.getItem(_SNAPSHOT_ATTEMPT_LS_KEY)) || 0; } catch (_) { /* noop */ }

            if (shouldAttemptAutoSnapshot({ freq, now, lastSuccess: lastBackup, lastAttempt })) {
                // Estampar el intento ANTES de la llamada (device-local), así un
                // fallo no dispara un reintento inmediato en el próximo save.
                try { localStorage.setItem(_SNAPSHOT_ATTEMPT_LS_KEY, String(now)); } catch (_) { /* noop */ }
                const rawState = stateManager.getState();
                FirebaseService.createSnapshot(rawState, 'auto', 'daily-auto').then(() => {
                    state.settings.lastSnapshotTimestamp = now;
                }).catch(e => console.error('Error en backup automático:', e));
            }
        }
    }

    // 💾 Persistencia Local. Guarded operations already completed this
    // step before any cloud enqueue; ordinary saves retain the legacy order.
    if (!_localConfirmed) {
        _localOk = await _persistLocalState(options);
    }

    // 💬 Toast HONESTO del resultado (solo si el caller lo pidió con announce).
    // Éxito local → el notifier muestra el provisional y espera la nube
    // (verde local+nube / amarillo solo-local), o el verde final si no hay
    // nube. Fallo local → rojo (además del toast de error inline con el
    // detalle: el spinner de la fase 0 no puede quedarse colgado).
    if (options.announce && !globalThis._isApplyingRemoteData) {
        const _label = typeof options.announce === 'string' ? options.announce : null;
        saveOutcomeNotifier.recordLocalResult({ localOk: _localOk, cloudExpected: _cloudAttempted, label: _label });
    }

    // 📡 Emitir evento de guardado
    if (globalThis.eventBus && (!options.requireLocalSuccess || _localOk)) {
        globalThis.eventBus.emit('data:saved', { timestamp: Date.now() });
    }

    return { localOk: _localOk, cloudRequested: _cloudAttempted };
}

/**
 * 📂 CARGA INICIAL DE DATOS
 * Maneja la migración de LocalStorage a IndexedDB si es necesario.
 */
export async function loadApplicationData() {
    try {
        debug.log('📂 PersistenceService: Iniciando carga de datos...');

        // 🛡️ H5: pedir almacenamiento persistente (best-effort). Sin esto el
        // navegador puede desalojar IndexedDB bajo presión de espacio (Safari
        // es agresivo) y la app caería a datos viejos o vacíos.
        try {
            if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
                navigator.storage.persist().then(granted => {
                    debug.log(`🗄️ Almacenamiento persistente: ${granted ? 'concedido' : 'denegado (best-effort)'}`);
                }).catch(() => { /* best-effort */ });
            }
        } catch (_) { /* navegadores sin soporte */ }

        // Rehidratar colas de borrado pendientes del storage para que
        // docs que quedaron sin borrar en sesiones anteriores se reintenten.
        loadDeleteQueuesFromStorage();

        // 1. Intentar cargar desde IndexedDB (Fase 2+)
        const idbData = await indexedDBService.loadFullState();
        
        if (idbData && (idbData.employees?.length > 0 || idbData.positions?.length > 0)) {
            debug.log('✅ Datos cargados desde IndexedDB');
            
            // Inflar datos (convertir a instancias de clase)
            const inflatedData = {
                employees: (idbData.employees || []).map(e => e instanceof Employee ? e : new Employee(e)),
                positions: (idbData.positions || []).map(p => p instanceof Position ? p : new Position(p)),
                leaders: (idbData.leaders || []).map(l => l instanceof Leader ? l : new Leader(l)),
                attendance: {},
                settings: idbData.settings || {}
            };

            // Inflar asistencia
            Object.entries(idbData.attendance || {}).forEach(([key, val]) => {
                inflatedData.attendance[key] = val instanceof Attendance ? val : new Attendance(val);
            });

            // Poblar el estado global
            Object.assign(state, inflatedData);
            state.isDataLoaded = true;
            state.useIndexedDB = true;

            // 🕒 Conectar SyncStatus → state.settings.lastCloudSavedAt.
            // Idempotente: llamadas múltiples (ej. hot-reload, demos) reemplazan
            // el listener anterior en lugar de apilarlo.
            initSyncPersistence();
            // U8: armar el drenado del outbox al volver la conexión. Idempotente
            // (un solo listener 'online' real por sesión, ver MainSyncStore).
            initMainSyncLifecycle(_mainSyncGuards);
            // U9: ids de borrado pendientes de antes de esta actualización.
            _seedMainSyncOutboxFromLegacyDeletes();

            // 🟢 Pre-cargar SyncStatus con el último timestamp persistido para
            // que el badge muestre "Sincronizado · hace Xm" desde el primer
            // render, en lugar de "Aún no sincronizado".
            warmUpSyncStatus(state.settings);

            // Retención local: se ejecuta después de rehidratar el outbox para
            // proteger fechas pending/dead y antes de calcular reportes.
            try {
                const retention = await pruneAttendanceCache();
                if (retention.evicted > 0) {
                    debug.log(`🧹 Caché de asistencia: ${retention.evicted} registro(s) anterior(es) a ${retention.cutoffDate} retirado(s).`);
                }
            } catch (error) {
                console.warn('⚠️ No se pudo aplicar la retención local de asistencia:', error);
            }

            // 🛡️ Validar integridad. Si hubo correcciones, persistir en IndexedDB
            // de forma inmediata pero sin subir a Firebase todavía.
            // Se guarda un contador en state para que app.js le pregunte al
            // usuario si desea subir las correcciones a la nube después del
            // primer render (ver _checkSanitizationCloudSyncPrompt en app.js).
            const fixesOnLoad = await validateDataIntegrity();
            if (fixesOnLoad > 0) {
                debug.log(`🛡️ Persistiendo ${fixesOnLoad} corrección(es) de integridad (solo local)...`);
                // localOnly:true → escribe IndexedDB pero omite el bloque de Firebase.
                saveApplicationData({ force: true, localOnly: true });
                // Señal para la capa de UI: mostrar prompt de subida después del render.
                state._pendingSanitizationCloudSync = fixesOnLoad;
            }

            stateManager.markAttendanceDirty(); // Asegurar reconstrucción total tras carga masiva
            // Bulk load → the dirty flag covers the index lazily, but statsCache.mtd
            // is NOT cleared by it. Wholesale-clear it (load-bearing after Paso 4):
            // stale monthly stats from the previous dataset would corrupt payroll.
            invalidateAllStats();
            return true;
        }

        // 2. Fallback a LocalStorage (Migración o Legacy)
        console.log('🔄 No se detectaron datos en IndexedDB. Buscando en LocalStorage...');
        const hasDataInLS = dataService.loadAll();
        
        if (hasDataInLS) {
            debug.log('✅ Datos cargados desde LocalStorage');
            state.isDataLoaded = true;
            initSyncPersistence();
            initMainSyncLifecycle(_mainSyncGuards); // U8: mismo cableado que la rama IndexedDB
            _seedMainSyncOutboxFromLegacyDeletes(); // U9: mismo cableado que la rama IndexedDB
            warmUpSyncStatus(state.settings);

            // Si el navegador soporta IndexedDB, migramos de inmediato
            if (indexedDBService.isSupported()) {
                console.log('🚀 Migrando datos de LocalStorage a IndexedDB...');
                await indexedDBService.saveState(state);
                state.useIndexedDB = true;
                localStorage.setItem('migrated-to-idb', 'true');
                // 🛡️ H5: eliminar la copia legacy de localStorage. Si se queda,
                // un desalojo futuro de IndexedDB la "resucitaría" como verdad
                // (datos congelados de meses atrás) y podría subirla a la nube.
                // El saveState de arriba ya lanzó si la migración falló.
                try {
                    localStorage.removeItem('asistencia-data');
                    debug.log('🧹 Copia legacy de localStorage eliminada tras migración a IndexedDB');
                } catch (_) { /* noop */ }
            }

            await validateDataIntegrity();
            return true;
        }

        console.log('ℹ️ No hay datos guardados para cargar');
        state.isDataLoaded = true;
        return false;

    } catch (error) {
        // 🧨 Apertura de IndexedDB acotada (bloqueada por otra ventana o
        // timeout): NO se tragan acá. Deben propagar al catch de arranque de
        // app.js, que muestra el diálogo accionable (recargar / continuar sin
        // datos locales). Tragarlos dejaría el boot "silenciosamente vacío".
        if (
            error?.name === 'IndexedDBOpenBlockedError' ||
            error?.name === 'IndexedDBOpenTimeoutError'
        ) {
            throw error;
        }
        console.error('❌ Error fatal al cargar datos:', error);
        state.isDataLoaded = true; // No bloquear la UI
        return false;
    }
}

/**
 * 🌱 CARGAR DATOS DEMO EN LA BASE DE DATOS
 * Limpia la base de datos actual e inyecta la semilla de prueba.
 */
export async function loadDemoDataIntoDB() {
    try {
        console.log('🌱 PersistenceService: Iniciando carga de datos DEMO...');
        const seed = getDemoSeed();
        
        // 1. Guardar en IndexedDB limpiando primero
        await indexedDBService.saveState(seed.data, { clearFirst: true });
        
        // 2. Recargar el estado global desde la base de datos recién poblada
        await loadApplicationData();
        
        // 3. Marcar como modo demo
        state.usingDemoData = true;
        
        console.log('✅ Datos DEMO cargados y persistidos correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error cargando datos demo:', error);
        throw error;
    }
}

/**
 * 🪦 Fase 1 (U2d): ventana de retención de tombstones de asistencia. Más larga
 * que cualquier desconexión razonable de un dispositivo — si se compactara
 * antes, un equipo que vuelve tras una ausencia larga podría revivir un
 * borrado que todavía no terminó de propagarse a todos los dispositivos.
 */
export const TOMBSTONE_RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 días

/**
 * 🛡️ VALIDACIÓN DE INTEGRIDAD
 * Limpia referencias huérfanas para evitar crashes en la UI.
 */
export async function validateDataIntegrity() {
    let fixes = 0;

    // 0. Backfill missing ids in loans / advances / bonuses / deductions
    //    and their nested payments / installments. Items without ids are
    //    silently dropped by unionById during cloud merge, causing data loss.
    //    This must run before any merge cycle touches the data.
    const backfilled = backfillNestedIds(state.employees);
    if (backfilled > 0) {
        console.log(`🔑 PersistenceService: ${backfilled} id(s) asignado(s) a ítems sin id (préstamos/pagos/cuotas).`);
        fixes += backfilled;
    }

    const positionIds = new Set(state.positions.map(p => p.id));
    const leaderIds = new Set(state.leaders.map(l => l.id));

    // 🛑 Guardia anti-masacre (incidente de campo 2026-07-11): un catálogo
    // vacío o a medio cargar (restauración, LiveSync que reemplaza la lista
    // entera, merge parcial) hacía que esta limpieza tratara a TODOS los
    // empleados como huérfanos: vaciaba positions, estampaba
    // positionsUpdatedAt=now y ese borrado GANABA el LWW y se propagaba a la
    // nube y a todos los dispositivos. La limpieza es para huérfanos
    // AISLADOS; si el daño sería masivo, la señal es "catálogo incompleto"
    // y NO se toca nada hasta que el catálogo esté sano. Umbrales (Judgment
    // Day, jueces A+B — el piso de ">=3" dejaba sin guardia a las empresas
    // chicas):
    //   a) catálogo vacío con referencias;
    //   b) ≥2 empleados afectados que además son ≥25% de los que tienen
    //      puestos;
    //   c) CUALQUIER empleado que quedaría en CERO posiciones — esa es la
    //      firma de la masacre, no de un huérfano (deletePosition bloquea
    //      puestos activos/asignados/con historial, así que perder el único
    //      puesto por limpieza legítima es casi imposible). Mejor un huérfano
    //      visible que un borrado propagado.
    const _empWithPositions = state.employees.filter(e => (e.positions || []).length > 0);
    const _empAffected = _empWithPositions.filter(e => e.positions.some(pid => !positionIds.has(pid)));
    const _empLosingAll = _empAffected.filter(e => e.positions.every(pid => !positionIds.has(pid)));
    const positionsCatalogSuspicious =
        (positionIds.size === 0 && _empAffected.length > 0) ||
        (_empAffected.length >= 2 && _empAffected.length * 4 >= _empWithPositions.length) ||
        (_empLosingAll.length > 0);
    if (positionsCatalogSuspicious) {
        console.error(
            `🛑 validateDataIntegrity: limpieza de puestos OMITIDA — ${_empAffected.length}/${_empWithPositions.length} ` +
            `empleado(s) perderían puestos con un catálogo de ${positionIds.size}. Esto es señal de catálogo ` +
            `incompleto (carga/merge/restauración parcial), no de huérfanos reales.`
        );
    }

    // Misma guardia para líderes, con rama proporcional (Judgment Day, juez
    // B): la corrupción PARCIAL del catálogo (queda 1 líder de 6) también
    // anulaba leaderId de casi todas las posiciones, estampaba y propagaba.
    const _posWithLeader = state.positions.filter(p => p.leaderId);
    const _posAffectedLeaders = _posWithLeader.filter(p => !leaderIds.has(p.leaderId));
    const leadersCatalogSuspicious =
        (leaderIds.size === 0 && _posWithLeader.length > 0) ||
        (_posAffectedLeaders.length >= 2 && _posAffectedLeaders.length * 4 >= _posWithLeader.length);
    if (leadersCatalogSuspicious) {
        console.error(
            `🛑 validateDataIntegrity: limpieza de líderes OMITIDA — ${_posAffectedLeaders.length}/` +
            `${_posWithLeader.length} posición(es) perderían su líder con un catálogo de ${leaderIds.size}. ` +
            `Señal de catálogo incompleto, no de huérfanos reales.`
        );
    }

    // 1. Limpiar posiciones en empleados
    // 🔁 Fix del bucle de sanitización (test de campo 2026-07-06): TODA
    // corrección dentro de un empleado/puesto DEBE estampar updatedAt (la
    // misma regla del choke point de préstamos). Sin la estampa,
    // EntityUploadTracker filtra el registro ("nada cambió"), la corrección
    // nunca sube, la nube queda sucia, y el merge entrante (mergePositions es
    // UNIÓN, no LWW) resucita el huérfano → corregir → guardar → espejo →
    // el otro dispositivo valida → corrige → ... ping-pong infinito quemando
    // cuota. La estampa hace que la corrección gane el merge y converja.
    // Y la inversa importa igual: si NO hubo corrección, NO estampar —
    // estampar de más re-subiría a todos los empleados en cada validación.
    if (!positionsCatalogSuspicious) state.employees.forEach(emp => {
        let empFixed = false;
        if (emp.positions) {
            const validPositions = emp.positions.filter(pid => positionIds.has(pid));
            if (validPositions.length !== emp.positions.length) {
                emp.positions = validPositions;
                fixes++;
                empFixed = true;
            }
        }

        // 2. Limpiar positionSalaries con IDs que ya no existen
        if (emp.positionSalaries) {
            Object.keys(emp.positionSalaries).forEach(posId => {
                if (!positionIds.has(posId)) {
                    delete emp.positionSalaries[posId];
                    fixes++;
                    empFixed = true;
                }
            });
        }

        if (empFixed) {
            const now = Date.now();
            emp.updatedAt = now;
            // El fix tocó positions/positionSalaries → estampar también la
            // frescura fina de puestos, para que el LWW de puestos en
            // EmployeeMerge reconozca la corrección como la más reciente y el
            // huérfano no resucite en el próximo merge.
            emp.positionsUpdatedAt = now;
        }
    });

    // 3. Limpiar líderes en posiciones. F1.4: con flag ON, un líder presente
    //    pero de OTRO proyecto efectivo también es huérfano — la referencia
    //    cross-proyecto no sobrevive (F0.4 §2: ausente ⇒ predeterminado).
    //    La guardia anti-masacre de arriba sigue protegiendo ambos caminos.
    const _entityScope = peekEntityScope();
    if (!leadersCatalogSuspicious) state.positions.forEach(pos => {
        if (!pos.leaderId) return;
        let orphan = !leaderIds.has(pos.leaderId);
        if (!orphan && _entityScope.enabled) {
            const leader = state.leaders.find(l => l.id === pos.leaderId);
            orphan = leader ? !sameEffectiveProject(leader, pos, _entityScope) : true;
        }
        if (orphan) {
            pos.leaderId = null;
            pos.updatedAt = Date.now(); // misma regla — sin estampa no sube ni converge
            fixes++;
        }
    });

    // 4. Limpiar positionHours en asistencia
    if (!positionsCatalogSuspicious) Object.values(state.attendance).forEach(att => {
        if (att.positionHours) {
            const validPh = att.positionHours.filter(ph => positionIds.has(ph.positionId));
            if (validPh.length !== att.positionHours.length) {
                att.positionHours = validPh;
                fixes++;
            }
        }
            // ⚡ P3-OPT: Si la posición seleccionada no existe por ID, puede ser un "Legacy ID" (un número largo de Firebase)
            // Intentamos buscar una posición activa con un nombre similar antes de borrarla.
            if (att.selectedPosition && !positionIds.has(att.selectedPosition)) {
                const legacyId = att.selectedPosition;
                // Si es un ID numérico largo (indicativo de Firebase), no lo borramos de inmediato
                // ya que la sanitización en el otro módulo puede estar por ocurrir.
                if (legacyId.length > 10 && !isNaN(legacyId)) {
                    // Esperar a que la sanitización actúe, no borrar nada
                } else {
                    att.selectedPosition = null;
                    fixes++;
                }
            }
        });

    // 5. Compactar tombstones de asistencia vencidos (Fase 1, U2d). Solo borra
    //    la copia LOCAL — el field en la nube no se toca acá (fuera de
    //    alcance de esta fase; para entonces ya se propagó a todos los
    //    dispositivos que estuvieran conectados dentro de la ventana).
    // Judgment Day Fase 1 R1: NO compactar un tombstone cuya subida diaria
    // sigue pendiente/muerta en el outbox — borrarlo ahí destruiría la única
    // evidencia local del borrado antes de que llegara a propagarse a la nube.
    const now = Date.now();
    const unconfirmedDateKeys = await MainSyncStore.getUnconfirmedDailyDateKeys();
    let compactedTombstones = 0;
    stateManager.batchSetState(() => {
        Object.entries(state.attendance).forEach(([key, att]) => {
            if (att.deletedAt != null && (now - att.deletedAt) > TOMBSTONE_RETENTION_MS) {
                if (unconfirmedDateKeys.has(att.date)) return; // subida sin confirmar — no compactar todavía
                delete state.attendance[key];
                compactedTombstones++;
            }
        });
        if (compactedTombstones > 0) {
            buildAttendanceIndex(); // el índice no debe referenciar claves ya compactadas
        }
    });
    if (compactedTombstones > 0) {
        fixes += compactedTombstones;
    }

    if (fixes > 0) {
        console.log(`🛡️ PersistenceService: ${fixes} referencia(s) huérfana(s) corregida(s)`);
    }
    return fixes;
}

/**
 * 🔄 REGENERACIÓN DE IDs PARA CLONADO
 * Genera nuevos UUIDs para todos los datos locales para poder 
 * subirlos a una cuenta nueva de Firebase/Supabase sin conflictos.
 */
export async function prepareDataForNewAccount() {
    console.log('🔄 Iniciando regeneración de IDs para nueva cuenta...');
    
    try {
        await indexedDBService.clear('leaders');
        await indexedDBService.clear('positions');
        await indexedDBService.clear('employees');
        await indexedDBService.clear('attendance');
        console.log('Sweep: Almacenes de IndexedDB limpiados');
    } catch (clearError) {
        console.warn('⚠️ Error limpiando stores:', clearError);
    }

    const idMap = new Map();
    const now = Date.now();

    // 1. Líderes
    state.leaders.forEach(l => {
        const oldId = l.id;
        l.id = generateUUID();
        l.updatedAt = now;
        idMap.set(oldId, l.id);
    });

    // 2. Posiciones
    state.positions.forEach(p => {
        const oldId = p.id;
        p.id = generateUUID();
        p.updatedAt = now;
        if (p.leaderId && idMap.has(p.leaderId)) {
            p.leaderId = idMap.get(p.leaderId);
        }
        idMap.set(oldId, p.id);
    });

    // 3. Empleados
    state.employees.forEach(e => {
        const oldId = e.id;
        e.id = generateUUID();
        e.updatedAt = now;
        if (e.positions) {
            e.positions = e.positions.map(pid => idMap.has(pid) ? idMap.get(pid) : pid);
        }
        idMap.set(oldId, e.id);
    });

    // 4. Asistencia
    const newAttendance = {};
    Object.entries(state.attendance).forEach(([oldKey, att]) => {
        const oldEmpId = att.employeeId || oldKey.split('-')[0];
        const newEmpId = idMap.get(oldEmpId) || oldEmpId;
        const newKey = `${newEmpId}-${att.date}`;
        
        att.id = generateUUID();
        att.employeeId = newEmpId;
        att.updatedAt = now;
        if (att.selectedPosition && idMap.has(att.selectedPosition)) {
            att.selectedPosition = idMap.get(att.selectedPosition);
        }
        if (att.positionHours) {
            att.positionHours.forEach(ph => {
                if (idMap.has(ph.positionId)) ph.positionId = idMap.get(ph.positionId);
            });
        }
        newAttendance[newKey] = att;
    });
    state.attendance = newAttendance;
    // Full key rewrite (every empId/date key changed) → total index rebuild +
    // wholesale stats clear: the old empIds' monthly stats are now meaningless.
    invalidateAllStats();
    buildAttendanceIndex();

    // 5. 🧾 Caja chica (L7): la cuenta clonada no debe conservar los ids de la
    // cuenta anterior. Regeneramos ids (con referencias cruzadas remapeadas),
    // re-encadenamos los comprobantes locales al id nuevo, limpiamos la outbox
    // vieja (sus entradas referencian ids/cuenta anteriores) y re-encolamos
    // todo vía PettyCashStore.save — así la outbox lo sube al entrar a la
    // cuenta nueva. Best-effort: un fallo aquí no aborta el clonado de nómina.
    try {
        const localPC = await PettyCashStore.loadLocal();
        const hasPC = localPC.projects.length || localPC.periods.length || localPC.movements.length;
        if (hasPC) {
            const regen = regeneratePettyCashIds(localPC, generateUUID);

            // Re-encadenar comprobantes (fotos locales) al id nuevo del movimiento.
            for (const mov of localPC.movements) {
                const newId = regen.idMap.get(mov?.id);
                if (!newId || !mov?.receiptStatus) continue;
                try {
                    const rec = await indexedDBService.getReceipt(mov.id);
                    if (rec?.dataUrl) {
                        await indexedDBService.saveReceipt(newId, rec.dataUrl, rec.status || 'pending');
                        await indexedDBService.deleteReceipt(mov.id);
                    }
                } catch { /* best-effort: el comprobante queda huérfano, no bloquea */ }
            }

            await indexedDBService.clear('pettyCashProjects');
            await indexedDBService.clear('pettyCashPeriods');
            await indexedDBService.clear('pettyCashMovements');
            await indexedDBService.clear('pettyCashOutbox');

            for (const p of regen.projects) await PettyCashStore.save('projects', p);
            for (const p of regen.periods) await PettyCashStore.save('periods', p);
            for (const m of regen.movements) await PettyCashStore.save('movements', m);

            // Reflejar en el estado en memoria si la pestaña ya está cargada.
            if (state.pettyCash && typeof state.pettyCash === 'object') {
                state.pettyCash.projects = regen.projects;
                state.pettyCash.periods = regen.periods;
                state.pettyCash.movements = regen.movements;
            }
            console.log(`🧾 Caja chica preparada para cuenta nueva: ${regen.projects.length} proyecto(s), ${regen.movements.length} movimiento(s) con ids nuevos re-encolados`);
        }
    } catch (e) {
        console.warn('⚠️ No se pudo preparar la caja chica para la cuenta nueva:', e);
    }

    await saveApplicationData();
    console.log('✅ IDs regenerados exitosamente');
    return true;
}

/**
 * 💾 SISTEMA DE AUTO-BACKUP (sessionStorage)
 */
export function createAutoBackup() {
    try {
        // 🔒 Redactar campos financieros/PII: el auto-backup es una red de
        // emergencia que puede quedar legible en sessionStorage en un equipo
        // compartido. Guardamos sólo la forma de la UI; salarios/préstamos/
        // adelantos/teléfonos se rehidratan desde IndexedDB / la nube.
        const backupData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            data: redactSensitiveBackup({
                employees: state.employees,
                positions: state.positions,
                leaders: state.leaders,
                attendance: state.attendance,
                settings: state.settings
            })
        };
        sessionStorage.setItem('attendance-backup', JSON.stringify(backupData));
    } catch (error) {
        // L8: con estados grandes el backup completo puede exceder la cuota de
        // sessionStorage (~5 MB). Antes el catch genérico lo tragaba EN SILENCIO
        // y la sesión quedaba sin red de seguridad. Ahora: ante error de cuota
        // reintentamos un respaldo REDUCIDO (sin asistencia, que es lo más
        // pesado y lo más recuperable desde la nube) y avisamos por consola.
        const isQuota = error?.name === 'QuotaExceededError' || error?.code === 22;
        if (isQuota) {
            try {
                const reduced = {
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                    reduced: true,
                    data: redactSensitiveBackup({
                        employees: state.employees,
                        positions: state.positions,
                        leaders: state.leaders,
                        settings: state.settings
                    })
                };
                sessionStorage.setItem('attendance-backup', JSON.stringify(reduced));
                console.warn('⚠️ Auto-backup: cuota de sessionStorage excedida — se guardó un respaldo REDUCIDO (sin asistencia).');
                return;
            } catch (_) { /* ni el reducido cupo: cae al reporte de abajo */ }
        }
        console.error('❌ Error en auto-backup:', error);
    }
}

export function restoreAutoBackup() {
    try {
        const backup = sessionStorage.getItem('attendance-backup');
        if (backup) {
            const parsed = JSON.parse(backup);
            if (parsed.data && state.employees.length === 0) {
                // JD#2: reinflar por constructor ANTES del Object.assign. El
                // auto-backup viene REDACTADO (sin loans/advances/positionSalaries/
                // salaryConfig...), así que un Object.assign crudo dejaría esos
                // campos en `undefined` y un loans.reduce()/advances.forEach()
                // posterior petaría justo en el escenario de emergencia. Los
                // constructores restituyen los defaults ([]/{}); los datos sensibles
                // se rehidratan luego desde la nube. Inflamos sobre parsed.data para
                // no introducir escrituras directas a `state` (1 sola asignación vía
                // Object.assign, igual que antes).
                const d = parsed.data;
                if (Array.isArray(d.employees)) {
                    d.employees = d.employees.map(e => e instanceof Employee ? e : new Employee(e));
                }
                if (Array.isArray(d.positions)) {
                    d.positions = d.positions.map(p => p instanceof Position ? p : new Position(p));
                }
                if (Array.isArray(d.leaders)) {
                    d.leaders = d.leaders.map(l => l instanceof Leader ? l : new Leader(l));
                }
                Object.assign(state, d);
                // Bulk replace → explicit coherence (this site had NONE before, and
                // Object.assign bypasses the proxy): total index rebuild + stats clear.
                invalidateAllStats();
                buildAttendanceIndex();
                NotificationSystem.success('✅ Sesión anterior restaurada');
                return true;
            }
        }
    } catch (error) {
        console.error('❌ Error restaurando backup:', error);
    }
    return false;
}

/**
 * 🧪 PRUEBA DE RESOLUCIÓN DE CONFLICTOS
 * Simula la restauración de un backup "sucio" con duplicados intencionales.
 */
export async function testConflictedRestore() {
    console.log('🧪 Iniciando prueba de restauración con CONFLICTOS...');
    
    try {
        // 1. Generar semilla con conflictos
        const conflictedSeed = getDemoSeed({ includeConflicts: true });
        console.log('📦 Backup de prueba generado (con duplicados intencionales)');
        
        // 2. Intentar restaurar usando IndexedDB
        // clearFirst: true simula una restauración limpia desde un archivo externo
        const stats = await indexedDBService.saveState(conflictedSeed.data, { clearFirst: true });
        
        // 3. Ejecutar saneamiento de puestos (donde unificamos por slug)
        const currentData = await indexedDBService.loadFullState();
        sanitizePositions(currentData);
        await indexedDBService.saveState(currentData);
        
        // 4. Recargar estado UI
        await loadApplicationData();
        
        NotificationSystem.success(`✅ Prueba completada: ${stats.deduplicated} conflictos resueltos`);
        console.log('✅ Resultado de la prueba:', stats);
        return stats;
    } catch (error) {
        console.error('❌ Error en prueba de conflictos:', error);
        NotificationSystem.error('Error en prueba de conflictos');
    }
}

/**
 * 🧹 sanitizePositions() - Unifica puestos duplicados y migra IDs a Slugs
 * Este proceso es vital para evitar errores de cálculo de nómina.
 */
export function sanitizePositions(state) {
    if (!state.positions || state.positions.length === 0) return false;

    debug.log('🧹 Iniciando sanitización de posiciones...');
    // ⚡ Opción A (IDs estables): los puestos tienen un id INMUTABLE que NO
    // se deriva del nombre. sanitize ya NO convierte ids a slug (eso hacía
    // que renombrar cambiara el id → documento nuevo + huérfano en la nube
    // per-doc). Aquí solo: (1) deduplicamos puestos con el MISMO nombre,
    // conservando el id del primero (master) y migrando referencias, y
    // (2) asignamos un id a puestos que no tengan ninguno.
    const idMap = new Map();          // ID_viejo (duplicado) -> ID_master estable
    const uniquePositions = [];
    const masterIdByKey = new Map();  // clave de dedup -> ID_master estable
    let hasChanges = false;
    // F1.4: con flag ON la identidad de dedup es `proyectoEfectivo::slug`
    // — homónimos en proyectos distintos conviven (mismo patrón que
    // analyzeConflicts). Flag OFF: slug crudo → paridad legacy exacta.
    const _dedupScope = peekEntityScope();

    state.positions.forEach(pos => {
        const slug = slugify(pos.name);
        if (!slug) return;

        // Garantizar un id estable: si falta, asignar UUID (una sola vez).
        if (!pos.id) {
            pos.id = generateUUID();
            hasChanges = true;
        }

        const dedupKey = _dedupScope.enabled
            ? `${effectiveProjectId(pos, _dedupScope)}::${slug}`
            : slug;
        if (!masterIdByKey.has(dedupKey)) {
            // Primer puesto con este nombre (en su proyecto efectivo) → master.
            masterIdByKey.set(dedupKey, pos.id);
            idMap.set(pos.id, pos.id); // identidad (no migra)
            uniquePositions.push(pos);
        } else {
            // Duplicado por NOMBRE → fusionar al master, conservando el id
            // estable del master. El doc del duplicado queda obsoleto → encolar
            // su borrado de la subcolección remota (positions/{id}).
            const masterId = masterIdByKey.get(dedupKey);
            idMap.set(pos.id, masterId);
            if (pos.id && pos.id !== masterId) enqueueCloudPositionDelete(pos.id);
            hasChanges = true;
            console.log(`🔗 Fusionando duplicado por nombre: ${pos.name} (${pos.id} -> ${masterId})`);
        }
    });

    if (!hasChanges) {
        debug.log('✨ No se encontraron duplicados ni IDs desactualizados.');
        return false;
    }

    // 1. Actualizar la lista oficial de puestos
    state.positions = uniquePositions;

    // 2. Actualizar empleados (sus arreglos de positions)
    if (state.employees) {
        state.employees.forEach(emp => {
            let empRemapped = false;
            if (Array.isArray(emp.positions)) {
                const mapped = emp.positions.map(pid => idMap.get(pid) || pid);
                const unique = [...new Set(mapped)];
                if (JSON.stringify(emp.positions) !== JSON.stringify(unique)) {
                    emp.positions = unique;
                    hasChanges = true;
                    empRemapped = true;
                }
            }
            // También actualizar positionSalaries si existen (solo si algo se
            // remapeó de verdad — reasignar sin cambios no debe estampar).
            if (emp.positionSalaries) {
                const newSalaries = {};
                let salariesRemapped = false;
                Object.entries(emp.positionSalaries).forEach(([pid, val]) => {
                    const newId = idMap.get(pid) || pid;
                    if (newId !== pid) salariesRemapped = true;
                    newSalaries[newId] = val;
                });
                if (salariesRemapped) {
                    emp.positionSalaries = newSalaries;
                    hasChanges = true;
                    empRemapped = true;
                }
            }

            // Especial: Sueldo por posición en el sistema viejo. idMap tiene
            // entradas IDENTIDAD para cada master, así que solo se marca
            // remapeado si el id REALMENTE cambia (si no, estampar de más
            // dispara un positionsUpdatedAt espurio que pisa el LWW real).
            if (emp.positionId) {
                const newPositionId = idMap.get(emp.positionId);
                if (newPositionId !== undefined && newPositionId !== emp.positionId) {
                    emp.positionId = newPositionId;
                    empRemapped = true;
                }
            }

            // 🕐 Misma disciplina de choke-point que validateDataIntegrity: la
            // corrección DEBE estampar updatedAt (sin él, EntityUploadTracker la
            // filtra y nunca sube) Y positionsUpdatedAt (sin él, pierde el LWW
            // fino de puestos contra un sello stale del otro dispositivo). Solo
            // en los empleados realmente tocados — estampar de más re-sube todo.
            if (empRemapped) {
                const now = Date.now();
                emp.updatedAt = now;
                emp.positionsUpdatedAt = now;
            }
        });
    }

    // 3. Actualizar registros de asistencia (Attendance)
    if (state.attendance) {
        Object.values(state.attendance).forEach(att => {
            if (att.positionHours) {
                att.positionHours.forEach(ph => {
                    if (idMap.has(ph.positionId)) {
                        ph.positionId = idMap.get(ph.positionId);
                    }
                });
            }
            if (att.selectedPosition && idMap.has(att.selectedPosition)) {
                att.selectedPosition = idMap.get(att.selectedPosition);
            }
            // En algunos casos el record individual tiene positionId
            if (att.records) {
                Object.values(att.records).forEach(rec => {
                    if (rec.positionId && idMap.has(rec.positionId)) {
                        rec.positionId = idMap.get(rec.positionId);
                    }
                });
            }
        });
    }

    console.log('✅ Sanitización completada.');
    return true;
}

// 🛟 Flush del guardado pendiente cuando la pestaña se oculta o se cierra.
// Sin esto, un guardado en debounce (300 ms) muere silenciosamente si el usuario
// cierra rápido la pestaña, manda la PWA a segundo plano o navega. `pagehide` es
// más fiable que `beforeunload` en móvil y PWAs; `visibilitychange` cubre el caso
// de cambio a otra app sin cerrar.
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { flushPendingSave(); });
    // visibilitychange se dispara en `document` por spec — escucharlo ahí
    // (en window solo llega por burbujeo, y no es fiable en todos los entornos).
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushPendingSave();
        });
    }
}

// Inicializar alias globales (Legacy compatibility)
globalThis.saveApplicationData = saveApplicationData;
globalThis.loadApplicationData = loadApplicationData;
globalThis.validateDataIntegrity = validateDataIntegrity;
globalThis.prepareDataForNewAccount = prepareDataForNewAccount;
globalThis.createAutoBackup = createAutoBackup;
globalThis.restoreAutoBackup = restoreAutoBackup;
globalThis.sanitizePositions = sanitizePositions; // NUEVO
globalThis.saveToLocalStorage = saveApplicationData;
globalThis.loadFromLocalStorage = loadApplicationData;
globalThis.loadDemoDataIntoDB = loadDemoDataIntoDB;
globalThis.testConflictedRestore = testConflictedRestore;

/**
 * 🔍 analyzeConflicts() - Detecta empleados duplicados por número de ficha.
 *
 * Si se pasa opts.cloudEmployees (lista de docs de users/{uid}/employees/),
 * los une con state.employees antes de agrupar, y marca cada miembro con
 * _source: 'local' | 'cloud' | 'both' para que la UI sepa de dónde viene
 * y la lógica de merge sepa si tiene que borrar el doc de la nube.
 *
 * Si un mismo id aparece en ambos lados, gana el de updatedAt mayor.
 *
 * @param {{cloudEmployees?: Array}} [opts]
 * @returns {Array} Lista de grupos de conflictos
 */
export function analyzeConflicts(opts = {}) {
    const localEmps = Array.isArray(state.employees) ? state.employees : [];
    const cloudEmps = Array.isArray(opts.cloudEmployees) ? opts.cloudEmployees : [];

    if (localEmps.length === 0 && cloudEmps.length === 0) return [];

    // 1. Unir local + cloud, deduplicar por id. Si un id está en ambos,
    //    gana el de mayor updatedAt y se marca _source: 'both'.
    const byId = new Map();
    localEmps.forEach(emp => {
        if (!emp || !emp.id || !emp.number) return;
        byId.set(String(emp.id), { ...emp, _source: 'local' });
    });
    cloudEmps.forEach(emp => {
        if (!emp || !emp.id || !emp.number) return;
        const key = String(emp.id);
        const existing = byId.get(key);
        if (!existing) {
            byId.set(key, { ...emp, _source: 'cloud' });
            return;
        }
        // Colisión por id: gana el de mayor updatedAt. _source pasa a 'both'.
        const existingTs = typeof existing.updatedAt === 'number' ? existing.updatedAt : 0;
        const incomingTs = typeof emp.updatedAt === 'number' ? emp.updatedAt : 0;
        const winner = incomingTs > existingTs ? emp : existing;
        byId.set(key, { ...winner, _source: 'both' });
    });

    // 2. Agrupar por número (igual que antes, pero sobre el set unido).
    //    F1.4: con flag ON la colisión sólo cuenta dentro del mismo proyecto
    //    efectivo — Proyecto A #12 y Proyecto B #12 conviven sin conflicto.
    //    Flag OFF: clave idéntica a antes (paridad legacy exacta).
    const _conflictScope = peekEntityScope();
    const groups = new Map();
    byId.forEach((emp) => {
        const key = _conflictScope.enabled
            ? `${effectiveProjectId(emp, _conflictScope)}::${emp.number}`
            : emp.number;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(emp);
    });

    const conflicts = [];
    groups.forEach((members, number) => {
        if (members.length > 1) {
            const conflictGroup = members.map(emp => {
                // Calcular metadatos para ayudar en la decisión
                const idPrefix = `${emp.id}-`;
                const attendanceKeys = Object.keys(state.attendance || {}).filter(k => k.startsWith(idPrefix));
                
                let lastDate = 'Nunca';
                if (attendanceKeys.length > 0) {
                    const sortedDates = attendanceKeys.map(k => k.substring(idPrefix.length)).sort();
                    lastDate = sortedDates[sortedDates.length - 1];
                }

                // Calcular completitud del perfil (0-100)
                const fields = ['phone', 'email', 'salary', 'dailyRate', 'entryDate'];
                const filled = fields.filter(f => emp[f] && emp[f] !== '').length;
                const completeness = Math.round((filled / fields.length) * 100);

                return {
                    ...emp,
                    attendanceCount: attendanceKeys.length,
                    lastAttendance: lastDate,
                    completeness: completeness
                };
            });
            conflicts.push({ number, members: conflictGroup });
        }
    });

    return conflicts;
}

/**
 * 🤝 mergeEmployees() - Fusiona un registro duplicado en un registro maestro
 * ⚠️ NO guarda automáticamente. El caller debe llamar saveApplicationData() al terminar.
 */
/**
 * 🔁 Intercambia el número de ficha de dos empleados. Usado por la
 * resolución inline de conflicto de número (editar Pedro y darle el número
 * de Juan → "Intercambiar"). Marca ambos como modificados para que se
 * propaguen a la nube.
 * @returns {boolean} true si el intercambio se realizó.
 */
export function swapEmployeeNumbers(idA, idB) {
    if (idA === idB) return false;
    const a = state.employees.find(e => e.id === idA);
    const b = state.employees.find(e => e.id === idB);
    if (!a || !b) return false;
    const tmp = a.number;
    a.number = b.number;
    b.number = tmp;
    const ts = Date.now();
    a.updatedAt = ts; b.updatedAt = ts;
    a._isDirty = true; b._isDirty = true;
    return true;
}

export function mergeEmployees(masterId, duplicateId) {
    const master = state.employees.find(e => e.id === masterId);
    const duplicate = state.employees.find(e => e.id === duplicateId);

    // Protección contra auto-fusión y existencias
    if (!master || !duplicate || masterId === duplicateId) {
        console.warn(`⚠️ Fusión abortada: ${!master ? 'Maestro no existe' : !duplicate ? 'Duplicado no existe' : 'Son el mismo ID'}`);
        return false;
    }

    console.log(`🤝 Fusionando: ${duplicate.name} -> ${master.name}`);

    // 1. Remapear Asistencia
    // Judgment Day Fase 1 R3: el remapeo multi-clave va en UN batch — todas
    // las escrituras a la raíz de state.attendance quedan gestionadas (un solo
    // repintado; la coherencia explícita corre después del loop, como siempre).
    // batchSetState es reentrante (guarda/restaura _silent), así que los tests
    // que envuelven mergeEmployees en un batch externo no se ven afectados.
    const idPrefix = `${duplicateId}-`;
    const touchedDateKeys = new Set(); // Judgment Day Fase 1 R1: para reencolar la subida granular
    stateManager.batchSetState(() => {
        Object.keys(state.attendance || {}).forEach(oldKey => {
            if (oldKey.startsWith(idPrefix)) {
                const datePart = oldKey.substring(idPrefix.length);
                touchedDateKeys.add(datePart);
                const newKey = `${masterId}-${datePart}`;
                const oldRecord = state.attendance[oldKey];
                const existingRecord = state.attendance[newKey];
                // Fase 1 U2b: foto ANTES de la mutación in-place de abajo — si tombstoneáramos oldKey
                // con el objeto ya mutado, el tombstone heredaría employeeId=masterId (la clave vieja
                // quedaría con datos del master). El tombstone debe reflejar el registro tal como
                // estaba bajo oldKey.
                const oldRecordSnapshot = { ...oldRecord };

                if (!existingRecord) {
                    // Simplemente mover
                    oldRecord.employeeId = masterId;
                    oldRecord.key = newKey;
                    state.attendance[newKey] = stampAttendanceWrite(oldRecord);
                } else {
                    // Fusionar inteligentemente
                    existingRecord.present = existingRecord.present || oldRecord.present;
                    existingRecord.hoursWorked = Math.max(existingRecord.hoursWorked || 0, oldRecord.hoursWorked || 0);
                    if (oldRecord.note && (!existingRecord.note || !existingRecord.note.includes(oldRecord.note))) {
                        existingRecord.note = existingRecord.note ? `${existingRecord.note} | ${oldRecord.note}` : oldRecord.note;
                    }
                    // Fusionar horas por posición si existen
                    if (oldRecord.positionHours) {
                        existingRecord.positionHours = existingRecord.positionHours || [];
                        oldRecord.positionHours.forEach(oph => {
                            const existingPh = existingRecord.positionHours.find(eph => eph.positionId === oph.positionId);
                            if (existingPh) {
                                existingPh.hours = Math.max(existingPh.hours, oph.hours);
                            } else {
                                existingRecord.positionHours.push(oph);
                            }
                        });
                    }
                    // Judgment Day Fase 1 R1: el merge recién cambió el contenido de
                    // existingRecord — debe pasar por el choke point para frescura (LWW) y
                    // para que revivir (present:true) limpie un deletedAt viejo si el
                    // master estaba tombstoneado (si no, queda present:true + deletedAt
                    // seteado — contradictorio: nómina lo paga, todo el resto lo ghostea).
                    state.attendance[newKey] = stampAttendanceWrite(existingRecord);
                }
                state.attendance[oldKey] = tombstoneAttendanceWrite(oldRecordSnapshot);
            }
        });
    });

    // Key remap spanning multiple dates (assign + delete) touched master's
    // hoursWorked/positionHours → explicit coherence after the loop: total index
    // rebuild + invalidate BOTH employees' monthly stats (master changed, duplicate gone).
    buildAttendanceIndex();
    invalidateEmployeeStats(masterId);
    invalidateEmployeeStats(duplicateId);

    // Judgment Day Fase 1 R3 (endurecimiento): los pasos 2-7 van en un try
    // cuyo finally reencola las fechas tocadas. Tras reubicar el reencolado al
    // final (R2-1), una excepción en cualquiera de estos pasos abortaba la
    // función ANTES del forEach — y la asistencia ya remapeada/tombstoneada en
    // el paso 1 quedaba solo-local para siempre (el borrado nunca llegaba a la
    // nube). La excepción se sigue propagando (el caller debe enterarse); solo
    // se garantiza que la subida granular no se pierda. Si el finally corre por
    // una excepción, el mirror que dispara _executeSave refleja el estado a
    // medio fusionar — correcto: ES el estado local real en ese momento.
    try {
        // 2. Fusionar arreglos "log" del empleado usando unionById:
        //    - Loans, advances, bonuses, deductions → unión por id (en colisión
        //      gana el de mayor updatedAt). Items sin id reciben uno sintético
        //      y se preservan (defensa en profundidad sobre el fix de unionById).
        //    - Antes solo se concatenaban advances/bonuses/deductions y se
        //      perdían los loans del duplicate. El caso real del usuario:
        //      master(5 asist, 0 préstamos, [a,b]) absorbiendo
        //      duplicate(0 asist, 3 préstamos, [a,c]) ahora termina como
        //      (5 asist, 3 préstamos, [a,b,c]).
        master.loans      = unionById(master.loans,      duplicate.loans);
        master.advances   = unionById(master.advances,   duplicate.advances);
        master.bonuses    = unionById(master.bonuses,    duplicate.bonuses);
        master.deductions = unionById(master.deductions, duplicate.deductions);

        // 3. Posiciones (lista de strings) → unión deduplicada
        {
            const set = new Set();
            (Array.isArray(master.positions) ? master.positions : []).forEach(p => { if (p) set.add(p); });
            (Array.isArray(duplicate.positions) ? duplicate.positions : []).forEach(p => { if (p) set.add(p); });
            master.positions = [...set];
        }

        // 4. positionSalaries (mapa por positionId) → unión por clave.
        //    Master gana en colisión (el usuario lo eligió como verdad);
        //    las claves que solo existen en el duplicate se traen al master.
        if (duplicate.positionSalaries && typeof duplicate.positionSalaries === 'object') {
            const ms = (master.positionSalaries && typeof master.positionSalaries === 'object')
                ? master.positionSalaries : {};
            const merged = { ...duplicate.positionSalaries, ...ms };
            master.positionSalaries = merged;
        }

        // 5. Completar campos del maestro si están vacíos
        ['phone', 'email', 'entryDate', 'salary', 'dailyRate'].forEach(field => {
            if (!master[field] && duplicate[field]) master[field] = duplicate[field];
        });

        // 6. Refrescar updatedAt para que el siguiente saveMany propague el
        //    estado fusionado al doc remoto del master. También
        //    positionsUpdatedAt: la unión de puestos del paso 3-4 debe ganar el
        //    LWW fino de puestos (sin el sello, un positionsUpdatedAt stale del
        //    otro dispositivo la pisaría en el próximo merge).
        const _mergeNow = Date.now();
        master.updatedAt = _mergeNow;
        master.positionsUpdatedAt = _mergeNow;
        master._isDirty = true;

        // 7. Eliminar el duplicado del estado
        state.employees = state.employees.filter(e => e.id !== duplicateId);
    } finally {
        // Judgment Day Fase 1 R2 (2026-07-03): este bloque estaba ANTES de los
        // pasos 2-7 (loans/posiciones/positionSalaries/duplicado). Como
        // saveApplicationData({ immediate: true }) corre _executeSave()
        // SÍNCRONAMENTE hasta su primer await propio (que no llega antes de
        // capturar el snapshot completo del mirror), disparar esto antes de
        // terminar el merge subía una foto a mitad de camino: con el duplicate
        // todavía en state.employees y los loans/posiciones del master sin
        // fusionar. Se reubica acá, después del paso 7, para que el snapshot
        // refleje el estado YA fusionado.
        //
        // Judgment Day Fase 1 R1: sin esto, la asistencia fusionada queda
        // solo-local — el save wholesale de los callers (sin dateKey) no sube
        // el campo attendance (el mirror lo excluye) y nadie encola la subida
        // granular por día. Fire-and-forget: mergeEmployees es síncrona.
        //
        // Judgment Day Fase 2A Ronda 3: antes esto era un
        // saveApplicationData({dateKey, immediate}) POR fecha — cada uno
        // encolaba un mirror COMPLETO (write amplification, el mismo patrón
        // que el purge de historial ya corrigió). El canal dateKeys sube TODO
        // el lote en un solo _executeSave: un 'daily' por fecha, un solo
        // mirror/entities. `immediate: true` sigue siendo necesario (el camino
        // debounced no retorna Promise y el guardado no debe perderse en un
        // F5). saveApplicationData también puede retornar `undefined` (p.ej.
        // borrado local en curso), así que `.catch()` se encadena solo si es
        // realmente una promesa (Judgment Day Fase 1 R2 — ningún caller de
        // mergeEmployees envuelve esto en try/catch).
        // touchedDateKeys es un Set → convertir a array (dateKeys espera Array;
        // Array.isArray(Set) es false y .length es undefined).
        const _touchedDates = [...touchedDateKeys];
        if (_touchedDates.length > 0) {
            // En cuentas legacy (schema < 2) las entidades todavía viajan en el
            // mirror. Este merge no puede quedar detrás de la cadencia normal.
            const savePromise = saveApplicationData({
                dateKeys: _touchedDates,
                immediate: true,
                forceMirror: true
            });
            if (savePromise && typeof savePromise.catch === 'function') {
                savePromise.catch(e => console.error('Error subiendo asistencia fusionada:', e));
            }
        }
    }

    return true;
}

/**
 * 🔤 Normaliza un nombre para comparación (sin acentos, minúsculas, sin espacios extra)
 */
function normalizeName(name) {
    return (name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim();
}

/**
 * 🔍 Determina si dos nombres son suficientemente similares para considerarlos la misma persona
 */
function areSamePerson(nameA, nameB) {
    const a = normalizeName(nameA);
    const b = normalizeName(nameB);
    if (a === b) return true;
    // Si uno contiene al otro (ej: "Juan" vs "Juan Perez")
    if (a.includes(b) || b.includes(a)) return true;
    return false;
}

/**
 * ⚡ executeAutoRepair() - Ejecuta limpieza automática basada en puntuación
 * Separa conflictos en dos categorías:
 *   - Misma persona (nombres similares) → fusión automática
 *   - Personas distintas (nombres diferentes) → pendientes de reasignación
 * @returns {{ success, fixed, pendingReassignments }}
 */
export async function executeAutoRepair() {
    const conflicts = analyzeConflicts();
    if (conflicts.length === 0) {
        NotificationSystem.info('✨ No se encontraron duplicados.');
        return { success: true, fixed: 0, pendingReassignments: [] };
    }

    let fixedCount = 0;
    const pendingReassignments = [];

    conflicts.forEach(group => {
        // Verificar si todos los miembros son la misma persona
        const firstMember = group.members[0];
        const allSamePerson = group.members.every(m => areSamePerson(m.name, firstMember.name));

        if (!allSamePerson) {
            // Personas distintas: no fusionar, acumular para reasignación
            console.log(`⚠️ Ficha ${group.number}: nombres diferentes detectados, omitiendo fusión automática`);
            pendingReassignments.push(group);
            return;
        }

        // Misma persona: fusionar automáticamente
        const sorted = [...group.members].sort((a, b) => {
            if (b.attendanceCount !== a.attendanceCount) return b.attendanceCount - a.attendanceCount;
            const timeA = new Date(a.updatedAt || 0).getTime();
            const timeB = new Date(b.updatedAt || 0).getTime();
            if (timeB !== timeA) return timeB - timeA;
            return b.completeness - a.completeness;
        });

        const master = sorted[0];
        const duplicates = sorted.slice(1);

        duplicates.forEach(dup => {
            if (mergeEmployees(master.id, dup.id)) fixedCount++;
        });
    });

    // Guardar UNA sola vez con limpieza de attendance en IndexedDB
    if (fixedCount > 0) {
        await saveApplicationData({ skipValidation: false, clearAttendance: true });
    }

    if (pendingReassignments.length > 0) {
        NotificationSystem.info(`⚡ ${fixedCount} duplicados fusionados. ${pendingReassignments.length} conflicto(s) requieren reasignación manual.`);
    } else {
        NotificationSystem.success(`⚡ Limpieza automática completada. Se eliminaron ${fixedCount} duplicados.`);
    }

    if (globalThis.render) globalThis.render();
    
    return { success: true, fixed: fixedCount, pendingReassignments };
}

/**
 * 🔄 reassignEmployeeNumber() - Cambia el número de ficha de un empleado
 * También actualiza las claves de asistencia para mantener coherencia.
 *
 * Por defecto rechaza la reasignación si el nuevo número ya está en uso
 * por otro empleado (comportamiento clásico, seguro para llamadas desde
 * UI ad-hoc).
 *
 * Con `opts.allowCollision === true` aplica la reasignación aunque deje
 * dos (o más) empleados con el mismo número, creando un conflicto
 * temporal. Usado por el wizard manual de saneamiento: la cascada de
 * re-análisis (applyManualGroup paso 4) detectará el nuevo grupo y
 * lo añadirá a la cola para que el usuario lo resuelva a continuación.
 * Sin este opt, el wizard se quedaba atascado en cascadas tipo
 * "ficha 501 con 3 personas, una va a ficha 500 ya ocupada".
 *
 * ⚠️ NO guarda automáticamente. El caller debe llamar saveApplicationData().
 */
export function reassignEmployeeNumber(employeeId, newNumber, opts = {}) {
    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return false;

    if (!opts.allowCollision) {
        // Verificar que el nuevo número no esté en uso
        const conflict = state.employees.find(e => e.number === newNumber && e.id !== employeeId);
        if (conflict) {
            console.warn(`⚠️ Número ${newNumber} ya en uso por ${conflict.name}`);
            return false;
        }
    }

    const oldNumber = emp.number;
    emp.number = newNumber;
    emp.updatedAt = Date.now();
    emp._isDirty = true;

    const tail = opts.allowCollision && state.employees.some(e => e.number === newNumber && e.id !== employeeId)
        ? ' [conflicto temporal — el wizard lo resolverá en el siguiente paso]'
        : '';
    console.log(`🔄 Ficha reasignada: ${emp.name} (${oldNumber} → ${newNumber})${tail}`);
    return true;
}

// Inicializar alias globales
globalThis.analyzeConflicts = analyzeConflicts;
globalThis.mergeEmployees = mergeEmployees;
globalThis.executeAutoRepair = executeAutoRepair;
globalThis.reassignEmployeeNumber = reassignEmployeeNumber;
