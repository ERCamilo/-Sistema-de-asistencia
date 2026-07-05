/**
 * 📋 ErrorLog.js
 *
 * Registro local (localStorage) de errores técnicos, para que el usuario
 * pueda exportarlo y compartirlo cuando algo falla — sin tener que copiar
 * pantallazos de la consola del navegador. Vive junto a ErrorTranslator.js
 * (que decide el MENSAJE QUE VE el usuario); este módulo guarda el detalle
 * técnico completo (code, name, message, stack) para diagnóstico.
 *
 * localStorage, no IndexedDB: es un dato diagnóstico liviano y descartable
 * (no datos de negocio), no justifica un bump de versión de esquema ni una
 * migración. Cap de entradas (MAX_ENTRIES) para no crecer sin límite — mismo
 * criterio que NestedTombstones.js: conserva las más recientes.
 */

const STORAGE_KEY = 'attendance-error-log';
const MAX_ENTRIES = 200;

function _readAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function _writeAll(entries) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch (_) {
        // localStorage lleno/no disponible: no debe romper el flujo del error
        // real que disparó este log — perder el log es aceptable, perder el
        // manejo del error original no.
    }
}

/**
 * Registra un error técnico. Nunca lanza (defensivo por diseño: un log que
 * rompe el flujo que intenta diagnosticar sería peor que no tener log).
 * @param {*} error - Error, objeto con .code/.name/.message, string, o null/undefined.
 * @param {string|null} [context] - qué se estaba intentando (ej. "cargar el backup").
 * @returns {{timestamp:number, context:string|null, code:string|null, name:string|null, message:string, stack:string|null}}
 */
export function logError(error, context = null) {
    const isObj = error && typeof error === 'object';
    const entry = {
        timestamp: Date.now(),
        context: typeof context === 'string' ? context : null,
        code: (isObj && typeof error.code === 'string') ? error.code : null,
        name: (isObj && typeof error.name === 'string') ? error.name : null,
        message: (isObj && typeof error.message === 'string') ? error.message : String(error ?? 'Error desconocido'),
        stack: (isObj && typeof error.stack === 'string') ? error.stack : null
    };
    const entries = _readAll();
    entries.push(entry);
    _writeAll(entries);
    return entry;
}

/** Devuelve todas las entradas registradas (más viejas primero). */
export function getAllErrors() {
    return _readAll();
}

/** Vacía el registro. */
export function clearErrorLog() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
}

/** Formatea el log completo como texto plano, para exportar/descargar. */
export function formatErrorLogAsText(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return 'Sin errores registrados.';
    return list.map(e => {
        const date = new Date(e.timestamp).toISOString();
        const ctx = e.context ? ` (${e.context})` : '';
        const code = e.code ? ` [${e.code}]` : '';
        const header = `[${date}]${ctx} ${e.name || 'Error'}${code}: ${e.message}`;
        return e.stack ? `${header}\n${e.stack}` : header;
    }).join('\n\n');
}

export default { logError, getAllErrors, clearErrorLog, formatErrorLogAsText };
