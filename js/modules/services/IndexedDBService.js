/**
 * 💾 INDEXEDDB SERVICE
 * Módulo para gestionar la base de datos local y asegurar integridad de datos.
 */

import { Notification } from '../components/Notification.js';
import { computeSaveStatsExtras } from './SaveStatsExtras.js';
import { dedupKeyForRecord } from './RecordKey.js';

export class IndexedDBService {
    constructor(dbName = 'attendance-app-db', version = 10) {
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

            request.onblocked = () => {
                console.warn('⚠️ Upgrade de IndexedDB bloqueado: cierra otras pestañas de la app para completar la actualización.');
                // Avisar al usuario: sin cerrar la otra pestaña el upgrade no avanza
                // y el boot (que espera init()) puede quedar colgado.
                try {
                    Notification?.warning?.('Hay otra pestaña de la app abierta. Ciérrala para completar la actualización de la base de datos.');
                } catch (_) { /* Notification puede no estar disponible en algunos entornos */ }
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                // 🔧 Si OTRA pestaña dispara un upgrade de versión (p.ej. v10→v11),
                // esta conexión abierta lo bloquearía indefinidamente y colgaría el
                // boot de la otra pestaña. onversionchange nos avisa: cerramos esta
                // conexión para cederle el paso, en vez de colgar ambas.
                this.db.onversionchange = () => {
                    console.warn('🔧 IndexedDB: otra pestaña solicitó un upgrade; cerrando esta conexión para no bloquearlo.');
                    try { this.db.close(); } catch (_) { /* noop */ }
                    this.db = null;
                    this.isInitialized = false;
                };
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

                // Store: Comprobantes de caja chica (v9) — foto local (data URL)
                // por txId, en cola para subir a Supabase vía n8n.
                if (!db.objectStoreNames.contains('pettyCashReceipts')) {
                    const rcStore = db.createObjectStore('pettyCashReceipts', { keyPath: 'txId' });
                    rcStore.createIndex('status', 'status', { unique: false });
                }

                // Stores: Caja chica datos (v10) — proyectos/periodos/movimientos
                // ahora viven en IndexedDB (no en localStorage) + outbox de
                // escrituras pendientes para no perder cambios hechos offline.
                if (!db.objectStoreNames.contains('pettyCashProjects')) {
                    db.createObjectStore('pettyCashProjects', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('pettyCashPeriods')) {
                    const pStore = db.createObjectStore('pettyCashPeriods', { keyPath: 'id' });
                    pStore.createIndex('projectId', 'projectId', { unique: false });
                }
                if (!db.objectStoreNames.contains('pettyCashMovements')) {
                    const mStore = db.createObjectStore('pettyCashMovements', { keyPath: 'id' });
                    mStore.createIndex('periodId', 'periodId', { unique: false });
                }
                if (!db.objectStoreNames.contains('pettyCashOutbox')) {
                    const oStore = db.createObjectStore('pettyCashOutbox', { keyPath: 'key', autoIncrement: true });
                    oStore.createIndex('status', 'status', { unique: false });
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
                reject(request.error || new Error('Error en solicitud IndexedDB (request.error es null)'));
            };
        });
    }

    // 🧹 clear(storeName) está definido más abajo (junto a delete/clearAll).
    // La copia duplicada que vivía aquí era código muerto (L1, auditoría
    // 2026-06-09): en una clase, la segunda definición pisa a la primera.

