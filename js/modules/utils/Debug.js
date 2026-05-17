/**
 * 🐞 Debug.js - Utilidades de Depuración
 *
 * `debug.log` y `debug.warn` solo escriben en consola si el modo debug
 * está activo. Esto reduce el ruido en producción.
 *
 * Cómo activar/desactivar desde la consola del navegador:
 *   debug.enable()   → activa logs verbosos (persiste en localStorage)
 *   debug.disable()  → desactiva logs verbosos
 *   debug.isEnabled  → estado actual
 *
 * Los errores (debug.error) SIEMPRE se muestran.
 */

const STORAGE_KEY = 'app:debugMode';

// Estado inicial: si el usuario lo activó previamente, mantener; si no, off por defecto
let DEBUG_MODE = (() => {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(STORAGE_KEY) === '1';
        }
    } catch (_) { /* localStorage no disponible (modo privado) */ }
    return false;
})();

export const debug = {
    log: (...args) => { if (DEBUG_MODE) console.log('DEBUG:', ...args); },
    error: (...args) => console.error('DEBUG ERROR:', ...args),
    warn: (...args) => { if (DEBUG_MODE) console.warn('DEBUG WARN:', ...args); },

    enable() {
        DEBUG_MODE = true;
        try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
        console.log('%c🐞 Debug mode ENABLED', 'background: #06b6d4; color: #000; padding: 2px 8px; border-radius: 4px;');
    },

    disable() {
        DEBUG_MODE = false;
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        console.log('%c🔇 Debug mode disabled', 'background: #64748b; color: #fff; padding: 2px 8px; border-radius: 4px;');
    },

    get isEnabled() {
        return DEBUG_MODE;
    }
};

// Exponer en window para uso desde la consola
if (typeof window !== 'undefined') {
    window.debug = debug;
}
