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
    promoteLegacyPayrollClosure,
    validatePayrollClosureSummaryForScopedRead,
    validatePayrollClosureForScopedWrite
} from './PayrollClosure.js';
import { resolvePayrollClosureMutation } from './PayrollClosureMerge.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import {
    captureEntityProjectScope,
    peekEntityScope
} from '../projects/EntityProjectScope.js';

const COLLECTION = 'payrollClosures';
// M1: cerrojo por cierre de origen. Un cierre schema 2 sin obra puede llegar a
// una obra por promoción (mismo id) o por copia de recuperación (id nuevo con
// recovery.sourceId). El primero que crea users/{uid}/payrollClosureClaims/{sourceId}
// en la misma transacción que su escritura gana; el documento es inmutable
// (firestore.rules) y el otro camino lo lee dentro de su transacción y aborta.
const CLAIM_COLLECTION = 'payrollClosureClaims';
export const PAYROLL_CLOSURE_CLAIM_KIND = Object.freeze({
    PROMOTION: 'promotion',
    RECOVERY_COPY: 'recovery-copy'
});

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

function currentClaimDocument(sourceId) {
    if (!auth.currentUser) return null;
    return doc(db, 'users', auth.currentUser.uid, CLAIM_COLLECTION, String(sourceId));
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
    if (!scope?.enabled || !projectId) {
        throw new Error('A canonical project is required for scoped payroll closure access');
    }
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
    if (scope.recoveryUid) {
        if (auth.currentUser?.uid !== scope.recoveryUid) throw staleReadError('La cuenta cambió durante la recuperación');
        return;
    }
    const current = peekEntityScope();
    if (!current?.enabled || normalizedProjectId(current.projectId) !== scope.projectId) {
        throw staleReadError('Payroll closure read stale: project switched');
    }
}

// Firestore responde FAILED_PRECONDITION cuando falta el índice compuesto que
// piden las consultas paginadas (projectId + closedAt + __name__, ver
// firestore.indexes.json). El índice vive en el repo, pero su despliegue es
// externo: la app no debe asumir que existe.
export function isMissingFirestoreIndexError(error) {
    const code = String(error?.code || '').toLowerCase().replace(/_/g, '-');
    return code.endsWith('failed-precondition') && /index/i.test(String(error?.message || ''));
}

function missingIndexError(cause) {
    const error = new Error('El historial remoto de nómina no está disponible todavía (falta un índice de Firestore). Se muestran los cierres guardados en este dispositivo.');
    error.code = 'PAYROLL_CLOSURE_INDEX_MISSING';
    error.name = 'PayrollClosureIndexMissingError';
    error.expectedRemoteUnavailable = true;
    error.cause = cause;
    return error;
}

function typedQueryError(error) {
    return isMissingFirestoreIndexError(error) ? missingIndexError(error) : error;
}

async function getPageDocs(ref) {
    try {
        return await getDocs(ref);
    } catch (error) {
        throw typedQueryError(error);
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
    const isSchema3 = source.schemaVersion === PAYROLL_CLOSURE_SCHEMA_VERSION;
    const hasIdentityKind = Object.prototype.hasOwnProperty.call(source, 'identityKind');
    const hasOwnershipToken = Object.prototype.hasOwnProperty.call(source, 'ownershipToken');
    const identity = isSchema3
        ? {
            projectId: source.projectId,
            identityKind: hasIdentityKind ? source.identityKind : null,
            ownershipToken: hasOwnershipToken ? source.ownershipToken : null
        }
        : {
            projectId: null,
            identityKind: null,
            ownershipToken: null
        };
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
        voidReason: source.voidReason,
        ...identity
    };
}

