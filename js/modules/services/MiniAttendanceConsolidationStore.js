import indexedDBService from './IndexedDBService.js';

export const MINI_ATTENDANCE_CONSOLIDATIONS_STORE = 'miniAttendanceConsolidations';
export const MINI_ATTENDANCE_CONSOLIDATION_STATUSES = Object.freeze([
    'resolving',
    'mini_consolidated',
    'comparing_sa',
    'ready_to_apply',
    'incorporated',
    'discarded'
]);

function clone(value) {
    if (value === null || value === undefined) return value;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function requiredText(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
    return value.trim();
}

function normalizeStatus(status) {
    if (!MINI_ATTENDANCE_CONSOLIDATION_STATUSES.includes(status)) {
        throw new TypeError(`Invalid consolidation status: ${status}`);
    }
    return status;
}

export function miniAttendanceConsolidationKey(saProjectId, consolidationId) {
    return `${encodeURIComponent(requiredText(saProjectId, 'saProjectId'))}|${encodeURIComponent(requiredText(consolidationId, 'consolidationId'))}`;
}

function sourceRefs(sourceDrafts = []) {
    return (Array.isArray(sourceDrafts) ? sourceDrafts : []).map(draft => ({
        submissionId: draft?.submissionId || draft?.sourceSnapshot?.submissionId || null,
        bodyHash: draft?.bodyHash || null,
        workDate: draft?.workDate || draft?.sourceSnapshot?.workDate || null,
        deviceId: draft?.sourceSnapshot?.deviceId || null,
        receivedAt: draft?.receivedAt || null,
        updatedAt: draft?.updatedAt || null,
        seriesKey: draft?.versioning?.seriesKey || null,
        versionRole: draft?.versioning?.role || null,
        semanticHash: draft?.versioning?.semanticHash || null
    })).filter(ref => ref.submissionId);
}

function baseRecord({ consolidationId, saProjectId, revision = 1, status, createdAt, updatedAt, sourceDrafts = [] }) {
    const id = requiredText(consolidationId, 'consolidationId');
    const project = requiredText(saProjectId, 'saProjectId');
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision must be a positive integer');
    return {
        key: miniAttendanceConsolidationKey(project, id),
        consolidationId: id,
        saProjectId: project,
        revision,
        status: normalizeStatus(status),
        sourceRefs: sourceRefs(sourceDrafts),
        createdAt,
        updatedAt
    };
}

export class MiniAttendanceConsolidationStore {
    constructor({ db = indexedDBService, now = () => Date.now() } = {}) {
        this.db = db;
        this.now = now;
    }

    async saveProgress({ consolidationId, snapshot, sourceDrafts = [], revision = 1 } = {}) {
        if (!snapshot || snapshot.schema !== 'mini-attendance-consolidation-progress/v1') {
            throw new TypeError('Valid Mini consolidation progress snapshot is required');
        }
        const existing = await this.get(snapshot.saProjectId, consolidationId);
        const now = this.now();
        const record = {
            ...baseRecord({
                consolidationId,
                saProjectId: snapshot.saProjectId,
                revision,
                status: 'resolving',
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                sourceDrafts
            }),
            schema: snapshot.schema,
            sourceSubmissionIds: [...(snapshot.sourceSubmissionIds || [])],
            workDates: [...(snapshot.workDates || [])],
            completedDays: [...(snapshot.completedDays || [])],
            devices: [...(snapshot.devices || [])],
            contributingSubmissions: clone(snapshot.contributingSubmissions || []),
            items: clone(snapshot.items || []),
            summary: clone(snapshot.summary || {}),
            sourceRefs: sourceDrafts.length ? sourceRefs(sourceDrafts) : clone(existing?.sourceRefs || [])
        };
        await this.db.update(MINI_ATTENDANCE_CONSOLIDATIONS_STORE, record);
        return clone(record);
    }

    async saveConsolidated(draft, { sourceDrafts = [] } = {}) {
        if (!draft || draft.schema !== 'mini-attendance-consolidated/v1') {
            throw new TypeError('Valid Mini consolidated draft is required');
        }
        const existing = await this.get(draft.saProjectId, draft.consolidationId);
        const now = this.now();
        const record = {
            ...baseRecord({
                consolidationId: draft.consolidationId,
                saProjectId: draft.saProjectId,
                revision: draft.revision || existing?.revision || 1,
                status: 'mini_consolidated',
                createdAt: existing?.createdAt || draft.createdAt || now,
                updatedAt: now,
                sourceDrafts
            }),
            ...clone(draft),
            key: miniAttendanceConsolidationKey(draft.saProjectId, draft.consolidationId),
            status: 'mini_consolidated',
            sourceRefs: sourceDrafts.length ? sourceRefs(sourceDrafts) : clone(existing?.sourceRefs || []),
            createdAt: existing?.createdAt || draft.createdAt || now,
            updatedAt: now
        };
        await this.db.update(MINI_ATTENDANCE_CONSOLIDATIONS_STORE, record);
        return clone(record);
    }

    async get(saProjectId, consolidationId) {
        const key = miniAttendanceConsolidationKey(saProjectId, consolidationId);
        return clone(await this.db.get(MINI_ATTENDANCE_CONSOLIDATIONS_STORE, key) || null);
    }

    async list({ saProjectId = null, status = null, includeDiscarded = false } = {}) {
        const all = clone(await this.db.getAll(MINI_ATTENDANCE_CONSOLIDATIONS_STORE) || []);
        return all.filter(record => {
            if (saProjectId && record.saProjectId !== saProjectId) return false;
            if (status && record.status !== status) return false;
            if (!includeDiscarded && record.status === 'discarded') return false;
            return true;
        }).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

    async updateStatus(saProjectId, consolidationId, status, patch = {}) {
        const existing = await this.get(saProjectId, consolidationId);
        if (!existing) throw new Error(`Consolidation not found: ${consolidationId}`);
        const now = this.now();
        const record = {
            ...existing,
            ...clone(patch),
            key: existing.key,
            consolidationId: existing.consolidationId,
            saProjectId: existing.saProjectId,
            status: normalizeStatus(status),
            updatedAt: now
        };
        await this.db.update(MINI_ATTENDANCE_CONSOLIDATIONS_STORE, record);
        return clone(record);
    }

    async discard(saProjectId, consolidationId, reason = null) {
        return this.updateStatus(saProjectId, consolidationId, 'discarded', {
            discardedAt: this.now(),
            discardReason: reason || null
        });
    }
}

export const miniAttendanceConsolidationStore = new MiniAttendanceConsolidationStore();
export default miniAttendanceConsolidationStore;
