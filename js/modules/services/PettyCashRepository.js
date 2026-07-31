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
    doc, setDoc, deleteDoc, collection, getDocs, onSnapshot, query, where
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

    function snapshotToList(snap) {
        const list = [];
        if (snap && typeof snap.forEach === 'function') {
            snap.forEach(d => {
                const data = typeof d.data === 'function' ? d.data() : d;
                if (data) list.push(data);
            });
        }
        return list;
    }

    async function loadRef(ref, source) {
        if (!ref) return [];
        const startedAt = Date.now();
        PettyCashPersistenceMetrics.record({
            operation: 'read', collection: metricCollection, stage: 'cloud-attempt', source
        });
        try {
            const snap = await getDocs(ref);
            const result = snapshotToList(snap);
            PettyCashPersistenceMetrics.record({
                operation: 'read', collection: metricCollection, stage: 'cloud-success',
                source, count: Math.max(1, result.length), durationMs: Date.now() - startedAt
            });
            return result;
        } catch (e) {
            PettyCashPersistenceMetrics.record({
                operation: 'read', collection: metricCollection, stage: 'cloud-failure',
                source, status: 'error', durationMs: Date.now() - startedAt
            });
            console.error(`❌ PettyCashRepository[${COLLECTION}] read error:`, e);
            return [];
        }
    }

    function subscribeRef(ref, onChange, source = 'live-sync') {
        if (!ref) return () => {};
        PettyCashPersistenceMetrics.record({
            operation: 'subscribe', collection: metricCollection, stage: 'requested', source
        });
        try {
            return onSnapshot(ref, (snap) => {
                const list = snapshotToList(snap);
                PettyCashPersistenceMetrics.record({
                    operation: 'read', collection: metricCollection, stage: 'snapshot',
                    source, count: Math.max(1, list.length)
                });
                try { onChange(list); } catch (e) { console.error('subscribe callback error:', e); }
            });
        } catch (e) {
            console.error(`❌ PettyCashRepository[${COLLECTION}].subscribe error:`, e);
            return () => {};
        }
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
            return loadRef(ref, 'startup');
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
            return subscribeRef(ref, onChange);
        },

        async loadWhere(field, value, source = 'history') {
            const ref = colRef();
            if (!ref) return [];
            return loadRef(query(ref, where(field, '==', value)), source);
        },

        subscribeWhere(field, values, onChange) {
            const ref = colRef();
            const uniqueValues = [...new Set(
                (Array.isArray(values) ? values : [values])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )];
            if (!ref || uniqueValues.length === 0) return () => {};

            const chunks = [];
            for (let index = 0; index < uniqueValues.length; index += 30) {
                chunks.push(uniqueValues.slice(index, index + 30));
            }
            const results = new Map();
            const initialized = new Set();
            const unsubscribers = chunks.map((chunk, index) => {
                const constraint = chunk.length === 1
                    ? where(field, '==', chunk[0])
                    : where(field, 'in', chunk);
                return subscribeRef(query(ref, constraint), (items) => {
                    results.set(index, items);
                    initialized.add(index);
                    if (initialized.size !== chunks.length) return;
                    const combined = new Map();
                    results.forEach((chunkItems) => {
                        chunkItems.forEach((item) => {
                            if (item?.id) combined.set(String(item.id), item);
                        });
                    });
                    onChange([...combined.values()]);
                });
            });
            return () => unsubscribers.forEach((unsubscribe) => {
                try { unsubscribe(); } catch { /* noop */ }
            });
        }
    };
}

const movements = makeRepo('pettyCash', 'movements');
movements.loadForPeriod = (periodId) =>
    movements.loadWhere('periodId', String(periodId || '').trim(), 'history');
movements.subscribeForPeriods = (periodIds, onChange) =>
    movements.subscribeWhere('periodId', periodIds, onChange);

export const PettyCashRepository = {
    projects: makeRepo('projects', 'projects'),
    periods: makeRepo('cashPeriods', 'periods'),
    movements
};

export default PettyCashRepository;
