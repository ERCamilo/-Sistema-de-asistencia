import indexedDBService from '../../services/IndexedDBService.js';
import {
    isSamePayrollClosureContent,
    PAYROLL_CLOSURE_STATUS,
    voidPayrollClosure
} from './PayrollClosure.js';

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

export class PayrollClosureConflictError extends Error {
    constructor(existing, incoming) {
        super(`Payroll closure content conflict: ${incoming?.id || existing?.id || 'unknown'}`);
        this.name = 'PayrollClosureConflictError';
        this.existing = clone(existing);
        this.incoming = clone(incoming);
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
            existing => {
                if (existing) {
                    if (!isSamePayrollClosureContent(existing, incoming)) {
                        throw new PayrollClosureConflictError(existing, incoming);
                    }
                    // Business audit is monotonic: a stale device cannot revive a voided
                    // closure, and a repeated void cannot replace the original audit actor.
                    if (existing.status === PAYROLL_CLOSURE_STATUS.VOIDED ||
                        incoming.status === existing.status) {
                        return { write: false, value: clone(existing) };
                    }
                }
                return { write: true, value: incoming };
            }
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

    async getActiveByPeriod(periodStart, periodEnd) {
        const records = await this.db.query(
            PAYROLL_CLOSURE_STORE,
            'periodKey',
            periodKey(periodStart, periodEnd)
        );
        return (records || [])
            .filter(item => item.status === PAYROLL_CLOSURE_STATUS.CLOSED)
            .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0))
            .map(clone);
    }

    async listPage({ limit = 20, status = null, cursor = null } = {}) {
        const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 20)));
        const indexName = status ? 'statusClosedAtId' : 'closedAtId';
        const options = {
            limit: normalizedLimit + 1,
            direction: 'prev',
            cursor: cursor ? {
                closedAt: Number(cursor.closedAt) || 0,
                id: String(cursor.id || '')
            } : null
        };

        if (status) {
            options.prefix = String(status);
            options.lowerBound = [options.prefix, Number.MIN_SAFE_INTEGER, ''];
            options.upperBound = [
                options.prefix,
                options.cursor?.closedAt ?? Number.MAX_SAFE_INTEGER,
                options.cursor?.id || '\uffff'
            ];
            options.upperOpen = Boolean(options.cursor);
        } else if (options.cursor) {
            options.upperBound = [options.cursor.closedAt, options.cursor.id];
            options.upperOpen = true;
        }

        const records = await this.db.getPageByIndex(
            PAYROLL_CLOSURE_STORE,
            indexName,
            options
        );
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
}

export const payrollClosureStore = new PayrollClosureStore();
export default payrollClosureStore;
