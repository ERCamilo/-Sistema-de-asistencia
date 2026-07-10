/**
 * 👤 EmployeeRepository.js
 * Capa de acceso a la nueva colección de empleados (Fase 4.1):
 *   users/{uid}/employees/{employeeId}
 *
 * Reemplaza la escritura del arreglo gigante `data/current.employees[]`
 * por escrituras granulares — un documento por empleado. Dos dispositivos
 * editando empleados distintos dejan de pisarse.
 *
 * Esta capa NO conoce el state global. Es una API pura de IO contra
 * Firestore. Quien la invoca se encarga de mantener consistencia con
 * el estado en memoria, IndexedDB, etc.
 */

import {
    auth, db,
    doc, setDoc, deleteDoc, collection, getDocs, onSnapshot, getDoc
} from '../data/firebase.js';
import { mergeEmployees } from './EmployeeMerge.js';
import { SyncStatus } from './SyncStatus.js';

const COLLECTION = 'employees';

/**
 * Devuelve la referencia a la colección employees del usuario actual,
 * o null si no hay sesión.
 */
function userEmployeesRef() {
    if (!auth.currentUser) return null;
    return collection(db, 'users', auth.currentUser.uid, COLLECTION);
}

/**
 * Devuelve la referencia a un doc específico del empleado, o null si no
 * hay sesión / id inválido.
 */
function employeeDocRef(employeeId) {
    if (!auth.currentUser) return null;
    if (!employeeId) return null;
    return doc(db, 'users', auth.currentUser.uid, COLLECTION, String(employeeId));
}

