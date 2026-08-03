import indexedDBService from '../../services/IndexedDBService.js';
import {
    PAYROLL_CLOSURE_STATUS,
    voidPayrollClosure
} from './PayrollClosure.js';
import {
    resolvePayrollClosureMutation
} from './PayrollClosureMerge.js';

export { PayrollClosureConflictError } from './PayrollClosureMerge.js';

export const PAYROLL_CLOSURE_STORE = 'payrollClosures';

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

function periodKey(periodStart, periodEnd) {
    return `${String(periodStart || '')}:${String(periodEnd || '')}`;
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

export class PayrollClosureStore {
    constructor({ db = indexedDBService } = {}) {
        this.db = db;
    }

    async save(closure) {
        assertClosure(closure);
        const incoming = {
            ...clone(closure),
            periodKey: periodKey(closure.periodStart, closure.periodEnd)
        };
        const saved = await this.db.atomicMutate(
            PAYROLL_CLOSURE_STORE,
            incoming.id,
            existing => resolvePayrollClosureMutation(existing, incoming)
        );
        return clone(saved);
    }

    async saveWithEmployees(closure, employees = [], { enqueueCloud = false, queuedAt = Date.now() } = {}) {
        assertClosure(closure);
        const incoming = {
            ...clone(closure),
            periodKey: periodKey(closure.periodStart, closure.periodEnd)
        };
        const batches = [{ storeName: 'employees', records: clone(employees || []) }];
        if (enqueueCloud) {
            batches.push({
                storeName: 'mainSyncOutbox',
                records: [{
                    kind: 'payrollClosure',
                    closureId: incoming.id,
                    closure: incoming,
                    ts: Number(queuedAt) || Date.now(),
                    status: 'pending'
                }]
            });
        }
        const saved = await this.db.atomicMutateWithBatches(
            PAYROLL_CLOSURE_STORE,
            incoming.id,
            existing => resolvePayrollClosureMutation(existing, incoming),
            batches
        );
        return clone(saved);
    }

    async getById(id) {
        return clone(await this.db.get(PAYROLL_CLOSURE_STORE, String(id || '')) || null);
    }

    async void(id, audit = {}) {
        const existing = await this.getById(id);
        if (!existing) throw new Error(`Payroll closure not found: ${id}`);
        return this.save(voidPayrollClosure(existing, audit));
    }

    async getByPeriod(periodStart, periodEnd) {
        const records = await this.db.query(
            PAYROLL_CLOSURE_STORE,
            'periodKey',
            periodKey(periodStart, periodEnd)
        );
        return (records || [])
            .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0))
            .map(clone);
    }

    async getActiveByPeriod(periodStart, periodEnd) {
        const records = await this.getByPeriod(periodStart, periodEnd);
        return records.filter(item => item.status === PAYROLL_CLOSURE_STATUS.CLOSED);
    }

    async listPage({
        limit = 20,
        status = null,
        cursor = null,
        periodStart = null,
        periodEnd = null
    } = {}) {
        const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 20)));
        const indexName = status ? 'statusClosedAtId' : 'closedAtId';
        const normalizedCursor = cursor ? {
                closedAt: Number(cursor.closedAt) || 0,
                id: String(cursor.id || '')
            } : null;
        const fetchPage = async (pageLimit, pageCursor) => {
            const options = {
                limit: pageLimit,
                direction: 'prev',
                cursor: pageCursor
            };
            if (status) {
                options.prefix = String(status);
                options.lowerBound = [options.prefix, Number.MIN_SAFE_INTEGER, ''];
                options.upperBound = [
                    options.prefix,
                    pageCursor?.closedAt ?? Number.MAX_SAFE_INTEGER,
                    pageCursor?.id || '\uffff'
                ];
                options.upperOpen = Boolean(pageCursor);
            } else if (pageCursor) {
                options.upperBound = [pageCursor.closedAt, pageCursor.id];
                options.upperOpen = true;
            }
            return this.db.getPageByIndex(PAYROLL_CLOSURE_STORE, indexName, options);
        };
        const hasPeriodFilter = Boolean(periodStart || periodEnd);
        let records;
        if (!hasPeriodFilter) {
            records = await fetchPage(normalizedLimit + 1, normalizedCursor);
        } else {
            records = [];
            let scanCursor = normalizedCursor;
            const scanLimit = 100;
            while (records.length <= normalizedLimit) {
                const page = await fetchPage(scanLimit, scanCursor);
                if (page.length === 0) break;
                for (const item of page) {
                    scanCursor = { closedAt: Number(item.closedAt) || 0, id: String(item.id) };
                    const overlapsStart = !periodStart || String(item.periodEnd || '') >= String(periodStart);
                    const overlapsEnd = !periodEnd || String(item.periodStart || '') <= String(periodEnd);
                    if (overlapsStart && overlapsEnd) records.push(item);
                    if (records.length > normalizedLimit) break;
                }
                if (records.length > normalizedLimit || page.length < scanLimit) break;
            }
        }
        const hasMore = records.length > normalizedLimit;
        const items = records.slice(0, normalizedLimit).map(clone);
        const last = items.at(-1);
        return {
            items,
            nextCursor: hasMore && last
                ? { closedAt: Number(last.closedAt) || 0, id: String(last.id) }
                : null
        };
    }

    async getSyncStates(closureIds = []) {
        const ids = [...new Set((closureIds || []).map(String).filter(Boolean))];
        const states = Object.fromEntries(ids.map(id => [id, 'synced']));
        if (ids.length === 0) return states;
        const wanted = new Set(ids);
        const entries = await this.db.getAll('mainSyncOutbox').catch(() => []);
        for (const entry of entries || []) {
            const id = String(entry?.closureId || '');
            if (entry?.kind !== 'payrollClosure' || !wanted.has(id)) continue;
            if (entry.status === 'dead') states[id] = 'dead';
            else if (entry.status === 'pending' && states[id] !== 'dead') states[id] = 'pending';
        }
        return states;
    }
}

export const payrollClosureStore = new PayrollClosureStore();
export default payrollClosureStore;
