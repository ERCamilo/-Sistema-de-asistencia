/**
 * 🐞 Debug.js - Utilidades de Depuración
 */

const DEBUG_MODE = true; // Por ahora activado para estabilización

export const debug = {
    log: (...args) => { if (DEBUG_MODE) console.log('DEBUG:', ...args); },
    error: (...args) => console.error('DEBUG ERROR:', ...args),
    warn: (...args) => { if (DEBUG_MODE) console.warn('DEBUG WARN:', ...args); }
};
