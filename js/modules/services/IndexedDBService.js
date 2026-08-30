/**
 * 💾 INDEXEDDB SERVICE
 * Módulo para gestionar la base de datos local y asegurar integridad de datos.
 */

import { Notification } from '../components/Notification.js';
import { computeSaveStatsExtras } from './SaveStatsExtras.js';
import { dedupKeyForRecord } from './RecordKey.js';
import { captureEntityProjectScope } from '../features/projects/EntityProjectScope.js';
import {
    deleteEmployeePhotoCache,
    ensureEmployeePhotoStore,
    getEmployeePhotoCache,
    listEmployeePhotosCache,
    putEmployeePhotoCache
} from './EmployeePhotoCache.js';

// ⏱️ Cotas de apertura de la base de datos.
// Sin límite de tiempo, un open bloqueado por otra ventana/pestaña que retiene
// una conexión vieja durante un upgrade de versión puede quedar pendiente para
// siempre: el boot (que espera init() vía loadApplicationData) se cuelga, el
// listener de auth nunca se registra y el usuario aparece deslogueado y sin
// datos con la consola limpia. Acotamos la apertura y rechazamos con errores
// tipados para que app.js pueda mostrar un diálogo accionable.
export const IDB_OPEN_TIMEOUT_MS = 8000;
export const IDB_BLOCKED_GRACE_MS = 4000;