function scopedClosureSummary(closure, projectId) {
    const summary = closureSummary(closure);
    return validatePayrollClosureSummaryForScopedRead(summary, projectId);
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

export function recoverySourcePromotedError(sourceId) {
    const error = new Error('El cierre original ya fue asignado a una obra desde otro dispositivo. No se sube la copia recuperada para no duplicar la nómina; revisa el cierre antes de continuar.');
    error.code = 'PAYROLL_CLOSURE_RECOVERY_CONFLICT';
    error.name = 'PayrollClosureRecoveryConflictError';
    error.sourceId = String(sourceId || '');
    return error;
}

function isPermissionDeniedError(error) {
    return String(error?.code || '').toLowerCase().replace(/_/g, '-').endsWith('permission-denied');
}

// Antes de publicar las reglas del cerrojo, Firestore niega leerlo. Sin cerrojo
// no hay garantía contra la carrera promoción/copia, así que ambos caminos
// quedan en pausa (fail-closed) hasta el despliegue.
export function claimUnavailableError(sourceId, cause = null) {
    const error = new Error('La asignación de cierres de nómina antiguos a una obra está en pausa hasta publicar las reglas de Firestore que evitan duplicarlos. Se muestran los cierres guardados en este dispositivo.');
    error.code = 'PAYROLL_CLOSURE_CLAIM_UNAVAILABLE';
    error.name = 'PayrollClosureClaimUnavailableError';
    error.expectedRemoteUnavailable = true;
    error.sourceId = String(sourceId || '');
    error.cause = cause;
    return error;
}

async function readClaim(transaction, sourceId) {
    const ref = requireSessionRef(currentClaimDocument(sourceId));
    try {
        const snapshot = await transaction.get(ref);
        return { ref, claim: snapshot?.exists?.() ? clone(snapshot.data()) : null };
    } catch (error) {
        if (isPermissionDeniedError(error)) throw claimUnavailableError(sourceId, error);
        throw error;
    }
}

function buildClaim(kind, sourceId, targetId, projectId) {
    return {
        sourceId: String(sourceId),
        kind,
        targetId: String(targetId),
        projectId: String(projectId),
        claimedAt: Date.now()
    };
}

function isClaimFor(claim, kind, targetId) {
    return claim?.kind === kind && String(claim?.targetId || '') === String(targetId);
}

async function promoteLegacyCloudClosure(legacy, scope) {
    if (!scope || scope.defaultProjectId !== scope.projectId || !isRawLegacyClosure(legacy)) {
        return null;
    }
    // Copias anteriores al cerrojo no tienen claim: la consulta las sigue viendo.
    const recovered = await getPageDocs(query(requireSessionRef(currentCollection()), where('recovery.sourceId', '==', legacy.id)));
    ensureNotStale(scope);
    const copies = snapshotItems(recovered);
    const matches = copies.filter(c => c.projectId === scope.projectId);
    if (matches.length > 1) throw new Error('Hay más de una recuperación para el mismo cierre');
    if (matches.length) return validatePayrollClosureForScopedWrite(matches[0], scope.projectId);
    // H1: ya existe una copia recuperada en otra obra. Promoverlo aquí duplicaría
    // la misma nómina en dos obras; el original queda sin promover.
    if (copies.length) return null;
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
        // M1: la consulta de copias queda fuera de la transacción; el cerrojo no.
        const { ref: claimRef, claim } = await readClaim(transaction, current.id);
        ensureNotStale(scope);
        if (claim?.kind === PAYROLL_CLOSURE_CLAIM_KIND.RECOVERY_COPY) {
            const copySnapshot = await transaction.get(requireSessionRef(currentDocument(claim.targetId)));
            const copy = copySnapshot?.exists?.()
                ? { ...clone(copySnapshot.data()), id: String(claim.targetId) }
                : null;
            return copy && isScopedClosure(copy, scope.projectId) ? copy : null;
        }
        if (claim && !(isClaimFor(claim, PAYROLL_CLOSURE_CLAIM_KIND.PROMOTION, current.id)
            && claim.projectId === scope.projectId)) {
            throw recoverySourcePromotedError(current.id);
        }
        const promoted = promoteLegacyPayrollClosure(current, scope.projectId);
        transaction.set(ref, promoted);
        if (!claim) {
            transaction.set(claimRef, buildClaim(PAYROLL_CLOSURE_CLAIM_KIND.PROMOTION,
                current.id, current.id, scope.projectId));
        }
        return promoted;
    });
    ensureNotStale(scope);
    if (result?.recovery?.sourceId) return validatePayrollClosureForScopedWrite(clone(result), scope.projectId);
    return result ? clone(result) : null;
}

