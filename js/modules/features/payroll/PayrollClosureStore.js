import indexedDBService from '../../services/IndexedDBService.js';
import {
    PAYROLL_CLOSURE_STATUS,
    validatePayrollClosureForScopedWrite,
    voidPayrollClosure
} from './PayrollClosure.js';
import {
    resolvePayrollClosureMutation
} from './PayrollClosureMerge.js';
import { assertPayrollClosureSize } from './PayrollClosureSize.js';
import { assertTandaBBlockedWhenScoped } from '../../config/TandaBGate.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import {
    captureEntityProjectScope,
    peekEntityScope
} from '../projects/EntityProjectScope.js';

export { PayrollClosureConflictError } from './PayrollClosureMerge.js';

export const PAYROLL_CLOSURE_STORE = 'payrollClosures';
export const PAYROLL_EMPLOYEE_SCHEMA_MIN = 2;

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

function captureScopedProjectId() {
    if (!isProjectsEnabled()) return null;
    const scope = captureEntityProjectScope();
    if (!scope?.enabled || !scope.projectId) return null;
    const pid = String(scope.projectId).trim();
    if (!pid || pid.startsWith('legacy-unresolved:')) return null;
    return pid;
}

function ensureNotStale(capturedPid) {
    if (capturedPid == null) return;
    if (!isProjectsEnabled()) {
        const err = new Error('Payroll closure read stale: projects disabled mid-read');
        err.code = 'PAYROLL_CLOSURE_STALE_READ';
        err.name = 'PayrollClosureStaleReadError';
        throw err;
    }
    const cur = peekEntityScope();
    const curPid = cur?.projectId ? String(cur.projectId) : null;
    if (!cur?.enabled || curPid !== capturedPid) {
        const err = new Error('Payroll closure read stale: project switched');
        err.code = 'PAYROLL_CLOSURE_STALE_READ';
        err.name = 'PayrollClosureStaleReadError';
        throw err;
    }
}

function ownsClosure(record, pid) {
    if (!record) return false;
    return String(record.projectId || '') === String(pid);
}

export class PayrollClosureStore {
    constructor({ db = indexedDBService } = {}) {
        this.db = db;
    }

