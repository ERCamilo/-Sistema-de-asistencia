/**
 * 🗓️ AutoSnapshotPolicy.js (R-gaps: tormenta de reintentos de snapshot)
 *
 * Decide si corresponde intentar un backup automático (snapshot) en este save.
 *
 * Antes el guard sólo miraba lastSnapshotTimestamp (que se estampa SÓLO en
 * éxito): si createSnapshot fallaba persistentemente, cada save volvía a
 * intentarlo, re-serializando el estado completo en el hot path. Acá agregamos
 * un cooldown entre INTENTOS. El caller debe persistir `lastAttempt` en
 * almacenamiento DEVICE-LOCAL (localStorage), nunca en state.settings, porque
 * settings se mirror-ea a la nube y un "intento fallido" suprimiría los backups
 * de otros dispositivos.
 */

// Cooldown mínimo entre intentos de snapshot automático (frena la tormenta de
// reintentos cuando createSnapshot falla seguido). Device-local.
export const SNAPSHOT_RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hora

export const SNAPSHOT_INTERVALS = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000
};

/**
 * @param {Object} p
 * @param {string} p.freq - 'none' | 'daily' | 'weekly' | 'monthly'
 * @param {number} p.now - Date.now()
 * @param {number} [p.lastSuccess=0] - timestamp del último backup EXITOSO (de state.settings)
 * @param {number} [p.lastAttempt=0] - timestamp del último INTENTO (device-local/localStorage)
 * @param {number} [p.cooldownMs=SNAPSHOT_RETRY_COOLDOWN_MS]
 * @returns {boolean} true si corresponde intentar el snapshot ahora
 */
export function shouldAttemptAutoSnapshot({
    freq,
    now,
    lastSuccess = 0,
    lastAttempt = 0,
    cooldownMs = SNAPSHOT_RETRY_COOLDOWN_MS
}) {
    if (!freq || freq === 'none') return false;
    const interval = SNAPSHOT_INTERVALS[freq];
    if (!interval) return false;

    const dueBySchedule = (now - lastSuccess) > interval;
    const cooledDown = (now - lastAttempt) >= cooldownMs;
    return dueBySchedule && cooledDown;
}
