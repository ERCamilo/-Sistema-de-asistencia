/**
 * 🔐 LocalDataOwner.js (Auditoría 2026-06-09, hallazgo C2)
 *
 * Marca los datos locales (IndexedDB/localStorage) con el uid de su dueño.
 *
 * Problema que resuelve: en un navegador compartido, si el usuario B inicia
 * sesión donde antes trabajó el usuario A, la "migración inicial" de app.js
 * (nube vacía + datos locales → subir local) enviaba la nómina de A a la
 * cuenta de B, y B veía todos los datos de A.
 *
 * Modelo:
 *   - claimLocalOwnership(uid): registra al dueño. Se llama en el primer
 *     login y después de un wipe local.
 *   - checkLocalOwnership(uid, {localHasData}):
 *       'match'     → mismo dueño, continuar normal.
 *       'unclaimed' → datos sin marcar (instalación legacy o dispositivo
 *                     limpio): se reclaman en este login.
 *       'mismatch'  → HAY datos locales de OTRA cuenta: el caller debe
 *                     bloquear la sincronización y preguntar al usuario.
 *   - clearLocalOwnership(): al borrar los datos locales del dispositivo.
 *
 * La marca vive en localStorage (por origen), igual que el deviceId: es un
 * estado del DISPOSITIVO, nunca se sincroniza a la nube.
 */

export const LOCAL_OWNER_LS_KEY = 'asistencia_local_owner_uid';

/** uid del dueño registrado de los datos locales, o null. Nunca lanza. */
export function getLocalOwnerUid() {
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(LOCAL_OWNER_LS_KEY) || null;
    } catch (_) {
        return null;
    }
}

/** Registra al dueño de los datos locales. Ignora uids falsy. Nunca lanza. */
export function claimLocalOwnership(uid) {
    if (!uid || typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(LOCAL_OWNER_LS_KEY, String(uid));
    } catch (e) {
        console.warn('⚠️ No se pudo registrar el dueño de los datos locales:', e);
    }
}

/** Elimina la marca de dueño (llamar al borrar los datos locales). */
export function clearLocalOwnership() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
    } catch (e) {
        console.warn('⚠️ No se pudo limpiar la marca de dueño local:', e);
    }
}

/**
 * Evalúa si el uid que inicia sesión puede usar los datos locales.
 *
 * @param {string} uid - uid del usuario que acaba de autenticarse.
 * @param {{localHasData?: boolean}} [opts] - si hay entidades locales que proteger.
 * @returns {'match'|'mismatch'|'unclaimed'}
 */
export function checkLocalOwnership(uid, opts = {}) {
    const owner = getLocalOwnerUid();
    if (!owner) return 'unclaimed';
    if (String(owner) === String(uid)) return 'match';
    // Dueño distinto: solo es un problema si quedan datos que proteger.
    // Sin datos locales no hay nada que filtrar entre cuentas.
    return opts.localHasData ? 'mismatch' : 'unclaimed';
}

export default {
    LOCAL_OWNER_LS_KEY,
    getLocalOwnerUid,
    claimLocalOwnership,
    clearLocalOwnership,
    checkLocalOwnership
};
