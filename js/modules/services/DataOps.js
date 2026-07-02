/**
 * 🔁 DataOps.js (Fase 0.5, U4-U5)
 *
 * Operaciones de REEMPLAZO total entre local y nube — la lógica, separada de
 * la UI (los modales de confirmación viven en la capa de presentación).
 *
 * Diferencia clave con los flujos de FUSIÓN del Sync Center: acá una fuente
 * REEMPLAZA a la otra por completo. Eso cambia las reglas de error:
 *   - En fusión, un fallo de lectura remota (null) se trata como "no fusionar
 *     nada" y lo local se conserva (M1).
 *   - En reemplazo, ese mismo null debe ABORTAR TODO: tratar un fallo de
 *     lectura como lista vacía borraría lo local sin reemplazo real.
 *
 * DI-friendly (mismo patrón que MainSyncStore.flush y LocalWipeService):
 * las dependencias efectosas se inyectan con defaults reales.
 */

import { state, stateManager, invalidateAllStats, buildAttendanceIndex } from '../core/AppState.js';
import { indexedDBService } from './IndexedDBService.js';
import { wipeAllLocalTraces } from './LocalWipeService.js';
import { endLocalDataWipe } from './PersistenceService.js';
import FirebaseService from './FirebaseService.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { PositionRepository } from './PositionRepository.js';
import { LeaderRepository } from './LeaderRepository.js';
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';

// Metadata del doc espejo que NUNCA debe filtrarse al state (el flujo viejo
// hacía Object.assign(state, cloudState) y arrastraba estos campos).
const MIRROR_METADATA_FIELDS = ['updatedAt', 'lastDevice', 'lastChangedBy', 'deviceId'];

/**
 * Borra todos los datos locales y adopta la nube como única fuente de verdad.
 *
 * Orden crítico: FETCH PRIMERO (si la red falla, no se tocó nada local),
 * recién después wipe + aplicar + persistir + reload. El wipe interno
 * (wipeAllLocalTraces) ya bloquea los guardados implícitos (U2) y purga el
 * outbox + colas legacy (U1) — sin esa purga, el drenado del próximo login
 * subía datos PRE-descarga y pisaba la nube recién adoptada (bug ALTA #1).
 *
 * @param {{
 *   fetchFullState?: () => Promise<Object|null>,
 *   loadEmployees?: () => Promise<Array|null>,
 *   loadPositions?: () => Promise<Array|null>,
 *   loadLeaders?: () => Promise<Array|null>,
 *   fetchAllAttendance?: () => Promise<Object>,
 *   wipeLocal?: () => Promise<{ok: boolean, errors: Array}>,
 *   persistState?: (rawState: Object) => Promise<*>,
 *   endWipe?: () => void,
 *   reload?: () => void
 * }} deps
 * @returns {Promise<{ok: boolean, reason?: string, error?: *}>}
 */
