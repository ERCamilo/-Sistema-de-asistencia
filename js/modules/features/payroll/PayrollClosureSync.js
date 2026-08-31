import { MainSyncStore } from '../../services/MainSyncStore.js';
import payrollClosureStore from './PayrollClosureStore.js';
import { PayrollClosureConflictError } from './PayrollClosureMerge.js';
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

function isOwnedScopedClosure(closure, projectId) {
    return Number(closure?.schemaVersion) === 3 &&
        String(closure?.projectId || '') === String(projectId);
}

function scopedPageItems(items, projectId) {
    return (items || []).filter(item => Number(item?.schemaVersion) !== 2 &&
        (!Object.prototype.hasOwnProperty.call(item || {}, 'projectId') ||
            String(item.projectId) === String(projectId)));
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
        assertTandaBBlockedWhenScoped('PayrollClosureSync.pullPage');
        const scope = isProjectsEnabled() ? captureScopedScope() : null;
        const pageSize = normalizedPageSize(options.limit);
        const periodStart = String(options.periodStart || '');
        const periodEnd = String(options.periodEnd || '');
        if (!periodStart && !periodEnd) {
            const page = await this.remoteRepository.loadPage({ ...options, limit: pageSize });
            if (scope) ensureNotStale(scope);
            return scope
                ? { ...page, items: scopedPageItems(page?.items, scope.projectId) }
                : page;
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
                cursor
            });
            if (scope) ensureNotStale(scope);
            const remoteItems = scope
                ? scopedPageItems(page?.items, scope.projectId)
                : (Array.isArray(page?.items) ? page.items : []);
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
        assertTandaBBlockedWhenScoped('PayrollClosureSync.pullDetail');
        const scope = isProjectsEnabled() ? captureScopedScope() : null;
        const closure = await this.remoteRepository.loadById(id);
        if (scope) ensureNotStale(scope);
        if (!closure) return null;
        if (!scope) return this.localStore.save(closure);
        if (!isOwnedScopedClosure(closure, scope.projectId)) return null;
        const saved = await this.localStore.save(closure);
        ensureNotStale(scope);
        return saved;
    }

    async pullPeriod(periodStart, periodEnd) {
        assertTandaBBlockedWhenScoped('PayrollClosureSync.pullPeriod');
        const scope = isProjectsEnabled() ? captureScopedScope() : null;
        const closures = await this.remoteRepository.loadByPeriod(periodStart, periodEnd);
        if (scope) ensureNotStale(scope);
        const scopedClosures = scope
            ? (closures || []).filter(closure => isOwnedScopedClosure(closure, scope.projectId))
            : closures;
        const imported = await this.importClosures(scopedClosures, { scope });
        if (scope) ensureNotStale(scope);
        return { closures: scopedClosures, ...imported };
    }

    async importClosures(closures = [], { scope = undefined } = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureSync.importClosures');
        const capturedScope = scope === undefined
            ? (isProjectsEnabled() ? captureScopedScope() : null)
            : scope;
        const conflicts = [];
        let imported = 0;
        for (const closure of closures || []) {
            if (capturedScope && !isOwnedScopedClosure(closure, capturedScope.projectId)) continue;
            try {
                await this.localStore.save(closure);
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
        assertTandaBBlockedWhenScoped('PayrollClosureSync.subscribeRecent');
        const scope = isProjectsEnabled() ? captureScopedScope() : null;
        const onError = typeof options.onError === 'function'
            ? options.onError
            : error => console.error('Payroll closure live sync failed:', error);
        return this.remoteRepository.subscribeRecent(closures => {
            if (scope) {
                try { ensureNotStale(scope); } catch (error) {
                    onError(error);
                    return;
                }
            }
            this.importClosures(closures, { scope })
                .then(result => {
                    if (typeof onApply === 'function') onApply(result);
                })
                .catch(onError);
        }, options);
    }
}

export const payrollClosureSync = new PayrollClosureSync();
export default payrollClosureSync;
