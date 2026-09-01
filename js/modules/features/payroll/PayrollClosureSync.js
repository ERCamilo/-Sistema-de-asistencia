import { MainSyncStore } from '../../services/MainSyncStore.js';
import payrollClosureStore from './PayrollClosureStore.js';
import { PayrollClosureConflictError } from './PayrollClosureMerge.js';
import {
    validatePayrollClosureSummaryForScopedRead,
    validatePayrollClosureForScopedWrite
} from './PayrollClosure.js';
import {
    _payrollClosureRepositoryInternals,
    PayrollClosureRepository
} from './PayrollClosureRepository.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';

const { captureScopedScope, ensureNotStale } = _payrollClosureRepositoryInternals;

function normalizedPageSize(value) {
    return Math.max(1, Math.min(10, Math.trunc(Number(value) || 10)));
}

function overlapsPeriod(closure, periodStart, periodEnd) {
    const overlapsStart = !periodStart || String(closure?.periodEnd || '') >= String(periodStart);
    const overlapsEnd = !periodEnd || String(closure?.periodStart || '') <= String(periodEnd);
    return overlapsStart && overlapsEnd;
}

function cursorFor(closure) {
    if (!closure?.id) return null;
    return { closedAt: Number(closure.closedAt) || 0, id: String(closure.id) };
}

function cursorToken(cursor) {
    return cursor ? `${Number(cursor.closedAt) || 0}:${String(cursor.id || '')}` : '';
}

function captureRemoteScope() {
    return isProjectsEnabled() ? captureScopedScope() : null;
}

function validateAll(items, scope, validator) {
    const details = Array.isArray(items) ? items : [];
    if (scope) {
        for (const detail of details) validator(detail, scope.projectId);
    }
    return details;
}

function identityValue(closure, field) {
    return closure?.[field] ?? null;
}

function assertSummaryMatchesDetail(summary, detail) {
    const immutableFields = [
        'schemaVersion', 'id', 'fingerprint', 'projectId', 'identityKind',
        'ownershipToken', 'periodStart', 'periodEnd', 'supersedesId'
    ];
    for (const field of immutableFields) {
        if (identityValue(summary, field) !== identityValue(detail, field)) {
            throw new Error(`Payroll closure summary/detail identity mismatch: ${field}`);
        }
    }
}

export class PayrollClosureSync {
    constructor({
        localStore = payrollClosureStore,
        remoteRepository = PayrollClosureRepository,
        outbox = MainSyncStore
    } = {}) {
        this.localStore = localStore;
        this.remoteRepository = remoteRepository;
        this.outbox = outbox;
    }

    /** Closure, affected employees, and cloud intent share one local transaction. */
    async record(closure, { employees = [], schemaVersion = null, queuedAt = Date.now() } = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureSync.record');
        const scope = isProjectsEnabled() ? captureScopedScope() : null;
        const result = await this.localStore.saveWithEmployees(closure, employees, {
            enqueueCloud: true,
            schemaVersion,
            queuedAt
        });
        if (scope) ensureNotStale(scope);
        return result;
    }

    async pullPage(options = {}) {
        const scope = captureRemoteScope();
        const pageSize = normalizedPageSize(options.limit);
        const periodStart = String(options.periodStart || '');
        const periodEnd = String(options.periodEnd || '');
        if (!periodStart && !periodEnd) {
            const page = await this.remoteRepository.loadPage({ ...options, limit: pageSize, scope });
            if (scope) ensureNotStale(scope);
            return { ...page, items: validateAll(page?.items, scope, validatePayrollClosureSummaryForScopedRead) };
        }

        const items = [];
        let cursor = options.cursor || null;
        const visited = new Set();
        while (items.length < pageSize) {
            const token = cursorToken(cursor);
            if (token && visited.has(token)) {
                throw new Error('La paginación remota del historial no avanzó.');
            }
            if (token) visited.add(token);

            const page = await this.remoteRepository.loadPage({
                ...options,
                limit: pageSize,
                cursor,
                scope
            });
            if (scope) ensureNotStale(scope);
            const remoteItems = validateAll(page?.items, scope, validatePayrollClosureSummaryForScopedRead);
            if (remoteItems.length === 0) return { items, nextCursor: null };

            for (let index = 0; index < remoteItems.length; index++) {
                const item = remoteItems[index];
                const itemCursor = cursorFor(item);
                if (!itemCursor) continue;
                cursor = itemCursor;
                if (!overlapsPeriod(item, periodStart, periodEnd)) continue;
                items.push(item);
                if (items.length === pageSize) {
                    const hasUnscannedItems = index < remoteItems.length - 1;
                    return {
                        items,
                        nextCursor: hasUnscannedItems || page.nextCursor ? itemCursor : null
                    };
                }
            }

            if (!page.nextCursor) return { items, nextCursor: null };
            cursor = page.nextCursor;
        }
        return { items, nextCursor: cursor };
    }

