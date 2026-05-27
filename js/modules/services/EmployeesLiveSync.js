/**
 * 📡 EmployeesLiveSync.js (Fase 2.1)
 *
 * Gestiona el ciclo de vida del onSnapshot listener sobre la colección
 * users/{uid}/employees. Singleton ligero: solo una suscripción activa
 * en cualquier momento.
 *
 * Garantías:
 *   - start() es idempotente: llamarlo N veces solo crea 1 subscribe.
 *   - stop() libera el slot y permite un nuevo start posterior.
 *   - Al recibir un cambio remoto, activa el flag _isApplyingRemoteData
 *     durante la aplicación + un margen, para que el save subsecuente
 *     no rebote la propia escritura de vuelta al servidor.
 *
 * Inyección de dependencias:
 *   - subscribe(cb): la función que abre el listener (EmployeeRepository.subscribe).
 *
 * Uso típico desde app.js:
 *   EmployeesLiveSync.start({
 *     subscribe: EmployeeRepository.subscribe.bind(EmployeeRepository),
 *     onApply: (emps) => applyEmployeesToState(emps)
 *   });
 */

let _unsubscribe = null;

// Ventana de "ignorar mis propias escrituras" tras aplicar un cambio remoto.
// El listener parent (mirror sync) ya usa 500ms; nos alineamos con ese valor.
const ECHO_GUARD_MS = 500;

export const EmployeesLiveSync = {

    /**
     * Inicia la suscripción si aún no está activa.
     * @param {object} args
     * @param {(cb: Function) => Function} args.subscribe Función que abre el
     *   listener y devuelve un unsubscribe.
     * @param {(employees: Array) => void} args.onApply Callback al recibir
     *   una nueva lista de empleados desde la nube.
     * @returns {boolean} true si se creó una suscripción (o ya había una),
     *   false si los argumentos no eran válidos.
     */
    start({ subscribe, onApply } = {}) {
        if (typeof subscribe !== 'function' || typeof onApply !== 'function') {
            return false;
        }
        if (_unsubscribe) {
            // Ya hay una suscripción activa — idempotente.
            return true;
        }

        try {
            _unsubscribe = subscribe((employees) => {
                // Activar guard para que la siguiente escritura no rebote.
                try {
                    if (typeof window !== 'undefined') {
                        window._isApplyingRemoteData = true;
                    }
                    onApply(employees);
                } catch (e) {
                    console.error('❌ EmployeesLiveSync.onApply error:', e);
                } finally {
                    // Devolver flag a false tras un margen — alineado con el
                    // listener parent del mirror sync.
                    if (typeof window !== 'undefined') {
                        setTimeout(() => {
                            window._isApplyingRemoteData = false;
                        }, ECHO_GUARD_MS);
                    }
                }
            });
            return true;
        } catch (e) {
            console.error('❌ EmployeesLiveSync.start error:', e);
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

    /**
     * Inspección útil para tests: indica si hay una suscripción activa.
     */
    isActive() {
        return _unsubscribe !== null;
    }
};

export default EmployeesLiveSync;
