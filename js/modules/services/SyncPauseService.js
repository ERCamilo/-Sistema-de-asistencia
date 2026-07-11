/**
 * ⏸️ SyncPauseService.js (cloud-upload pause feature)
 *
 * La pausa de subida a la nube es un estado **POR DISPOSITIVO**: vive en
 * localStorage, NUNCA en Firebase ni en state.settings. Esto es intencional:
 *
 *   - Pausar/reanudar en un dispositivo NO afecta a los demás (útil para
 *     pruebas o mantenimiento local sin tumbar la sync del resto).
 *   - Un flag viejo en la nube NO puede re-pausar este equipo solo: la pausa
 *     solo cambia con una acción explícita del usuario en ESTE dispositivo.
 *
 * Cuando está pausado:
 *   - Todos los guardados siguen yendo a IndexedDB (la persistencia local no
 *     se ve afectada).
 *   - La subida a Firebase se omite hasta que el usuario reanude.
 *   - El SyncStatusBadge muestra el estado "⏸️ Sync pausado".
 *   - El flag persiste entre recargas (localStorage de este navegador).
 *
 * Flujo típico:
 *   El usuario activa la pausa (switch del centro de sync o rechaza cambios
 *   entrantes) → pauseCloudUpload() → los próximos saves omiten Firebase →
 *   el usuario reanuda → resumeCloudUpload() → el flag local se limpia y se
 *   re-sube el estado local de inmediato.
 *
 * Dependencia: este módulo importa saveApplicationData de PersistenceService
 * de forma diferida (dynamic import) solo en runtime, para evitar ciclos en
 * tiempo de evaluación de módulos.
 */

/**
 * ✅ Kill-switch reactivado (2026-06-06).
 *
 * Las precondiciones que justificaban la pausa temporal están satisfechas:
 *   - Phase 1: errores de sync visibles al usuario (badge + toast); si algo
 *     falla al reanudar el usuario lo ve de inmediato.
 *   - Phase 2: colas de borrado pendientes (`_pendingCloud*Deletes`) persisten
 *     en localStorage y se drenan en el siguiente save autenticado; una pausa
 *     seguida de recarga ya no pierde ids de positions/leaders a borrar.
 *   - PositionsList.js encola `enqueueCloudPositionDelete` al borrar; el runner
 *     de Schema v3 migra cargos y líderes a per-doc en la primera sesión online.
 *   - Leaders: solo se desactivan (nunca se borran), diseño intencional para
 *     preservar histórico; no se necesita cola de borrado.
 *
 * Puntos de integración que respetan esta bandera:
 *   - PersistenceService: `_isPausedEffective` bloquea Firebase cuando pausado.
 *   - app.js: el badge muestra "⏸️ Sync pausado" y el click abre el modal de
 *     reanudar; el switch del centro de sync activa/desactiva la pausa.
 *   - app.js: el aviso de boot se dispara si la app arranca con pausa activa.
 */
export const SYNC_PAUSE_ENABLED = true;

// Clave local (por dispositivo). NUNCA se sincroniza a Firebase.
const _PAUSE_LS_KEY = 'asistencia_cloud_upload_paused';

// Pausa de DESCARGA (device-local, simétrica a la de subida). Cuando está
// activa, los cambios entrantes de la nube NO se aplican al estado local: el
// dispositivo queda "congelado" respecto a la nube hasta que el usuario
// reanude. Útil para pruebas o mantenimiento sin que la nube pise lo local.
// Al igual que la pausa de subida, vive SOLO en localStorage de este equipo.
const _DOWNLOAD_PAUSE_LS_KEY = 'asistencia_cloud_download_paused';

// Lazy-imported to avoid circular dependency at evaluation time.
// We call saveApplicationData only in pauseCloudUpload/resumeCloudUpload,
// which are called at runtime (never during module initialisation).
let _saveApplicationData = null;
async function _getSave() {
    if (!_saveApplicationData) {
        const m = await import('./PersistenceService.js');
        _saveApplicationData = m.saveApplicationData;
    }
    return _saveApplicationData;
}

function _writePausedFlag(paused) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (paused) {
            localStorage.setItem(_PAUSE_LS_KEY, 'true');
        } else {
            localStorage.removeItem(_PAUSE_LS_KEY);
        }
    } catch (e) {
        console.warn('⚠️ No se pudo persistir el estado de pausa local:', e);
    }
}