export const EmployeeRepository = {

    /**
     * Carga todos los empleados de la colección.
     * @returns {Promise<Array|null>} [] si no hay sesión o la colección está
     *   vacía; **null si la lectura FALLA** (M1: distinguible de "vacío" para
     *   que el caller no blanquee el estado con un error transitorio).
     */
    async loadAll(opts = {}) {
        const ref = userEmployeesRef();
        if (!ref) return [];
        // 🪦 Por defecto se filtran los tombstoneados (deletedAt): así la carga
        // inicial y el wizard de duplicados ven state.employees limpio, sin que
        // cada consumidor tenga que recordar filtrar. includeDeleted:true los
        // trae (para la compactación de tombstones vencidos). subscribe() NO
        // usa esto: entrega todo y mergeIncomingEmployees hace su propio filtro.
        const includeDeleted = opts.includeDeleted === true;
        try {
            const snap = await getDocs(ref);
            const result = [];
            snap.forEach(d => {
                const data = typeof d.data === 'function' ? d.data() : d;
                if (!data) return;
                if (!includeDeleted && Number.isFinite(data.deletedAt)) return;
                result.push(data);
            });
            return result;
        } catch (e) {
            console.error('❌ EmployeeRepository.loadAll error:', e);
            return null; // M1: null = fallo de lectura, NO "colección vacía"
        }
    },

    /**
     * Guarda (upsert) un empleado en su propio documento.
     * No-op si no hay sesión o falta id.
     *
     * @param {object} employee
     * @param {object} [opts]
     * @param {boolean} [opts.mergeRemote] (Fase 2.2) Lee primero la versión
     *   remota y fusiona con la local antes de escribir, para no perder
     *   préstamos / adelantos / etc. cuando ambos lados editaron offline.
     *   Si el read falla, cae al fast-path (write directo).
     * @returns {Promise<void>}
     */
    async saveOne(employee, opts = {}) {
        if (!employee || typeof employee !== 'object') return;
        const id = String(employee.id || '').trim();
        if (!id) return;

        const ref = employeeDocRef(id);
        if (!ref) return;

        // Garantizar updatedAt. Si el caller ya pasó uno (ej. en migración),
        // respetarlo.
        let payload = { ...employee };
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        // (Fase 2.2) Read-merge-write: si lo pidieron y hay versión remota,
        // fusionamos por id en los arreglos para no perder préstamos / pagos
        // que el otro dispositivo agregó offline.
        if (opts.mergeRemote) {
            try {
                const snap = await getDoc(ref);
                if (snap && typeof snap.exists === 'function' && snap.exists()) {
                    const remote = typeof snap.data === 'function' ? snap.data() : null;
                    if (remote && typeof remote === 'object') {
                        payload = mergeEmployees(remote, payload);
                    }
                }
            } catch (e) {
                // Si el read falla (offline, permisos), fallback al fast-path.
                // Mejor un save sin merge que perder el save del usuario.
                console.warn(`⚠️ EmployeeRepository.saveOne(${id}): read remoto falló, escribiendo sin merge:`, e);
            }
        }

        try {
            await setDoc(ref, payload, { merge: true });
            SyncStatus.markSynced();
        } catch (e) {
            console.error(`❌ EmployeeRepository.saveOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Guarda múltiples empleados en paralelo. Cuenta los efectivamente
     * escritos (los inválidos se saltan).
     *
     * @param {Array<object>} employees
     * @param {object} [opts]
     * @param {boolean} [opts.mergeRemote] Propaga el merge-por-id a cada
     *   saveOne. Útil para el camino de guardado normal (Fase 2.2).
     *   Por defecto false porque saveMany se usa también en la
     *   migración inicial donde no hay versión remota.
     * @returns {Promise<{written: number, saved: Array<object>}>} `saved` son
     *   las entidades cuyo write resolvió OK — el caller marca como subidas
     *   SOLO esas. allSettled (no Promise.all): si un write falla, los demás
     *   ya escritos no deben perder su crédito de "subido" ni re-subirse todos.
     */
    async saveMany(employees, opts = {}) {
        if (!Array.isArray(employees) || employees.length === 0) {
            return { written: 0, saved: [] };
        }
        if (!auth.currentUser) return { written: 0, saved: [] };

        const valid = employees.filter(e => e && typeof e === 'object' && String(e.id || '').trim());
        const results = await Promise.allSettled(valid.map(e => this.saveOne(e, opts)));
        const saved = valid.filter((_, i) => results[i].status === 'fulfilled');
        return { written: saved.length, saved };
    },

    /**
     * 🪦 Marca el empleado como eliminado (soft-delete / lápida) en vez de
     * borrar el doc. A diferencia de deleteOne (hard), el tombstone SOBREVIVE
     * al multi-dispositivo: un dispositivo que estaba offline al borrar recibe
     * el doc con deletedAt y lo saca de su vista, en vez de re-subir el
     * empleado vivo y resucitarlo. merge:true conserva name/loans/etc por si
     * hiciera falta un undelete. updatedAt = deletedAt para que el LWW del
     * merge propague el borrado (una edición POSTERIOR lo revive).
     */
    async tombstoneOne(employeeId, deletedAt) {
        const id = String(employeeId || '').trim();
        const ref = employeeDocRef(id);
        if (!ref) return;
        const ts = Number.isFinite(deletedAt) ? deletedAt : Date.now();
        try {
            await setDoc(ref, { deletedAt: ts, updatedAt: ts, active: false }, { merge: true });
            SyncStatus.markSynced();
        } catch (e) {
            console.error(`❌ EmployeeRepository.tombstoneOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Borra el documento de un empleado.
     * No-op si no hay sesión o falta id.
     */
    async deleteOne(employeeId) {
        const id = String(employeeId || '').trim();
        const ref = employeeDocRef(id);
        if (!ref) return;
        try {
            await deleteDoc(ref);
        } catch (e) {
            console.error(`❌ EmployeeRepository.deleteOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Suscribirse a cambios en la colección de empleados. El callback
     * recibe la lista completa cada vez que algo cambia. Retorna una
     * función para cancelar.
     * @param {(employees: Array<object>) => void} onChange
     * @returns {() => void} unsubscribe
     */
    subscribe(onChange) {
        const ref = userEmployeesRef();
        if (!ref) return () => {};
        try {
            return onSnapshot(ref, (snap) => {
                const list = [];
                if (snap && typeof snap.forEach === 'function') {
                    snap.forEach(d => {
                        const data = typeof d.data === 'function' ? d.data() : d;
                        if (data) list.push(data);
                    });
                }
                try { onChange(list); } catch (e) { console.error('subscribe callback error:', e); }
            });
        } catch (e) {
            console.error('❌ EmployeeRepository.subscribe error:', e);
            return () => {};
        }
    }
};

export default EmployeeRepository;