export async function replaceLocalWithCloud(deps = {}) {
    const {
        fetchFullState = () => FirebaseService.getFullState(),
        loadEmployees = () => EmployeeRepository.loadAll(),
        loadPositions = () => PositionRepository.loadAll(),
        loadLeaders = () => LeaderRepository.loadAll(),
        fetchAllAttendance = () => FirebaseService.getAllAttendance(),
        wipeLocal = () => wipeAllLocalTraces(),
        persistState = (raw) => indexedDBService.saveState(raw, {}),
        endWipe = endLocalDataWipe,
        reload = () => location.reload()
    } = deps;

    // ── 1. FETCH PRIMERO — nada local se toca hasta tener TODO el reemplazo ──
    let cloudState, employees, positions, leaders, attendance;
    try {
        cloudState = await fetchFullState();
        if (!cloudState) return { ok: false, reason: 'no-cloud-data' };

        const sv = (typeof cloudState.settings?.schemaVersion === 'number')
            ? cloudState.settings.schemaVersion
            : (typeof cloudState.schemaVersion === 'number' ? cloudState.schemaVersion : 0);

        if (sv >= 2) {
            employees = await loadEmployees();
            // En modo REEMPLAZO, null (fallo de lectura) ABORTA — no es "[]".
            if (!Array.isArray(employees)) return { ok: false, reason: 'entity-read-failed' };
        } else {
            employees = cloudState.employees || [];
        }

        if (sv >= 3) {
            positions = await loadPositions();
            leaders = await loadLeaders();
            if (!Array.isArray(positions) || !Array.isArray(leaders)) {
                return { ok: false, reason: 'entity-read-failed' };
            }
        } else {
            positions = cloudState.positions || [];
            leaders = cloudState.leaders || [];
        }

        attendance = await fetchAllAttendance();
        if (!attendance || typeof attendance !== 'object') {
            return { ok: false, reason: 'attendance-read-failed' };
        }
    } catch (error) {
        console.error('❌ replaceLocalWithCloud: fallo leyendo la nube (no se tocó nada local):', error);
        return { ok: false, reason: 'fetch-failed', error };
    }

    // ── 2. Wipe local + aplicar + persistir. Desde acá el guard de wipe (U2)
    //       bloquea todo guardado implícito; si algo falla, endWipe() lo
    //       libera para que la sesión no quede muda hasta el F5. ─────────────
    try {
        const wipeResult = await wipeLocal();
        if (!wipeResult.ok) {
            console.warn('⚠️ replaceLocalWithCloud: wipe parcial (se continúa):', wipeResult.errors);
        }

        // Aplicar el estado de la nube — campos de datos, sin metadata del doc.
        const cleanCloud = { ...cloudState };
        MIRROR_METADATA_FIELDS.forEach(f => delete cleanCloud[f]);
        delete cleanCloud.employees;
        delete cleanCloud.positions;
        delete cleanCloud.leaders;
        delete cleanCloud.attendance;

        // batchSetState: convención del repo para mutaciones múltiples — un
        // solo render agendado al cerrar, con la coherencia TOTAL (Familia
        // 6a: invalidateAllStats + rebuild sin argumento) DENTRO del batch,
        // así ningún repintado puede leer el índice/stats viejos contra la
        // asistencia nueva en la ventana del await de persistState.
        stateManager.batchSetState(() => {
            Object.assign(state, cleanCloud);
            state.employees = employees.map(e => e instanceof Employee ? e : new Employee(e));
            state.positions = positions.map(p => p instanceof Position ? p : new Position(p));
            state.leaders = leaders.map(l => l instanceof Leader ? l : new Leader(l));
            state.attendance = attendance;
            invalidateAllStats();
            buildAttendanceIndex();
        });

        // Persistencia DIRECTA (no saveApplicationData: está bloqueado por el
        // guard U2, y es correcto — no hay nada que encolar hacia la nube,
        // la nube ES la fuente).
        await persistState(JSON.parse(JSON.stringify({
            employees: state.employees, positions: state.positions,
            leaders: state.leaders, attendance: state.attendance,
            settings: state.settings
        })));

        reload();
        return { ok: true };
    } catch (error) {
        // JD-F3 (CRÍTICO): en este punto lo local YA está borrado. Quedarse en
        // la sesión reportando un error (contrato viejo) era la peor opción:
        // si el usuario cerraba la pestaña, perdía todo. La recarga con local
        // vacío + sesión activa dispara la re-adopción normal de la nube — la
        // recarga ES la recuperación. endWipe antes por si reload es no-op
        // (tests/entornos raros): la sesión no debe quedar muda.
        console.error('❌ replaceLocalWithCloud: fallo aplicando el reemplazo — se recarga para re-adoptar la nube:', error);
        endWipe();
        reload();
        return { ok: false, reason: 'apply-failed', error };
    }
}

/**
 * Colecciones del dataset PRINCIPAL — lo que "Subir y Reemplazar" borra y
 * re-sube. Caja chica (projects/cashPeriods/pettyCash) queda FUERA a
 * propósito: tiene su propio ciclo de sync (PettyCashStore) y este flujo no
 * la re-sube — borrarla sin reemplazo sería pérdida de datos en la nube.
 */
export const MAIN_DATA_COLLECTIONS = ['employees', 'positions', 'leaders', 'attendance'];

/**
 * 🛟 JD-F2 (CRÍTICO): respaldo de LO QUE HAY EN LA NUBE antes de destruirla.
 *
 * El "snapshot de seguridad" original hacía createSnapshot(state, ...) — una
 * copia redundante del state LOCAL (lo que se estaba por subir), no de la
 * nube (lo que se estaba por borrar). La promesa "recuperable" era falsa en
 * el caso real: un dispositivo con datos viejos fuerza "Subir y Reemplazar"
 * y los datos buenos de la nube desaparecían sin respaldo restaurable.
 *
 * Lee el estado actual de la nube (doc espejo + entidades per-doc en cuentas
 * migradas + asistencia completa) y lo guarda como snapshot. Nube vacía →
 * skipped (no hay nada que proteger). Una lectura de entidades fallida LANZA:
 * un respaldo incompleto no es un respaldo, y el caller debe abortar.
 *
 * @returns {Promise<{skipped: boolean}>}
 */