export class IndexedDBService {
    constructor(dbName = 'attendance-app-db', version = 19) {
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
            let settled = false;
            let openTimer = null;
            let blockedTimer = null;

            // Limpieza centralizada de timers: sin esto quedan timers vivos tras
            // un settle temprano (éxito/error rápido) y un rechazo tardío podría
            // dispararse sobre una promesa ya resuelta.
            const clearOpenTimers = () => {
                if (openTimer !== null) clearTimeout(openTimer);
                if (blockedTimer !== null) clearTimeout(blockedTimer);
                openTimer = null;
                blockedTimer = null;
            };

            // ⏱️ Cota global del open: algunos navegadores dejan indexedDB.open
            // pendiente indefinidamente si otra ventana oculta retiene una
            // conexión vieja durante un upgrade de versión, sin disparar ni
            // blocked ni error. Rechazamos con error tipado para no colgar el
            // boot y dejarle a app.js la señal para mostrar el diálogo accionable.
            openTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                clearOpenTimers();
                try { if (request.cancel) request.cancel(); } catch (_) { /* noop: nunca lanzar desde el timer */ }
                const timeoutError = new Error(
                    `IndexedDB tardó más de ${IDB_OPEN_TIMEOUT_MS} ms en abrir. El almacenamiento local no responde.`
                );
                timeoutError.name = 'IndexedDBOpenTimeoutError';
                console.error('❌ IndexedDB: timeout al abrir la base de datos.', timeoutError);
                reject(timeoutError);
            }, IDB_OPEN_TIMEOUT_MS);

            request.onerror = () => {
                if (settled) return;
                settled = true;
                clearOpenTimers();
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
                // Gracia corta: si el bloqueo sigue pasado ese margen, rechazamos
                // con error tipado en lugar de dejar la promesa pendiente para
                // siempre. onblocked puede dispararse más de una vez: el timer de
                // gracia se programa sólo la primera vez.
                if (blockedTimer !== null) return;
                blockedTimer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    clearOpenTimers();
                    const blockedError = new Error(
                        'La apertura del almacenamiento local está bloqueada por otra ventana o pestaña de la aplicación. Cerrá todas las ventanas o pestañas de la app y volvé a abrir.'
                    );
                    blockedError.name = 'IndexedDBOpenBlockedError';
                    console.error('❌ IndexedDB: apertura bloqueada por otra ventana/pestaña.', blockedError);
                    reject(blockedError);
                }, IDB_BLOCKED_GRACE_MS);
            };

            request.onsuccess = () => {
                settled = true;
                clearOpenTimers();
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
                // Store: espejo privado de movimientos en Supabase (v13).
                // Usa el id del movimiento como clave para compactar múltiples
                // ediciones offline y conservar únicamente la operación final.
                if (!db.objectStoreNames.contains('pettyCashMirrorOutbox')) {
                    const mirrorStore = db.createObjectStore('pettyCashMirrorOutbox', { keyPath: 'id' });
                    mirrorStore.createIndex('status', 'status', { unique: false });
                }

                // Store: Outbox de sincronización principal (v11) — mirror snapshot,
                // asistencia diaria y cloud-deletes en cola durable con dead-lettering.
                // NO reutiliza sync_queue (keyPath 'id') porque saveState({clearFirst})
                // lo BORRA en cada restore/demo/cuenta-nueva. Espeja pettyCashOutbox.
                if (!db.objectStoreNames.contains('mainSyncOutbox')) {
                    const mStore = db.createObjectStore('mainSyncOutbox', { keyPath: 'key', autoIncrement: true });
                    mStore.createIndex('status', 'status', { unique: false });
                    mStore.createIndex('kind', 'kind', { unique: false });
                }

                // Store: leases de coordinación entre pestañas (v12). Las
                // transacciones readwrite de IndexedDB son seriales entre tabs,
                // por lo que la adquisición es un compare-and-set atómico.
                if (!db.objectStoreNames.contains('syncLocks')) {
                    db.createObjectStore('syncLocks', { keyPath: 'name' });
                }

                // Stores locales y aislados del importador Mini (v14).
                if (!db.objectStoreNames.contains('miniAttendanceAliases')) {
                    const aliasStore = db.createObjectStore('miniAttendanceAliases', { keyPath: 'aliasId' });
                    aliasStore.createIndex('scopeKey', 'scopeKey', { unique: false });
                    aliasStore.createIndex('targetEmployeeId', 'targetEmployeeId', { unique: false });
                    aliasStore.createIndex('active', 'active', { unique: false });
                }
                if (!db.objectStoreNames.contains('miniAttendanceAliasAudit')) {
                    const auditStore = db.createObjectStore('miniAttendanceAliasAudit', { keyPath: 'auditId' });
                    auditStore.createIndex('aliasId', 'aliasId', { unique: false });
                    auditStore.createIndex('scopeKey', 'scopeKey', { unique: false });
                    auditStore.createIndex('eventType', 'eventType', { unique: false });
                }
                if (!db.objectStoreNames.contains('miniAttendanceInbox')) {
                    const inboxStore = db.createObjectStore('miniAttendanceInbox', { keyPath: 'eventId' });
                    inboxStore.createIndex('status', 'status', { unique: false });
                    inboxStore.createIndex('scopeKey', 'scopeKey', { unique: false });
                    inboxStore.createIndex('receivedAt', 'receivedAt', { unique: false });
                }

                // Store: cierres históricos de Nómina (v15). Vive fuera del
                // estado global para no reescribir todo el historial en cada save.
                if (!db.objectStoreNames.contains('payrollClosures')) {
                    const closureStore = db.createObjectStore('payrollClosures', { keyPath: 'id' });
                    closureStore.createIndex('periodKey', 'periodKey', { unique: false });
                    closureStore.createIndex('closedAtId', ['closedAt', 'id'], { unique: false });
                    closureStore.createIndex(
                        'statusClosedAtId',
                        ['status', 'closedAt', 'id'],
                        { unique: false }
                    );
                    closureStore.createIndex('projectId', 'projectId', { unique: false });
                } else if (event.oldVersion < 19) {
                    const closureStore = transaction.objectStore('payrollClosures');
                    if (!closureStore.indexNames.contains('projectId')) {
                        closureStore.createIndex('projectId', 'projectId', { unique: false });
                    }
                }

                // Store: employee avatar binaries (v16). It is intentionally
                // separate from employee state and petty-cash receipts.
                ensureEmployeePhotoStore(db);

                // Store: proyectos oficiales (v17, F1.1) — entidad raíz del
                // modelo multiproyecto (F0.3). Local-first en este slice:
                // sin outbox ni publicación cloud.
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }

                // Store: payroll configs por proyecto (v18, F1.6-A2) — config
                // operativa/económica versionada por projectId canónico.
                // Local-only en A2 (sin outbox ni publicación cloud).
                if (!db.objectStoreNames.contains('projectPayrollConfigs')) {
                    db.createObjectStore('projectPayrollConfigs', { keyPath: 'projectId' });
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

    async atomicUpdate(entries) {
        if (!Array.isArray(entries) || entries.length === 0) return true;
        await this.init();
        return new Promise((resolve, reject) => {
            const storeNames = [...new Set(entries.map(entry => entry.storeName))];
            const transaction = this.db.transaction(storeNames, 'readwrite');
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(
                transaction.error || new Error('Atomic IndexedDB update failed')
            );
            transaction.onabort = transaction.onerror;
            entries.forEach(entry => transaction.objectStore(entry.storeName)
                .put(this._serializeForIDB(entry.data)));
        });
    }

    // Employee photo binaries live only in their dedicated IndexedDB store.
    async saveEmployeePhoto(employeeId, value) {
        return putEmployeePhotoCache(this, employeeId, value);
    }

    async getEmployeePhoto(employeeId) {
        return getEmployeePhotoCache(this, employeeId);
    }

    async listEmployeePhotos() {
        return listEmployeePhotosCache(this);
    }

    async replaceEmployeePhoto(employeeId, value) {
        return putEmployeePhotoCache(this, employeeId, value);
    }

    async deleteEmployeePhoto(employeeId) {
        return deleteEmployeePhotoCache(this, employeeId);
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

    /**
     * Guarda el archivo ORIGINAL de un comprobante y sus estados de trabajo.
     * Estos registros son deliberadamente `local-only`: no participan de la
     * subida heredada a Supabase hasta que el respaldo remoto sea habilitado.
     */
    async saveReceiptOriginal(txId, originalBlob, previewDataUrl = null, metadata = {}) {
        if (!txId || !originalBlob) return;
        await this.init();
        const existing = await this.getReceipt(txId);
        const now = Date.now();
        const record = {
            ...(existing || {}),
            ...metadata,
            txId,
            originalBlob,
            previewDataUrl: previewDataUrl || existing?.previewDataUrl || null,
            status: 'local-only',
            storage: 'local-only',
            queueStatus: metadata.queueStatus || existing?.queueStatus || 'queued',
            ocrStatus: metadata.ocrStatus || existing?.ocrStatus || 'pending',
            uploadStatus: 'deferred',
            attempts: Number.isFinite(Number(existing?.attempts)) ? Number(existing.attempts) : 0,
            lastError: metadata.lastError ?? existing?.lastError ?? null,
            createdAt: existing?.createdAt || now,
            updatedAt: now
        };
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readwrite');
            const req = tx.objectStore('pettyCashReceipts').put(record);
            req.onsuccess = () => resolve(record);
            req.onerror = () => reject(req.error);
        });
    }

    /** Actualiza estados de una captura sin reemplazar su Blob original. */
    async updateReceiptJob(txId, patch = {}) {
        if (!txId) return null;
        await this.init();
        const existing = await this.getReceipt(txId);
        if (!existing) return null;
        const record = { ...existing, ...patch, txId, updatedAt: Date.now() };
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readwrite');
            const req = tx.objectStore('pettyCashReceipts').put(record);
            req.onsuccess = () => resolve(record);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Marca el respaldo remoto como verificado y libera el original local sólo
     * cuando existe una miniatura y una ruta recuperable en Supabase.
     */
    async finalizeReceiptBackup(txId, patch = {}) {
        if (!txId) return null;
        await this.init();
        const existing = await this.getReceipt(txId);
        if (!existing) return null;
        const now = Date.now();
        const record = {
            ...existing,
            ...patch,
            txId,
            status: 'uploaded',
            storage: 'supabase',
            uploadStatus: 'uploaded',
            updatedAt: now
        };
        const canPruneOriginal = !!(
            record.previewDataUrl &&
            record.remotePath &&
            Number(record.remoteVerifiedAt) > 0
        );
        if (canPruneOriginal) {
            delete record.originalBlob;
            record.localOriginalPrunedAt = now;
        }
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readwrite');
            const req = tx.objectStore('pettyCashReceipts').put(record);
            req.onsuccess = () => resolve(record);
            req.onerror = () => reject(req.error);
        });
    }

    /** Lista la cola durable de originales locales, opcionalmente por estado. */
    async listReceiptJobs(queueStatuses = null) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pettyCashReceipts'], 'readonly');
            const req = tx.objectStore('pettyCashReceipts').getAll();
            req.onsuccess = () => {
                const wanted = Array.isArray(queueStatuses) && queueStatuses.length
                    ? new Set(queueStatuses)
                    : null;
                const jobs = (req.result || []).filter((record) =>
                    record?.originalBlob && (!wanted || wanted.has(record.queueStatus))
                );
                resolve(jobs);
            };
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

    /** Deletes several keys atomically in a single IndexedDB transaction. */
    async batchDelete(storeName, keys) {
        if (!Array.isArray(keys) || keys.length === 0) return 0;
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            transaction.oncomplete = () => resolve(keys.length);
            transaction.onerror = () => reject(
                transaction.error || new Error(`Batch delete failed for ${storeName}`)
            );
            transaction.onabort = () => reject(
                transaction.error || new Error(`Batch delete aborted for ${storeName}`)
            );
            keys.forEach(key => store.delete(key));
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

    /**
     * Reads and conditionally replaces one record inside the same transaction.
     * The mutator must be synchronous and return { write, value }.
     */
    async atomicMutate(storeName, key, mutator) {
        if (typeof mutator !== 'function') {
            throw new TypeError('atomicMutate requires a synchronous mutator');
        }
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            let result;
            let mutationError = null;

            request.onsuccess = () => {
                try {
                    result = mutator(request.result);
                    if (!result || typeof result.write !== 'boolean' || !('value' in result)) {
                        throw new TypeError('atomicMutate mutator must return { write, value }');
                    }
                    if (result.write) {
                        store.put(this._serializeForIDB(result.value));
                    }
                } catch (error) {
                    mutationError = error;
                    transaction.abort();
                }
            };
            request.onerror = () => {
                mutationError = request.error;
            };
            transaction.oncomplete = () => resolve(result.value);
            transaction.onerror = () => reject(
                mutationError || transaction.error || new Error(`Atomic mutation failed for ${storeName}`)
            );
            transaction.onabort = () => reject(
                mutationError || transaction.error || new Error(`Atomic mutation aborted for ${storeName}`)
            );
        });
    }

    /**
     * Atomically mutates one primary record and writes related record batches
     * in other stores. Used by payroll closure so its loan balances and audit
     * snapshot cannot diverge after a crash between local writes.
     */
    async atomicMutateWithBatches(storeName, key, mutator, batches = []) {
        if (typeof mutator !== 'function') {
            throw new TypeError('atomicMutateWithBatches requires a synchronous mutator');
        }
        const validBatches = (batches || []).filter(batch =>
            batch?.storeName && Array.isArray(batch.records)
        );
        await this.init();
        return new Promise((resolve, reject) => {
            const storeNames = [...new Set([storeName, ...validBatches.map(batch => batch.storeName)])];
            const transaction = this.db.transaction(storeNames, 'readwrite');
            const primaryStore = transaction.objectStore(storeName);
            const request = primaryStore.get(key);
            let result;
            let mutationError = null;

            request.onsuccess = () => {
                try {
                    result = mutator(request.result);
                    if (!result || typeof result.write !== 'boolean' || !('value' in result)) {
                        throw new TypeError('atomicMutateWithBatches mutator must return { write, value }');
                    }
                    if (result.write) {
                        primaryStore.put(this._serializeForIDB(result.value));
                        for (const batch of validBatches) {
                            const relatedStore = transaction.objectStore(batch.storeName);
                            for (const record of batch.records) {
                                relatedStore.put(this._serializeForIDB(record));
                            }
                        }
                    }
                } catch (error) {
                    mutationError = error;
                    transaction.abort();
                }
            };
            request.onerror = () => {
                mutationError = request.error;
            };
            transaction.oncomplete = () => resolve(result.value);
            transaction.onerror = () => reject(
                mutationError || transaction.error || new Error(`Atomic batch mutation failed for ${storeName}`)
            );
            transaction.onabort = () => reject(
                mutationError || transaction.error || new Error(`Atomic batch mutation aborted for ${storeName}`)
            );
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

    async getPageByIndex(storeName, indexName, {
        limit = 20,
        direction = 'prev',
        lowerBound,
        upperBound,
        lowerOpen = false,
        upperOpen = false
    } = {}) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const index = store.index(indexName);
            let range = null;
            if (lowerBound !== undefined && upperBound !== undefined) {
                range = IDBKeyRange.bound(lowerBound, upperBound, lowerOpen, upperOpen);
            } else if (lowerBound !== undefined) {
                range = IDBKeyRange.lowerBound(lowerBound, lowerOpen);
            } else if (upperBound !== undefined) {
                range = IDBKeyRange.upperBound(upperBound, upperOpen);
            }
            const records = [];
            const request = index.openCursor(range, direction);
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor || records.length >= limit) {
                    resolve(records);
                    return;
                }
                records.push(cursor.value);
                cursor.continue();
            };
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

    /** Adquiere o renueva un lease atómico compartido por todas las pestañas. */
    async acquireLease(name, ownerId, leaseMs, now = Date.now()) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['syncLocks'], 'readwrite');
            const store = tx.objectStore('syncLocks');
            let acquired = false;
            const request = store.get(name);

            request.onsuccess = () => {
                const current = request.result;
                if (!current || current.ownerId === ownerId || current.expiresAt <= now) {
                    store.put({ name, ownerId, expiresAt: now + leaseMs });
                    acquired = true;
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve(acquired);
            tx.onerror = () => reject(tx.error || new Error('Could not acquire IndexedDB lease'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB lease transaction aborted'));
        });
    }

    /** Extiende un lease sólo si esta pestaña todavía es su propietaria. */
    async renewLease(name, ownerId, leaseMs, now = Date.now()) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['syncLocks'], 'readwrite');
            const store = tx.objectStore('syncLocks');
            let renewed = false;
            const request = store.get(name);

            request.onsuccess = () => {
                const current = request.result;
                if (current?.ownerId === ownerId) {
                    store.put({ name, ownerId, expiresAt: now + leaseMs });
                    renewed = true;
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve(renewed);
            tx.onerror = () => reject(tx.error || new Error('Could not renew IndexedDB lease'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB lease transaction aborted'));
        });
    }

    /** Libera el lease sin borrar el que ya haya tomado otra pestaña. */
    async releaseLease(name, ownerId) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['syncLocks'], 'readwrite');
            const store = tx.objectStore('syncLocks');
            let released = false;
            const request = store.get(name);

            request.onsuccess = () => {
                if (request.result?.ownerId === ownerId) {
                    store.delete(name);
                    released = true;
                }
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => resolve(released);
            tx.onerror = () => reject(tx.error || new Error('Could not release IndexedDB lease'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB lease transaction aborted'));
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
        const entityScope = captureEntityProjectScope();
        try {
            // Granular = una fecha (dateKey) o un lote de fechas (dateKeys, el
            // canal unificado multi-fecha del purge). Sin reconocer dateKeys,
            // esos guardados degradaban a completo (dedup + reescritura de
            // todos los stores en cada purge).
            const _granularDates = Array.isArray(options.dateKeys)
                ? options.dateKeys.filter(Boolean)
                : (options.dateKey ? [options.dateKey] : []);
            const isGranular = _granularDates.length > 0;

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
                    const key = dedupKeyForRecord(emp, entityScope);
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
                    const key = dedupKeyForRecord(l, entityScope);
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
                // ⚡ FIX: Soportar sufijos con guion (-) o guion bajo (_) para mayor
                // robustez, para CADA fecha del lote granular.
                const suffixes = _granularDates.flatMap(dk => [`-${dk}`, `_${dk}`]);
                attToSave = Object.entries(state.attendance || {})
                    .filter(([key]) => suffixes.some(s => key.endsWith(s)))
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
            payrollClosures: await this.getAll('payrollClosures'),
            projectPayrollConfigs: await this.getAll('projectPayrollConfigs').catch(() => []),
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
            await this.clear('payrollClosures');
            await this.clear('projectPayrollConfigs').catch(() => {});

            // L5: escritura por lotes (batchUpdate) en vez de update() uno-por-uno;
            // mucho más rápido al restaurar backups grandes.
            if (Array.isArray(data.employees)) await this.batchUpdate('employees', data.employees);
            if (Array.isArray(data.positions)) await this.batchUpdate('positions', data.positions);
            if (Array.isArray(data.leaders))   await this.batchUpdate('leaders', data.leaders);
            if (Array.isArray(data.attendance)) await this.batchUpdate('attendance', data.attendance);
            if (Array.isArray(data.settings))  await this.batchUpdate('settings', data.settings);
            if (Array.isArray(data.payrollClosures)) {
                await this.batchUpdate('payrollClosures', data.payrollClosures);
            }
            if (Array.isArray(data.projectPayrollConfigs)) {
                await this.batchUpdate('projectPayrollConfigs', data.projectPayrollConfigs);
            }

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
