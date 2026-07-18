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

/**
 * Fase 2B JD Ronda 2, fix F1.
 *
 * Decide si FirebaseService.saveSettings debe proceder con el write, dado
 * un posible override explícito (`force`). Se extrae como función pura para
 * que la decisión de "force" en sí sea testeable de forma aislada, ya que
 * FirebaseService está mockeado globalmente por moduleNameMapper en los
 * tests (mismo motivo por el que shouldWriteSettings vive acá).
 *
 * Bug que corrige: replaceCloudFull ("reemplazar nube con mis datos", un
 * override EXPLÍCITO del usuario) llamaba a saveSettings sin ninguna forma
 * de saltear el guard LWW de shouldWriteSettings. Bajo una carrera (otro
 * dispositivo escribe settings mientras el modal de conflicto espera
 * confirmación, o desfasaje de reloj), el guard podía descartar en silencio
 * la decisión explícita del usuario — el espejo quedaba reemplazado pero
 * /data/settings conservaba el valor del OTRO dispositivo.
 *
 * @param {object} args
 * @param {boolean} [args.force=false] true = override explícito (p.ej.
 *   replaceCloudFull) — el guard LWW se ignora, siempre escribe.
 * @param {boolean} [args.remoteExists=false] si el doc remoto ya existe
 *   (ignorado cuando force=true).
 * @param {number} [args.payloadUpdatedAt=0]
 * @param {number} [args.remoteUpdatedAt=0]
 * @returns {boolean} true = escribir (setDoc); false = omitir el write.
 */
export function resolveSettingsWrite({
    force = false,
    remoteExists = false,
    payloadUpdatedAt = 0,
    remoteUpdatedAt = 0
} = {}) {
    if (force) return true;
    if (!remoteExists) return true;
    return shouldWriteSettings({ payloadUpdatedAt, remoteUpdatedAt });
}

export default { shouldWriteSettings, resolveSettingsWrite };