async function saveOneScoped(closure, scope = captureScopedScope()) {
    if (!scope) throw new Error('A canonical project is required for scoped payroll closure writes');
    const incoming = clone(closure);
    validatePayrollClosureForScopedWrite(incoming, scope.projectId);
    assertPayrollClosureSize(incoming);
    const ref = requireSessionRef(currentDocument(incoming.id));
    if (incoming.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
        const preflight = await getDoc(ref);
        ensureNotStale(scope);
        if (!preflight?.exists?.()) {
            throw new Error('A promoted legacy closure must already exist as schema 2');
        }
        const source = { ...clone(preflight.data()), id: String(preflight.id || incoming.id) };
        if (isRawLegacyClosure(source)) {
            validatePayrollClosureForScopedWrite(incoming, scope.projectId, {
                legacySource: source
            });
        }
    }
    // M1: toda copia nueva (venga de la recuperación o de una subida ordinaria)
    // necesita el cerrojo de su origen; antes solo se comprobaba en recuperación.
    const recoverySourceId = incoming.recovery?.sourceId
        ? String(incoming.recovery.sourceId) : '';
    const sourceRef = recoverySourceId && recoverySourceId !== String(incoming.id)
        ? requireSessionRef(currentDocument(recoverySourceId)) : null;
    const result = await runTransaction(db, async transaction => {
        // H1: el original se lee dentro de la transacción. Si otro dispositivo lo
        // promueve antes del commit, Firestore reintenta y esta lectura lo ve.
        const sourceSnapshot = sourceRef ? await transaction.get(sourceRef) : null;
        const snapshot = await transaction.get(ref);
        ensureNotStale(scope);
        if (sourceSnapshot?.exists?.()) {
            const source = { ...clone(sourceSnapshot.data()), id: recoverySourceId };
            // Solo la promoción crea el conflicto; un v3 de una obra borrada sigue
            // siendo un origen válido para la copia.
            if (source.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY && !snapshot.exists()) {
                throw recoverySourcePromotedError(recoverySourceId);
            }
        }
        const existing = snapshot.exists()
            ? { ...clone(snapshot.data()), id: String(snapshot.id || incoming.id) }
            : null;
        if (existing?.projectId && !isScopedClosure(existing, scope.projectId)) {
            throw new Error('Payroll closure belongs to another project');
        }
        if (incoming.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
            if (!existing) throw new Error('A promoted legacy closure must already exist as schema 2');
            if (isRawLegacyClosure(existing)) {
                validatePayrollClosureForScopedWrite(incoming, scope.projectId, {
                    legacySource: existing
                });
                // M1: subir un promovido local también es una promoción.
                const { ref: claimRef, claim } = await readClaim(transaction, incoming.id);
                ensureNotStale(scope);
                if (claim && !(isClaimFor(claim, PAYROLL_CLOSURE_CLAIM_KIND.PROMOTION, incoming.id)
                    && claim.projectId === scope.projectId)) {
                    throw recoverySourcePromotedError(incoming.id);
                }
                transaction.set(ref, incoming);
                if (!claim) {
                    transaction.set(claimRef, buildClaim(PAYROLL_CLOSURE_CLAIM_KIND.PROMOTION,
                        incoming.id, incoming.id, scope.projectId));
                }
                return { written: true, closure: clone(incoming) };
            }
        }
        let recoveryClaim = null;
        if (recoverySourceId && !existing) {
            const { ref: claimRef, claim } = await readClaim(transaction, recoverySourceId);
            ensureNotStale(scope);
            if (claim && !(isClaimFor(claim, PAYROLL_CLOSURE_CLAIM_KIND.RECOVERY_COPY, incoming.id)
                && claim.projectId === scope.projectId)) {
                // Ganó la promoción, u otra copia (otra obra) ya reclamó el origen.
                throw recoverySourcePromotedError(recoverySourceId);
            }
            if (!claim) {
                recoveryClaim = [claimRef, buildClaim(PAYROLL_CLOSURE_CLAIM_KIND.RECOVERY_COPY,
                    recoverySourceId, incoming.id, scope.projectId)];
            }
        }
        const mutation = resolvePayrollClosureMutation(existing, incoming);
        if (mutation.write) transaction.set(ref, mutation.value);
        if (mutation.write && recoveryClaim) transaction.set(...recoveryClaim);
        return { written: mutation.write, closure: clone(mutation.value) };
    });
    ensureNotStale(scope);
    return result;
}