export async function snapshotCloudBeforeDestroy(deps = {}) {
    const {
        fetchFullState = () => FirebaseService.getFullState(),
        fetchAllAttendance = () => FirebaseService.getAllAttendance(),
        loadEmployees = () => EmployeeRepository.loadAll(),
        loadPositions = () => PositionRepository.loadAll(),
        loadLeaders = () => LeaderRepository.loadAll(),
        snapshot = (data, type, reason) => FirebaseService.createSnapshot(data, type, reason)
    } = deps;

    const cloud = await fetchFullState();
    if (!cloud) return { skipped: true };

    const sv = (typeof cloud.settings?.schemaVersion === 'number')
        ? cloud.settings.schemaVersion
        : (typeof cloud.schemaVersion === 'number' ? cloud.schemaVersion : 0);

    let employees = cloud.employees || [];
    let positions = cloud.positions || [];
    let leaders = cloud.leaders || [];
    if (sv >= 2) {
        employees = await loadEmployees();
        if (!Array.isArray(employees)) throw new Error('backup-read-failed: employees');
    }
    if (sv >= 3) {
        positions = await loadPositions();
        leaders = await loadLeaders();
        if (!Array.isArray(positions) || !Array.isArray(leaders)) {
            throw new Error('backup-read-failed: positions/leaders');
        }
    }
    const attendance = await fetchAllAttendance();

    await snapshot(
        { ...cloud, employees, positions, leaders, attendance: attendance || {} },
        'auto',
        'pre-replace-cloud-backup'
    );
    return { skipped: false };
}

/**
 * Borra el dataset principal de la nube y lo sustituye por los datos locales
 * — reemplazo REAL, no el merge del flujo viejo (merge:true nunca borraba lo
 * que sólo existía en la nube).
 *
 * Contrato de seguridad (el orden ES el contrato):
 *   1. Snapshot de seguridad — si falla, se aborta: nunca destruir la nube
 *      sin red de seguridad (los snapshots sobreviven al borrado).
 *   2. Purga de pendientes — una entrada stale del outbox drenando DESPUÉS
 *      degradaría el estado recién subido.
 *   3. Borrado acotado a MAIN_DATA_COLLECTIONS + doc espejo.
 *   4. Subida completa (saveFullState empuja entidades per-doc en cuentas
 *      migradas; syncHistory sube todos los días). Sobre nube vacía, el
 *      merge:true interno equivale a un reemplazo limpio.
 *
 * No toca nada local: un fallo en cualquier paso deja lo local intacto y
 * reintentar la operación entera es seguro (idempotente).
 *
 * @param {{
 *   createSafetySnapshot?: () => Promise<*>,
 *   purgePending?: () => Promise<boolean>,
 *   deleteCloud?: (collections: string[]) => Promise<*>,
 *   uploadFullState?: () => Promise<*>,
 *   uploadHistory?: () => Promise<*>
 * }} deps
 * @returns {Promise<{ok: boolean, reason?: string, error?: *}>}
 */
export async function replaceCloudWithLocal(deps = {}) {
    const {
        createSafetySnapshot = () => snapshotCloudBeforeDestroy(),
        purgePending = () => import('./PersistenceService.js').then(m => m.purgeAllPendingCloudWrites()),
        deleteCloud = (collections) => FirebaseService.deleteCloudData({ collections }),
        uploadFullState = (frozenState) => FirebaseService.saveFullState(frozenState),
        uploadHistory = (frozenAttendance) => FirebaseService.syncHistory(frozenAttendance)
    } = deps;

    // 🧊 JD-F1 (CRÍTICO): FOTO CONGELADA de lo que se va a subir, capturada
    // ANTES de tocar la nube. deleteCloudData borra los docs per-entidad y
    // los listeners en vivo (EmployeeRepository.subscribe y compañía NO
    // filtran ecos propios) rebotan ese borrado a state.employees = [] antes
    // de que la subida corra — leyendo el state VIVO se subían listas vacías
    // con éxito falso y la nube quedaba vaciada permanentemente.
    const frozen = JSON.parse(JSON.stringify({
        ...state,
        snapshots: undefined, isLoadingSnapshots: undefined, currentUser: undefined
    }));

    try {
        await createSafetySnapshot();
    } catch (error) {
        console.error('❌ replaceCloudWithLocal: snapshot de seguridad falló — se aborta sin tocar la nube:', error);
        return { ok: false, reason: 'snapshot-failed', error };
    }

    try {
        await purgePending();
    } catch (error) {
        // La purga legacy no puede fallar; el outbox reporta con boolean. Un
        // throw acá sería excepcional — mejor abortar que arriesgar un drain
        // stale sobre la nube recién reemplazada.
        console.error('❌ replaceCloudWithLocal: purga de pendientes falló:', error);
        return { ok: false, reason: 'purge-failed', error };
    }

    try {
        await deleteCloud(MAIN_DATA_COLLECTIONS);
    } catch (error) {
        console.error('❌ replaceCloudWithLocal: borrado de nube falló — no se sube nada sobre un borrado a medias:', error);
        return { ok: false, reason: 'delete-failed', error };
    }

    try {
        await uploadFullState(frozen);
        await uploadHistory(frozen.attendance || {});
        return { ok: true };
    } catch (error) {
        console.error('❌ replaceCloudWithLocal: la subida falló — tus datos locales están intactos; reintentá la operación:', error);
        return { ok: false, reason: 'upload-failed', error };
    }
}

