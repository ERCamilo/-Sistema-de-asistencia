/**
 * 💼 PositionRepository.js
 * Capa de acceso a la colección de cargos (Fase 4.1 / Schema v3):
 *   users/{uid}/positions/{positionId}
 *
 * Esta capa NO conoce el state global. Es una API pura de IO contra
 * Firestore. Quien la invoca se encarga de mantener consistencia con
 * el estado en memoria, IndexedDB, etc.
 */

import {
    auth, db,
    doc, setDoc, deleteDoc, collection, getDocs, onSnapshot, getDoc
} from '../data/firebase.js';
import { SyncStatus } from './SyncStatus.js';

const COLLECTION = 'positions';

function userPositionsRef() {
    if (!auth.currentUser) return null;
    return collection(db, 'users', auth.currentUser.uid, COLLECTION);
}

function positionDocRef(positionId) {
    if (!auth.currentUser) return null;
    if (!positionId) return null;
    return doc(db, 'users', auth.currentUser.uid, COLLECTION, String(positionId));
}

export const PositionRepository = {

    /**
     * Carga todos los cargos de la colección.
     * @returns {Promise<Array>}
     */
    async loadAll() {
        const ref = userPositionsRef();
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
            console.error('❌ PositionRepository.loadAll error:', e);
            return null; // M1: null = fallo de lectura, NO "colección vacía"
        }
    },

    /**
     * Guarda (upsert) un cargo en su propio documento.
     * @param {object} position
     * @param {object} [opts]
     * @param {boolean} [opts.mergeRemote] Reconciliación básica LWW por updatedAt.
     */
    async saveOne(position, opts = {}) {
        if (!position || typeof position !== 'object') return;
        const id = String(position.id || '').trim();
        if (!id) return;

        const ref = positionDocRef(id);
        if (!ref) return;

        let payload = { ...position };
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        if (opts.mergeRemote) {
            try {
                const snap = await getDoc(ref);
                if (snap && typeof snap.exists === 'function' && snap.exists()) {
                    const remote = typeof snap.data === 'function' ? snap.data() : null;
                    if (remote && typeof remote === 'object') {
                        // LWW simple para cargos planos: gana el updatedAt mayor
                        const remoteTs = remote.updatedAt || 0;
                        const localTs = payload.updatedAt || 0;
                        if (remoteTs > localTs) {
                            payload = { ...remote, ...payload, updatedAt: remoteTs };
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ PositionRepository.saveOne(${id}): merge remoto falló, escribiendo sin merge:`, e);
            }
        }

        try {
            await setDoc(ref, payload, { merge: true });
            SyncStatus.markSynced();
        } catch (e) {
            console.error(`❌ PositionRepository.saveOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Guarda múltiples cargos en paralelo.
     * @param {Array<object>} positions
     * @param {object} [opts]
     */
    async saveMany(positions, opts = {}) {
        if (!Array.isArray(positions) || positions.length === 0) {
            return { written: 0 };
        }
        if (!auth.currentUser) return { written: 0 };

        const valid = positions.filter(p => p && typeof p === 'object' && String(p.id || '').trim());
        await Promise.all(valid.map(p => this.saveOne(p, opts)));
        return { written: valid.length };
    },

    /**
     * Borra un cargo.
     */
    async deleteOne(positionId) {
        const id = String(positionId || '').trim();
        const ref = positionDocRef(id);
        if (!ref) return;
        try {
            await deleteDoc(ref);
        } catch (e) {
            console.error(`❌ PositionRepository.deleteOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Suscribirse a cambios en la colección.
     */
    subscribe(onChange) {
        const ref = userPositionsRef();
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
            console.error('❌ PositionRepository.subscribe error:', e);
            return () => {};
        }
    }
};

export default PositionRepository;
