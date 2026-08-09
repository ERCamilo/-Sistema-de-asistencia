import { MainSyncStore } from '../../services/MainSyncStore.js';
import payrollClosureStore from './PayrollClosureStore.js';
import { PayrollClosureConflictError } from './PayrollClosureMerge.js';
import { PayrollClosureRepository } from './PayrollClosureRepository.js';

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
        return this.localStore.saveWithEmployees(closure, employees, {
            enqueueCloud: true,
            schemaVersion,
            queuedAt
        });
    }

    async pullPage(options = {}) {
        const pageSize = normalizedPageSize(options.limit);
        const periodStart = String(options.periodStart || '');
        const periodEnd = String(options.periodEnd || '');
        if (!periodStart && !periodEnd) {
            return this.remoteRepository.loadPage({ ...options, limit: pageSize });
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
            const remoteItems = Array.isArray(page?.items) ? page.items : [];
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
        const closure = await this.remoteRepository.loadById(id);
        if (!closure) return null;
        return this.localStore.save(closure);
    }

    async pullPeriod(periodStart, periodEnd) {
        const closures = await this.remoteRepository.loadByPeriod(periodStart, periodEnd);
        return { closures, ...await this.importClosures(closures) };
    }

    async importClosures(closures = []) {
        const conflicts = [];
        let imported = 0;
        for (const closure of closures || []) {
            try {
                await this.localStore.save(closure);
                imported++;
            } catch (error) {
                if (!(error instanceof PayrollClosureConflictError)) throw error;
                conflicts.push({ id: closure?.id || null, error });
            }
        }
        return { imported, conflicts };
    }

    subscribeRecent(onApply = null, options = {}) {
        const onError = typeof options.onError === 'function'
            ? options.onError
            : error => console.error('Payroll closure live sync failed:', error);
        return this.remoteRepository.subscribeRecent(closures => {
            this.importClosures(closures)
                .then(result => {
                    if (typeof onApply === 'function') onApply(result);
                })
                .catch(onError);
        }, options);
    }
}

export const payrollClosureSync = new PayrollClosureSync();
export default payrollClosureSync;
