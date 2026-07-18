/**
 * SettingsWriteGuard.js — Judgment Day Fase 2B, fix B1.
 *
 * Política pura LWW (last-write-wins) para decidir si un payload local de
 * settings debe sobreescribir el doc remoto per-registro
 * (users/{uid}/data/settings), o si el remoto ya es más nuevo y el write
 * debe omitirse.
 *
 * Por qué existe como módulo aparte:
 *   FirebaseService.js está mockeado globalmente por moduleNameMapper en
 *   los tests (ver comentario en FirebaseServiceMergeAndReasonTests.js) —
 *   ni siquiera jest.requireActual comparte los mocks de firebase-data con
 *   el árbol de módulos real, así que no se puede observar el
 *   comportamiento de FirebaseService.saveSettings() de forma behavioral.
 *   La decisión LWW en sí (la parte crítica del bug) se extrae acá como
 *   función pura, testeable de forma aislada — mismo patrón que
 *   SyncWatermark.js.
 *
 * Bug que corrige: FirebaseService.saveSettings hacía un setDoc ciego sin
 * comparar contra el doc remoto. Un dispositivo que drenaba una entrada
 * STALE del outbox 'settings' (p.ej. tras estar offline) podía pisar un
 * settings más nuevo ya escrito por otro dispositivo — pérdida de datos
 * silenciosa, sin ningún gate de watermark que lo protegiera (a diferencia
 * de 'mirror', 'settings' se encola sin gate de watermark en
 * MainSyncStore._resolveCloudCall, con el argumento — antes falso — de que
 * saveSettings ya era LWW-safe por sí mismo).
 */

/**
 * ¿Debe escribirse el payload local sobre el doc remoto de settings?
 * @param {object} args
 * @param {number} [args.payloadUpdatedAt] settings.localUpdatedAt del payload a escribir
 * @param {number} [args.remoteUpdatedAt] settings.localUpdatedAt del doc remoto actual
 * @returns {boolean} true = escribir (full-replace); false = omitir (el remoto es más nuevo)
 */
export function shouldWriteSettings({ payloadUpdatedAt = 0, remoteUpdatedAt = 0 } = {}) {
    const p = Number.isFinite(payloadUpdatedAt) ? payloadUpdatedAt : 0;
    const r = Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0;
    // Empate → gana el payload local (full-replace), mismo criterio que
    // shouldAcceptRemote (SyncWatermark.js) trata remoteTime === localTime
    // como "aceptar" en la dirección opuesta.
    return p >= r;
}

export default { shouldWriteSettings };
