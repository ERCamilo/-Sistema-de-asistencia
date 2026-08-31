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
import {
    LEGACY_PAYROLL_CLOSURE_SCHEMA_VERSION,
    PAYROLL_CLOSURE_IDENTITY_KIND,
    PAYROLL_CLOSURE_SCHEMA_VERSION,
    PAYROLL_CLOSURE_STATUS,
    promoteLegacyPayrollClosure
} from './PayrollClosure.js';
import { resolvePayrollClosureMutation } from './PayrollClosureMerge.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import {
    captureEntityProjectScope,
    peekEntityScope
} from '../projects/EntityProjectScope.js';

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

function normalizedProjectId(value) {
    const projectId = typeof value === 'string' ? value.trim() : '';
    return projectId && !projectId.startsWith('legacy-unresolved:') ? projectId : null;
}

function captureScopedScope() {
    if (!isProjectsEnabled()) return null;
    const scope = captureEntityProjectScope();
    const projectId = normalizedProjectId(scope?.projectId);
    if (!scope?.enabled || !projectId) return null;
    return {
        projectId,
        defaultProjectId: normalizedProjectId(scope.defaultProjectId)
    };
}

function staleReadError(message) {
    const error = new Error(message);
    error.code = 'PAYROLL_CLOSURE_STALE_READ';
    error.name = 'PayrollClosureStaleReadError';
    return error;
}

function ensureNotStale(scope) {
    if (!scope) return;
    if (!isProjectsEnabled()) {
        throw staleReadError('Payroll closure read stale: projects disabled mid-read');
    }
    const current = peekEntityScope();
    if (!current?.enabled || normalizedProjectId(current.projectId) !== scope.projectId) {
        throw staleReadError('Payroll closure read stale: project switched');
    }
}

function isRawLegacyClosure(closure) {
    return Number(closure?.schemaVersion) === LEGACY_PAYROLL_CLOSURE_SCHEMA_VERSION &&
        !Object.prototype.hasOwnProperty.call(closure || {}, 'projectId') &&
        !Object.prototype.hasOwnProperty.call(closure || {}, 'identityKind');
}

function isScopedClosure(closure, capturedPid) {
    return Number(closure?.schemaVersion) === PAYROLL_CLOSURE_SCHEMA_VERSION &&
        String(closure?.projectId || '') === capturedPid;
}

function compareByClosedAt(left, right) {
    return Number(right.closedAt || 0) - Number(left.closedAt || 0) ||
        String(right.id).localeCompare(String(left.id));
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

function pageQuery({ limit = 10, cursor = null, status = null } = {}, capturedPid = null, legacy = false) {
    const constraints = [];
    if (capturedPid) constraints.push(where('projectId', '==', capturedPid));
    if (legacy) constraints.push(where('schemaVersion', '==', LEGACY_PAYROLL_CLOSURE_SCHEMA_VERSION));
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

function periodQuery(periodStart, periodEnd, capturedPid = null, legacy = false) {
    const constraints = [];
    if (capturedPid) constraints.push(where('projectId', '==', capturedPid));
    if (legacy) constraints.push(where('schemaVersion', '==', LEGACY_PAYROLL_CLOSURE_SCHEMA_VERSION));
    constraints.push(
        where('periodStart', '==', String(periodStart || '')),
        where('periodEnd', '==', String(periodEnd || ''))
    );
    return query(requireSessionRef(currentCollection()), ...constraints);
}

async function promoteLegacyCloudClosure(legacy, scope) {
    if (!scope || scope.defaultProjectId !== scope.projectId || !isRawLegacyClosure(legacy)) {
        return null;
    }
    const ref = requireSessionRef(currentDocument(legacy.id));
    const result = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        ensureNotStale(scope);
        if (!snapshot?.exists?.()) return null;
        const current = { ...clone(snapshot.data()), id: String(snapshot.id || legacy.id) };
        if (current.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
            if (!isScopedClosure(current, scope.projectId)) return null;
            return promoteLegacyPayrollClosure(current, scope.projectId);
        }
        if (!isRawLegacyClosure(current)) return null;
        const promoted = promoteLegacyPayrollClosure(current, scope.projectId);
        transaction.set(ref, promoted);
        return promoted;
    });
    ensureNotStale(scope);
    return result ? clone(result) : null;
}

async function saveOneScoped(closure, scope = captureScopedScope()) {
    if (!scope) throw new Error('A canonical project is required for scoped payroll closure writes');
    assertClosure(closure);
    assertPayrollClosureSize(closure);
    const incoming = clone(closure);
    if (!isScopedClosure(incoming, scope.projectId)) {
        throw new Error('Payroll closure does not belong to the captured project');
    }
    const ref = requireSessionRef(currentDocument(incoming.id));
    const result = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        ensureNotStale(scope);
        const existing = snapshot.exists() ? snapshot.data() : null;
        if (existing?.projectId && !isScopedClosure(existing, scope.projectId)) {
            throw new Error('Payroll closure belongs to another project');
        }
        const mutation = resolvePayrollClosureMutation(existing, incoming);
        if (mutation.write) transaction.set(ref, mutation.value);
        return { written: mutation.write, closure: clone(mutation.value) };
    });
    ensureNotStale(scope);
    return result;
}

