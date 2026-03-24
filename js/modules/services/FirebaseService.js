import { 
    auth, googleProvider, db,
    signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, collection, serverTimestamp, 
    query, orderBy, limit, getDocs, Timestamp 
} from '../data/firebase.js';

class FirebaseService {
    constructor() {
        this.user = null;
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
            
            await setDoc(docRef, {
                state: cleanState,
                metadata: {
                    timestamp,
                    type,
                    employeeCount: state.employees?.length || 0,
                    attendanceCount: Object.keys(state.attendance || {}).length,
                    createdAt: serverTimestamp()
                }
            });
            console.log(`📸 Snapshot (${type}) creado en Firebase`);
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
            return docSnap.exists() ? docSnap.data() : null;

        } catch (error) {
            console.error(`❌ Error recuperando snapshot ${snapshotId}:`, error);
            return null;
        }
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
     * Recupera registros de asistencia en un rango de fechas
     */
    async getAttendanceByRange(startDate, endDate) {
        if (!auth.currentUser) return {};
        
        // Nota: En una implementación ideal usaríamos una query. 
        // Por ahora, para mantener simplicidad y 0 estrés, 
        // el sistema Mirror Sync carga el bloque principal,
        // y usaremos este método para refrescar días específicos si es necesario.
        return {}; 
    }
}

export default new FirebaseService();
