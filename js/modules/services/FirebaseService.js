import { 
    auth, googleProvider, db, storage,
    signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp, 
    query, orderBy, limit, getDocs,
    ref, uploadString, getDownloadURL, onSnapshot, where, documentId, writeBatch, getBlob, deleteObject
} from '../data/firebase.js';
import { getDeviceId } from '../config/Config.js';
import { sanitizePettyCashForSnapshot } from './SnapshotSanitizer.js';
import { selectSnapshotsToPrune } from './SnapshotRetention.js';
import { SNAPSHOT_REASONS, defaultReasonForType } from './SnapshotReasons.js';
import { notifySnapshotCreated } from './SnapshotNotifier.js';
import { runMigrationIfNeeded } from './SchemaMigrationRunner.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { mergeAttendanceRecords } from '../features/attendance/AttendanceMerge.js';
import { entityInScope, peekEntityScope } from '../features/projects/ProjectContext.js';
import { PositionRepository } from './PositionRepository.js';
import { LeaderRepository } from './LeaderRepository.js';
import { Notification } from '../components/Notification.js';
import { SyncStatus } from './SyncStatus.js';
import { checkMirrorDocSize } from './MirrorSizeGuard.js';
import { createEntityUploadTracker } from './EntityUploadTracker.js';
import { supportsGzipCodec, gzipToBase64, gunzipFromBase64 } from './SnapshotCodec.js';
import { resolveSettingsWrite } from './SettingsWriteGuard.js';

// Fix crítico post-Fase-2-U1 (test de campo, 2026-07-05): saveEntities() subía
// TODAS las entidades en CADA guardado, aunque el guardado fuera por algo no
// relacionado (una nota, un día de asistencia). Con mergeRemote:true (lectura
// + escritura por entidad) eso agotó la cuota diaria de Firestore en horas.
// Un tracker POR TIPO de entidad (no uno compartido — mezclaría ids entre
// empleados/puestos/líderes) filtra a solo lo que cambió desde la última
// subida exitosa.
// storageKey por tipo: el watermark se persiste y sobrevive al reload (sin
// esto, el primer guardado tras recargar re-subía el roster entero).
const _employeeUploadTracker = createEntityUploadTracker('entityUpload.employees.v1');
const _positionUploadTracker = createEntityUploadTracker('entityUpload.positions.v1');
const _leaderUploadTracker = createEntityUploadTracker('entityUpload.leaders.v1');

class FirebaseService {
    constructor() {
        this.user = null;
        this._attendanceInitialized = false;
    }

