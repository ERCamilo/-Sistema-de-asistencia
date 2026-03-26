/**
 * 📵 CONNECTIVITY / OFFLINE MANAGER (Fase 3 - Modularización)
 * Gestiona el estado de red y las notificaciones globales de conexión.
 */

import { eventBus } from './Events.js';
import { render } from './RenderManager.js';
import { debug } from '../utils/Debug.js';
import { Notification } from '../components/Notification.js';

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
        debug.log('🌐 Conexión restaurada');
        Notification.success('✅ Conexión restaurada');
        eventBus.emit('connection:online');
        // El header reaccionará al estado de conexión en el siguiente renderizado
        render();
    }

    handleOffline() {
        debug.log('📵 Sin conexión');
        Notification.warning('⚠️ Sin conexión - Modo offline');
        eventBus.emit('connection:offline');
        render();
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

export const offlineManager = new OfflineManager();
window.offlineManager = offlineManager;
