/**
 * 📡 SettingsLiveSync.js (Fase 2B, U2 — extracción de cobertura)
 *
 * Lógica de decisión del callback de FirebaseService.subscribeToSettings,
 * extraída de app.js (onAuthStateChanged) para que sea testeable sin
 * depender de un mock gigante de ese IIFE — mismo espíritu que
 * EmployeesLiveSync.js separa el ciclo de vida del listener de empleados.
 *
 * A diferencia de EmployeesLiveSync (que solo gestiona start/stop del
 * onSnapshot), acá SÍ vive la decisión de negocio: si aceptar o descartar
 * el doc remoto de settings (whole-object merge, newer-wins), el mismo
 * criterio que ya usa el espejo (subscribeToChanges). Antes de este cambio,
 * esa decisión estaba inline en app.js y solo tenía cobertura por regex
 * sobre el texto fuente — nada ejecutaba la rama accept/reject de verdad.
 *
 * Inyección de dependencias:
 *   - shouldAcceptRemote / mergeCloudWatermark / localStateIsEmpty / getDeviceId
 *     ya son funciones puras (SyncWatermark.js, Config.js) — se importan por
 *     defecto pero admiten override vía `deps` para tests deterministas.
 *   - batchSetState: inyectado por el caller (normalmente
 *     stateManager.batchSetState) para que las mutaciones de `state` puedan
 *     testearse contra un objeto plano sin Proxy real.
 */

import {
    shouldAcceptRemote as shouldAcceptRemoteDefault,
    mergeCloudWatermark as mergeCloudWatermarkDefault,
    localStateIsEmpty as localStateIsEmptyDefault
} from './SyncWatermark.js';
import { getDeviceId as getDeviceIdDefault } from '../config/Config.js';

/**
 * Procesa un doc remoto de settings (users/{uid}/data/settings) y decide si
 * mergearlo en `state.settings`.
 *
 * @param {object} args
 * @param {{settings: object, updatedAt: *, lastChangedBy: string}} args.remoteDoc
 *   Doc recibido desde FirebaseService.subscribeToSettings.
 * @param {object} args.state Estado mutable (lee/escribe state.settings y
 *   state._lastKnownCloudUpdatedAt).
 * @param {number} [args.lastKnownMirrorTs] Último ts conocido del espejo
 *   (subscribeToChanges), para combinar el watermark por MAX.
 * @param {(cb: Function) => void} args.batchSetState Función que envuelve
 *   las mutaciones de `state` (normalmente stateManager.batchSetState).
 * @param {object} [args.deps] Overrides para test:
 *   shouldAcceptRemote, mergeCloudWatermark, localStateIsEmpty, getDeviceId, debugLog.
 * @returns {{accepted: boolean, echo: boolean, settingsDocTs: number}}
 */
export function handleRemoteSettings({
    remoteDoc,
    state,
    lastKnownMirrorTs = 0,
    batchSetState,
    deps = {}
} = {}) {
    const {
        shouldAcceptRemote = shouldAcceptRemoteDefault,
        mergeCloudWatermark = mergeCloudWatermarkDefault,
        localStateIsEmpty = localStateIsEmptyDefault,
        getDeviceId = getDeviceIdDefault,
        debugLog = () => {}
    } = deps;

    if (!remoteDoc || !state || typeof batchSetState !== 'function') {
        return { accepted: false, echo: false, settingsDocTs: 0 };
    }

    // 🛡️ Filtro de eco (defensa en profundidad): FirebaseService.subscribeToSettings
    // ya filtra los ecos por lastChangedBy ANTES de invocar este callback (mismo
    // criterio que subscribeToChanges). Esta segunda comprobación mantiene la
    // función auto-contenida y testeable sin pasar por ese primer filtro.
    if (remoteDoc.lastChangedBy && remoteDoc.lastChangedBy === getDeviceId()) {
        debugLog('📡 Ignorando eco de settings: cambio local detectado via deviceId');
        return { accepted: false, echo: true, settingsDocTs: 0 };
    }

    const settingsDocTs = remoteDoc.settings?.localUpdatedAt || 0;
    const remoteTime = settingsDocTs;
    const localTime = state.settings?.localUpdatedAt || 0;
    const localEmpty = localStateIsEmpty(state);
    const accept = shouldAcceptRemote({ localTime, remoteTime, localEmpty });

    batchSetState(() => {
        // El watermark se actualiza SIEMPRE (incluso si el merge de abajo se
        // descarta), igual que el espejo: combinado por MAX para que esta
        // fuente no atrase al espejo ni viceversa.
        state._lastKnownCloudUpdatedAt = mergeCloudWatermark(
            state._lastKnownCloudUpdatedAt,
            settingsDocTs,
            lastKnownMirrorTs
        );
        if (accept) {
            // Merge whole-object (mismo patrón que el espejo): el dispositivo
            // remoto siempre tiene el mapa de settings completo en memoria.
            state.settings = { ...state.settings, ...remoteDoc.settings };
        }
    });

    if (!accept) {
        debugLog(`🛡️ Settings: doc remoto (${remoteTime}) es más antiguo que Estado Local (${localTime}). Ignorado.`);
    }

    return { accepted: accept, echo: false, settingsDocTs };
}

export default { handleRemoteSettings };
