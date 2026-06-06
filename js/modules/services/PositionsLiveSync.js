/**
 * 📡 PositionsLiveSync.js
 *
 * Gestiona el ciclo de vida del onSnapshot listener sobre la colección
 * users/{uid}/positions. Singleton ligero: solo una suscripción activa
 * en cualquier momento.
 */

let _unsubscribe = null;
const ECHO_GUARD_MS = 500;

export const PositionsLiveSync = {

    /**
     * Inicia la suscripción si aún no está activa.
     * @param {object} args
     * @param {(cb: Function) => Function} args.subscribe Función que abre el
     *   listener y devuelve un unsubscribe.
     * @param {(positions: Array) => void} args.onApply Callback al recibir
     *   una nueva lista de cargos desde la nube.
     */
    start({ subscribe, onApply } = {}) {
        if (typeof subscribe !== 'function' || typeof onApply !== 'function') {
            return false;
        }
        if (_unsubscribe) {
            return true;
        }

        try {
            _unsubscribe = subscribe((positions) => {
                try {
                    if (typeof window !== 'undefined') {
                        window._isApplyingRemoteData = true;
                    }
                    onApply(positions);
                } catch (e) {
                    console.error('❌ PositionsLiveSync.onApply error:', e);
                } finally {
                    if (typeof window !== 'undefined') {
                        setTimeout(() => {
                            window._isApplyingRemoteData = false;
                        }, ECHO_GUARD_MS);
                    }
                }
            });
            return true;
        } catch (e) {
            console.error('❌ PositionsLiveSync.start error:', e);
            _unsubscribe = null;
            return false;
        }
    },

    /**
     * Cancela la suscripción activa, si la hay.
     */
    stop() {
        if (typeof _unsubscribe === 'function') {
            try { _unsubscribe(); } catch (e) { console.warn('Error al desuscribir:', e); }
        }
        _unsubscribe = null;
    },

    isActive() {
        return _unsubscribe !== null;
    }
};

export default PositionsLiveSync;
