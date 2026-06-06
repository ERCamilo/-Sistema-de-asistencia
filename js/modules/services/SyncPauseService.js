/**
 * ⏸️ SyncPauseService.js (cloud-upload pause feature)
 *
 * Manages the cloudUploadPaused flag in state.settings.
 * When paused:
 *   - All saves still go to IndexedDB (local persistence is unaffected).
 *   - Firebase sync is skipped until the user resumes.
 *   - The SyncStatusBadge shows a "⏸️ Sync pausado" state.
 *   - The flag persists across page refreshes (stored in IndexedDB via
 *     the normal save cycle).
 *
 * Typical flow:
 *   User rejects incoming changes and chooses "pause" →
 *   pauseCloudUpload() is called →
 *   Future saves skip Firebase →
 *   User clicks "Reanudar" in the badge or settings →
 *   resumeCloudUpload() is called →
 *   The flag is cleared and local state is re-uploaded immediately.
 *
 * Dependency note: this module imports from PersistenceService to
 * trigger saves. PersistenceService in turn imports isSyncPaused() from
 * here to guard the Firebase sync block — no circular dependency because
 * PersistenceService only calls isSyncPaused() at runtime (not at module
 * evaluation time), and this module only calls saveApplicationData at
 * runtime.
 */

import { state } from '../core/AppState.js';

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
 *     reanudar.
 *   - app.js: el aviso de boot se dispara si la app arranca con pausa activa.
 */
export const SYNC_PAUSE_ENABLED = true;

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

/**
 * Returns true when cloud uploads are currently paused.
 * Safe to call before state is fully loaded (returns false defensively).
 */
export function isSyncPaused() {
    return state?.settings?.cloudUploadPaused === true;
}

/**
 * Pause cloud uploads. Local (IndexedDB) saves continue normally.
 * The flag is persisted immediately so it survives a page refresh.
 */
export async function pauseCloudUpload(reason = 'Usuario solicitó pausar la sincronización') {
    if (!state.settings) state.settings = {};
    state.settings.cloudUploadPaused = true;
    console.warn(`⏸️ Sincronización de subida a la nube PAUSADA. Motivo: ${reason}`);
    // Save only to IndexedDB (Firebase sync is already gated by the flag
    // we just set, so the save itself won't push to cloud).
    const save = await _getSave();
    save({ immediate: true });
}

/**
 * Resume cloud uploads and immediately re-upload local state to Firestore
 * so any changes made while paused are reflected in the cloud.
 *
 * IMPORTANT: we set the flag to `false` (not `delete`) on purpose. The save
 * path goes through JSON.stringify (which strips undefined properties) and
 * then through Firestore's setDoc(..., { merge: true }), which only overwrites
 * fields present in the payload. If we delete the flag, it disappears from the
 * payload entirely, the cloud keeps the old `true`, and the next subscribe
 * echo re-applies `true` to local state — sync stays paused forever.
 */
export async function resumeCloudUpload() {
    if (!state.settings) state.settings = {};
    // Explicit false (not delete) so the value survives JSON.stringify and
    // overwrites the cloud's old true through Firestore's merge:true.
    state.settings.cloudUploadPaused = false;
    console.log('▶️ Sincronización de subida a la nube REANUDADA. Re-subiendo estado local a la nube...');
    const save = await _getSave();
    save({ force: true, immediate: true });
}

export default { isSyncPaused, pauseCloudUpload, resumeCloudUpload };
