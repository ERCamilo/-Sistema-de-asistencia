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

/**
 * Fase 2B JD-A1 — cache compartido de los dos últimos timestamps conocidos
 * por fuente (doc per-registro de settings y espejo).
 *
 * ANTES: `_lastKnownSettingsDocTs` / `_lastKnownMirrorTs` vivían como
 * variables `let` de closure en DOS scopes DISTINTOS dentro de app.js — el
 * listener del espejo (subscribeToChanges, dentro del IIFE de
 * onAuthStateChanged) y la suscripción a subscribeToSettings. El reset de
 * "local wins" en `_initOutgoingConflictGuard` (función de nivel de módulo,
 * llamada UNA vez desde initializeApp) solo podía limpiar
 * `state._lastKnownCloudUpdatedAt` porque esas dos closures no eran
 * accesibles desde ahí. El resultado: el próximo snapshot remoto legítimo
 * volvía a MAXear los dos caches stale-altos vía mergeCloudWatermark,
 * resucitando el watermark que el usuario ya había resuelto — re-disparaba
 * el modal de conflicto saliente y saltaba el enqueue a la nube de ese
 * guardado.
 *
 * FIX: un único objeto de cache, importable tanto desde
 * `_initOutgoingConflictGuard` como desde los listeners del espejo y de
 * settings, con un `reset()` que limpia AMBAS fuentes atómicamente junto
 * con `state._lastKnownCloudUpdatedAt`.
 *
 * @returns {{
 *   get: () => {settingsDocTs: number, mirrorTs: number},
 *   setSettingsDocTs: (ts: number) => void,
 *   setMirrorTs: (ts: number) => void,
 *   reset: (value?: number) => void
 * }}
 */
export function createWatermarkCache() {
    let settingsDocTs = 0;
    let mirrorTs = 0;

    return {
        get() {
            return { settingsDocTs, mirrorTs };
        },
        setSettingsDocTs(ts) {
            settingsDocTs = Number.isFinite(ts) ? ts : 0;
        },
        setMirrorTs(ts) {
            mirrorTs = Number.isFinite(ts) ? ts : 0;
        },
        reset(value = 0) {
            const v = Number.isFinite(value) ? value : 0;
            settingsDocTs = v;
            mirrorTs = v;
        }
    };
}

/**
 * Instancia única compartida por toda la sesión de app.js (un solo usuario
 * autenticado a la vez por pestaña) — importada tanto por
 * `_initOutgoingConflictGuard` (reset) como por los listeners de
 * subscribeToChanges / subscribeToSettings (lectura/escritura), resolviendo
 * el desajuste de scopes descrito arriba.
 */
export const outgoingWatermarkCache = createWatermarkCache();

/**
 * Judgment Day Fase 2B, Ronda 3 (fix F2 completo) — resetea ATÓMICAMENTE las
 * DOS piezas del watermark saliente:
 *   1. `stateObj._lastKnownCloudUpdatedAt` — leído por
 *      PersistenceService._executeSave como `_cloudTime` para el gate de
 *      conflicto saliente.
 *   2. El cache compartido (settingsDocTs/mirrorTs) — leído por
 *      mergeCloudWatermark, que usa el watermark actual como PISO (Math.max)
 *      y por lo tanto nunca retrocede solo.
 *
 * ANTES: el reset "local wins" de `_initOutgoingConflictGuard` hacía ambas
 * cosas inline y correctamente. Los dos resets agregados por el fix F2
 * (login y logout, para no arrastrar timestamps de una cuenta a la
 * siguiente en la misma pestaña) solo llamaban a
 * `outgoingWatermarkCache.reset()` y se olvidaban de
 * `stateObj._lastKnownCloudUpdatedAt`. Como ese valor es el que
 * PersistenceService realmente usa como piso del gate, un
 * logout→login sin reload dejaba sobrevivir el timestamp stale de la cuenta
 * anterior y disparaba un conflicto saliente espurio contra la cuenta
 * nueva — el mismo bug cross-cuenta que fix F2 debía cerrar.
 *
 * Este helper une los dos resets en un único punto testeable para que las
 * dos piezas no puedan volver a desincronizarse.
 *
 * @param {object} stateObj  objeto state de la app (o un fake en tests)
 * @param {{reset: (value?: number) => void}} cache  instancia de createWatermarkCache()
 * @param {number} [value] valor al que resetear ambas piezas (default 0)
 */
export function resetOutgoingWatermark(stateObj, cache, value = 0) {
    const v = Number.isFinite(value) ? value : 0;
    if (stateObj) stateObj._lastKnownCloudUpdatedAt = v;
    if (cache) cache.reset(v);
}

export default { localStateIsEmpty, shouldAcceptRemote, mergeCloudWatermark, createWatermarkCache, outgoingWatermarkCache, resetOutgoingWatermark };