async function loadPageScoped(options = {}, scope = captureScopedScope()) {
    if (!scope) return { items: [], nextCursor: null };
    const pageSize = normalizedLimit(options.limit);
    const nativeSnapshot = await getDocs(pageQuery(options, scope.projectId));
    ensureNotStale(scope);
    let loaded = snapshotItems(nativeSnapshot)
        .filter(item => isScopedClosure(item, scope.projectId));

    if (scope.defaultProjectId === scope.projectId) {
        const legacySnapshot = await getDocs(pageQuery(options, null, true));
        ensureNotStale(scope);
        for (const legacy of snapshotItems(legacySnapshot)) {
            const promoted = await promoteLegacyCloudClosure(legacy, scope);
            ensureNotStale(scope);
            if (promoted) loaded.push(promoted);
        }
    }

    loaded.sort(compareByClosedAt);
    const items = loaded.slice(0, pageSize).map(closureSummary);
    const last = items.at(-1);
    return {
        items,
        nextCursor: loaded.length >= pageSize && last
            ? { closedAt: Number(last.closedAt) || 0, id: String(last.id) }
            : null
    };
}

async function loadByIdScoped(id, scope = captureScopedScope()) {
    if (!scope) return null;
    const snapshot = await getDoc(requireSessionRef(currentDocument(id)));
    ensureNotStale(scope);
    if (!snapshot?.exists?.()) return null;
    const record = { ...clone(snapshot.data()), id: String(snapshot.id || id) };
    if (isScopedClosure(record, scope.projectId)) return record;
    if (scope.defaultProjectId !== scope.projectId || !isRawLegacyClosure(record)) return null;
    const promoted = await promoteLegacyCloudClosure(record, scope);
    ensureNotStale(scope);
    return promoted;
}

async function loadByPeriodScoped(periodStart, periodEnd, scope = captureScopedScope()) {
    if (!scope) return [];
    const nativeSnapshot = await getDocs(periodQuery(periodStart, periodEnd, scope.projectId));
    ensureNotStale(scope);
    const loaded = snapshotItems(nativeSnapshot)
        .filter(item => isScopedClosure(item, scope.projectId));

    if (scope.defaultProjectId === scope.projectId) {
        const legacySnapshot = await getDocs(periodQuery(periodStart, periodEnd, null, true));
        ensureNotStale(scope);
        for (const legacy of snapshotItems(legacySnapshot)) {
            const promoted = await promoteLegacyCloudClosure(legacy, scope);
            ensureNotStale(scope);
            if (promoted) loaded.push(promoted);
        }
    }
    return loaded;
}

function subscribeRecentScoped(onChange, { limit = 10, onError = null } = {}, scope = captureScopedScope()) {
    if (!scope || typeof onChange !== 'function') return () => {};
    const ref = pageQuery({ limit }, scope.projectId);
    return onSnapshot(ref, snapshot => {
        try {
            ensureNotStale(scope);
            if (snapshot?.metadata?.hasPendingWrites) return;
            onChange(snapshotItems(snapshot)
                .filter(item => isScopedClosure(item, scope.projectId))
                .map(closureSummary));
        } catch (error) {
            if (typeof onError === 'function') onError(error);
        }
    }, error => {
        if (typeof onError === 'function') onError(error);
        else console.error('Payroll closure subscription failed:', error);
    });
}

export const PayrollClosureRepository = {
    async saveOne(closure) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.saveOne');
        if (isProjectsEnabled()) return saveOneScoped(closure);
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
        if (isProjectsEnabled()) return loadPageScoped(options);
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
        if (isProjectsEnabled()) return loadByIdScoped(id);
        const snapshot = await getDoc(requireSessionRef(currentDocument(id)));
        if (!snapshot?.exists?.()) return null;
        return { ...clone(snapshot.data()), id: String(snapshot.id || id) };
    },

    async loadByPeriod(periodStart, periodEnd) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.loadByPeriod');
        if (isProjectsEnabled()) return loadByPeriodScoped(periodStart, periodEnd);
        const snapshot = await getDocs(query(
            requireSessionRef(currentCollection()),
            where('periodStart', '==', String(periodStart || '')),
            where('periodEnd', '==', String(periodEnd || ''))
        ));
        return snapshotItems(snapshot);
    },

    subscribeRecent(onChange, { limit = 10, onError = null } = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureRepository.subscribeRecent');
        if (isProjectsEnabled()) return subscribeRecentScoped(onChange, { limit, onError });
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

// Public ON gates remain in place until B3.4; these seams keep B3.3 testable.
export const _payrollClosureRepositoryInternals = Object.freeze({
    captureScopedScope,
    ensureNotStale,
    loadByIdScoped,
    loadByPeriodScoped,
    loadPageScoped,
    promoteLegacyCloudClosure,
    saveOneScoped,
    subscribeRecentScoped
});

export default PayrollClosureRepository;
