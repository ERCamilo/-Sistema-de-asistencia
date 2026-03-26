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
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
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
        try {
            // 🛡️ UNBOXING: Convertir el estado (que puede ser un Proxy) a un objeto plano
            // para evitar errores de DataCloneError en IndexedDB (algoritmo Structured Clone).
            const cleanState = JSON.parse(JSON.stringify(state));
            
            if (options.clearFirst) {
                await this.clear('employees');
                await this.clear('positions');
                await this.clear('leaders');
                await this.clear('attendance');
                await this.clear('settings');
            }

            // 1. DEDUPLICACIÓN INTERNA DE EMPLEADOS (en el state entrante)
            const empMap = new Map();
            const empToDeletesInternal = [];

            (cleanState.employees || []).forEach(emp => {
                const num = String(emp.number || '').trim();
                if (!num) return;

                const existing = empMap.get(num);
                if (!existing || (emp.updatedAt || 0) > (existing.updatedAt || 0)) {
                    if (existing && existing.id !== emp.id) empToDeletesInternal.push(existing.id);
                    empMap.set(num, emp);
                } else if (existing.id !== emp.id) {
                    empToDeletesInternal.push(emp.id);
                }
            });

            // 2. DEDUPLICACIÓN INTERNA DE LÍDERES
            const leadMap = new Map();
            const leadToDeletesInternal = [];

            (cleanState.leaders || []).forEach(l => {
                const num = String(l.number || '').trim();
                if (!num) return;

                const existing = leadMap.get(num);
                if (!existing || (l.updatedAt || 0) > (existing.updatedAt || 0)) {
                    if (existing && existing.id !== l.id) leadToDeletesInternal.push(existing.id);
                    leadMap.set(num, l);
                } else if (existing.id !== l.id) {
                    leadToDeletesInternal.push(l.id);
                }
            });

            // 3. LIMPIEZA DE COLISIONES CONTRA LA BASE DE DATOS
            // Ya no es necesaria la limpieza de colisiones por 'number' porque el índice ya no es único (v8).
            // Esto permite total flexibilidad del usuario para organizar sus números.

            // 4. GUARDADO EFECTIVO
            for (const emp of empMap.values()) await this.update('employees', emp);
            for (const pos of (cleanState.positions || [])) await this.update('positions', pos);
            for (const leader of leadMap.values()) await this.update('leaders', leader);

            const attRecords = Object.entries(cleanState.attendance || {}).map(([key, value]) => ({
                key,
                ...value
            }));
            for (const att of attRecords) await this.update('attendance', att);

            if (cleanState.settings) {
                await this.update('settings', {
                    key: 'app',
                    ...cleanState.settings
                });
            }

            return true;
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