async function loadPageScoped(options = {}, scope = captureScopedScope()) {
    if (!scope) return { items: [], nextCursor: null };
    const pageSize = normalizedLimit(options.limit);
    const nativeSnapshot = await getPageDocs(pageQuery(options, scope.projectId));
    ensureNotStale(scope);
    let loaded = snapshotItems(nativeSnapshot);

    if (scope.defaultProjectId === scope.projectId) {
        const legacySnapshot = await getPageDocs(pageQuery(options, null, true));
        ensureNotStale(scope);
        for (const legacy of snapshotItems(legacySnapshot)) {
            const promoted = await promoteLegacyCloudClosure(legacy, scope);
            ensureNotStale(scope);
            if (promoted) loaded.push(promoted);
        }
    }

    loaded = [...new Map(loaded.map(c => [c.id, c])).values()];
    loaded.sort(compareByClosedAt);
    const items = loaded.slice(0, pageSize)
        .map(item => scopedClosureSummary(item, scope.projectId));
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
    if (isScopedClosure(record, scope.projectId)) {
        validatePayrollClosureForScopedWrite(record, scope.projectId);
        return record;
    }
    if (scope.defaultProjectId !== scope.projectId || !isRawLegacyClosure(record)) return null;
    const promoted = await promoteLegacyCloudClosure(record, scope);
    ensureNotStale(scope);
    if (promoted) validatePayrollClosureForScopedWrite(promoted, scope.projectId);
    return promoted;
}

async function loadByPeriodScoped(periodStart, periodEnd, scope = captureScopedScope()) {
    if (!scope) return [];
    const nativeSnapshot = await getPageDocs(periodQuery(periodStart, periodEnd, scope.projectId));
    ensureNotStale(scope);
    const loaded = snapshotItems(nativeSnapshot);

    if (scope.defaultProjectId === scope.projectId) {
        const legacySnapshot = await getPageDocs(periodQuery(periodStart, periodEnd, null, true));
        ensureNotStale(scope);
        for (const legacy of snapshotItems(legacySnapshot)) {
            const promoted = await promoteLegacyCloudClosure(legacy, scope);
            ensureNotStale(scope);
            if (promoted) loaded.push(promoted);
        }
    }
    for (const closure of loaded) {
        validatePayrollClosureForScopedWrite(closure, scope.projectId);
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
                .map(item => scopedClosureSummary(item, scope.projectId)));
        } catch (error) {
            if (typeof onError === 'function') onError(error);
        }
    }, error => {
        const typed = typedQueryError(error);
        if (typeof onError === 'function') onError(typed);
        else console.error('Payroll closure subscription failed:', typed);
    });
}

export const PayrollClosureRepository = {
    async saveRecoveredClosure(closure) {
        if (!closure?.recovery?.sourceId || !auth.currentUser?.uid) throw new Error('La recuperación requiere origen y sesión');
        return saveOneScoped(closure, { projectId: closure.projectId, recoveryUid: auth.currentUser.uid });
    },
    async saveOne(closure) {
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
        const { scope = undefined, ...queryOptions } = options;
        if (isProjectsEnabled()) {
            return loadPageScoped(queryOptions, scope || captureScopedScope());
        }
        const pageSize = normalizedLimit(queryOptions.limit);
        const snapshot = await getPageDocs(pageQuery(queryOptions));
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

    async loadById(id, { scope = undefined } = {}) {
        if (isProjectsEnabled()) return loadByIdScoped(id, scope || captureScopedScope());
        const snapshot = await getDoc(requireSessionRef(currentDocument(id)));
        if (!snapshot?.exists?.()) return null;
        return { ...clone(snapshot.data()), id: String(snapshot.id || id) };
    },

    async loadByPeriod(periodStart, periodEnd, { scope = undefined } = {}) {
        if (isProjectsEnabled()) {
            return loadByPeriodScoped(periodStart, periodEnd, scope || captureScopedScope());
        }
        const snapshot = await getPageDocs(query(
            requireSessionRef(currentCollection()),
            where('periodStart', '==', String(periodStart || '')),
            where('periodEnd', '==', String(periodEnd || ''))
        ));
        return snapshotItems(snapshot);
    },

    subscribeRecent(onChange, { limit = 10, onError = null } = {}) {
        if (isProjectsEnabled()) {
            const scope = captureScopedScope();
            return subscribeRecentScoped(onChange, { limit, onError }, scope);
        }
        if (typeof onChange !== 'function') return () => {};
        const ref = pageQuery({ limit });
        return onSnapshot(ref, snapshot => {
            if (snapshot?.metadata?.hasPendingWrites) return;
            onChange(snapshotItems(snapshot).map(closureSummary));
        }, error => {
            const typed = typedQueryError(error);
            if (typeof onError === 'function') onError(typed);
            else console.error('Payroll closure subscription failed:', typed);
        });
    }
};

export const _payrollClosureRepositoryInternals = Object.freeze({
    captureScopedScope,
    closureSummary,
    ensureNotStale,
    loadByIdScoped,
    loadByPeriodScoped,
    loadPageScoped,
    promoteLegacyCloudClosure,
    saveOneScoped,
    subscribeRecentScoped
});

export default PayrollClosureRepository;
