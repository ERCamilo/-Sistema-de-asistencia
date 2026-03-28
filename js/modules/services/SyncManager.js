/**
 * SyncManager: Gestión de cola de sincronización local (IndexedDB).
 * Permite manejar operaciones en diferido para posterior sincronización con la nube.
 * Parte de la infraestructura core (Alpha Refactorizer).
 */
import { Notification } from '../components/Notification.js';
import { eventBus } from '../core/Events.js';
import { indexedDBService } from './IndexedDBService.js';

class SyncManager {
    constructor(db) {
        this.indexedDB = db || indexedDBService;
        this.isPending = false;
    }

    // Agregar operación a cola
    async queueOperation(operation) {
        const queueItem = {
            type: operation.type,
            data: operation.data,
            status: 'pending',
            timestamp: Date.now(),
            retries: 0
        };

        await this.indexedDB.add('sync_queue', queueItem);
        this.isPending = true;

        if (window.debug) window.debug.log('📝 Operación agregada a cola de sync');
        this.updateSyncBadge();
    }

    // Obtener operaciones pendientes
    async getPendingOperations() {
        return await this.indexedDB.query('sync_queue', 'status', 'pending');
    }

    // Procesar cola
    async processPendingQueue() {
        const pending = await this.getPendingOperations();

        if (pending.length === 0) {
            Notification.info('ℹ️ No hay cambios pendientes');
            return;
        }

        if (window.debug) window.debug.log(`🔄 Procesando ${pending.length} operaciones pendientes...`);

        let processed = 0;
        for (const item of pending) {
            try {
                // Procesar según tipo (Extensible)
                switch (item.type) {
                    case 'attendance:create':
                    case 'attendance:update':
                        await this.indexedDB.update('attendance', item.data);
                        break;
                    case 'employee:create':
                    case 'employee:update':
                        await this.indexedDB.update('employees', item.data);
                        break;
                    case 'position:create':
                    case 'position:update':
                        await this.indexedDB.update('positions', item.data);
                        break;
                }

                // Marcar como procesado
                await this.indexedDB.update('sync_queue', {
                    ...item,
                    status: 'synced',
                    syncedAt: Date.now()
                });

                processed++;
            } catch (error) {
                if (window.debug) window.debug.error('❌ Error procesando operación:', error);
                await this.indexedDB.update('sync_queue', {
                    ...item,
                    status: 'failed',
                    error: error.message,
                    retries: item.retries + 1
                });
            }
        }

        this.isPending = (await this.getPendingOperations()).length > 0;
        this.updateSyncBadge();

        Notification.success(`✅ ${processed} cambios procesados`);
    }

    // Actualizar badge de sincronización
    updateSyncBadge() {
        eventBus.emit('sync:update', {
            pending: this.isPending
        });
    }

    // Limpiar cola procesada
    async clearProcessed() {
        const synced = await this.indexedDB.query('sync_queue', 'status', 'synced');
        for (const item of synced) {
            await this.indexedDB.delete('sync_queue', item.id);
        }
    }

    // Obtener estadísticas
    async getStats() {
        const all = await this.indexedDB.getAll('sync_queue');
        return {
            pending: all.filter(i => i.status === 'pending').length,
            synced: all.filter(i => i.status === 'synced').length,
            failed: all.filter(i => i.status === 'failed').length,
            total: all.length
        };
    }
}

const syncManager = new SyncManager(indexedDBService);
export default syncManager;
