import { 
    auth, googleProvider, db, storage,
    signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, 
    query, orderBy, limit, getDocs, Timestamp,
    ref, uploadString, getDownloadURL, onSnapshot, where, documentId
} from '../data/firebase.js';

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
            
            const cleanState = JSON.parse(JSON.stringify(snapshotContext));


            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
            await setDoc(docRef, {
                ...cleanState,
                updatedAt: serverTimestamp(),
                lastDevice: navigator.userAgent
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
                    size: stateString.length,
                    employeeCount: state.employees?.length || 0,
                    attendanceCount: Object.keys(state.attendance || {}).length,
                    createdAt: serverTimestamp()
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
                callback(docSnap.data());
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
                const dateKey = change.doc.id;
                const records = change.doc.data().records || {};

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
                date: dateKey
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

        console.log('🚀 Iniciando sincronización masiva de historial...');
        const entries = Object.entries(allAttendance);
        const daysToSync = {};

        // 1. Agrupar por fecha para reducir escrituras
        entries.forEach(([key, record]) => {
            const dateKey = record.date || key.split('-').slice(-3).join('-');
            if (!daysToSync[dateKey]) daysToSync[dateKey] = {};
            daysToSync[dateKey][key] = record;
        });

        const totalDays = Object.keys(daysToSync).length;
        let count = 0;

        // 2. Subir cada día
        for (const [dateKey, dayRecords] of Object.entries(daysToSync)) {
            await this.saveDailyAttendance(dateKey, dayRecords);
            count++;
            if (count % 5 === 0) console.log(`⏳ Progresando sincronización: ${count}/${totalDays} días`);
        }

        console.log('✅ Sincronización masiva completada');
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
     * Elimina permanentemente todos los datos del usuario en la nube
     */
    async deleteCloudData() {
        if (!auth.currentUser) return;

        try {
            // 1. Eliminar documento 'current'
            const currentDocRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
            await deleteDoc(currentDocRef);

            // 2. Eliminar toda la colección de attendance
            // Nota: En Firestore cliente no hay 'deleteCollection'. Hay que iterar.
            const attendanceRef = collection(db, 'users', auth.currentUser.uid, 'attendance');
            const attDocs = await getDocs(attendanceRef);
            for (const d of attDocs.docs) {
                await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'attendance', d.id));
            }

            // 3. Opcional: Eliminar snapshots (backups)
            const snapshotsRef = collection(db, 'users', auth.currentUser.uid, 'snapshots');
            const snapDocs = await getDocs(snapshotsRef);
            for (const d of snapDocs.docs) {
                await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'snapshots', d.id));
            }

            console.log('🗑️ Datos en la nube eliminados correctamente');
            return true;
        } catch (error) {
            console.error('❌ Error al eliminar datos en la nube:', error);
            throw error;
        }
    }
}

export default new FirebaseService();