    async save(closure) {
        assertTandaBBlockedWhenScoped('PayrollClosureStore.save');
        assertClosure(closure);
        assertPayrollClosureSize(closure);
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

    async importRemote(closure, { scope = undefined } = {}) {
        if (!isProjectsEnabled()) return this.save(closure);
        const capturedPid = scope === undefined ? captureScopedProjectId() :
            String(scope?.projectId || '').trim() || null;
        if (capturedPid == null) {
            throw new Error('A canonical project is required for scoped payroll closure imports');
        }
        ensureNotStale(capturedPid);
        validatePayrollClosureForScopedWrite(closure, capturedPid);
        assertPayrollClosureSize(closure);
        const incoming = { ...clone(closure), periodKey: periodKey(closure.periodStart, closure.periodEnd) };
        const saved = await this.db.atomicMutate(
            PAYROLL_CLOSURE_STORE,
            incoming.id,
            existing => {
                ensureNotStale(capturedPid);
                return resolvePayrollClosureMutation(existing, incoming);
            }
        );
        ensureNotStale(capturedPid);
        return clone(saved);
    }

    async saveWithEmployees(closure, employees = [], {
        enqueueCloud = false,
        queuedAt = Date.now(),
        schemaVersion = null
    } = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureStore.saveWithEmployees');
        assertClosure(closure);
        assertPayrollClosureSize(closure);
        if (enqueueCloud && Number(schemaVersion) < PAYROLL_EMPLOYEE_SCHEMA_MIN) {
            throw new TypeError(
                `Payroll closure cloud bundle requires employee schema ${PAYROLL_EMPLOYEE_SCHEMA_MIN} or newer`
            );
        }
        const incoming = {
            ...clone(closure),
            periodKey: periodKey(closure.periodStart, closure.periodEnd)
        };
        const batches = [{ storeName: 'employees', records: clone(employees || []) }];
        if (enqueueCloud) {
            batches.push({
                storeName: 'mainSyncOutbox',
                records: [{
                    key: `payroll:${incoming.id}`,
                    kind: 'payrollClosureBundle',
                    closureId: incoming.id,
                    closure: incoming,
                    employees: clone(employees || []),
                    schemaVersion: Number(schemaVersion),
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
        const normalizedId = String(id || '');
        if (!isProjectsEnabled()) {
            return clone(await this.db.get(PAYROLL_CLOSURE_STORE, normalizedId) || null);
        }
        const pid = captureScopedProjectId();
        if (pid == null) return null;
        const record = await this.db.get(PAYROLL_CLOSURE_STORE, normalizedId);
        ensureNotStale(pid);
        if (!ownsClosure(record, pid)) return null;
        return clone(record);
    }

    async void(id, audit = {}) {
        assertTandaBBlockedWhenScoped('PayrollClosureStore.void');
        const existing = await this.getById(id);
        if (!existing) throw new Error(`Payroll closure not found: ${id}`);
        return this.save(voidPayrollClosure(existing, audit));
    }

    async getByPeriod(periodStart, periodEnd) {
        if (!isProjectsEnabled()) {
            const records = await this.db.query(
                PAYROLL_CLOSURE_STORE,
                'periodKey',
                periodKey(periodStart, periodEnd)
            );
            return (records || [])
                .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0))
                .map(clone);
        }
        const pid = captureScopedProjectId();
        if (pid == null) return [];
        const records = await this.db.query(PAYROLL_CLOSURE_STORE, 'projectId', pid);
        ensureNotStale(pid);
        const wantedKey = periodKey(periodStart, periodEnd);
        return (records || [])
            .filter(item => String(item.periodKey || '') === String(wantedKey) && ownsClosure(item, pid))
            .sort((left, right) => Number(right.closedAt || 0) - Number(left.closedAt || 0))
            .map(clone);
    }

    async getActiveByPeriod(periodStart, periodEnd) {
        if (!isProjectsEnabled()) {
            const records = await this.getByPeriod(periodStart, periodEnd);
            return records.filter(item => item.status === PAYROLL_CLOSURE_STATUS.CLOSED);
        }
        const pid = captureScopedProjectId();
        if (pid == null) return [];
        const records = await this.getByPeriod(periodStart, periodEnd);
        ensureNotStale(pid);
        return records.filter(item => item.status === PAYROLL_CLOSURE_STATUS.CLOSED);
    }

    async listPage({
        limit = 20,
        status = null,
        cursor = null,
        periodStart = null,
        periodEnd = null
    } = {}) {
        if (!isProjectsEnabled()) {
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
        const pid = captureScopedProjectId();
        if (pid == null) return { items: [], nextCursor: null };
        const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 20)));
        const normalizedCursor = cursor ? {
                closedAt: Number(cursor.closedAt) || 0,
                id: String(cursor.id || '')
            } : null;
        const hasPeriodFilter = Boolean(periodStart || periodEnd);
        const fetchScopedPage = async (pageLimit, pageCursor) => {
            const options = {
                limit: pageLimit,
                direction: 'prev'
            };
            if (status) {
                options.lowerBound = [pid, String(status), Number.MIN_SAFE_INTEGER, ''];
                options.upperBound = [
                    pid,
                    String(status),
                    pageCursor?.closedAt ?? Number.MAX_SAFE_INTEGER,
                    pageCursor?.id || '\uffff'
                ];
                options.lowerOpen = false;
                options.upperOpen = Boolean(pageCursor);
                const page = await this.db.getPageByIndex(PAYROLL_CLOSURE_STORE, 'projectStatusClosedAtId', options);
                ensureNotStale(pid);
                return page;
            }
            options.lowerBound = [pid, Number.MIN_SAFE_INTEGER, ''];
            options.upperBound = [pid, pageCursor?.closedAt ?? Number.MAX_SAFE_INTEGER, pageCursor?.id || '\uffff'];
            options.lowerOpen = false;
            options.upperOpen = Boolean(pageCursor);
            const page = await this.db.getPageByIndex(PAYROLL_CLOSURE_STORE, 'projectClosedAtId', options);
            ensureNotStale(pid);
            return page;
        };
        let records;
        if (!hasPeriodFilter) {
            records = await fetchScopedPage(normalizedLimit + 1, normalizedCursor);
        } else {
            records = [];
            let scanCursor = normalizedCursor;
            const scanLimit = 100;
            while (records.length <= normalizedLimit) {
                const page = await fetchScopedPage(scanLimit, scanCursor);
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
        if (!isProjectsEnabled()) {
            const wanted = new Set(ids);
            const entries = await this.db.getAll('mainSyncOutbox').catch(() => []);
            for (const entry of entries || []) {
                const id = String(entry?.closureId || '');
                if (!['payrollClosure', 'payrollClosureBundle'].includes(entry?.kind) || !wanted.has(id)) continue;
                if (entry.status === 'dead') states[id] = 'dead';
                else if (entry.status === 'pending' && states[id] !== 'dead') states[id] = 'pending';
            }
            return states;
        }
        const pid = captureScopedProjectId();
        if (pid == null) return states;
        const wanted = new Set(ids);
        const ownedRecords = await this.db.query(PAYROLL_CLOSURE_STORE, 'projectId', pid).catch(() => []);
        ensureNotStale(pid);
        const ownedIds = new Set(
            (ownedRecords || [])
                .filter(item => wanted.has(String(item.id)) && ownsClosure(item, pid))
                .map(item => String(item.id))
        );
        const entries = await this.db.getAll('mainSyncOutbox').catch(() => []);
        ensureNotStale(pid);
        for (const entry of entries || []) {
            const id = String(entry?.closureId || '');
            if (!ownedIds.has(id)) continue;
            if (!['payrollClosure', 'payrollClosureBundle'].includes(entry?.kind)) continue;
            if (entry.status === 'dead') states[id] = 'dead';
            else if (entry.status === 'pending' && states[id] !== 'dead') states[id] = 'pending';
        }
        return states;
    }
}

export const payrollClosureStore = new PayrollClosureStore();
export default payrollClosureStore;
