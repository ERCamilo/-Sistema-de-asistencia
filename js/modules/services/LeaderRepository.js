/**
 * 👥 LeaderRepository.js
 * Capa de acceso a la colección de líderes (Fase 4.1 / Schema v3):
 *   users/{uid}/leaders/{leaderId}
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

const COLLECTION = 'leaders';

function userLeadersRef() {
    if (!auth.currentUser) return null;
    return collection(db, 'users', auth.currentUser.uid, COLLECTION);
}

function leaderDocRef(leaderId) {
    if (!auth.currentUser) return null;
    if (!leaderId) return null;
    return doc(db, 'users', auth.currentUser.uid, COLLECTION, String(leaderId));
}

export const LeaderRepository = {

    /**
     * Carga todos los líderes de la colección.
     * @returns {Promise<Array>}
     */
    async loadAll() {
        const ref = userLeadersRef();
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
            console.error('❌ LeaderRepository.loadAll error:', e);
            return [];
        }
    },

    /**
     * Guarda (upsert) un líder en su propio documento.
     * @param {object} leader
     * @param {object} [opts]
     * @param {boolean} [opts.mergeRemote] Reconciliación básica LWW por updatedAt.
     */
    async saveOne(leader, opts = {}) {
        if (!leader || typeof leader !== 'object') return;
        const id = String(leader.id || '').trim();
        if (!id) return;

        const ref = leaderDocRef(id);
        if (!ref) return;

        let payload = { ...leader };
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        if (opts.mergeRemote) {
            try {
                const snap = await getDoc(ref);
                if (snap && typeof snap.exists === 'function' && snap.exists()) {
                    const remote = typeof snap.data === 'function' ? snap.data() : null;
                    if (remote && typeof remote === 'object') {
                        // LWW simple para líderes planos: gana el updatedAt mayor
                        const remoteTs = remote.updatedAt || 0;
                        const localTs = payload.updatedAt || 0;
                        if (remoteTs > localTs) {
                            payload = { ...remote, ...payload, updatedAt: remoteTs };
                        }
                    }
                }
            } catch (e) {
                console.warn(`⚠️ LeaderRepository.saveOne(${id}): merge remoto falló, escribiendo sin merge:`, e);
            }
        }

        try {
            await setDoc(ref, payload, { merge: true });
            SyncStatus.markSynced();
        } catch (e) {
            console.error(`❌ LeaderRepository.saveOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Guarda múltiples líderes en paralelo.
     * @param {Array<object>} leaders
     * @param {object} [opts]
     */
    async saveMany(leaders, opts = {}) {
        if (!Array.isArray(leaders) || leaders.length === 0) {
            return { written: 0 };
        }
        if (!auth.currentUser) return { written: 0 };

        const valid = leaders.filter(l => l && typeof l === 'object' && String(l.id || '').trim());
        await Promise.all(valid.map(l => this.saveOne(l, opts)));
        return { written: valid.length };
    },

    /**
     * Borra un líder.
     */
    async deleteOne(leaderId) {
        const id = String(leaderId || '').trim();
        const ref = leaderDocRef(id);
        if (!ref) return;
        try {
            await deleteDoc(ref);
        } catch (e) {
            console.error(`❌ LeaderRepository.deleteOne(${id}) error:`, e);
            throw e;
        }
    },

    /**
     * Suscribirse a cambios en la colección.
     */
    subscribe(onChange) {
        const ref = userLeadersRef();
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
            console.error('❌ LeaderRepository.subscribe error:', e);
            return () => {};
        }
    }
};

export default LeaderRepository;
