import { 
    auth, googleProvider, db, storage,
    signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, 
    query, orderBy, limit, getDocs,
    ref, uploadString, getDownloadURL, onSnapshot, where, documentId, writeBatch, getBlob, deleteObject
} from '../data/firebase.js';
import { getDeviceId } from '../config/Config.js';
import { SNAPSHOT_REASONS, defaultReasonForType } from './SnapshotReasons.js';
import { notifySnapshotCreated } from './SnapshotNotifier.js';
import { runMigrationIfNeeded } from './SchemaMigrationRunner.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { Notification } from '../components/Notification.js';

class FirebaseService {
    constructor() {
        this.user = null;
        this._attendanceInitialized = false;
    }

    /**
     * Inicia sesión con Google (POPUP)
     */
    async loginWithGoogle() {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            this.user = result.user;
            console.log('Usuario autenticado:', this.user.email);
            return this.user;
        } catch (error) {
            console.error('Error en login con Google:', error);
            throw error;
        }
    }

    /**
     * Cierra la sesión activa
     */
    async logout() {
        try {
            await signOut(auth);
            this.user = null;
            console.log('Sesión cerrada correctamente');
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            throw error;
        }
    }

    /**
     * Escucha cambios en el estado de autenticación
     */
    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, (user) => {
            this.user = user;
            callback(user);
        });
    }

    /**
     * Guarda el estado completo de la aplicación (Mirror Sync)
     * @param {object} state El objeto de estado global
     */
    async saveFullState(state) {
        if (!auth.currentUser) return;

        try {
            // Firestore no acepta instancias de clases personalizadas ni valores undefined.
            // Limpiamos el estado de propiedades de UI/Sesión y redundancias (como la lista de snapshots dentro del snapshot)
            const snapshotContext = { ...state };
            delete snapshotContext.snapshots;
            delete snapshotContext.isLoadingSnapshots;
            delete snapshotContext.currentUser;
            delete snapshotContext.attendance; // ⚡ OPT: La asistencia se guarda por separado en su propia colección
            delete snapshotContext.attendanceByDate; // ⚡ OPT: Índices locales no se suben

            // ⚡ FASE 4.1: Si la cuenta ya migró al modelo doc-por-empleado
            // (schemaVersion >= 2), escribimos los empleados granular en
            // users/{uid}/employees/{id} en lugar de aplastar el arreglo
            // en el parent. Cada dispositivo solo toca los docs que cambia
            // y deja de pisar lo que cambiaron otros dispositivos.
            const schemaVersion = state?.settings?.schemaVersion;
            const isMigrated = typeof schemaVersion === 'number' && schemaVersion >= 2;

            if (isMigrated) {
                // Escribir empleados como docs individuales en paralelo.
                // mergeRemote:true (Fase 2.2) hace read-merge-write para fusionar
                // por id los arreglos del empleado (loans, advances, payments,
                // etc.) — protege contra pérdida cuando dos dispositivos
                // editaron el mismo empleado offline.
                const emps = Array.isArray(state.employees) ? state.employees : [];
                if (emps.length > 0) {
                    await EmployeeRepository.saveMany(emps, { mergeRemote: true });
                }
                // Y eliminarlos del payload del mirror para no reescribir
                // el arreglo legacy con datos que ya viven en su propia colección.
                delete snapshotContext.employees;
            }

            const cleanState = JSON.parse(JSON.stringify(snapshotContext));


            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
            // 🛡️ merge: true evita que un guardado parcial borre campos top-level
            // que este dispositivo no conoce. Combinado con el split de empleados
            // arriba, esto cierra la ruta de pérdida de datos en multi-dispositivo
            // para todo lo que vive en el empleado (préstamos, segundos empleos,
            // adelantos, etc.).
            await setDoc(docRef, {
                ...cleanState,
                updatedAt: serverTimestamp(),
                lastDevice: navigator.userAgent,
                lastChangedBy: getDeviceId()
            }, { merge: true });
            console.log(`☁️ Estado sincronizado en Firebase (schemaVersion=${schemaVersion || 'legacy'})`);
        } catch (error) {
            console.error('❌ Error sincronizando estado:', error);
            throw error;
        }
    }

    /**
     * Crea un punto de restauración (Snapshot) en la colección de backups
     * @param {object} state Estado global a respaldar
     * @param {string} type Tipo (auto/manual/pre-restore) — compat hacia atrás
     * @param {string|object} [reasonOrOpts] Razón específica (código del catálogo
     *   SnapshotReasons) o un objeto { reason, userNote } para snapshots manuales
     *   con comentario libre del usuario.
     */
    async createSnapshot(state, type = 'auto', reasonOrOpts = null) {
        if (!auth.currentUser) return;

        // Permitir tanto string (reason) como objeto { reason, userNote }
        let reason = null;
        let userNote = null;
        if (typeof reasonOrOpts === 'string') {
            reason = reasonOrOpts;
        } else if (reasonOrOpts && typeof reasonOrOpts === 'object') {
            reason = reasonOrOpts.reason || null;
            userNote = reasonOrOpts.userNote || null;
        }

        // Resolver reason desde el type si no vino explícita
        const resolvedReason = reason || defaultReasonForType(type);
        const reasonInfo = SNAPSHOT_REASONS[resolvedReason] || null;
        const reasonLabel = reasonInfo?.label || null;

        try {
            const snapshotContext = { ...state };
            delete snapshotContext.snapshots;
            delete snapshotContext.isLoadingSnapshots;
            delete snapshotContext.currentUser;

            const cleanState = JSON.parse(JSON.stringify(snapshotContext));

            const timestamp = Date.now();
            const docRef = doc(db, 'users', auth.currentUser.uid, 'snapshots', `snapshot_${timestamp}`);
            
            const stateString = JSON.stringify(cleanState);
            const isExternal = stateString.length > 800000; // ~800KB threshold
            let storageUrl = null;

            if (isExternal) {
                console.log(`📦 Snapshot grande (${(stateString.length/1024).toFixed(1)} KB). Subiendo a Storage...`);
                const storageRef = ref(storage, `users/${auth.currentUser.uid}/snapshots/snapshot_${timestamp}.json`);
                await uploadString(storageRef, stateString);
                storageUrl = await getDownloadURL(storageRef);
            }

            await setDoc(docRef, {
                state: isExternal ? null : cleanState,
                isExternal: isExternal,
                storageUrl: storageUrl,
                metadata: {
                    timestamp,
                    type,
                    reason: resolvedReason,
                    reasonLabel,
                    userNote,
                    isProtected: type === 'pre-restore' || !!reasonInfo?.protected,
                    size: stateString.length,
                    employeeCount: state.employees?.length || 0,
                    attendanceCount: Object.keys(state.attendance || {}).length,
                    createdAt: serverTimestamp(),
                    lastChangedBy: getDeviceId()
                }
            });
            console.log(`📸 Snapshot (${type}/${resolvedReason}) creado en Firebase ${isExternal ? '(en Storage)' : '(en Firestore)'}`);

            // 📣 Notificar al usuario (solo snapshots automáticos/del sistema;
            // los manuales ya muestran su propio toast desde el botón).
            notifySnapshotCreated({
                reason: resolvedReason,
                reasonLabel,
                type,
                isProtected: type === 'pre-restore' || !!reasonInfo?.protected
            });

            return docRef.id;
        } catch (error) {
            console.error('❌ Error creando snapshot:', error);
            throw error;
        }
    }

    /**
     * 🔄 Migración v1→v2: Si el doc parent indica que aún no migró
     * (schemaVersion < 2) y hay empleados en el arreglo legacy, ejecuta:
     *   1. Snapshot pre-migration-v2 (red de seguridad)
     *   2. Escritura granular: un doc por empleado en users/{uid}/employees/{id}
     *   3. Marca schemaVersion: 2 en el parent (merge:true para no romper otros campos)
     *   4. Toast de éxito al usuario
     *
     * Idempotente: si se interrumpe a medias, el próximo arranque lo retoma.
     *
     * @param {object|null} parentDoc El doc users/{uid}/data/current
     * @param {object} [opts]         { isDemo?: boolean }
     * @returns {Promise<{migrated: boolean, count?: number}>}
     */
    async migrateIfNeeded(parentDoc, opts = {}) {
        if (!auth.currentUser) return { migrated: false };

        return await runMigrationIfNeeded({
            parentDoc,
            isDemo: !!opts.isDemo,
            createSnapshot: () =>
                this.createSnapshot(parentDoc, 'pre-restore', 'pre-migration-v2'),
            saveEmployees: (employees) =>
                EmployeeRepository.saveMany(employees),
            markSchemaVersion: async (version) => {
                const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
                // lastChangedBy garantiza que el listener filtre este eco.
                await setDoc(docRef, {
                    schemaVersion: version,
                    lastChangedBy: getDeviceId(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            },
            notify: (msg) => Notification.success(msg, 5000)
        });
    }

    /**
     * 📥 Carga la lista actual de empleados aplicando el modelo correcto:
     *   - Si schemaVersion >= 2: lee de users/{uid}/employees/* (per-doc).
     *   - Si schemaVersion < 2 o ausente: usa el arreglo legacy del parent.
     *
     * @param {object|null} parentDoc El doc users/{uid}/data/current
     * @returns {Promise<Array>}
     */
    async loadEmployeesIfMigrated(parentDoc) {
        const version = parentDoc?.schemaVersion;
        if (typeof version === 'number' && version >= 2) {
            return await EmployeeRepository.loadAll();
        }
        // Modelo viejo: confiar en el arreglo legacy.
        return Array.isArray(parentDoc?.employees) ? parentDoc.employees : [];
    }

    /**
     * Lista los últimos snapshots del usuario
     */
    async listSnapshots(limitCount = 10) {
        if (!auth.currentUser) return [];

        try {
            const snapshotsRef = collection(db, 'users', auth.currentUser.uid, 'snapshots');
            const q = query(snapshotsRef, orderBy('metadata.createdAt', 'desc'), limit(limitCount));
            const querySnapshot = await getDocs(q);
            
            return querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data().metadata,
                createdAt: doc.data().metadata?.createdAt?.toDate() || new Date(doc.data().metadata.timestamp)
            }));
        } catch (error) {
            console.error('❌ Error listando snapshots:', error);
            return [];
        }
    }

    /**
     * Recupera un snapshot específico
     */
    async getSnapshot(snapshotId) {
        if (!auth.currentUser) return null;

        try {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'snapshots', snapshotId);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) return null;
            
            const data = docSnap.data();
            let state = data.state;

            // ⚡ OPTIMIZACIÓN: Si es externo, usar getBlob del SDK (más robusto contra Tracking Prevention)
            if (data.isExternal) {
                console.log('📦 Recuperando snapshot grande vía Firebase SDK...');
                // Construir referencia interna para evitar bloqueos por URL de fetch
                const timestamp = data.metadata?.timestamp || snapshotId.replace('snapshot_', '');
                const storageRef = ref(storage, `users/${auth.currentUser.uid}/snapshots/snapshot_${timestamp}.json`);
                
                const blob = await getBlob(storageRef);
                const text = await blob.text();
                state = JSON.parse(text);
            }
            
            return {
                state: state,
                metadata: data.metadata || {}
            };
        } catch (error) {
            console.error(`❌ Error recuperando snapshot ${snapshotId}:`, error);
            throw error; // Lanzar para que app.js lo maneje
        }
    }

    /**
     * Suscribe a los cambios del estado global
     * @param {function} callback Función que recibe el nuevo estado
     * @returns {function} Función para cancelar la suscripción
     */
    subscribeToChanges(callback) {
        if (!auth.currentUser) return () => {};

        const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
        return onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
                const data = docSnap.data();
                
                // 🛡️ Filtro de Eco: Ignorar si el cambio fue hecho por este mismo dispositivo
                if (data.lastChangedBy === getDeviceId()) {
                    if (window.debug) window.debug.log('📡 Ignorando eco de red: cambio local detectado via deviceId');
                    return;
                }
                
                callback(data);
            }
        }, (error) => {
            console.error('❌ Error en suscripción de estado:', error);
        });
    }

    /**
     * Suscribe a los cambios en la colección de asistencia (opcional, para tiempo real total)
     * @param {function} callback
     */
    /**
     * Suscribe a los cambios en la colección de asistencia de forma granular (Zonal)
     * Soporta filtrado por rango de fechas (basado en el ID del documento: YYYY-MM-DD)
     * @param {object} options { onAdded, onModified, onRemoved, onInitialLoad, startDate, endDate }
     * @returns {function} Función para cancelar la suscripción
     */
    subscribeToAttendanceZonal(options = {}) {
        if (!auth.currentUser) return () => {};

        const { onAdded, onModified, onRemoved, onInitialLoad, startDate, endDate } = options;
        let attendanceRef = collection(db, 'users', auth.currentUser.uid, 'attendance');

        // 🔥 OPTIMIZACIÓN FASE 3: Filtrado por Rango de Fechas
        // Firestore permite filtrar por ID de documento usando documentId()
        if (startDate || endDate) {
            const constraints = [];
            if (startDate) constraints.push(where(documentId(), '>=', startDate));
            if (endDate) constraints.push(where(documentId(), '<=', endDate));
            attendanceRef = query(attendanceRef, ...constraints);
        }

        console.log(`📡 Suscribiendo a asistencia ${startDate ? `desde ${startDate}` : ''} ${endDate ? `hasta ${endDate}` : ''}`);

        return onSnapshot(attendanceRef, (querySnapshot) => {
            // No procesar si hay escrituras locales pendientes (evitar bucles infinitos)
            if (querySnapshot.metadata.hasPendingWrites) return;

            if (querySnapshot.docs.length > 0 && onInitialLoad && !this._attendanceInitialized) {
                const allAttendance = {};
                querySnapshot.forEach(doc => {
                    const dateKey = doc.id;
                    const records = doc.data().records || {};
                    // Inyectar timestamp de acceso para LRU y normalizar llaves
                    Object.entries(records).forEach(([key, r]) => {
                        r.lastAccessed = Date.now();
                        // ⚡ FIX: Asegurar clave canónica (id-fecha)
                        const canonicalKey = `${r.employeeId}-${dateKey}`;
                        allAttendance[canonicalKey] = r;
                    });
                });
                this._attendanceInitialized = true;
                onInitialLoad(allAttendance);
            }

            querySnapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                
                // 🛡️ Filtro de Eco Granular: Ignorar si el documento fue actualizado por este dispositivo
                if (data.deviceId === getDeviceId()) {
                    // if (window.debug) window.debug.log(`📡 Ignorando eco de asistencia: ${change.doc.id}`);
                    return;
                }

                const dateKey = change.doc.id;
                const records = data.records || {};

                if (change.type === "added" || change.type === "modified") {
                    const normalizedRecords = {};
                    // Inyectar timestamp de acceso para LRU y normalizar llaves
                    Object.entries(records).forEach(([key, r]) => {
                        r.lastAccessed = Date.now();
                        // ⚡ FIX: Asegurar clave canónica (id-fecha)
                        const canonicalKey = `${r.employeeId}-${dateKey}`;
                        normalizedRecords[canonicalKey] = r;
                    });
                    if (onModified) onModified(dateKey, normalizedRecords);
                }
                if (change.type === "removed") {
                    if (onRemoved) onRemoved(dateKey);
                }
            });
        }, (error) => {
            console.error('❌ Error en suscripción zonal de asistencia:', error);
        });
    }

    /**
     * Recupera el estado actual desde Firebase
     */
    async getFullState() {
        if (!auth.currentUser) return null;
        
        const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
        try {
            const docSnap = await getDoc(docRef);
            return docSnap.exists() ? docSnap.data() : null;
        } catch (error) {
            console.error('❌ Error cargando estado desde Firebase:', error);
            throw error;
        }
    }

    /**
     * Guarda un registro de asistencia específico para una fecha
     * @param {string} dateKey Formato YYYY-MM-DD
     * @param {object} dayAttendance Mapa de { empId: data } para ese día
     */
    async saveDailyAttendance(dateKey, dayAttendance) {
        if (!auth.currentUser) return;

        try {
            const cleanAttendance = JSON.parse(JSON.stringify(dayAttendance));
            const docRef = doc(db, 'users', auth.currentUser.uid, 'attendance', dateKey);
            
            await setDoc(docRef, {
                records: cleanAttendance,
                updatedAt: serverTimestamp(),
                date: dateKey,
                deviceId: getDeviceId()
            }, { merge: true });
            
            console.log(`☁️ Asistencia sincronizada: ${dateKey}`);
        } catch (error) {
            console.error(`❌ Error sincronizando asistencia del ${dateKey}:`, error);
        }
    }

    /**
     * Sincroniza todo el historial de asistencia local con la nube
     * Útil para la primera migración o reconstrucción de datos
     * @param {object} allAttendance Objeto con todo el historial de asistencia
     */
    async syncHistory(allAttendance) {
        if (!auth.currentUser || !allAttendance) return;

        console.log('🚀 Iniciando sincronización masiva de historial con Batches...');
        const entries = Object.entries(allAttendance);
        const daysToSync = {};

        // 1. Agrupar por fecha
        entries.forEach(([key, record]) => {
            const dateKey = record.date || key.split('-').slice(-3).join('-');
            if (!daysToSync[dateKey]) daysToSync[dateKey] = {};
            daysToSync[dateKey][key] = record;
        });

        const totalDays = Object.keys(daysToSync).length;
        let batch = writeBatch(db);
        let operationsCount = 0;

        // 2. Preparar el Batch (Límax 500 operaciones por batch en Firestore)
        for (const [dateKey, dayRecords] of Object.entries(daysToSync)) {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'attendance', dateKey);
            const cleanAttendance = JSON.parse(JSON.stringify(dayRecords));
            
            batch.set(docRef, {
                records: cleanAttendance,
                updatedAt: serverTimestamp(),
                date: dateKey
            }, { merge: true });

            operationsCount++;

            // Si llegamos al límite de 500, enviamos y reiniciamos el batch
            if (operationsCount === 500) {
                console.log('Enviando lote de 500 días a Firestore...');
                await batch.commit();
                batch = writeBatch(db);
                operationsCount = 0;
            }
        }

        // 3. Comprometer el Batch restante
        if (operationsCount > 0) {
            console.log(`Enviando lote final de ${operationsCount} días a Firestore...`);
            await batch.commit();
        }

        console.log('✅ Sincronización masiva (Batch) completada');
        return true;
    }

    /**
     * Recupera TODOS los registros de asistencia desde la nube
     */
    async getAllAttendance() {
        if (!auth.currentUser) return {};
        
        try {
            const attendanceRef = collection(db, 'users', auth.currentUser.uid, 'attendance');
            const querySnapshot = await getDocs(attendanceRef);
            
            const allAttendance = {};
            querySnapshot.forEach(doc => {
                const dateKey = doc.id;
                const dayData = doc.data().records || {};
                // Inyectar timestamp de acceso para LRU y normalizar llaves
                Object.entries(dayData).forEach(([key, r]) => {
                    r.lastAccessed = Date.now();
                    const canonicalKey = `${r.employeeId}-${dateKey}`;
                    allAttendance[canonicalKey] = r;
                });
            });
            
            return allAttendance;
        } catch (error) {
            console.error('❌ Error recuperando historial completo:', error);
            throw error;
        }
    }

    /**
     * Elimina un snapshot específico
     */
    async deleteSnapshot(snapshotId) {
        if (!auth.currentUser) return;

        try {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'snapshots', snapshotId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                // 1. Si está en Storage, borrarlo de allí primero
                if (data.isExternal) {
                    const storageRef = ref(storage, `users/${auth.currentUser.uid}/snapshots/${snapshotId}.json`);
                    try {
                        await deleteObject(storageRef);
                        console.log('🗑️ Archivo de snapshot eliminado de Storage');
                    } catch (e) {
                        console.warn('⚠️ No se pudo eliminar el archivo en Storage:', e);
                    }
                }
                
                // 2. Borrar documento de Firestore
                await deleteDoc(docRef);
                console.log(`🗑️ Snapshot ${snapshotId} eliminado de Firestore`);
            }
            return true;
        } catch (error) {
            console.error(`❌ Error eliminando snapshot ${snapshotId}:`, error);
            throw error;
        }
    }

    /**
     * Elimina todos los snapshots de un tipo específico (Limpieza masiva)
     * @param {string} type 'auto' o 'manual'
     */
    async deleteSnapshotsByType(type) {
        if (!auth.currentUser) return;

        try {
            const snapshotsRef = collection(db, 'users', auth.currentUser.uid, 'snapshots');
            const q = query(snapshotsRef, where('metadata.type', '==', type));
            const querySnapshot = await getDocs(q);
            
            const batch = writeBatch(db);
            let count = 0;

            for (const docSnap of querySnapshot.docs) {
                const data = docSnap.data();
                
                // 🛡️ Ignorar protegidos
                if (data.metadata?.isProtected || data.metadata?.type === 'pre-restore') continue;

                // Borrar de Storage si es externo
                if (data.isExternal) {
                    const storageRef = ref(storage, `users/${auth.currentUser.uid}/snapshots/${docSnap.id}.json`);
                    try { await deleteObject(storageRef); } catch (e) {}
                }

                batch.delete(docSnap.ref);
                count++;
            }

            if (count > 0) {
                await batch.commit();
                console.log(`🗑️ Historial limpio: ${count} snapshots de tipo ${type} eliminados`);
            }
            return count;
        } catch (error) {
            console.error(`❌ Error en borrado masivo de snapshots (${type}):`, error);
            throw error;
        }
    }
}

export default new FirebaseService();
