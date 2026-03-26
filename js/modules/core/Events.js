/**
 * 📡 SISTEMA DE EVENTOS (Fase 3 - Modularización)
 * Implementa un bus de eventos desacoplado para la comunicación entre módulos.
 */

class EventBus {
    constructor() {
        this._events = new Map();
        this._eventHistory = [];
        this._maxHistory = 100;
    }

    /**
     * Suscribirse a un evento
     * @param {string} eventName 
     * @param {function} callback 
     * @param {object} options { once, priority }
     * @returns {function} función para cancelar suscripción
     */
    on(eventName, callback, options = {}) {
        const { once = false, priority = 0 } = options;

        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }

        const listener = {
            callback,
            once,
            priority,
            id: Date.now() + Math.random()
        };

        const listeners = this._events.get(eventName);
        listeners.push(listener);

        // Ordenar por prioridad (mayor primero)
        listeners.sort((a, b) => b.priority - a.priority);

        return () => this.off(eventName, listener.id);
    }

    /**
     * Suscribirse una sola vez
     */
    once(eventName, callback, priority = 0) {
        return this.on(eventName, callback, { once: true, priority });
    }

    /**
     * Cancelar suscripción
     */
    off(eventName, listenerId) {
        if (!this._events.has(eventName)) return;

        const listeners = this._events.get(eventName);
        const index = listeners.findIndex(l => l.id === listenerId);

        if (index !== -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * Emitir un evento
     */
    emit(eventName, data) {
        this._addToHistory(eventName, data);

        if (!this._events.has(eventName)) {
            return;
        }

        const listeners = this._events.get(eventName);
        const toRemove = [];

        listeners.forEach(listener => {
            try {
                listener.callback(data);
                if (listener.once) {
                    toRemove.push(listener.id);
                }
            } catch (error) {
                console.error(`❌ Error en listener de '${eventName}':`, error);
            }
        });

        toRemove.forEach(id => this.off(eventName, id));
    }

    _addToHistory(eventName, data) {
        if (this._eventHistory.length >= this._maxHistory) {
            this._eventHistory.shift();
        }
        this._eventHistory.push({
            event: eventName,
            data,
            timestamp: Date.now()
        });
    }

    clear() {
        this._events.clear();
    }

    getStats() {
        const stats = {};
        this._events.forEach((listeners, event) => {
            stats[event] = listeners.length;
        });
        return stats;
    }
}

export const eventBus = new EventBus();