    // ─── Comprobantes de caja chica (fotos locales, v9) ───────────────
    /**
     * Guarda (upsert) la foto de un comprobante como data URL, en cola para
     * subir a Supabase vía n8n.
     * @param {string} txId  id del movimiento
     * @param {string} dataUrl  'data:image/jpeg;base64,...'
     * @param {string} [status] 'pending' (local, por subir) | 'uploaded'
     */
    async saveReceipt(txId, dataUrl, status = 'pending') {
        if (!txId || !dataUrl) return;
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readwrite');
            const req = tx.objectStore('pettyCashReceipts').put({ txId, dataUrl, status, createdAt: Date.now() });
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    /** Devuelve el registro del comprobante { txId, dataUrl, status } o null. */
    async getReceipt(txId) {
        if (!txId) return null;
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readonly');
            const req = tx.objectStore('pettyCashReceipts').get(txId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    /** Borra el comprobante local de un movimiento. */
    async deleteReceipt(txId) {
        if (!txId) return;
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readwrite');
            const req = tx.objectStore('pettyCashReceipts').delete(txId);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    /** Lista los comprobantes pendientes de subir (status 'pending'). */
    async listPendingReceipts() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readonly');
            const idx = tx.objectStore('pettyCashReceipts').index('status');
            const req = idx.getAll('pending');
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
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
        // 🧹 H2: limpiar TODO lo que exista en la DB, no una lista hardcodeada.
        // La lista vieja omitía los stores de caja chica (v9/v10): "Borrar
        // Información Local" dejaba movimientos financieros y fotos de
        // comprobantes en el dispositivo.
        const stores = Array.from(this.db.objectStoreNames);
        const promises = stores.map(store => this.clear(store));
        await Promise.all(promises);
        console.log(`🧹 IndexedDB: ${stores.length} store(s) limpiados (${stores.join(', ')})`);
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
                // 🧹 M3: limpiar SOLO los stores que este método reescribe.
                // clearAll() borraría también la caja chica y los comprobantes,
                // que saveState NO sabe restaurar (los maneja PettyCashStore) —
                // un restore de backup viejo arrasaría datos que el archivo no
                // trae. El borrado total sigue siendo clearAll() (Borrar Local).
                const ownStores = ['employees', 'positions', 'leaders', 'attendance', 'settings', 'sync_queue'];
                await this.init();
                await Promise.all(
                    ownStores
                        .filter(s => this.db.objectStoreNames.contains(s))
                        .map(s => this.clear(s))
                );
            }

            // ⚡ P1-OPT: No clonar todo el estado (evita 500ms+ de CPU)
            // Solo procesamos lo necesario según si es granular o completo

            if (!isGranular) {
                // 1. DEDUPLICACIÓN INTERNA (Solo en guardado completo)
                // 🔑 H1: la clave es number || id (dedupKeyForRecord). Antes,
                // un registro sin número se descartaba en silencio y nunca
                // llegaba a IndexedDB — pérdida de datos local tras un F5.
                const empMap = new Map();
                (state.employees || []).forEach(emp => {
                    const key = dedupKeyForRecord(emp);
                    if (!key) return; // sin number NI id: nada que persistir
                    const existing = empMap.get(key);
                    if (!existing || (emp.updatedAt || 0) > (existing.updatedAt || 0)) {
                        if (existing) stats.deduplicated++;
                        empMap.set(key, emp);
                    } else {
                        stats.deduplicated++;
                    }
                });

                const leadMap = new Map();
                (state.leaders || []).forEach(l => {
                    const key = dedupKeyForRecord(l);
                    if (!key) return;
                    const existing = leadMap.get(key);
                    if (!existing || (l.updatedAt || 0) > (existing.updatedAt || 0)) {
                        if (existing) stats.deduplicated++;
                        leadMap.set(key, l);
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
                // ⚡ FIX: Soportar sufijos con guion (-) o guion bajo (_) para mayor robustez
                const dateKey = options.dateKey;
                attToSave = Object.entries(state.attendance || {})
                    .filter(([key]) => key.endsWith(`-${dateKey}`) || key.endsWith(`_${dateKey}`))
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
                // Usar formato canónico (guion) para la clave de deduplicación interna
                const empDateKey = `${record.employeeId}-${record.date}`;
                if (seenAttendance.has(empDateKey)) {
                    console.warn(`🛡️ Purgado registro IDB huérfano para evitar ConstraintError: ${empDateKey}`);
                    return false;
                }
                seenAttendance.add(empDateKey);
                return true;
            });

            stats.attendance = await this.batchUpdate('attendance', attToSave);

            if (state.settings) {
                // L3: key:'app' va DESPUÉS del spread para que un eventual
                // state.settings.key no pise el keyPath del store.
                await this.update('settings', { ...state.settings, key: 'app' });
            }

            const extras = computeSaveStatsExtras(state);
            stats.loans = extras.loans;
            stats.pettyCash = extras.pettyCash;
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
            // 💵 M3: la caja chica también es parte de la DB local — sin esto
            // el dump estaba incompleto y una restauración la perdía.
            pettyCashProjects: await this.getAll('pettyCashProjects').catch(() => []),
            pettyCashPeriods: await this.getAll('pettyCashPeriods').catch(() => []),
            pettyCashMovements: await this.getAll('pettyCashMovements').catch(() => []),
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

            // L5: escritura por lotes (batchUpdate) en vez de update() uno-por-uno;
            // mucho más rápido al restaurar backups grandes.
            if (Array.isArray(data.employees)) await this.batchUpdate('employees', data.employees);
            if (Array.isArray(data.positions)) await this.batchUpdate('positions', data.positions);
            if (Array.isArray(data.leaders))   await this.batchUpdate('leaders', data.leaders);
            if (Array.isArray(data.attendance)) await this.batchUpdate('attendance', data.attendance);
            if (Array.isArray(data.settings))  await this.batchUpdate('settings', data.settings);

            return true;
        } catch (error) {
            console.error('❌ Error al importar datos:', error);
            return false;
        }
    }

    // Migrar desde localStorage
    async migrateFromLocalStorage(storageKey = 'asistencia-data') {
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
