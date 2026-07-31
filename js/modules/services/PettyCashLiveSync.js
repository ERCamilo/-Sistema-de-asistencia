/**
 * 📡 PettyCashLiveSync.js — Caja chica (Fase 1, Paso 2)
 *
 * Singleton que gestiona las suscripciones onSnapshot de las 3 colecciones
 * del modelo de caja chica (projects, cashPeriods, pettyCash) y aplica los
 * cambios remotos al state. Mismo patrón que EmployeesLiveSync, pero
 * multi-colección.
 *
 * Inyección de dependencias — cada colección recibe { subscribe, onApply }:
 *   PettyCashLiveSync.start({
 *     projects:  { subscribe: PettyCashRepository.projects.subscribe.bind(...),  onApply: applyProjects },
 *     periods:   { subscribe: PettyCashRepository.periods.subscribe.bind(...),   onApply: applyPeriods },
 *     movements: { subscribe: PettyCashRepository.movements.subscribe.bind(...), onApply: applyMovements }
 *   });
 *
 * Garantías:
 *   - start() es idempotente (no duplica listeners).
 *   - stop() libera todas las suscripciones y permite re-start.
 *   - Al aplicar un cambio remoto, activa window._isApplyingRemoteData
 *     durante la aplicación + un margen, para no rebotar la escritura.
 */

const COLLECTIONS = ['projects', 'periods', 'movements'];
const ECHO_GUARD_MS = 500;

let _subs = new Map();

function guardedApply(onApply, items) {
    try {
        if (typeof window !== 'undefined') window._isApplyingRemoteData = true;
        onApply(items);
    } catch (e) {
        console.error('❌ PettyCashLiveSync.onApply error:', e);
    } finally {
        if (typeof window !== 'undefined') {
            setTimeout(() => { window._isApplyingRemoteData = false; }, ECHO_GUARD_MS);
        }
    }
}

export const PettyCashLiveSync = {

    /**
     * Inicia las suscripciones de las colecciones provistas.
     * @param {object} config map { projects|periods|movements: { subscribe, onApply } }
     * @returns {boolean} true si se inició (o ya estaba activo), false si no
     *   había ninguna colección válida en la config.
     */
    start(config = {}) {
        const valid = COLLECTIONS.filter(k =>
            config && config[k] &&
            typeof config[k].subscribe === 'function' &&
            typeof config[k].onApply === 'function'
        );
        if (valid.length === 0) return false;
        if (_subs.size > 0) return true; // ya activo — idempotente

        for (const k of valid) {
            const { subscribe, onApply } = config[k];
            try {
                const unsub = subscribe((items) => guardedApply(onApply, items));
                if (typeof unsub === 'function') _subs.set(k, unsub);
            } catch (e) {
                console.error(`❌ PettyCashLiveSync.start(${k}) error:`, e);
            }
        }
        return _subs.size > 0;
    },

    replace(collectionName, item) {
        if (!COLLECTIONS.includes(collectionName)) return false;
        if (typeof item?.subscribe !== 'function' || typeof item?.onApply !== 'function') {
            return false;
        }
        const previous = _subs.get(collectionName);
        try { previous?.(); } catch (e) { console.warn('Error al desuscribir:', e); }
        _subs.delete(collectionName);
        try {
            const unsubscribe = item.subscribe((items) => guardedApply(item.onApply, items));
            if (typeof unsubscribe === 'function') _subs.set(collectionName, unsubscribe);
        } catch (e) {
            console.error(`❌ PettyCashLiveSync.replace(${collectionName}) error:`, e);
        }
        return _subs.has(collectionName);
    },

    /** Cancela todas las suscripciones activas. */
    stop() {
        for (const unsub of _subs.values()) {
            try { unsub(); } catch (e) { console.warn('Error al desuscribir:', e); }
        }
        _subs = new Map();
    },

    /** True si hay al menos una suscripción activa. */
    isActive() {
        return _subs.size > 0;
    }
};

export default PettyCashLiveSync;