    async pullDetail(id) {
        const scope = captureRemoteScope();
        const closure = await this.remoteRepository.loadById(id, { scope });
        if (scope) ensureNotStale(scope);
        if (!closure) return null;
        if (scope) {
            validatePayrollClosureForScopedWrite(closure, scope.projectId);
            if (String(closure.id) !== String(id)) {
                throw new Error('Payroll closure detail does not match the requested id');
            }
        }
        const saved = await this.localStore.importRemote(closure, { scope });
        ensureNotStale(scope);
        return saved;
    }

    async pullPeriod(periodStart, periodEnd) {
        const scope = captureRemoteScope();
        const closures = await this.remoteRepository.loadByPeriod(periodStart, periodEnd, { scope });
        if (scope) ensureNotStale(scope);
        const admitted = validateAll(closures, scope, validatePayrollClosureForScopedWrite);
        if (scope && admitted.some(closure =>
            closure.periodStart !== String(periodStart || '') ||
            closure.periodEnd !== String(periodEnd || ''))) {
            throw new Error('Payroll closure detail does not match the requested period');
        }
        const imported = await this.importClosures(admitted, { scope });
        if (scope) ensureNotStale(scope);
        return { closures: admitted, ...imported };
    }

    async importClosures(closures = [], { scope = undefined } = {}) {
        const capturedScope = isProjectsEnabled()
            ? (scope === undefined ? captureScopedScope() : scope)
            : null;
        if (capturedScope) ensureNotStale(capturedScope);
        const admitted = validateAll(closures, capturedScope, validatePayrollClosureForScopedWrite);
        const conflicts = [];
        let imported = 0;
        for (const closure of admitted) {
            try {
                await this.localStore.importRemote(closure, { scope: capturedScope });
                if (capturedScope) ensureNotStale(capturedScope);
                imported++;
            } catch (error) {
                if (capturedScope) ensureNotStale(capturedScope);
                if (!(error instanceof PayrollClosureConflictError)) throw error;
                conflicts.push({ id: closure?.id || null, error });
            }
        }
        return { imported, conflicts };
    }

    subscribeRecent(onApply = null, options = {}) {
        const scope = captureRemoteScope();
        const onError = typeof options.onError === 'function'
            ? options.onError
            : error => console.error('Payroll closure live sync failed:', error);
        let pending = Promise.resolve();
        return this.remoteRepository.subscribeRecent(closures => {
            pending = pending.then(async () => {
                if (scope) ensureNotStale(scope);
                const summaries = validateAll(closures, scope, validatePayrollClosureSummaryForScopedRead);
                const details = [];
                for (const summary of summaries) {
                    const detail = await this.remoteRepository.loadById(summary.id, { scope });
                    if (scope) ensureNotStale(scope);
                    if (!detail) throw new Error(`Payroll closure detail not found: ${summary.id}`);
                    validateAll([detail], scope, validatePayrollClosureForScopedWrite);
                    assertSummaryMatchesDetail(summary, detail);
                    details.push(detail);
                }
                const result = await this.importClosures(details, { scope });
                if (typeof onApply === 'function') onApply(result);
            }).catch(onError);
        }, { ...options, onError });
    }
}

export const payrollClosureSync = new PayrollClosureSync();
export default payrollClosureSync;