    /**
     * Olvida los watermarks de subida de entidades (empleados/puestos/líderes).
     * Para la RESTAURACIÓN de un snapshot: el estado restaurado debe re-subirse
     * ENTERO aunque los ids ya figuren como "subidos" — sin este reset,
     * filterChanged() filtraría el roster restaurado y la nube conservaría la
     * copia que el usuario justamente quiso reemplazar.
     */
    resetEntityUploadTrackers() {
        _employeeUploadTracker.reset();
        _positionUploadTracker.reset();
        _leaderUploadTracker.reset();
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
        // 🔐 M6: el auto-backup de sessionStorage guarda el estado completo en
        // claro (salarios, préstamos, RNC). En un equipo compartido NO debe
        // sobrevivir al cierre de sesión. Lo limpiamos ANTES del signOut para
        // que se borre aunque signOut falle.
        try {
            sessionStorage.removeItem('attendance-backup');
        } catch (_) { /* sessionStorage no disponible: nada que limpiar */ }

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
     * @param {object} [opts] { skipEntities?: boolean } — SOLO lo usa
     *   _mainSyncGuards().saveMirror (PersistenceService.js): en el camino
     *   normal de guardado (_executeSave), la entrada 'entities' del outbox
     *   (sin gate de watermark, ver MainSyncStore._resolveCloudCall) YA
     *   escribe las entidades por separado — llamar a saveEntities() acá
     *   TAMBIÉN las escribiría dos veces por guardado.
     */
    async saveFullState(state, opts = {}) {
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
            // 🧼 C3: la caja chica vive per-doc en projects/cashPeriods/pettyCash.
            // Además, su estado de UI (form/_editPhoto) puede contener fotos
            // base64 que harían superar el límite de 1 MB del doc espejo.
            delete snapshotContext.pettyCash;

            const schemaVersion = state?.settings?.schemaVersion;
            const isMigratedEmployees = typeof schemaVersion === 'number' && schemaVersion >= 2;
            const isMigratedGranular = typeof schemaVersion === 'number' && schemaVersion >= 3;

            // Fase 2 U1 (fix de regresión): saveFullState vuelve a escribir las
            // entidades ella misma — U1 la había sacado por completo, rompiendo a
            // TODO llamador directo de saveFullState que no pasa por el outbox
            // (Reemplazo Total de la Nube, Subir y Reemplazar, Sync Now manual,
            // uploadToCloud, la migración de primera vez). opts.skipEntities sólo
            // lo usa _mainSyncGuards().saveMirror: en el camino normal de guardado
            // (_executeSave), el nuevo outbox kind 'entities' (sin gate de
            // watermark) YA escribe las entidades por separado — llamarlo acá
            // TAMBIÉN las escribiría dos veces por guardado.
            if (!opts.skipEntities) {
                await this.saveEntities(state.employees, state.positions, state.leaders, schemaVersion);
            }

            // ⚡ FASE 4.1 / Schema v3: Si la cuenta migró al modelo granular, el
            // doc espejo no lleva estas entidades inline — se escriben en sus
            // propias colecciones (arriba, vía saveEntities).
            if (isMigratedEmployees) {
                delete snapshotContext.employees;
            }

            if (isMigratedGranular) {
                delete snapshotContext.positions;
                delete snapshotContext.leaders;
            }

            const cleanState = JSON.parse(JSON.stringify(snapshotContext));
            const settingsMap = cleanState.settings;

            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');

            // 🛡️ R4: guard de tamaño del doc espejo. En cuentas LEGACY (<v2) los
            // empleados/posiciones/líderes siguen INLINE y una nómina grande con
            // préstamos puede superar el límite de 1 MiB de Firestore → setDoc tira
            // y el sync se pierde en silencio. Si excede el margen, NO recortamos
            // entidades (perderíamos préstamos de la única copia espejo): omitimos
            // el write inline y pedimos migración a per-doc.
            // JD#8: las cuentas migradas (>=v2) ya escribieron sus entidades en
            // subcolecciones arriba y nunca exceden inline, así que evitamos el
            // doble JSON.stringify corriendo el check SÓLO para cuentas legacy.
            if (!isMigratedEmployees) {
                const sizeCheck = checkMirrorDocSize(cleanState, schemaVersion);
                if (sizeCheck.needsMigration) {
                    console.warn(`⚠️ R4: doc espejo legacy demasiado grande (${sizeCheck.bytes} bytes, cerca del límite de 1 MiB). Se omite el write inline y se solicita migración a per-doc.`);
                    // JD#5: aunque no podamos escribir las entidades inline, sí
                    // sincronizamos settings (preferencias) — es un write chico de un
                    // único campo que no toca las entidades grandes.
                    if (settingsMap && typeof settingsMap === 'object') {
                        try {
                            // JD2#4: setDoc(merge:true), no updateDoc — updateDoc tira
                            // NOT_FOUND si el doc nunca existió (cuenta nueva cuyo primer
                            // save ya excede). setDoc(merge) lo crea y sólo toca settings.
                            await setDoc(docRef, { settings: settingsMap }, { merge: true });
                        } catch (e) {
                            console.warn('⚠️ R4: no se pudo sincronizar settings aparte:', e?.message);
                        }
                    }
                    // JD#6: un subscriber de eventBus que lance no debe romper el save.
                    try {
                        if (globalThis.eventBus) {
                            globalThis.eventBus.emit('sync:mirror-too-large', { bytes: sizeCheck.bytes });
                        }
                    } catch (e) {
                        console.warn('⚠️ subscriber de sync:mirror-too-large lanzó:', e?.message);
                    }
                    SyncStatus.markError(new Error('mirror-too-large'));
                    return; // no escribir el doc inline que excede 1 MiB ni recortar entidades
                }
            }
            // 🛡️ merge: true evita que un guardado parcial borre campos top-level
            // que este dispositivo no conoce. Combinado con el split de empleados
            // arriba, esto cierra la ruta de pérdida de datos en multi-dispositivo
            // para todo lo que vive en el empleado (préstamos, segundos empleos,
            // adelantos, etc.).
            //
            // ⚠️ settings SE INCLUYE en este write para que el snapshot lleve el
            // localUpdatedAt correcto en una sola operación (si lo excluyéramos,
            // el otro dispositivo vería un snapshot con settings/localUpdatedAt
            // viejos y el watermark dispararía un re-sync innecesario).
            await setDoc(docRef, {
                ...cleanState,
                updatedAt: serverTimestamp(),
                lastDevice: navigator.userAgent,
                lastChangedBy: getDeviceId()
            }, { merge: true });

            // 🧩 M9: tras el merge, REEMPLAZAMOS settings como mapa COMPLETO.
            // Con merge:true Firestore fusiona mapas en profundidad, así que una
            // clave de settings BORRADA localmente sobreviviría. updateDoc
            // reemplaza el campo entero, eliminando las claves que ya no existen
            // (LWW por dispositivo: settings es un objeto coherente que el
            // dispositivo siempre tiene completo en memoria).
            if (settingsMap && typeof settingsMap === 'object') {
                await updateDoc(docRef, { settings: settingsMap });
            }
            console.log(`☁️ Estado sincronizado en Firebase (schemaVersion=${schemaVersion || 'legacy'})`);
            SyncStatus.markSynced();
        } catch (error) {
            console.error('❌ Error sincronizando estado:', error);
            throw error;
        }
    }

