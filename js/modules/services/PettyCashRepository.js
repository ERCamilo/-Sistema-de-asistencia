/**
 * 💵 PettyCashRepository.js — Caja chica (Fase 1, Paso 2)
 *
 * Capa de acceso per-doc para el modelo de 3 niveles:
 *   users/{uid}/projects/{projectId}     → sub-repo .projects
 *   users/{uid}/cashPeriods/{periodId}   → sub-repo .periods
 *   users/{uid}/pettyCash/{txId}         → sub-repo .movements
 *
 * Mismo patrón que EmployeeRepository: API pura de IO contra Firestore,
 * sin conocer el state global. Cada doc es plano (los niveles se enlazan
 * por id: period.projectId, movement.periodId), así que NO hay arreglos
 * anidados → no se necesita merge-por-id; basta setDoc con { merge:true }.
 */

import {
    auth, db,
    doc, setDoc, deleteDoc, collection, getDocs, onSnapshot
} from '../data/firebase.js';
import { SyncStatus } from './SyncStatus.js';
import { PettyCashPersistenceMetrics } from '../features/pettycash/PettyCashPersistenceMetrics.js';

/**
 * Crea un sub-repositorio per-doc para una colección dada.
 * @param {string} COLLECTION nombre de la subcolección bajo users/{uid}
 */
function makeRepo(COLLECTION, metricCollection) {

    function colRef() {
        if (!auth.currentUser) return null;
        return collection(db, 'users', auth.currentUser.uid, COLLECTION);
    }

    function docRef(id) {
        if (!auth.currentUser) return null;
        if (!id) return null;
        return doc(db, 'users', auth.currentUser.uid, COLLECTION, String(id));
    }

    return {
        /** Carga todos los docs de la colección. [] si no hay sesión. */
        async loadAll() {
            const ref = colRef();
            if (!ref) {
                PettyCashPersistenceMetrics.record({
                    operation: 'read', collection: metricCollection, stage: 'skipped',
                    source: 'startup', status: 'skipped'
                });
                return [];
            }
            const startedAt = Date.now();
            PettyCashPersistenceMetrics.record({
                operation: 'read', collection: metricCollection, stage: 'cloud-attempt',
                source: 'startup'
            });
            try {
                const snap = await getDocs(ref);
                const result = [];
                snap.forEach(d => {
                    const data = typeof d.data === 'function' ? d.data() : d;
                    if (data) result.push(data);
                });
                PettyCashPersistenceMetrics.record({
                    operation: 'read', collection: metricCollection, stage: 'cloud-success',
                    source: 'startup', count: Math.max(1, result.length),
                    durationMs: Date.now() - startedAt
                });
                return result;
            } catch (e) {
                PettyCashPersistenceMetrics.record({
                    operation: 'read', collection: metricCollection, stage: 'cloud-failure',
                    source: 'startup', status: 'error', durationMs: Date.now() - startedAt
                });
                console.error(`❌ PettyCashRepository[${COLLECTION}].loadAll error:`, e);
                return [];
            }
        },

        /** Upsert de un doc en su propio documento. No-op sin sesión o sin id. */
        async saveOne(item, context = {}) {
            if (!item || typeof item !== 'object') return;
            const id = String(item.id || '').trim();
            if (!id) return;
            const ref = docRef(id);
            if (!ref) return;

            const payload = { ...item };
            if (typeof payload.updatedAt !== 'number') {
                payload.updatedAt = Date.now();
            }
            const source = context.source || 'unspecified';
            const startedAt = Date.now();
            PettyCashPersistenceMetrics.record({
                operation: 'save', collection: metricCollection, stage: 'cloud-attempt', source
            });
            try {
                await setDoc(ref, payload, { merge: true });
                PettyCashPersistenceMetrics.record({
                    operation: 'save', collection: metricCollection, stage: 'cloud-success', source,
                    durationMs: Date.now() - startedAt
                });
                SyncStatus.markSynced();
            } catch (e) {
                PettyCashPersistenceMetrics.record({
                    operation: 'save', collection: metricCollection, stage: 'cloud-failure', source,
                    status: 'error', durationMs: Date.now() - startedAt
                });
                console.error(`❌ PettyCashRepository[${COLLECTION}].saveOne(${id}) error:`, e);
                throw e;
            }
        },

        /** Guarda múltiples docs en paralelo. Salta inválidos. */
        async saveMany(items) {
            if (!Array.isArray(items) || items.length === 0) return { written: 0 };
            if (!auth.currentUser) return { written: 0 };
            const valid = items.filter(i => i && typeof i === 'object' && String(i.id || '').trim());
            await Promise.all(valid.map(i => this.saveOne(i)));
            return { written: valid.length };
        },

        /** Borra el doc por id. No-op sin sesión o sin id. */
        async deleteOne(id, context = {}) {
            const clean = String(id || '').trim();
            const ref = docRef(clean);
            if (!ref) return;
            const source = context.source || 'unspecified';
            const startedAt = Date.now();
            PettyCashPersistenceMetrics.record({
                operation: 'delete', collection: metricCollection, stage: 'cloud-attempt', source
            });
            try {
                await deleteDoc(ref);
                PettyCashPersistenceMetrics.record({
                    operation: 'delete', collection: metricCollection, stage: 'cloud-success', source,
                    durationMs: Date.now() - startedAt
                });
            } catch (e) {
                PettyCashPersistenceMetrics.record({
                    operation: 'delete', collection: metricCollection, stage: 'cloud-failure', source,
                    status: 'error', durationMs: Date.now() - startedAt
                });
                console.error(`❌ PettyCashRepository[${COLLECTION}].deleteOne(${clean}) error:`, e);
                throw e;
            }
        },

        /** Suscripción onSnapshot. Devuelve unsubscribe. */
        subscribe(onChange) {
            const ref = colRef();
            if (!ref) return () => {};
            PettyCashPersistenceMetrics.record({
                operation: 'subscribe', collection: metricCollection, stage: 'requested',
                source: 'live-sync'
            });
            try {
                return onSnapshot(ref, (snap) => {
                    const list = [];
                    if (snap && typeof snap.forEach === 'function') {
                        snap.forEach(d => {
                            const data = typeof d.data === 'function' ? d.data() : d;
                            if (data) list.push(data);
                        });
                    }
                    PettyCashPersistenceMetrics.record({
                        operation: 'read', collection: metricCollection, stage: 'snapshot',
                        source: 'live-sync', count: Math.max(1, list.length)
                    });
                    try { onChange(list); } catch (e) { console.error('subscribe callback error:', e); }
                });
            } catch (e) {
                console.error(`❌ PettyCashRepository[${COLLECTION}].subscribe error:`, e);
                return () => {};
            }
        }
    };
}

export const PettyCashRepository = {
    projects: makeRepo('projects', 'projects'),
    periods: makeRepo('cashPeriods', 'periods'),
    movements: makeRepo('pettyCash', 'movements')
};

export default PettyCashRepository;
