/**
 * 🗣️ ErrorTranslator.js
 *
 * Traduce errores técnicos (Firestore, Firebase Auth, IndexedDB, red) a
 * mensajes en español que un usuario sin conocimientos técnicos pueda
 * entender y, cuando corresponde, saber qué hacer. NO reemplaza el logging
 * técnico — console.error/console.warn siguen existiendo para diagnóstico;
 * esto sólo decide qué texto ve el usuario final.
 *
 * Disparador: incidente de campo 2026-07-05 (cuota de Firestore agotada) —
 * el usuario vio "FirebaseError: [code=resource-exhausted]: Quota exceeded"
 * crudo en la consola, y varios puntos de la app concatenan error.message
 * directo en notificaciones al usuario.
 */

const FIRESTORE_MESSAGES = {
    'resource-exhausted': 'Se alcanzó el límite de uso gratuito del servicio de nube por hoy. Tus datos están a salvo en este dispositivo — la sincronización se reanuda sola cuando el límite se renueve.',
    'permission-denied': 'No tenés permiso para hacer esta operación. Si creés que es un error, contactá al administrador.',
    'unavailable': 'No se pudo conectar con el servicio de nube. Revisá tu conexión a internet — tus datos están a salvo en este dispositivo y se sincronizarán solos apenas vuelva la señal.',
    'deadline-exceeded': 'El servicio de nube tardó demasiado en responder. Tus datos están a salvo en este dispositivo; probá de nuevo en un momento.',
    'not-found': 'No se encontró la información solicitada en la nube.',
    'already-exists': 'Ya existe un registro con esos datos.',
    'unauthenticated': 'Tu sesión expiró. Cerrá sesión y volvé a iniciarla.',
    'cancelled': 'La operación se canceló.',
    'failed-precondition': 'No se pudo completar la operación por el estado actual de los datos.',
    'invalid-argument': 'Los datos enviados no son válidos.',
    'aborted': 'La operación se interrumpió, probablemente por un conflicto con otro cambio. Probá de nuevo.',
    'internal': 'Ocurrió un problema interno del servicio de nube. Probá de nuevo en un momento.',
    'data-loss': 'Se detectó una posible pérdida de datos en la nube. Contactá a soporte.'
};

const AUTH_MESSAGES = {
    'auth/network-request-failed': 'No se pudo conectar para iniciar sesión. Revisá tu conexión a internet.',
    'auth/popup-closed-by-user': 'Se cerró la ventana de inicio de sesión antes de completarla.',
    'auth/user-disabled': 'Esta cuenta fue deshabilitada. Contactá al administrador.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá un momento antes de volver a intentar.'
};

const NETWORK_PATTERN = /Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|net::ERR_/i;
const CONSTRAINT_PATTERN = /ConstraintError/i;

function isConstraintError(error) {
    return error?.name === 'ConstraintError' || CONSTRAINT_PATTERN.test(String(error?.message || ''));
}

function isStorageQuotaError(error) {
    return error?.name === 'QuotaExceededError' || /QuotaExceededError/i.test(String(error?.message || ''));
}

function isNetworkFailureMessage(error) {
    return NETWORK_PATTERN.test(String(error?.message || ''));
}

function genericFallback(fallbackContext) {
    return fallbackContext
        ? `Ocurrió un problema al ${fallbackContext}. Probá de nuevo; si persiste, contactá a soporte.`
        : 'Ocurrió un problema inesperado. Probá de nuevo; si persiste, contactá a soporte.';
}

/**
 * @param {*} error - error capturado (Error, objeto con .code/.name, string, o null/undefined)
 * @param {{fallbackContext?: string, isOnline?: boolean}} [opts]
 *   fallbackContext: acción que se estaba intentando (ej. "cargar el backup"),
 *     se incorpora SOLO al mensaje genérico (cuando no hay un código reconocible).
 *   isOnline: por defecto navigator.onLine si existe; inyectable para test.
 * @returns {string} mensaje en español, sin detalles técnicos.
 */
export function translateError(error, opts = {}) {
    // Defensivo: un caller que pase un string/número/array por error (en vez
    // de {fallbackContext, isOnline}) no debe tirar TypeError — 'in' exige un
    // objeto a la derecha y explotaba con cualquier valor no-objeto acá.
    const safeOpts = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
    const { fallbackContext = null } = safeOpts;
    const isOnline = 'isOnline' in safeOpts
        ? safeOpts.isOnline
        : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

    if (!error || typeof error !== 'object') {
        if (isOnline === false) return FIRESTORE_MESSAGES['unavailable'];
        return genericFallback(fallbackContext);
    }

    const code = typeof error.code === 'string' ? error.code : null;
    if (code && FIRESTORE_MESSAGES[code]) return FIRESTORE_MESSAGES[code];
    if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];

    if (isStorageQuotaError(error)) {
        return 'El almacenamiento local del dispositivo está lleno. Liberá espacio o borrá datos que ya no uses.';
    }
    if (isConstraintError(error)) {
        return 'No se pudo guardar en el almacenamiento local del dispositivo (puede estar lleno o dañado). Probá liberar espacio o recargar la app.';
    }
    if (isOnline === false || isNetworkFailureMessage(error)) {
        return FIRESTORE_MESSAGES['unavailable'];
    }

    return genericFallback(fallbackContext);
}

export default translateError;