    /**
     * Fase 2 U1: escribe empleados/puestos/líderes en sus colecciones per-doc,
     * DESACOPLADO del write del espejo. Antes vivía inline dentro de
     * saveFullState, atado al MISMO gate de watermark que protege el espejo —
     * pero cada saveOne/saveMany ya hace su propio LWW por updatedAt, así que
     * ese gate grueso sólo difería en silencio ediciones que el merge fino
     * sabe resolver bien (ver MainSyncStore.enqueueEntities).
     *
     * Fix crítico (test de campo 2026-07-05): este método se llama en CADA
     * guardado (MainSyncStore encola 'entities' junto con 'mirror' en cada
     * _executeSave), sin importar si algo relacionado a empleados/puestos/
     * líderes cambió. Sin el filtro de _employeeUploadTracker (et al.), un
     * guardado de asistencia o una nota volvía a subir TODAS las entidades
     * — con mergeRemote:true eso es lectura+escritura por entidad, y agotó
     * la cuota diaria de Firestore en horas con una cuenta de tamaño normal.
     */
    async saveEntities(employees, positions, leaders, schemaVersion) {
        const isMigratedEmployees = typeof schemaVersion === 'number' && schemaVersion >= 2;
        const isMigratedGranular = typeof schemaVersion === 'number' && schemaVersion >= 3;

        // markUploaded recibe SOLO las entidades que escribieron OK (res.saved),
        // no las candidatas: si un write falla, ese id sigue siendo candidato el
        // próximo guardado (no se pierde en silencio) y los demás no se re-suben.
        if (isMigratedEmployees) {
            const emps = _employeeUploadTracker.filterChanged(Array.isArray(employees) ? employees : []);
            if (emps.length > 0) {
                const res = await EmployeeRepository.saveMany(emps, { mergeRemote: true });
                _employeeUploadTracker.markUploaded(res.saved);
            }
        }

        if (isMigratedGranular) {
            const pos = _positionUploadTracker.filterChanged(Array.isArray(positions) ? positions : []);
            if (pos.length > 0) {
                const res = await PositionRepository.saveMany(pos, { mergeRemote: true });
                _positionUploadTracker.markUploaded(res.saved);
            }
            const leads = _leaderUploadTracker.filterChanged(Array.isArray(leaders) ? leaders : []);
            if (leads.length > 0) {
                const res = await LeaderRepository.saveMany(leads, { mergeRemote: true });
                _leaderUploadTracker.markUploaded(res.saved);
            }
        }
    }

