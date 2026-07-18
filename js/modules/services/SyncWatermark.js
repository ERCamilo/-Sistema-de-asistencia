/**
 * SyncWatermark.js — política pura de aceptación de datos remotos.
 *
 * Usado por el listener subscribeToChanges para decidir si aplicar el
 * snapshot de la nube o descartarlo por "obsoleto".
 *
 * Corrige el bug del navegador fresco: un estado local vacío con un
 * localUpdatedAt recién estampado (por un guardado prematuro) hacía que el
 * watermark descartara la nube real → los datos nunca cargaban.
 */

/**
 * ¿El estado local no tiene entidades que proteger?
 * (sin empleados, cargos ni líderes)
 * @param {object} state
 * @returns {boolean}
 */
export function localStateIsEmpty(state) {
    if (!state) return true;
    const n = (arr) => (Array.isArray(arr) ? arr.length : 0);
    return n(state.employees) === 0 && n(state.positions) === 0 && n(state.leaders) === 0;
}

/**
 * ¿Debemos aceptar (aplicar) los datos remotos?
 * @param {object} args
 * @param {number} [args.localTime]  state.settings.localUpdatedAt local
 * @param {number} [args.remoteTime] remoteData.settings.localUpdatedAt
 * @param {boolean} args.localEmpty  resultado de localStateIsEmpty(state)
 * @returns {boolean} true = aplicar la nube; false = descartar (watermark)
 */
export function shouldAcceptRemote({ localTime = 0, remoteTime = 0, localEmpty = false } = {}) {
    // Sin datos locales no hay nada que proteger → aceptar siempre.
    if (localEmpty) return true;
    // Con datos locales: aceptar solo si la nube no es más vieja.
    return remoteTime >= localTime;
}

/**
 * Fase 2B U2 — combina el watermark de nube desde DOS fuentes: el doc
 * per-registro de settings (users/{uid}/data/settings, listener propio sin
 * throttle) y el espejo (users/{uid}/data/current, cuya cadencia se reduce
 * en Change B). Ninguna fuente por sí sola es autoritativa — cada una puede
 * disparar en momentos distintos — así que el watermark efectivo es siempre
 * el MÁS RECIENTE conocido entre las tres entradas (el watermark actual +
 * lo último visto de cada fuente).
 *
 * `current` actúa como piso: el watermark nunca retrocede, aunque una de las
 * dos fuentes reporte, en un disparo puntual, algo más viejo que lo que ya
 * se sabía (p.ej. el espejo dispara con un snapshot desactualizado mientras
 * el doc de settings ya había adelantado el watermark).
 *
 * @param {number} [current] watermark ya conocido (state._lastKnownCloudUpdatedAt)
 * @param {number|null} [fromSettings] settings.localUpdatedAt visto en el doc de settings (null/undefined si esa fuente no aportó nada nuevo, p.ej. cuenta v3/legacy sin doc todavía)
 * @param {number|null} [fromMirror] settings.localUpdatedAt visto en el doc espejo (null/undefined si esa fuente no aportó nada nuevo)
 * @returns {number} el mayor timestamp conocido entre las tres entradas
 */
export function mergeCloudWatermark(current, fromSettings, fromMirror) {
    const c = Number.isFinite(current) ? current : 0;
    const s = Number.isFinite(fromSettings) ? fromSettings : 0;
    const m = Number.isFinite(fromMirror) ? fromMirror : 0;
    return Math.max(c, s, m);
}

export default { localStateIsEmpty, shouldAcceptRemote, mergeCloudWatermark };
