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
     * Carga todos los empleados de la colección. Retorna [] si no hay
     * sesión o la colección está vacía.
     * @returns {Promise<Array>}
     */
    async loadAll() {
        const ref = userEmployeesRef();
        if (!ref) return [];
        try {
            const snap = await getDocs(ref);
            const result = [];
            snap.forEach(d => {
                const data = typeof d.data === 'function' ? d.data() : d;
                if (data) result.push(data);
            });
            return result;
        } catch (e) {
            console.error('❌ EmployeeRepository.loadAll error:', e);
            return [];
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
     * @returns {Promise<{written: number}>}
     */
    async saveMany(employees, opts = {}) {
        if (!Array.isArray(employees) || employees.length === 0) {
            return { written: 0 };
        }
        if (!auth.currentUser) return { written: 0 };

        const valid = employees.filter(e => e && typeof e === 'object' && String(e.id || '').trim());
        await Promise.all(valid.map(e => this.saveOne(e, opts)));
        return { written: valid.length };
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
