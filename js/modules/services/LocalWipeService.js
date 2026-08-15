/**
 * 🧹 LocalWipeService.js (Fase 0.5, U3)
 *
 * Borrado local REAL — todo rastro. El reset() histórico de DataService sólo
 * limpiaba la clave principal de localStorage + IndexedDB + 2 flags: la cola
 * de borrados pendientes (asistencia_pending_cloud_deletes) sobrevivía y,
 * tras re-login, ejecutaba borrados viejos EN LA NUBE — rompiendo la promesa
 * de la UI "Los datos en la nube NO se borrarán" (bug ALTA #2, auditoría
 * 2026-07-01).
 *
 * Secuencia (el orden importa):
 *   1. beginLocalDataWipe()  — bloquea guardados implícitos (debounce,
 *      pagehide del reload) para que nada re-persista a mitad del borrado.
 *   2. purgeAllPendingCloudWrites() — vacía outbox + colas legacy, para que
 *      el próximo login no suba/borre nada de ANTES del borrado.
 *   3. Limpieza de storage: clave principal, manifiesto de claves sueltas,
 *      respaldo de sessionStorage, IndexedDB completo, propiedad local.
 *
 * Best-effort: un paso que falla se registra y se sigue con el resto —
 * abortar a mitad dejaría un estado zombie peor que un borrado parcial
 * reportado. No recarga la página: eso lo decide el caller (la UI).
 */

import { indexedDBService } from './IndexedDBService.js';
import { storageService } from './StorageService.js';
import { clearLocalOwnership } from './LocalDataOwner.js';
import { beginLocalDataWipe, purgeAllPendingCloudWrites } from './PersistenceService.js';

/**
 * Manifiesto explícito de TODO rastro local conocido fuera de la clave
 * principal ('asistencia-data', que limpia storageService.clear()).
 * Si agregás una clave nueva de persistencia en la app, sumala acá —
 * LocalWipeServiceTests documenta y verifica este inventario.
 */
export const LOCAL_TRACE_KEYS = [
    'asistencia_pending_cloud_deletes',   // colas de borrado hacia la nube (bug ALTA #2)
    'asistencia-data-backup',             // respaldo pre-migración que escribe IndexedDBService
    'migrated-to-idb',                    // flag de migración localStorage→IndexedDB
    'onboardingCompleted',                // flag del tour inicial
    'asistencia_last_snapshot_attempt',   // cooldown device-local de snapshots
    'asistencia_cloud_upload_paused',     // pausa de subida (device-local)
    'asistencia_cloud_download_paused',   // pausa de descarga (device-local)
    '_pettycash_local_v2',                // caché legacy de caja chica
    '_pettycash_sel_v1',                  // selección de UI de caja chica
    'icon-set'                            // JD-F9: set de íconos elegido — es un AJUSTE del usuario (app.js ICON_SET_STORAGE_KEY)
];

const SESSION_TRACE_KEYS = [
    'attendance-backup' // auto-backup redactado (salarios/préstamos) de sessionStorage
];

/**
 * Elimina todo rastro local de datos de la aplicación.
 *
 * @param {{
 *   beginWipe?: () => void,
 *   purgePendingCloudWrites?: () => Promise<boolean>,
 *   clearMainStorage?: () => boolean,
 *   clearIndexedDB?: () => Promise<boolean>,
 *   clearOwnership?: () => void
 * }} deps - inyectables para test (mismo patrón que los guards de
 *   MainSyncStore.flush); por defecto usan los servicios reales.
 * @returns {Promise<{ok: boolean, errors: Array<{step: string, error: *}>}>}
 */
export async function wipeAllLocalTraces(deps = {}) {
    const {
        beginWipe = beginLocalDataWipe,
        purgePendingCloudWrites = purgeAllPendingCloudWrites,
        clearMainStorage = () => storageService.clear(),
        clearIndexedDB = () => indexedDBService.clearAll(),
        clearOwnership = clearLocalOwnership
    } = deps;

    const errors = [];
    const attempt = async (step, fn) => {
        try {
            const r = await fn();
            // purga U1 reporta false si el outbox falló — es un fallo parcial
            if (r === false) errors.push({ step, error: 'reported-false' });
        } catch (error) {
            console.warn(`⚠️ wipeAllLocalTraces: paso "${step}" falló (se continúa):`, error);
            errors.push({ step, error });
        }
    };

    // 1. Bloquear guardados implícitos ANTES de tocar nada.
    await attempt('begin-wipe', () => beginWipe());

    // 2. Purgar pendientes hacia la nube (outbox + colas legacy).
    await attempt('purge-pending-cloud-writes', () => purgePendingCloudWrites());

    // 3a. Clave principal de localStorage.
    await attempt('clear-main-storage', () => clearMainStorage());

    // 3b. Manifiesto de claves sueltas.
    for (const key of LOCAL_TRACE_KEYS) {
        await attempt(`localStorage:${key}`, () => {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
        });
    }

    // 3c. Respaldo de sessionStorage.
    for (const key of SESSION_TRACE_KEYS) {
        await attempt(`sessionStorage:${key}`, () => {
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
        });
    }

    // 3d. IndexedDB completo (todos los stores, incluido el outbox — H2).
    await attempt('clear-indexeddb', () => clearIndexedDB());

    // 3e. Propiedad del dispositivo: sin datos ya no hay dueño que proteger.
    await attempt('clear-ownership', () => clearOwnership());

    return { ok: errors.length === 0, errors };
}

/**
 * Prepara una adopción nube→local del dataset principal sin borrar dominios
 * que todavía no puede rehidratar DataOps (Caja Chica, comprobantes y cierres).
 * El guard y la purga siguen siendo necesarios para que un outbox viejo no
 * vuelva a escribir datos principales durante la recarga.
 */
export async function wipeMainLocalTraces(deps = {}) {
    const {
        beginWipe = beginLocalDataWipe,
        purgePendingCloudWrites = purgeAllPendingCloudWrites,
        clearMainStorage = () => storageService.clear(),
        clearStore = (store) => indexedDBService.clear(store)
    } = deps;
    const errors = [];
    const attempt = async (step, fn) => {
        try {
            const result = await fn();
            if (result === false) errors.push({ step, error: 'reported-false' });
        } catch (error) {
            console.warn(`⚠️ wipeMainLocalTraces: paso "${step}" falló:`, error);
            errors.push({ step, error });
        }
    };
    await attempt('begin-wipe', () => beginWipe());
    await attempt('purge-pending-cloud-writes', () => purgePendingCloudWrites());
    await attempt('clear-main-storage', () => clearMainStorage());
    for (const store of ['employees', 'positions', 'leaders', 'attendance', 'settings', 'sync_queue', 'mainSyncOutbox']) {
        await attempt('clear-indexeddb', () => clearStore(store));
    }
    return { ok: errors.length === 0, errors };
}

export default { wipeAllLocalTraces, wipeMainLocalTraces, LOCAL_TRACE_KEYS };