    /**
     * Fase 2B U1: escribe el mapa de settings COMPLETO en su propio doc
     * per-registro (users/{uid}/data/settings), desacoplado del espejo —
     * mismo espíritu que saveEntities (Fase 2 U1) pero para preferencias.
     *
     * setDoc SIN merge:true (full-replace): con merge:true Firestore fusiona
     * mapas en profundidad y una clave borrada localmente sobreviviría (mismo
     * motivo por el que saveFullState hace un updateDoc({settings}) aparte,
     * ver M9). El dispositivo siempre tiene el mapa completo en memoria, así
     * que reemplazar entero es seguro y es la semántica LWW por dispositivo
     * que el diseño pide.
     * @param {object} settingsMap El mapa de settings completo del dispositivo
     * @param {object} [opts]
     * @param {boolean} [opts.force=false] Si es true, omite por completo el
     *   guard LWW (shouldWriteSettings) y el read remoto previo, y escribe
     *   incondicionalmente. Reservado para overrides explícitos del usuario
     *   (p.ej. el flujo de "reemplazar nube con mis datos") donde la decisión
     *   de pisar la nube ya fue tomada explícitamente — el guard LWW normal
     *   (JD-B1) NO debe poder silenciar esa decisión (JD Ronda 2, fix F1). El
     *   path normal (drenaje del outbox 'settings' vía MainSyncStore) sigue
     *   usando force=false, o sea sigue LWW-protegido.
     */
    async saveSettings(settingsMap, { force = false } = {}) {
        if (!auth.currentUser) return;

        try {
            const cleanSettings = JSON.parse(JSON.stringify(settingsMap || {}));
            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'settings');

            if (!force) {
                // Fase 2B JD-B1: read-compare-write LWW antes de reemplazar el doc
                // entero, mismo espíritu que EmployeeRepository.saveOne con
                // mergeRemote — sin esto, saveSettings era un setDoc a ciegas sin
                // comparar contra la nube, y un dispositivo drenando una entrada
                // STALE del outbox 'settings' (p.ej. tras estar offline) podía
                // pisar un settings más nuevo ya escrito por otro dispositivo.
                // Si el read remoto falla (offline, permisos), cae al write
                // directo — mejor un save sin comparar que perder el save del
                // usuario.
                let remoteExists = false;
                let remoteUpdatedAt = 0;
                try {
                    const remoteSnap = await getDoc(docRef);
                    remoteExists = !!(remoteSnap && typeof remoteSnap.exists === 'function' && remoteSnap.exists());
                    if (remoteExists) {
                        const remoteData = typeof remoteSnap.data === 'function' ? remoteSnap.data() : null;
                        remoteUpdatedAt = remoteData?.settings?.localUpdatedAt || 0;
                    }
                } catch (e) {
                    console.warn('⚠️ saveSettings: read remoto para comparar LWW falló, escribiendo sin comparar:', e);
                }

                const payloadUpdatedAt = cleanSettings?.localUpdatedAt || 0;
                if (!resolveSettingsWrite({ force, remoteExists, payloadUpdatedAt, remoteUpdatedAt })) {
                    console.log('☁️ saveSettings: doc remoto más nuevo que el payload — se omite el write (LWW)');
                    return;
                }
            }

            await setDoc(docRef, {
                settings: cleanSettings,
                updatedAt: serverTimestamp(),
                lastChangedBy: getDeviceId()
            }); // sin { merge: true } — reemplazo TOTAL del mapa de settings
            console.log(force
                ? '☁️ Settings sincronizados en Firebase (doc per-registro) [force: override explícito, sin guard LWW]'
                : '☁️ Settings sincronizados en Firebase (doc per-registro)');
        } catch (error) {
            console.error('❌ Error sincronizando settings:', error);
            throw error;
        }
    }

    /**
     * Fase 2B U1: lectura one-shot del doc per-registro de settings.
     * `null` significa v3/legacy (el doc todavía no existe) — el caller debe
     * tratar la copia dual-escrita en el espejo como autoritativa hasta que
     * la cuenta migre a v4.
     * @returns {Promise<{settings: object, updatedAt: *, lastChangedBy: string}|null>}
     */
    async getSettings() {
        if (!auth.currentUser) return null;

        try {
            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'settings');
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) return null;

            const data = docSnap.data();
            return {
                settings: data.settings || {},
                updatedAt: data.updatedAt,
                lastChangedBy: data.lastChangedBy
            };
        } catch (error) {
            console.error('❌ Error cargando settings desde Firebase:', error);
            throw error;
        }
    }

    /**
     * Fase 2B U2: listener en vivo sobre el doc per-registro de settings
     * (users/{uid}/data/settings) — hermano de subscribeToChanges (el
     * listener del espejo), mismo patrón de filtro de eco por lastChangedBy.
     * app.js combina el watermark de esta fuente con el del espejo vía
     * mergeCloudWatermark (SyncWatermark.js) para que ninguna de las dos
     * "atrase" a la otra.
     * @param {function} callback recibe {settings, updatedAt, lastChangedBy}
     * @returns {function} función para cancelar la suscripción
     */
    subscribeToSettings(callback) {
        if (!auth.currentUser) return () => {};

        const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'settings');
        return onSnapshot(docRef, (docSnap) => {
            if (!docSnap.exists() || docSnap.metadata.hasPendingWrites) return;

            const data = docSnap.data();

            // 🛡️ Filtro de Eco: mismo criterio que subscribeToChanges — ignorar
            // si el cambio fue hecho por este mismo dispositivo.
            if (data.lastChangedBy === getDeviceId()) {
                if (window.debug) window.debug.log('📡 Ignorando eco de settings: cambio local detectado via deviceId');
                return;
            }

            callback({
                settings: data.settings || {},
                updatedAt: data.updatedAt,
                lastChangedBy: data.lastChangedBy
            });
        }, (error) => {
            console.error('❌ Error en suscripción de settings:', error);
        });
    }

    /**
     * Marca empleados como subidos en el watermark del EntityUploadTracker.
     * Seam público para flujos que escriben empleados por FUERA de saveEntities
     * (p.ej. CloudReconcile): sin esto el watermark queda stale y el próximo
     * saveEntities re-sube todo (cuota). Recibe la lista efectivamente escrita.
     */
    markEmployeesUploaded(list) {
        _employeeUploadTracker.markUploaded(list);
    }

    /**
     * 🔄 TRUE OVERWRITE: Replace cloud data entirely with local state.
     *
     * Unlike saveFullState (which uses merge:true and leaves cloud-only
     * data intact), this method:
     *   1. Reads all cloud employee doc IDs
     *   2. Deletes any doc NOT present in the local employee list (orphans)
     *   3. Writes the main state doc WITHOUT merge:true (full overwrite)
     *   4. Saves all local employees via EmployeeRepository.saveMany
     *
     * Only use this when the user explicitly confirms they want their
     * local data to win over the cloud — it's destructive to cloud-only data.
     */
    async replaceCloudFull(state) {
        if (!auth.currentUser) return;

        try {
            console.log('🔄 replaceCloudFull: Reemplazando nube con datos locales (overwrite real)...');

            const schemaVersion = state?.settings?.schemaVersion;
            const isMigrated = typeof schemaVersion === 'number' && schemaVersion >= 2;

            // --- 1. Delete orphan cloud employee docs ---
            if (isMigrated) {
                // M1: loadAll() devuelve null ante fallo de lectura. Si no
                // pudimos leer la nube, OMITIMOS el borrado de huérfanos (no se
                // debe borrar a ciegas); el guardado de lo local sigue su curso.
                const cloudEmps = await EmployeeRepository.loadAll();
                const localIds  = new Set(
                    (Array.isArray(state.employees) ? state.employees : [])
                        .map(e => String(e.id))
                );
                const orphanIds = Array.isArray(cloudEmps)
                    ? cloudEmps.map(e => String(e.id)).filter(id => !localIds.has(id))
                    : [];
                if (!Array.isArray(cloudEmps)) {
                    console.warn('⚠️ replaceCloudFull: no se pudo leer empleados cloud; se omite el borrado de huérfanos');
                }

                if (orphanIds.length > 0) {
                    console.log(`🗑️ replaceCloudFull: Borrando ${orphanIds.length} empleado(s) huérfano(s) de la nube:`, orphanIds);
                    for (const id of orphanIds) {
                        try { await EmployeeRepository.deleteOne(id); }
                        catch (e) { console.warn(`⚠️ Error borrando doc cloud ${id}:`, e); }
                    }
                }

                // Save all local employees (no mergeRemote — local wins entirely).
                const emps = Array.isArray(state.employees) ? state.employees : [];
                if (emps.length > 0) {
                    const res = await EmployeeRepository.saveMany(emps, { mergeRemote: false });
                    // El watermark debe reflejar EXACTAMENTE lo re-subido: reset
                    // (borra sellos de ids que ya no existen) + markUploaded de
                    // lo que escribió OK. Sin esto, esta subida ocurre por fuera
                    // de saveEntities y el próximo guardado re-subiría el roster
                    // entero (cuota) o filtraría entidades legítimas.
                    _employeeUploadTracker.reset();
                    _employeeUploadTracker.markUploaded(res.saved);
                }
            }

            // --- 2. Build main doc payload (same cleanup as saveFullState) ---
            const snapshotContext = { ...state };
            delete snapshotContext.snapshots;
            delete snapshotContext.isLoadingSnapshots;
            delete snapshotContext.currentUser;
            delete snapshotContext.attendance;
            delete snapshotContext.attendanceByDate;
            // 🧼 C3: igual que en saveFullState — per-doc + riesgo de fotos base64.
            delete snapshotContext.pettyCash;
            if (isMigrated) delete snapshotContext.employees;

            const cleanState = JSON.parse(JSON.stringify(snapshotContext));

            // --- 3. Write WITHOUT merge:true (true overwrite) ---
            const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
            await setDoc(docRef, {
                ...cleanState,
                updatedAt: serverTimestamp(),
                lastDevice: navigator.userAgent,
                lastChangedBy: getDeviceId()
            }); // NO { merge: true } — this REPLACES the doc entirely

            // Fase 2B JD-A2: reescribe el doc per-registro de settings para que
            // "reemplazar nube con mis datos" no lo deje STALE.
            // Fase 2B JD Ronda 2, fix F1: force:true — override explícito de
            // "local gana", no debe poder ser silenciado por el guard LWW de
            // saveSettings (JD-B1) ante una carrera o desfasaje de reloj. El
            // drenaje normal del outbox (guards.saveSettings) sigue sin force.
            await this.saveSettings(state.settings, { force: true });

            console.log('✅ replaceCloudFull: Nube reemplazada con datos locales');
            SyncStatus.markSynced();
        } catch (error) {
            console.error('❌ Error en replaceCloudFull:', error);
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
            // 🧼 C3: el snapshot SÍ conserva los datos de caja chica (es un
            // backup completo), pero saneados: sin form/fotos base64/estado UI.
            snapshotContext.pettyCash = sanitizePettyCashForSnapshot(snapshotContext.pettyCash);
            if (snapshotContext.pettyCash === null) delete snapshotContext.pettyCash;

            const cleanState = JSON.parse(JSON.stringify(snapshotContext));

            const timestamp = Date.now();
            const docRef = doc(db, 'users', auth.currentUser.uid, 'snapshots', `snapshot_${timestamp}`);
            
            const stateString = JSON.stringify(cleanState);
            const FIRESTORE_SAFE_BYTES = 800000; // margen bajo el límite de ~1MB por doc
            const tooBigInline = stateString.length > FIRESTORE_SAFE_BYTES;
            let storageUrl = null;
            let compressedState = null;
            let isExternal = false;

            if (tooBigInline) {
                // 📦 Comprimir ANTES de recurrir a Storage (2026-07-11: el
                // bucket nunca se aprovisionó — 404 — y cada snapshot grande
                // moría tras ~2 min de reintentos). El estado es JSON
                // repetitivo: gzip+base64 lo deja muy por debajo del límite
                // de Firestore, sin depender de infraestructura extra.
                if (supportsGzipCodec()) {
                    try {
                        const b64 = await gzipToBase64(stateString);
                        if (b64.length <= FIRESTORE_SAFE_BYTES) {
                            compressedState = b64;
                            console.log(`📦 Snapshot grande (${(stateString.length / 1024).toFixed(1)} KB) comprimido a ${(b64.length / 1024).toFixed(1)} KB (inline en Firestore).`);
                        }
                    } catch (gzErr) {
                        console.warn('⚠️ Compresión del snapshot falló; se intenta Storage:', gzErr);
                    }
                }
                if (!compressedState) {
                    // Último recurso: Storage (puede no estar aprovisionado).
                    isExternal = true;
                    console.log(`📦 Snapshot grande (${(stateString.length / 1024).toFixed(1)} KB). Subiendo a Storage...`);
                    const storageRef = ref(storage, `users/${auth.currentUser.uid}/snapshots/snapshot_${timestamp}.json`);
                    await uploadString(storageRef, stateString);
                    storageUrl = await getDownloadURL(storageRef);
                }
            }

            await setDoc(docRef, {
                state: (tooBigInline || isExternal) ? null : cleanState,
                compressedState: compressedState,
                encoding: compressedState ? 'gzip-base64' : null,
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

            // 🧹 M5: retención. Tras un snapshot AUTOMÁTICO (los que se acumulan),
            // podamos los autos antiguos. Best-effort y fire-and-forget: nunca
            // debe bloquear ni romper la creación del snapshot.
            if (type === 'auto') {
                this.pruneOldSnapshots().catch(e =>
                    console.warn('⚠️ Retención de snapshots no crítica falló:', e));
            }

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
                this.createSnapshot(parentDoc, 'pre-restore', 'pre-migration-v4'),
            // Tras el saveMany de la migración (por fuera de saveEntities), se
            // marca el watermark para que el próximo saveEntities no re-suba el
            // roster entero (cuota).
            saveEmployees: async (employees) => {
                const res = await EmployeeRepository.saveMany(employees);
                _employeeUploadTracker.markUploaded(res.saved);
                return res;
            },
            savePositions: async (positions) => {
                const res = await PositionRepository.saveMany(positions);
                _positionUploadTracker.markUploaded(res.saved);
                return res;
            },
            saveLeaders: async (leaders) => {
                const res = await LeaderRepository.saveMany(leaders);
                _leaderUploadTracker.markUploaded(res.saved);
                return res;
            },
            // Fase 2B U3: siembra el doc per-registro de settings (Fase 2B U1)
            // desde la copia inline que trae el espejo. Reutiliza el mismo
            // writer que usa el guardado normal — no es infra nueva.
            saveSettings: (settings) => this.saveSettings(settings),
            markSchemaVersion: async (version) => {
                const docRef = doc(db, 'users', auth.currentUser.uid, 'data', 'current');
                // lastChangedBy garantiza que el listener filtre este eco.
                await setDoc(docRef, {
                    schemaVersion: version,
                    lastChangedBy: getDeviceId(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            },
            // Fase 2B U3: spinner de migración — mismo patrón defensivo que
            // sync:mirror-too-large (un subscriber que lance no debe romper
            // la migración).
            notifyMigrationStart: () => {
                try {
                    if (globalThis.eventBus) {
                        globalThis.eventBus.emit('sync:migration-start', {});
                    }
                } catch (e) {
                    console.warn('⚠️ subscriber de sync:migration-start lanzó:', e?.message);
                }
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
     * 📥 Carga la lista actual de cargos aplicando el modelo correcto:
     *   - Si schemaVersion >= 3: lee de users/{uid}/positions/* (per-doc).
     *   - Si schemaVersion < 3 o ausente: usa el arreglo legacy del parent.
     */
    async loadPositionsIfMigrated(parentDoc) {
        const version = parentDoc?.schemaVersion;
        if (typeof version === 'number' && version >= 3) {
            return await PositionRepository.loadAll();
        }
        return Array.isArray(parentDoc?.positions) ? parentDoc.positions : [];
    }

    /**
     * 📥 Carga la lista actual de líderes aplicando el modelo correcto:
     *   - Si schemaVersion >= 3: lee de users/{uid}/leaders/* (per-doc).
     *   - Si schemaVersion < 3 o ausente: usa el arreglo legacy del parent.
     */
    async loadLeadersIfMigrated(parentDoc) {
        const version = parentDoc?.schemaVersion;
        if (typeof version === 'number' && version >= 3) {
            return await LeaderRepository.loadAll();
        }
        return Array.isArray(parentDoc?.leaders) ? parentDoc.leaders : [];
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

            // 📦 Snapshot comprimido inline (encoding gzip-base64): la vía
            // nueva para estados grandes — sin Storage de por medio.
            if (!state && data.compressedState && data.encoding === 'gzip-base64') {
                console.log('📦 Descomprimiendo snapshot inline (gzip-base64)...');
                state = JSON.parse(await gunzipFromBase64(data.compressedState));
            } else if (data.isExternal) {
                // ⚡ Legado: snapshots externos en Storage (getBlob del SDK,
                // más robusto contra Tracking Prevention)
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
                    // Normalizar llaves. Una descarga pasiva NO cuenta como
                    // acceso del usuario; AttendanceRangeLoader marca sólo los
                    // rangos solicitados explícitamente.
                    Object.entries(records).forEach(([key, r]) => {
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
                    // Normalizar sin alterar lastAccessed (sync pasivo).
                    Object.entries(records).forEach(([key, r]) => {
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
     * @param {object} [opts] F1.5: { scope } estampa del remitente capturada al
     *   ENCOLAR (entry.scope) — evita filtrar con el scope vivo si el usuario
     *   cambió de proyecto entre el enqueue y el flush. Sin estampa, fallback
     *   al snapshot síncrono actual (peekEntityScope).
     */
    async saveDailyAttendance(dateKey, dayAttendance, opts = {}) {
        if (!auth.currentUser) return;

        try {
            // F1.5 (ADR-008 slice 2) — DUEÑO DEL PAYLOAD SALIENTE: sólo viajan
            // los registros del alcance efectivo del remitente (projectId
            // propio ?? predeterminado === scope.projectId), incluidos SUS
            // tombstones. Un registro ajeno que llegue acá (estado local
            // completo o copia stale de otro contexto) se excluye ANTES del
            // merge LWW: así jamás puede competir por frescura contra la
            // verdad remota ni restaurar estado viejo (escenario de
            // divergencia A/B con relojes desincronizados). Flag OFF o scope
            // sin resolver ⇒ entityInScope es identidad (paridad legacy).
            const _scope = opts?.scope || peekEntityScope();
            const ownScopeRecords = {};
            Object.entries(dayAttendance || {}).forEach(([key, record]) => {
                if (entityInScope(record, _scope)) ownScopeRecords[key] = record;
            });
            let cleanAttendance = JSON.parse(JSON.stringify(ownScopeRecords));
            const docRef = doc(db, 'users', auth.currentUser.uid, 'attendance', dateKey);

            // Fase 1 (U4): read-merge-write por-registro (mismo patrón que
            // EmployeeRepository.saveOne con mergeRemote). setDoc({merge:true})
            // hace deep-merge CAMPO A CAMPO dentro de `records` — un registro
            // local con menos campos que el remoto heredaba campos viejos
            // (franken-merge: horas de hoy + notas de la semana pasada en el
            // mismo registro). Leer primero y resolver con mergeAttendanceRecords
            // (LWW por updatedAt) asegura que cada clave se escriba COMPLETA de
            // un solo lado — nunca mezclada — y de paso preserva registros de
            // otros empleados/dispositivos ese mismo día que este dispositivo
            // no conoce localmente.
            try {
                const remoteSnap = await getDoc(docRef);
                if (remoteSnap && typeof remoteSnap.exists === 'function' && remoteSnap.exists()) {
                    const remoteData = typeof remoteSnap.data === 'function' ? remoteSnap.data() : null;
                    const remoteRecords = (remoteData && remoteData.records) || {};
                    cleanAttendance = mergeAttendanceRecords(cleanAttendance, remoteRecords);
                }
            } catch (e) {
                // Si el read falla (offline, permisos), fallback al fast-path.
                // Mejor un save sin merge que perder el save del usuario.
                console.warn(`⚠️ saveDailyAttendance(${dateKey}): read remoto falló, escribiendo sin merge:`, e);
            }

            // El payload FINAL tampoco lleva registros ajenos: los que el
            // merge trajo desde el doc remoto se omiten acá — {merge:true}
            // preserva byte-intacta cualquier clave de `records` no mencionada,
            // así que los proyectos extranjeros sobreviven sin re-subirlos.
            const scopedPayload = {};
            Object.entries(cleanAttendance).forEach(([key, record]) => {
                if (entityInScope(record, _scope)) scopedPayload[key] = record;
            });

            await setDoc(docRef, {
                records: scopedPayload,
                updatedAt: serverTimestamp(),
                date: dateKey,
                deviceId: getDeviceId()
            }, { merge: true });
            
            console.log(`☁️ Asistencia sincronizada: ${dateKey}`);
        } catch (error) {
            console.error(`❌ Error sincronizando asistencia del ${dateKey}:`, error);
            // 🔔 H6: re-lanzar para que el caller notifique al usuario
            // (_notifySyncError). Tragarse el error aquí dejaba el badge en
            // "Sincronizado" mientras la asistencia llevaba días sin subir.
            throw error;
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
        // F1.5 (ADR-008): el historial masivo también es payload saliente —
        // sólo sube registros del alcance efectivo actual. Flag OFF ⇒ sin
        // filtrado (paridad legacy exacta).
        const _scope = peekEntityScope();
        const entries = Object.entries(allAttendance);
        const daysToSync = {};

        // 1. Agrupar por fecha
        entries.forEach(([key, record]) => {
            if (!entityInScope(record, _scope)) return; // ajeno: no es nuestro payload
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

    /** Recupera un rango inclusivo de asistencia (o todo si no recibe límites). */
    async getAttendanceRange(startDate, endDate) {
        if (!auth.currentUser) return {};

        try {
            let attendanceRef = collection(db, 'users', auth.currentUser.uid, 'attendance');
            const constraints = [];
            if (startDate) constraints.push(where(documentId(), '>=', startDate));
            if (endDate) constraints.push(where(documentId(), '<=', endDate));
            if (constraints.length > 0) attendanceRef = query(attendanceRef, ...constraints);
            const querySnapshot = await getDocs(attendanceRef);

            const allAttendance = {};
            querySnapshot.forEach(doc => {
                const dateKey = doc.id;
                const dayData = doc.data().records || {};
                Object.entries(dayData).forEach(([key, r]) => {
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

    /** Recupera TODOS los registros; usado sólo por restore/operaciones de datos. */
    async getAllAttendance() {
        return this.getAttendanceRange();
    }

    /**
     * 🗑️ Elimina TODOS los datos de la cuenta en la nube (Auditoría C1).
     *
     * Borra:
     *   - El doc espejo users/{uid}/data/current
     *   - Las subcolecciones de entidades: employees, positions, leaders
     *   - La asistencia granular: attendance/{fecha}
     *   - Caja chica: projects, cashPeriods, pettyCash
     *
     * NO borra los snapshots: son la red de seguridad para deshacer
     * exactamente esta clase de operación destructiva. Para limpiarlos
     * existe deleteSnapshotsByType().
     *
     * Los borrados van en lotes de writeBatch (límite Firestore: 500 ops).
     *
     * @returns {Promise<{deleted: number}>} cantidad de docs eliminados
     */
    async deleteCloudData(options = {}) {
        if (!auth.currentUser) return { deleted: 0 };
        const uid = auth.currentUser.uid;

        const ALL_CLOUD_COLLECTIONS = [
            'employees', 'positions', 'leaders', 'attendance',
            'projects', 'cashPeriods', 'pettyCash'
        ];
        // Fase 0.5 (U5): borrado ACOTADO opcional — 'Subir y Reemplazar' pasa
        // sólo el dataset principal (caja chica tiene su propio sync y ese
        // flujo no la re-sube; borrarla sin reemplazo sería pérdida de datos).
        // Sin el parámetro, se borra TODO como siempre ('Borrar Nube'). El
        // filtro contra el listado completo evita que un typo del caller
        // borre colecciones fuera de este contrato (la red de seguridad de
        // respaldos incluida — ver el test "NO toca los snapshots").
        const SUBCOLLECTIONS = (Array.isArray(options.collections) && options.collections.length > 0)
            ? options.collections.filter(c => ALL_CLOUD_COLLECTIONS.includes(c))
            : ALL_CLOUD_COLLECTIONS;

        let deleted = 0;
        try {
            for (const colName of SUBCOLLECTIONS) {
                // 🚦 Invalidar el watermark de subida ANTES de borrar ESTA
                // colección (el tracker es persistente; sin esto la re-subida
                // posterior quedaría filtrada como "ya subido" contra una nube
                // vacía). Por-colección y no upfront: si el borrado aborta en
                // una excepción, las colecciones que nunca se tocaron conservan
                // su watermark. Antes y no después: si el borrado falla a
                // mitad, watermark limpio = re-subida benigna; watermark stale
                // sobre una colección a medio borrar = docs que nunca vuelven.
                if (colName === 'employees') _employeeUploadTracker.reset();
                else if (colName === 'positions') _positionUploadTracker.reset();
                else if (colName === 'leaders') _leaderUploadTracker.reset();

                const colRef = collection(db, 'users', uid, colName);
                const snap = await getDocs(colRef);

                let batch = writeBatch(db);
                let ops = 0;
                for (const docSnap of snap.docs) {
                    batch.delete(docSnap.ref);
                    ops++;
                    deleted++;
                    if (ops === 500) {
                        await batch.commit();
                        batch = writeBatch(db);
                        ops = 0;
                    }
                }
                if (ops > 0) await batch.commit();
            }

            // Doc espejo principal al final: si algo falla antes, el doc
            // sobrevive y la cuenta sigue siendo funcional/reintentable.
            // ⚠️ JD-F13: el doc espejo se borra SIEMPRE, aunque
            // options.collections acote las subcolecciones — contiene settings
            // y los arreglos inline legacy, así que un borrado parcial que lo
            // conservara dejaría datos "fantasma" del dataset viejo. Si algún
            // caller futuro necesita conservarlo, que lo pida explícito.
            await deleteDoc(doc(db, 'users', uid, 'data', 'current'));
            deleted++;

            console.log(`🗑️ deleteCloudData: ${deleted} doc(s) eliminados de la nube`);
            return { deleted };
        } catch (error) {
            console.error('❌ Error en deleteCloudData:', error);
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

    /**
     * 🧹 M5: Retención de snapshots. Conserva los N más recientes por razón
     * de los snapshots AUTOMÁTICOS y borra el resto (Firestore + Storage).
     * Nunca toca protegidos ni manuales. Best-effort: cualquier fallo se
     * reporta pero no se propaga (no debe romper la creación de snapshots).
     *
     * @param {object} [opts] { keep?: {razón: N}, defaultKeep?: number }
     * @returns {Promise<{pruned: number}>}
     */
    async pruneOldSnapshots(opts = {}) {
        if (!auth.currentUser) return { pruned: 0 };
        try {
            const snapshotsRef = collection(db, 'users', auth.currentUser.uid, 'snapshots');
            // Listamos TODOS (no sólo los 10 de listSnapshots) para decidir bien.
            const qs = await getDocs(query(snapshotsRef, orderBy('metadata.timestamp', 'desc')));
            const all = qs.docs.map(d => {
                const meta = d.data()?.metadata || {};
                return {
                    id: d.id,
                    type: meta.type,
                    reason: meta.reason,
                    timestamp: meta.timestamp,
                    isProtected: !!meta.isProtected
                };
            });

            const ids = selectSnapshotsToPrune(all, opts);
            let pruned = 0;
            for (const id of ids) {
                try {
                    await this.deleteSnapshot(id);
                    pruned++;
                } catch (e) {
                    console.warn(`⚠️ Retención: no se pudo borrar snapshot ${id}:`, e);
                }
            }
            if (pruned > 0) console.log(`🧹 Retención de snapshots: ${pruned} automático(s) antiguo(s) eliminados`);
            return { pruned };
        } catch (error) {
            console.warn('⚠️ pruneOldSnapshots falló (no crítico):', error);
            return { pruned: 0 };
        }
    }
}

export default new FirebaseService();
