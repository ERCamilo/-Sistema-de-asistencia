/**
 * 💾 BatchedSaver.js
 *
 * Acumula múltiples solicitudes de guardado y las ejecuta una sola vez
 * cuando el navegador esté ocioso (o tras un timeout máximo).
 *
 * Casos de uso típicos:
 *   - Firebase manda 17 días de asistencia en ráfaga al arrancar
 *   - En vez de guardar 17 veces en IndexedDB, acumulamos y guardamos 1 sola vez
 *
 * Uso:
 *   const saver = new BatchedSaver({
 *     flush: async (batch) => { ... },
 *     maxWaitMs: 1000
 *   });
 *   saver.add('2026-04-15');
 *   saver.add('2026-04-16');
 *   // ... más adds en ráfaga ...
 *   // → flush() se llama una sola vez con ['2026-04-15', '2026-04-16', ...]
 *
 * Inyección de dependencias:
 *   - `scheduler` (opcional): función para programar trabajo idle.
 *     Por defecto usa requestIdleCallback con fallback a setTimeout.
 *     Inyectable para testing.
 */

/**
 * Scheduler por defecto: usa requestIdleCallback si está disponible,
 * con fallback a setTimeout para navegadores que no lo soportan
 * (Safari < 17, iOS < 17).
 */
export function defaultIdleScheduler(callback, options = {}) {
    const timeout = options.timeout || 1000;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(callback, { timeout });
    }
    // Fallback: ejecutar tras un setTimeout corto
    return setTimeout(callback, 50);
}

export function defaultIdleCancel(handle) {
    if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(handle);
    } else {
        clearTimeout(handle);
    }
}

/**
 * 🔧 Decisión pura del watchdog de `_isApplyingRemoteData` (R3).
 *
 * El flag bloquea los guardados mientras se aplican datos remotos. Si el flush
 * del BatchedSaver nunca llega a correr (excepción entre poner el flag y add(),
 * o la pestaña vuelve sin completar), el flag quedaría trabado en true y
 * silenciaría TODOS los guardados siguientes de la sesión.
 *
 * El watchdog sólo debe liberar el flag cuando es seguro: el flag está puesto
 * Y el saver NO está activo (ni flush programado ni en vuelo). Atarlo al ciclo
 * de vida del saver — en vez de a un timer ciego — evita cortar un apply
 * legítimo a mitad de camino en dispositivos lentos con cargas zonales grandes.
 *
 * @param {boolean} flagIsSet - valor actual de window._isApplyingRemoteData
 * @param {{isActive: boolean}|null|undefined} saver - el BatchedSaver entrante
 * @returns {boolean} true si es seguro liberar el flag
 */
export function shouldReleaseApplyingFlag(flagIsSet, saver) {
    return flagIsSet === true && (!saver || saver.isActive !== true);
}

export class BatchedSaver {
    /**
     * @param {Object} options
     * @param {Function} options.flush - async (batch: Array<any>, meta: Object) => void
     * @param {number} [options.maxWaitMs=1000] - Tiempo máximo de espera antes de forzar flush
     * @param {Function} [options.scheduler] - Para inyección en tests
     * @param {Function} [options.cancel] - Para inyección en tests
     * @param {Function} [options.onError] - Callback para errores
     */
    constructor(options = {}) {
        if (typeof options.flush !== 'function') {
            throw new TypeError('BatchedSaver: option "flush" must be a function');
        }
        this._flush = options.flush;
        this._maxWaitMs = options.maxWaitMs ?? 1000;
        this._scheduler = options.scheduler || defaultIdleScheduler;
        this._cancel = options.cancel || defaultIdleCancel;
        this._onError = options.onError || ((err) => console.error('BatchedSaver flush error:', err));

        this._batch = [];
        this._meta = {};
        this._idleHandle = null;
        this._isFlushing = false;
        this._stats = { totalAdded: 0, totalFlushes: 0, lastBatchSize: 0 };
    }

    /**
     * Añadir un item al batch. Programa un flush si no había uno pendiente.
     * @param {any} item - Item a procesar (típicamente un dateKey o un objeto)
     * @param {Object} [meta] - Metadata extra que se fusiona con la del batch
     */
    add(item, meta = {}) {
        this._batch.push(item);
        Object.assign(this._meta, meta);
        this._stats.totalAdded++;

        if (this._idleHandle === null) {
            this._idleHandle = this._scheduler(() => this._doFlush(), {
                timeout: this._maxWaitMs
            });
        }
    }

    /**
     * Forzar un flush inmediato (sin esperar a estar ocioso).
     * Útil para tests o cleanup al cerrar.
     */
    async flushNow() {
        if (this._idleHandle !== null) {
            this._cancel(this._idleHandle);
            this._idleHandle = null;
        }
        await this._doFlush();
    }

    async _doFlush() {
        this._idleHandle = null;

        if (this._batch.length === 0) return;

        // Tomar snapshot del batch actual y resetear (permitir nuevos adds durante el flush)
        const currentBatch = this._batch;
        const currentMeta = this._meta;
        this._batch = [];
        this._meta = {};

        this._stats.totalFlushes++;
        this._stats.lastBatchSize = currentBatch.length;

        this._isFlushing = true;
        try {
            await this._flush(currentBatch, currentMeta);
        } catch (err) {
            this._onError(err);
        } finally {
            this._isFlushing = false;
        }
    }

    /**
     * Cancelar el batch pendiente sin ejecutar el flush.
     */
    cancel() {
        if (this._idleHandle !== null) {
            this._cancel(this._idleHandle);
            this._idleHandle = null;
        }
        this._batch = [];
        this._meta = {};
    }

    /**
     * @returns {number} Número de items pendientes
     */
    get pendingCount() {
        return this._batch.length;
    }

    /**
     * @returns {boolean} true si hay un flush programado
     */
    get hasScheduledFlush() {
        return this._idleHandle !== null;
    }

    /**
     * @returns {boolean} true si el saver está ACTIVO: hay un flush programado
     * O un flush en vuelo. Es la señal de seguridad para el watchdog de
     * _isApplyingRemoteData: el flag sólo puede limpiarse cuando isActive es
     * false, para no cortar un apply legítimo a mitad de camino (R3).
     */
    get isActive() {
        return this._idleHandle !== null || this._isFlushing;
    }

    /**
     * @returns {Object} Estadísticas acumuladas
     */
    getStats() {
        return { ...this._stats };
    }
}
