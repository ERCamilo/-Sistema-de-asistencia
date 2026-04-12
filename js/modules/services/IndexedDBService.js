/**
 * 💾 INDEXEDDB SERVICE
 * Módulo para gestionar la base de datos local y asegurar integridad de datos.
 */

import { Notification } from '../components/Notification.js';

export class IndexedDBService {
    constructor(dbName = 'attendance-app-db', version = 8) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.isInitialized = false;
    }

    /** 🌐 Verificar soporte de navegador */
    isSupported() {
        return !!(window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB);
    }

    // Inicializar base de datos
    async init() {
        if (this.isInitialized) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.error('❌ Error al abrir IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;

                // Store: Empleados
                if (!db.objectStoreNames.contains('employees')) {
                    const empStore = db.createObjectStore('employees', { keyPath: 'id' });
                    empStore.createIndex('number', 'number', { unique: false });
                    empStore.createIndex('active', 'active', { unique: false });
                    empStore.createIndex('name', 'name', { unique: false });
                } else {
                    const empStore = transaction.objectStore('employees');
                    // Actualizar índice para que NO sea único (v8)
                    if (empStore.indexNames.contains('number')) {
                        const idx = empStore.index('number');
                        if (idx.unique) {
                            empStore.deleteIndex('number');
                            empStore.createIndex('number', 'number', { unique: false });
                        }
                    } else {
                        empStore.createIndex('number', 'number', { unique: false });
                    }
                }

                // Store: Posiciones
                if (!db.objectStoreNames.contains('positions')) {
                    const posStore = db.createObjectStore('positions', { keyPath: 'id' });
                    posStore.createIndex('name', 'name', { unique: false });
                }

                // Store: Líderes
                if (!db.objectStoreNames.contains('leaders')) {
                    const leadStore = db.createObjectStore('leaders', { keyPath: 'id' });
                    leadStore.createIndex('number', 'number', { unique: false });
                } else {
                    const leadStore = transaction.objectStore('leaders');
                    if (leadStore.indexNames.contains('code')) {
                        leadStore.deleteIndex('code');
                    }
                    // Actualizar índice para que NO sea único (v8)
                    if (leadStore.indexNames.contains('number')) {
                        const idx = leadStore.index('number');
                        if (idx.unique) {
                            leadStore.deleteIndex('number');
                            leadStore.createIndex('number', 'number', { unique: false });
                        }
                    } else {
                        leadStore.createIndex('number', 'number', { unique: false });
                    }
                }

                // Store: Asistencia
                if (!db.objectStoreNames.contains('attendance')) {
                    const attStore = db.createObjectStore('attendance', { keyPath: 'key' });
                    attStore.createIndex('employeeId', 'employeeId', { unique: false });
                    attStore.createIndex('date', 'date', { unique: false });
                    attStore.createIndex('employeeDate', ['employeeId', 'date'], { unique: true });
                }

                // Store: Settings
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Store: Cola de sincronización
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                    syncStore.createIndex('status', 'status', { unique: false });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async update(storeName, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(this._serializeForIDB(data));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error(`❌ Error en put (${storeName}):`, request.error);
                reject(request.error || new Error('Error en solicitud IndexedDB (request.error balance null)'));
            };
        });
    }

    /**
     * 🧹 Limpia todos los registros de una store específica.
     * Usado antes de reescribir la store de attendance tras fusiones.
     * @param {string} storeName - Nombre del store a limpiar
     */
    async clear(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => {
                console.error(`❌ Error limpiando store ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 🛡️ Convierte objetos no serializables por IndexedDB (ej: Timestamp de Firestore)
     * a valores planos antes de escribir en la DB.
     * - Timestamp de Firestore {seconds, nanoseconds} → número (milisegundos)
     * - Instancias de clase → objeto plano (JSON round-trip)
     * No lanza: si un valor no puede convertirse, lo omite.
     * @param {*} value - Valor a serializar
     * @returns {*} Valor serializable
     */
    _serializeForIDB(value) {
        if (value === null || value === undefined) return value;

        // Timestamp de Firestore: tiene .toMillis() o {seconds, nanoseconds}
        if (typeof value?.toMillis === 'function') {
            return value.toMillis();
        }

        if (Array.isArray(value)) {
            return value.map(item => this._serializeForIDB(item));
        }

        if (typeof value === 'object') {
            // Instancias de Date son clonables, no tocar
            if (value instanceof Date) return value;

            const plain = {};
            for (const [k, v] of Object.entries(value)) {
                plain[k] = this._serializeForIDB(v);
            }
            return plain;
        }

        // Primitivos (string, number, boolean): clonables directamente
        return value;
    }

    /**
     * ⚡ P2-OPT: Escribe N registros en una sola transacción de IndexedDB.
     * Reduce el overhead de N transacciones a 1 transacción con N escrituras.
     * Incluye serialización defensiva para tipos no clonables (Timestamp de Firestore).
     * @param {string} storeName - Nombre del store
     * @param {Array} records - Registros a guardar
     */
    async batchUpdate(storeName, records) {
        if (!records || records.length === 0) return 0;
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            let count = 0;
            transaction.oncomplete = () => resolve(count);
            transaction.onerror = () => {
                const err = transaction.error || new Error('Transacción abortada o fallida sin error explícito');
                console.error(`❌ Transacción fallida en ${storeName}:`, err);
                reject(err);
            };
            records.forEach(record => {
                // 🛡️ Saneamiento defensivo: elimina cualquier Timestamp u objeto
                // de clase de Firestore que rompería el Structured Clone Algorithm.
                store.put(this._serializeForIDB(record));
                count++;
            });
        });
    }

    async get(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async clearAll() {
        await this.init();
        const stores = ['employees', 'positions', 'leaders', 'attendance', 'settings', 'sync_queue'];
        const promises = stores.map(store => this.clear(store));
        await Promise.all(promises);
        console.log('🧹 IndexedDB: Todas las tablas limpiadas');
        return true;
    }

    async query(storeName, indexName, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            // 🔥 SEGURIDAD: Verificar si el índice existe antes de consultarlo
            if (!store.indexNames.contains(indexName)) {
                console.warn(`⚠️ El índice "${indexName}" no existe en el store "${storeName}".`);
                resolve([]);
                return;
            }

            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async count(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 🛡️ GUARDADO SEGURO CON DEDUPLICACIÓN PROACTIVA
     * Procesa el estado y lo guarda en IndexedDB resolviendo conflictos de índices únicos
     * tanto en los datos entrantes como contra los registros existentes en la DB.
     * 
     * @param {Object} state - El estado global de la aplicación
     * @param {Object} options - Opciones (ej. { clearFirst: false })
     */
    async saveState(state, options = {}) {
        const stats = { employees: 0, positions: 0, leaders: 0, attendance: 0, deduplicated: 0 };
        try {
            const isGranular = !!options.dateKey;
            
            if (options.clearFirst) {
                await this.clearAll();
            }

            // ⚡ P1-OPT: No clonar todo el estado (evita 500ms+ de CPU)
            // Solo procesamos lo necesario según si es granular o completo

            if (!isGranular) {
                // 1. DEDUPLICACIÓN INTERNA (Solo en guardado completo)
                const empMap = new Map();
                (state.employees || []).forEach(emp => {
                    const num = String(emp.number || '').trim();
                    if (!num) return;
                    const existing = empMap.get(num);
                    if (!existing || (emp.updatedAt || 0) > (existing.updatedAt || 0)) {
                        if (existing) stats.deduplicated++;
                        empMap.set(num, emp);
                    } else {
                        stats.deduplicated++;
                    }
                });

                const leadMap = new Map();
                (state.leaders || []).forEach(l => {
                    const num = String(l.number || '').trim();
                    if (!num) return;
                    const existing = leadMap.get(num);
                    if (!existing || (l.updatedAt || 0) > (existing.updatedAt || 0)) {
                        if (existing) stats.deduplicated++;
                        leadMap.set(num, l);
                    } else {
                        stats.deduplicated++;
                    }
                });

                // GUARDADO DE METADATOS
                stats.employees = await this.batchUpdate('employees', [...empMap.values()]);
                stats.positions = await this.batchUpdate('positions', state.positions || []);
                stats.leaders = await this.batchUpdate('leaders', [...leadMap.values()]);
            }

            // 2. GUARDADO DE ASISTENCIA (Incremental si hay dateKey)
            // ⚡ FIX: Si clearAttendance está activo, limpiar toda la store antes de reescribir.
            // Esto elimina registros huérfanos que causan ConstraintError tras fusiones.
            if (options.clearAttendance) {
                await this.clear('attendance');
                console.log('🧹 Store attendance limpiada antes de reescritura completa');
            }

            let attToSave = [];
            if (isGranular) {
                const suffix = `-${options.dateKey}`;
                attToSave = Object.entries(state.attendance || {})
                    .filter(([key]) => key.endsWith(suffix))
                    .map(([key, value]) => ({ key, ...value }));
            } else {
                attToSave = Object.entries(state.attendance || {}).map(([key, value]) => ({
                    key,
                    ...value
                }));
            }

            // 🛡️ BARRERA DE PROTECCIÓN: Deduplicar forzosamente (employeeId, date)
            // Asegura que no rompa el Unique Index (employeeDate) si el JS state se desincronizó o corrompió.
            const seenAttendance = new Set();
            attToSave = attToSave.filter(record => {
                const empDateKey = `${record.employeeId}_${record.date}`;
                if (seenAttendance.has(empDateKey)) {
                    console.warn(`🛡️ Purgado registro IDB huérfano para evitar ConstraintError: ${empDateKey}`);
                    return false;
                }
                seenAttendance.add(empDateKey);
                return true;
            });

            stats.attendance = await this.batchUpdate('attendance', attToSave);

            if (state.settings) {
                await this.update('settings', { key: 'app', ...state.settings });
            }

            console.log(`📊 IndexedDB ${isGranular ? 'Granular' : 'Full'} Save Stats:`, stats);
            return stats;
        } catch (error) {
            console.error('❌ Error en saveState (IndexedDB):', error);
            throw error;
        }
    }

    // Exportar toda la DB
    async exportDB() {
        const data = {
            employees: await this.getAll('employees'),
            positions: await this.getAll('positions'),
            leaders: await this.getAll('leaders'),
            attendance: await this.getAll('attendance'),
            settings: await this.getAll('settings'),
            exportedAt: new Date().toISOString(),
            version: this.version
        };
        return data;
    }

    /**
     * 📂 CARGAR ESTADO COMPLETO
     * Lee todas las tablas y reconstruye el objeto de estado.
     */
    async loadFullState() {
        try {
            await this.init();
            
            const [employees, positions, leaders, attendance, settings] = await Promise.all([
                this.getAll('employees'),
                this.getAll('positions'),
                this.getAll('leaders'),
                this.getAll('attendance'),
                this.getAll('settings')
            ]);

            // Convertir el array de asistencia back to object
            const attendanceObj = {};
            attendance.forEach(record => {
                if (record.key) {
                    const { key, ...data } = record;
                    attendanceObj[key] = data;
                }
            });

            // Obtener settings (es un store tipo key-value, buscamos 'app')
            const appSettings = settings.find(s => s.key === 'app') || {};

            return {
                employees: employees || [],
                positions: positions || [],
                leaders: leaders || [],
                attendance: attendanceObj,
                settings: appSettings.key ? appSettings : (settings[0] || {})
            };
        } catch (error) {
            console.error('❌ Error al cargar estado desde IndexedDB:', error);
            throw error;
        }
    }

    // Importar DB completa
    async importDB(data) {
        try {
            await this.clear('employees');
            await this.clear('positions');
            await this.clear('leaders');
            await this.clear('attendance');
            await this.clear('settings');

            if (data.employees) for (const emp of data.employees) await this.update('employees', emp);
            if (data.positions) for (const pos of data.positions) await this.update('positions', pos);
            if (data.leaders) for (const leader of data.leaders) await this.update('leaders', leader);
            if (data.attendance) for (const att of data.attendance) await this.update('attendance', att);
            if (data.settings) for (const s of data.settings) await this.update('settings', s);

            return true;
        } catch (error) {
            console.error('❌ Error al importar datos:', error);
            return false;
        }
    }

    // Migrar desde localStorage
    async migrateFromLocalStorage(storageKey = 'attendance-app-data') {
        try {
            const oldData = localStorage.getItem(storageKey);
            if (!oldData) return false;

            const parsed = JSON.parse(oldData);
            const data = parsed.data || parsed;

            // Usamos saveState para asegurar que la deduplicación proactiva se aplique
            // El formato de data de localStorage coincide con el que espera saveState
            await this.saveState(data, { clearFirst: true });

            localStorage.setItem(storageKey + '-backup', oldData);
            return true;
        } catch (error) {
            console.error('❌ Error en migración:', error);
            return false;
        }
    }
}
export const indexedDBService = new IndexedDBService();
export default indexedDBService;
