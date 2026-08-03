import {
    auth,
    db,
    collection,
    doc,
    documentId,
    getDocs,
    limit as firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    startAfter
} from '../../data/firebase.js';
import { PAYROLL_CLOSURE_STATUS } from './PayrollClosure.js';
import { resolvePayrollClosureMutation } from './PayrollClosureMerge.js';

const COLLECTION = 'payrollClosures';

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

function assertClosure(closure) {
    if (!closure?.id || !closure?.fingerprint) {
        throw new TypeError('Payroll closure id and fingerprint are required');
    }
    if (![PAYROLL_CLOSURE_STATUS.CLOSED, PAYROLL_CLOSURE_STATUS.VOIDED]
        .includes(closure.status)) {
        throw new TypeError(`Unsupported payroll closure status: ${closure.status}`);
    }
}

function currentCollection() {
    if (!auth.currentUser) return null;
    return collection(db, 'users', auth.currentUser.uid, COLLECTION);
}

function currentDocument(id) {
    if (!auth.currentUser) return null;
    return doc(db, 'users', auth.currentUser.uid, COLLECTION, String(id));
}

function requireSessionRef(ref) {
    if (!ref) throw new Error('No hay una sesión activa para sincronizar la nómina');
    return ref;
}

function snapshotItems(snapshot) {
    return (snapshot?.docs || []).map(item => ({
        ...clone(item.data()),
        id: String(item.id)
    }));
}

function normalizedLimit(value, fallback = 50) {
    return Math.max(1, Math.min(100, Math.trunc(Number(value) || fallback)));
}

function pageQuery({ limit = 50, cursor = null, includeLookahead = false } = {}) {
    const constraints = [
        orderBy('closedAt', 'desc'),
        orderBy(documentId(), 'desc')
    ];
    if (cursor?.id && Number.isFinite(Number(cursor.closedAt))) {
        constraints.push(startAfter(Number(cursor.closedAt), String(cursor.id)));
    }
    const pageSize = normalizedLimit(limit);
    constraints.push(firestoreLimit(pageSize + (includeLookahead ? 1 : 0)));
    return query(requireSessionRef(currentCollection()), ...constraints);
}

export const PayrollClosureRepository = {
    async saveOne(closure) {
        assertClosure(closure);
        const incoming = clone(closure);
        const ref = requireSessionRef(currentDocument(incoming.id));
        return runTransaction(db, async transaction => {
            const snapshot = await transaction.get(ref);
            const existing = snapshot.exists() ? snapshot.data() : null;
            const mutation = resolvePayrollClosureMutation(existing, incoming);
            if (mutation.write) transaction.set(ref, mutation.value);
            return {
                written: mutation.write,
                closure: clone(mutation.value)
            };
        });
    },

    async loadPage(options = {}) {
        const pageSize = normalizedLimit(options.limit);
        const snapshot = await getDocs(pageQuery({ ...options, includeLookahead: true }));
        const loaded = snapshotItems(snapshot);
        const items = loaded.slice(0, pageSize);
        const last = items.at(-1);
        return {
            items,
            nextCursor: loaded.length > pageSize && last
                ? { closedAt: Number(last.closedAt) || 0, id: String(last.id) }
                : null
        };
    },

    subscribeRecent(onChange, { limit = 100, onError = null } = {}) {
        if (typeof onChange !== 'function') return () => {};
        const ref = pageQuery({ limit });
        return onSnapshot(ref, snapshot => {
            if (snapshot?.metadata?.hasPendingWrites) return;
            onChange(snapshotItems(snapshot));
        }, error => {
            if (typeof onError === 'function') onError(error);
            else console.error('Payroll closure subscription failed:', error);
        });
    }
};

export default PayrollClosureRepository;
