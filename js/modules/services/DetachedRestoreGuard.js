/**
 * 🧷 DetachedRestoreGuard.js (M2)
 *
 * «Desconectar y restaurar» cierra la sesión y restaura un respaldo solo en
 * este dispositivo. Si después se vuelve a iniciar sesión, el arranque normal
 * (espejo, listas en vivo, Caja Chica) aplicaba la nube sobre lo restaurado:
 * lo que la nube no tenía desaparecía del dispositivo sin aviso.
 *
 * Este módulo deja una marca local (nunca se sincroniza) y, en el siguiente
 * inicio de sesión, detiene el arranque hasta que el usuario elige:
 *   - 'upload': subir lo restaurado a la cuenta que inició sesión;
 *   - 'cloud':  descartar lo restaurado y usar la nube (el archivo no cambia);
 *   - 'logout': cerrar sesión y seguir solo en este dispositivo.
 * Sin elección (cerrar el diálogo) equivale a 'logout'. La marca solo se
 * borra cuando la opción elegida terminó bien.
 *
 * El guardián de dueño local (LocalDataOwner) se evalúa ANTES: si inicia
 * sesión otra cuenta, sigue mandando su propio diálogo y aquí no se sube nada.
 */

export const DETACHED_RESTORE_LS_KEY = 'asistencia_detached_restore_v1';

// La marca durable permanece durante la subida. Solo la operación autorizada
// en esta pestaña puede pasar las guardias de salida; otras pestañas siguen
// bloqueadas y un cierre inesperado conserva la decisión pendiente.
// El estado es por pestaña y lo comparten todos los módulos cargados en ella.
const SYNC_ALLOWANCE_KEY = Symbol.for('sa.detachedRestoreSyncAllowance');
const syncAllowance = globalThis[SYNC_ALLOWANCE_KEY]
    || (globalThis[SYNC_ALLOWANCE_KEY] = { depth: 0 });

export function isDetachedRestoreSyncBlocked() {
    return Boolean(getDetachedRestore()) && syncAllowance.depth === 0;
}

async function withAuthorizedSync(action) {
    syncAllowance.depth++;
    try { return await action(); }
    finally { syncAllowance.depth--; }
}

export const DETACHED_RESTORE_CHOICE = Object.freeze({
    UPLOAD: 'upload',
    CLOUD: 'cloud',
    LOGOUT: 'logout'
});

/** Marca activa o null. Nunca lanza. */
export function getDetachedRestore() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DETACHED_RESTORE_LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        // Una marca ilegible sigue siendo una marca: mejor preguntar de más.
        return { restoredAt: 0, previousUid: null, hasPettyCash: true, unreadable: true };
    }
}

/**
 * Registra la restauración desconectada. Devuelve false si no se pudo guardar
 * (el caller debe avisar: sin marca no habrá diálogo al volver a entrar).
 */
export function markDetachedRestore({ previousUid = null, hasPettyCash = false, now = Date.now() } = {}) {
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(DETACHED_RESTORE_LS_KEY, JSON.stringify({
            restoredAt: now,
            previousUid: previousUid ? String(previousUid) : null,
            hasPettyCash: Boolean(hasPettyCash)
        }));
        return true;
    } catch (_) {
        return false;
    }
}

export function clearDetachedRestore() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(DETACHED_RESTORE_LS_KEY); } catch (_) { /* noop */ }
}

/**
 * Orquesta la decisión al iniciar sesión. Todo efecto llega inyectado.
 *
 * @param {{
 *   user: {uid: string, email?: string},
 *   marker?: object|null,
 *   ask: (ctx: {user: object, marker: object}) => Promise<string|null>,
 *   upload: (ctx) => Promise<{ok: boolean}|void>,
 *   useCloud: (ctx) => Promise<{ok: boolean}|void>,
 *   logout: () => Promise<void>,
 *   isCurrent?: () => boolean
 * }} deps
 * @returns {Promise<{proceed: boolean, choice: string|null, ok?: boolean}>}
 *   proceed=true: el arranque normal puede seguir (sin marca o subida hecha).
 */
export async function runDetachedRestoreLoginGate({
    user,
    marker = getDetachedRestore(),
    ask,
    upload,
    useCloud,
    logout,
    isCurrent = () => true
} = {}) {
    if (!marker) return { proceed: true, choice: null };
    const ctx = { user, marker };
    let choice = null;
    try {
        choice = await ask(ctx);
    } catch (_) {
        choice = null;
    }
    if (!isCurrent()) return { proceed: false, choice };

    if (choice === DETACHED_RESTORE_CHOICE.UPLOAD || choice === DETACHED_RESTORE_CHOICE.CLOUD) {
        // La marca persiste hasta completar la decisión. Si la pestaña se
        // cierra a mitad de la subida, el próximo login vuelve a preguntar.
        let result;
        try {
            result = await (choice === DETACHED_RESTORE_CHOICE.UPLOAD
                ? withAuthorizedSync(() => upload(ctx))
                : useCloud(ctx));
        } catch (error) {
            result = { ok: false, error };
        }
        if (result?.ok === false) {
            // La sustitución por la nube puede haber borrado el almacenamiento
            // local; en ese caso restauramos la marca antes de cerrar sesión.
            if (!getDetachedRestore()) markDetachedRestore({
                previousUid: marker.previousUid ?? null,
                hasPettyCash: marker.hasPettyCash !== false,
                now: Number(marker.restoredAt) || Date.now()
            });
            // Sin la opción confirmada no se arranca la sync: la nube podría
            // pisar lo restaurado.
            if (isCurrent()) await logout();
            return { proceed: false, choice, ok: false, error: result.error || result.reason || null };
        }
        clearDetachedRestore();
        // 'cloud' recarga la app: el arranque de esta pestaña no sigue.
        return { proceed: choice === DETACHED_RESTORE_CHOICE.UPLOAD && isCurrent(), choice, ok: true };
    }

    await logout();
    return { proceed: false, choice: DETACHED_RESTORE_CHOICE.LOGOUT };
}

export default {
    DETACHED_RESTORE_LS_KEY,
    DETACHED_RESTORE_CHOICE,
    getDetachedRestore,
    markDetachedRestore,
    clearDetachedRestore,
    isDetachedRestoreSyncBlocked,
    runDetachedRestoreLoginGate
};
