import {
    auth,
    db,
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    limit as firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    startAfter,
    where
} from '../../data/firebase.js';
import { PAYROLL_CLOSURE_STATUS } from './PayrollClosure.js';
import { resolvePayrollClosureMutation } from './PayrollClosureMerge.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';

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

function normalizedLimit(value, fallback = 10) {
    return Math.max(1, Math.min(10, Math.trunc(Number(value) || fallback)));
}

function closureSummary(closure = {}) {
    const source = clone(closure);
    return {
        schemaVersion: source.schemaVersion,
        id: source.id,
        fingerprint: source.fingerprint,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        periodSource: source.periodSource,
        status: source.status,
        closedAt: source.closedAt,
        closedBy: source.closedBy,
        updatedAt: source.updatedAt,
        totals: source.totals,
        employeeCount: source.employeeCount,
        undoUntil: source.undoUntil,
        supersedesId: source.supersedesId,
        voidedAt: source.voidedAt,
        voidedBy: source.voidedBy,
        voidReason: source.voidReason
    };
}

function pageQuery({ limit = 10, cursor = null, status = null } = {}) {
    const constraints = [];
    if (status) constraints.push(where('status', '==', String(status)));
    constraints.push(
        orderBy('closedAt', 'desc'),
        orderBy(documentId(), 'desc')
    );
    if (cursor?.id && Number.isFinite(Number(cursor.closedAt))) {
        constraints.push(startAfter(Number(cursor.closedAt), String(cursor.id)));
    }
    const pageSize = normalizedLimit(limit);
    constraints.push(firestoreLimit(pageSize));
    return query(requireSessionRef(currentCollection()), ...constraints);
}

export const PayrollClosureRepository = {
    async saveOne(closure) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.saveOne');
        assertClosure(closure);
        assertPayrollClosureSize(closure);
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
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.loadPage');
        const pageSize = normalizedLimit(options.limit);
        const snapshot = await getDocs(pageQuery(options));
        const loaded = snapshotItems(snapshot);
        const items = loaded.slice(0, pageSize).map(closureSummary);
        const last = items.at(-1);
        return {
            items,
            nextCursor: loaded.length === pageSize && last
                ? { closedAt: Number(last.closedAt) || 0, id: String(last.id) }
                : null
        };
    },

    async loadById(id) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.loadById');
        const snapshot = await getDoc(requireSessionRef(currentDocument(id)));
        if (!snapshot?.exists?.()) return null;
        return { ...clone(snapshot.data()), id: String(snapshot.id || id) };
    },

    async loadByPeriod(periodStart, periodEnd) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.loadByPeriod');
        const snapshot = await getDocs(query(
            requireSessionRef(currentCollection()),
            where('periodStart', '==', String(periodStart || '')),
            where('periodEnd', '==', String(periodEnd || ''))
        ));
        return snapshotItems(snapshot);
    },

    subscribeRecent(onChange, { limit = 10, onError = null } = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.subscribeRecent');
        if (typeof onChange !== 'function') return () => {};
        const ref = pageQuery({ limit });
        return onSnapshot(ref, snapshot => {
            if (snapshot?.metadata?.hasPendingWrites) return;
            onChange(snapshotItems(snapshot).map(closureSummary));
        }, error => {
            if (typeof onError === 'function') onError(error);
            else console.error('Payroll closure subscription failed:', error);
        });
    }
};

export default PayrollClosureRepository;
