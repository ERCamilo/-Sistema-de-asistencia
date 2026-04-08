import { 
    auth, googleProvider, db, storage,
    signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, 
    query, orderBy, limit, getDocs,
    ref, uploadString, getDownloadURL, onSnapshot, where, documentId, writeBatch
} from '../data/firebase.js';
import { getDeviceId } from '../config/Config.js';

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
            
            const cleanState = JSON.parse(JSON.stringify(snapshotContext));


            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
            await setDoc(docRef, {
                ...cleanState,
                updatedAt: serverTimestamp(),
                lastDevice: navigator.userAgent,
                lastChangedBy: getDeviceId()
            });
            console.log('☁️ Estado sincronizado en Firebase');
        } catch (error) {
            console.error('❌ Error sincronizando estado:', error);
            throw error;
        }
    }

    /**
     * Crea un punto de restauración (Snapshot) en la colección de backups
     */
    async createSnapshot(state, type = 'auto') {
        if (!auth.currentUser) return;

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
                    isProtected: type === 'pre-restore',
                    size: stateString.length,
                    employeeCount: state.employees?.length || 0,
                    attendanceCount: Object.keys(state.attendance || {}).length,
                    createdAt: serverTimestamp(),
                    lastChangedBy: getDeviceId()
                }
            });
            console.log(`📸 Snapshot (${type}) creado en Firebase ${isExternal ? '(en Storage)' : '(en Firestore)'}`);
            return docRef.id;
        } catch (error) {
            console.error('❌ Error creando snapshot:', error);
            throw error;
        }
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
            
            if (data.isExternal && data.storageUrl) {
                console.log('📦 Recuperando snapshot grande desde Storage...');
                const response = await fetch(data.storageUrl);
                return await response.json();
            }
            
            return data.state;
        } catch (error) {
            console.error(`❌ Error recuperando snapshot ${snapshotId}:`, error);
            return null;
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
                    const records = doc.data().records || {};
                    // Inyectar timestamp de acceso para LRU
                    Object.values(records).forEach(r => r.lastAccessed = Date.now());
                    Object.assign(allAttendance, records);
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
                    // Inyectar timestamp de acceso para LRU
                    Object.values(records).forEach(r => r.lastAccessed = Date.now());
                    if (onModified) onModified(dateKey, records);
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
        const batch = writeBatch(db);
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
        }

        // 3. Comprometer el Batch
        if (operationsCount > 0) {
            console.log(`⏳ Enviando lote de ${operationsCount} días a Firestore...`);
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
                const dayData = doc.data().records || {};
                // Inyectar timestamp de acceso para LRU
                Object.values(dayData).forEach(r => r.lastAccessed = Date.now());
                Object.assign(allAttendance, dayData);
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