function _writeDownloadPausedFlag(paused) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (paused) {
            localStorage.setItem(_DOWNLOAD_PAUSE_LS_KEY, 'true');
        } else {
            localStorage.removeItem(_DOWNLOAD_PAUSE_LS_KEY);
        }
    } catch (e) {
        console.warn('⚠️ No se pudo persistir el estado de pausa de descarga:', e);
    }
}

/**
 * Returns true when cloud uploads are currently paused ON THIS DEVICE.
 * Reads only from localStorage — never from Firebase-synced state. Safe to
 * call before state is fully loaded.
 */
export function isSyncPaused() {
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(_PAUSE_LS_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

/**
 * Pause cloud uploads on this device. Local (IndexedDB) saves continue
 * normally. The flag is written to localStorage synchronously so it survives
 * a page refresh and is never pushed to the cloud.
 */
export async function pauseCloudUpload(reason = 'Usuario solicitó pausar la sincronización') {
    _writePausedFlag(true);
    console.warn(`⏸️ Sincronización de subida a la nube PAUSADA (solo este dispositivo). Motivo: ${reason}`);
}

/**
 * Resume cloud uploads on this device and immediately re-upload local state
 * to Firestore so any changes made while paused are reflected in the cloud.
 */
export async function resumeCloudUpload() {
    _writePausedFlag(false);
    console.log('▶️ Sincronización de subida a la nube REANUDADA. Re-subiendo estado local a la nube...');
    const save = await _getSave();
    save({ force: true, immediate: true });
}

/**
 * Returns true when cloud downloads are currently paused ON THIS DEVICE.
 * Reads only from localStorage — never from Firebase-synced state.
 */
export function isDownloadPaused() {
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(_DOWNLOAD_PAUSE_LS_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

/**
 * Pause incoming cloud data on this device. Snapshot listeners stay open
 * but their callbacks return early — no remote data is applied to state.
 */
export async function pauseCloudDownload(reason = 'Usuario solicitó pausar la descarga de la nube') {
    _writeDownloadPausedFlag(true);
    console.warn(`⏸️ Descarga de datos de la nube PAUSADA (solo este dispositivo). Motivo: ${reason}`);
}

/**
 * Resume incoming cloud data on this device. The caller should trigger a
 * re-sync (e.g. syncFirebaseNow) so data missed during the pause is applied.
 */
export async function resumeCloudDownload() {
    _writeDownloadPausedFlag(false);
    console.log('▶️ Descarga de datos de la nube REANUDADA...');
}

// 🩹 Marcador de pausa-por-restauración (Judgment Day 2026-07-11): la
// restauración pausa la DESCARGA y la reanuda en su finally. Si la pestaña
// muere a mitad (crash, cierre), el finally nunca corre y el dispositivo
// queda "congelado" respecto a la nube para siempre, en silencio. El
// marcador distingue "pausa de restauración" de una pausa manual del
// usuario, y el heal al arrancar reanuda SOLO la primera.
const _RESTORE_PAUSE_LS_KEY = 'asistencia_restore_download_pause';

export function markRestoreDownloadPause() {
    try { localStorage.setItem(_RESTORE_PAUSE_LS_KEY, 'true'); } catch (_) { /* noop */ }
}

export function clearRestoreDownloadPause() {
    try { localStorage.removeItem(_RESTORE_PAUSE_LS_KEY); } catch (_) { /* noop */ }
}

/**
 * Al arrancar la app: si quedó un marcador de restauración con la descarga
 * aún pausada, la restauración anterior murió a mitad — reanudar y avisar
 * por consola. Una pausa manual (sin marcador) jamás se toca.
 * @returns {boolean} true si hubo curación.
 */
export function healOrphanedRestorePause() {
    try {
        if (localStorage.getItem(_RESTORE_PAUSE_LS_KEY) !== 'true') return false;
        localStorage.removeItem(_RESTORE_PAUSE_LS_KEY);
        if (isDownloadPaused()) {
            _writeDownloadPausedFlag(false);
            console.warn('🩹 Restauración interrumpida detectada: la descarga de la nube quedó pausada y se reanudó automáticamente.');
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

export default { isSyncPaused, pauseCloudUpload, resumeCloudUpload, isDownloadPaused, pauseCloudDownload, resumeCloudDownload, markRestoreDownloadPause, clearRestoreDownloadPause, healOrphanedRestorePause };
