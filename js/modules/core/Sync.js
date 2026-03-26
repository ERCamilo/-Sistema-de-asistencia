/**
 * 🔄 SYNC MANAGER (Fase 3 - Modularización)
 * Gestiona la cola de operaciones locales y su persistencia en IndexedDB.
 */

import { eventBus } from './Events.js';
import { debug } from '../utils/Debug.js';
import { Notification } from '../components/Notification.js';

class SyncManager {
    constructor(indexedDB) {
        this.indexedDB = indexedDB;
        this.isPending = false;
    }

    /**
     * Agregar operación a cola de sincronización
     */
    async queueOperation(operation) {
        const queueItem = {
            type: operation.type,
            data: operation.data,
            status: 'pending',
            timestamp: Date.now(),
            retries: 0
        };

        try {
            await this.indexedDB.add('sync_queue', queueItem);
            this.isPending = true;
            debug.log('📝 Operación agregada a cola de sync');
            this.updateSyncBadge();
        } catch (error) {
            debug.error('❌ Error en queueOperation:', error);
        }
    }

    /**
     * Obtener operaciones pendientes
     */
    async getPendingOperations() {
        return await this.indexedDB.query('sync_queue', 'status', 'pending');
    }

    /**
     * Procesar cola (versión local/híbrida)
     */
    async processPendingQueue() {
        const pending = await this.getPendingOperations();

        if (pending.length === 0) {
            Notification.info('ℹ️ No hay cambios pendientes');
            return;
        }

        debug.log(`🔄 Procesando ${pending.length} operaciones pendientes...`);

        let processed = 0;
        for (const item of pending) {
            try {
                // Procesar según tipo (mapeo a IndexedDB local)
                const storeMap = {
                    'attendance': 'attendance',
                    'employee': 'employees',
                    'position': 'positions'
                };

                const typeKey = item.type.split(':')[0];
                const storeName = storeMap[typeKey];

                if (storeName) {
                    await this.indexedDB.update(storeName, item.data);
                }

                // Marcar como procesado
                await this.indexedDB.update('sync_queue', {
                    ...item,
                    status: 'synced',
                    syncedAt: Date.now()
                });

                processed++;
            } catch (error) {
                debug.error('❌ Error procesando operación:', error);
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

    updateSyncBadge() {
        eventBus.emit('sync:update', {
            pending: this.isPending
        });
    }

    async clearProcessed() {
        try {
            const synced = await this.indexedDB.query('sync_queue', 'status', 'synced');
            for (const item of synced) {
                await this.indexedDB.delete('sync_queue', item.id);
            }
            debug.log(`🗑️ ${synced.length} operaciones procesadas eliminadas`);
        } catch (error) {
            debug.error('❌ Error en clearProcessed:', error);
        }
    }
}

// Nota: La instancia requiere el IndexedDBService que se inicializará en AppState o similar.
// Exportamos la clase por ahora.
export { SyncManager };
