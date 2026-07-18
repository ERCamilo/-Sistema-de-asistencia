/**
 * 🟢 SyncStatus.js (Fase 3.2)
 *
 * Estado global que rastrea la última sincronización exitosa con
 * Firebase. La UI lee de aquí para mostrar el badge "Sincronizado
 * hace Xs" y avisar cuando algo lleva demasiado sin sincronizar.
 *
 * Diseño: singleton con suscripciones (pub/sub). Pure JS, sin
 * dependencias. Los callers son los métodos que escriben a Firestore
 * (saveFullState, EmployeeRepository.saveOne, etc.) — invocan
 * markSynced() cuando una escritura completa exitosa.
 */

let _lastSyncedAt = null;
let _lastError = null;
let _syncing = false;
const _subscribers = new Set();

function _notify(ts) {
    // Iteramos sobre una copia para evitar problemas si un callback
    // se desuscribe durante la iteración. Cualquier error en un
    // callback se loguea pero no rompe a los demás.
    [..._subscribers].forEach(cb => {
        try { cb(ts); } catch (e) {
            console.warn('⚠️ SyncStatus subscriber error (ignored):', e);
        }
    });
}

export const SyncStatus = {

    /**
     * @returns {number|null} timestamp (ms) de la última sync exitosa,
     *   o null si nunca se ha sincronizado.
     */
    getLastSyncedAt() {
        return _lastSyncedAt;
    },

    /**
     * Marca el momento en que una escritura a Firebase tuvo éxito.
     * @param {number} [timestamp] Opcional; por defecto Date.now().
     *   Valores no numéricos se ignoran (defensivo contra payload corrupto).
     */
    /**
     * Marca que hay una sincronización EN CURSO (para el spinner del badge).
     * Se apaga sola cuando llega markSynced/markError/clearError.
     */
    markSyncing() {
        _syncing = true;
        _notify(_lastSyncedAt);
    },

    /** @returns {boolean} true si hay una sincronización en vuelo. */
    isSyncing() {
        return _syncing;
    },

    markSynced(timestamp) {
        const ts = (typeof timestamp === 'number' && Number.isFinite(timestamp))
            ? timestamp
            : Date.now();
        // Si el caller pasó algo inválido, no sobrescribir.
        if (arguments.length > 0 && (typeof timestamp !== 'number' || !Number.isFinite(timestamp))) {
            return;
        }
        _lastError = null;
        _syncing = false;
        _lastSyncedAt = ts;
        _notify(ts);
    },

    /**
     * Registra que el último intento de escritura a Firebase falló.
     * Los suscriptores son notificados para que el badge se actualice.
     * @param {Error|*} [error]
     */
    markError(error) {
        _lastError = error ?? true;
        _syncing = false;
        _notify(_lastSyncedAt);
    },

    /** @returns {boolean} true si el último intento de sync falló */
    hasError() {
        return _lastError !== null;
    },

    /**
     * Limpia el error SIN tocar lastSyncedAt (a diferencia de markSynced, que
     * también lo actualiza a ahora). Para cuando un retry manual (U12) tuvo
     * éxito pero no fue una operación que llame a markSynced() — p. ej. sólo
     * se drenaron borrados del outbox — y aun así hay que apagar el badge rojo.
     * No-op (no notifica) si no había error, para no re-renderizar de más.
     */
    clearError() {
        _syncing = false;
        if (_lastError === null) return;
        _lastError = null;
        _notify(_lastSyncedAt);
    },

    /**
     * Suscríbete a cambios. El callback se invoca cada vez que markSynced
     * o reset son llamados, con el nuevo timestamp (o null en reset).
     * @returns {() => void} unsubscribe
     */
    subscribe(cb) {
        if (typeof cb !== 'function') return () => {};
        _subscribers.add(cb);
        return () => { _subscribers.delete(cb); };
    },

    /**
     * Limpia el estado (útil en logout y en tests). Notifica a los
     * suscriptores con null para que la UI borre el badge.
     */
    reset() {
        _lastSyncedAt = null;
        _lastError = null;
        _syncing = false;
        _notify(null);
    }
};

export default SyncStatus;
