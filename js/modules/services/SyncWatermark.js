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

export default { localStateIsEmpty, shouldAcceptRemote };
