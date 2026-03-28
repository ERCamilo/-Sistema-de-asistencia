/**
 * OfflineManager: Gestión de estado de red (Online/Offline).
 * Maneja banners de estado y eventos globales de conexión.
 * Parte de la infraestructura core (Alpha Refactorizer).
 */
import { Notification } from '../components/Notification.js';
import { eventBus } from '../core/Events.js';

class OfflineManager {
    constructor() {
        this.online = navigator.onLine;
        this.setupListeners();
    }

    setupListeners() {
        window.addEventListener('online', () => {
            this.online = true;
            this.handleOnline();
        });

        window.addEventListener('offline', () => {
            this.online = false;
            this.handleOffline();
        });
    }

    handleOnline() {
        if (window.debug) window.debug.log('🌐 Conexión restaurada');
        Notification.success('✅ Conexión restaurada', 3000);
        eventBus.emit('connection:online');
        // trigger render to hide potential banners
        if (typeof window.render === 'function') window.render();
    }

    handleOffline() {
        if (window.debug) window.debug.log('📵 Sin conexión');
        Notification.warning('⚠️ Sin conexión - Modo offline', 5000);
        eventBus.emit('connection:offline');
        // trigger render to show potential banners
        if (typeof window.render === 'function') window.render();
    }

    isOnline() {
        return this.online;
    }

    isOffline() {
        return !this.online;
    }

    getConnectionType() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return connection ? connection.effectiveType : 'unknown';
    }
}

const offlineManager = new OfflineManager();
export default offlineManager;