/**
 * Borra TODOS los datos de la nube — el "Borrar Nube" honesto.
 *
 * Agujeros del flujo viejo que este contrato cierra:
 *   - Sin purga previa, los pendientes del outbox/colas legacy drenaban en
 *     el próximo save/online/login y RE-CREABAN datos en la nube recién
 *     borrada ("la nube no se borra de verdad").
 *   - No ofrecía borrar snapshots ni pausar la subida — sin pausa, el
 *     próximo guardado ordinario re-sube el estado local completo (por
 *     diseño del save loop; la UI debe decirlo y ofrecer la pausa).
 *
 * @param {{alsoSnapshots?: boolean, pauseUpload?: boolean}} options
 * @param {{
 *   purgePending?: () => Promise<boolean>,
 *   deleteCloud?: () => Promise<*>,
 *   deleteSnapshotsOfType?: (type: string) => Promise<*>,
 *   pauseUpload?: () => void
 * }} deps
 * @returns {Promise<{ok: boolean, reason?: string, error?: *, deleted?: number}>}
 */
export async function eraseCloudData(options = {}, deps = {}) {
    const {
        purgePending = () => import('./PersistenceService.js').then(m => m.purgeAllPendingCloudWrites()),
        deleteCloud = () => FirebaseService.deleteCloudData(),
        deleteSnapshotsOfType = (type) => FirebaseService.deleteSnapshotsByType(type),
        pauseUpload = () => import('./SyncPauseService.js').then(m => m.pauseCloudUpload('Nube borrada por el usuario.'))
    } = deps;

    // Purga PRIMERO: un flush disparado durante el borrado (online/login)
    // subiría pendientes viejos a la nube recién vaciada.
    try {
        await purgePending();
    } catch (error) {
        console.error('❌ eraseCloudData: purga de pendientes falló:', error);
        return { ok: false, reason: 'purge-failed', error };
    }

    let deleted;
    try {
        const r = await deleteCloud();
        deleted = r?.deleted;
    } catch (error) {
        console.error('❌ eraseCloudData: borrado de nube falló:', error);
        return { ok: false, reason: 'delete-failed', error };
    }

    // Los snapshots son la red de seguridad: sólo se borran si el usuario lo
    // pidió explícitamente, y sólo tras un borrado principal exitoso. La capa
    // de abajo (deleteSnapshotsByType) respeta protegidos y pre-restore.
    if (options.alsoSnapshots) {
        try {
            await deleteSnapshotsOfType('auto');
            await deleteSnapshotsOfType('manual');
        } catch (error) {
            console.warn('⚠️ eraseCloudData: los datos se borraron pero los snapshots no:', error);
            return { ok: false, reason: 'snapshots-failed', error, deleted };
        }
    }

    // Sin pausa, el próximo guardado ordinario re-sube el estado local
    // completo (save loop). Con ella, la nube queda vacía DE VERDAD hasta
    // que el usuario reanude.
    if (options.pauseUpload) {
        try { await pauseUpload(); } catch (e) { console.warn('⚠️ eraseCloudData: no se pudo pausar la subida:', e); }
    }

    return { ok: true, deleted };
}

export default { replaceLocalWithCloud, replaceCloudWithLocal, eraseCloudData, snapshotCloudBeforeDestroy, MAIN_DATA_COLLECTIONS };
