/**
 * AttendanceSubmissionInboxStore — SA consumer/validator/pending inbox for
 * frozen F3.4 `attendance-submission/v1` (Mini → SA).
 *
 * Direction-frozen half only: validate + hold pending. This module:
 * - validates the bare JSON body against the exact F3.4 contract,
 * - computes a stable bodyHash for replay protection,
 * - stores ONE pending record per (saProjectId, submissionId),
 * - never writes canonical attendance, never applies, never calls runtime,
 *   never touches Firebase / network / clipboard.
 *
 * Existing `mini-attendance/v1` and MiniAttendanceInboxStore remain frozen
 * and untouched. This is a separate schema with a separate store name.
 *
 * Envelope (exact keys only, no sibling version/checksum):
 *   required: schema, submissionId, saProjectId, scope, deviceId,
 *             rosterVersion, capturedAt, workDate, rows
 *   optional: clientSequence, excludedCount, errorSummary
 *
 * Row (exact keys only, no position/group/leader/private keys):
 *   required: miniLocalId, number, name, normalHours, overtimeHours, status
 *   optional: saEmployeeId
 *
 * Identity: the ONLY employee join key in v1 is
 * (envelope.saProjectId, row.saEmployeeId) when saEmployeeId exists.
 * number/name are display snapshots, never identity. scope
 * {ownerUid, siteId, sourceId} is audit-only and never project authority:
 * siteId is never interpreted as saProjectId.
 */

export const ATTENDANCE_SUBMISSION_SCHEMA = 'attendance-submission/v1';
export const ATTENDANCE_SUBMISSION_INBOX = 'attendanceSubmissionInbox';

export const ATTENDANCE_SUBMISSION_ENVELOPE_KEYS = Object.freeze([
    'schema',
    'submissionId',
    'saProjectId',
    'scope',
    'deviceId',
    'rosterVersion',
    'capturedAt',
    'workDate',
    'rows',
    'clientSequence',
    'excludedCount',
    'errorSummary'
]);

export const ATTENDANCE_SUBMISSION_ROW_KEYS = Object.freeze([
    'miniLocalId',
    'number',
    'name',
    'normalHours',
    'overtimeHours',
    'status',
    'saEmployeeId'
]);

export const ATTENDANCE_SUBMISSION_SCOPE_KEYS = Object.freeze([
    'ownerUid',
    'siteId',
    'sourceId'
]);

export const ATTENDANCE_SUBMISSION_ERROR_SUMMARY_KEYS = Object.freeze([
    'unparsedFragments',
    'codes'
]);

const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SA_ID_MAX_LENGTH = 128;
const SA_ID_FORBIDDEN_RE = /[\s\x00-\x1F\x7F]/;
const WORKDATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${field} is required`);
    }
    return value.trim();
}

function iso(value, field) {
    const result = text(value, field);
    const parsed = new Date(result);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
        throw new TypeError(`${field} must be ISO-8601`);
    }
    return result;
}

function exactKeys(value, allowed, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${field} must be an object`);
    }
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) {
        throw new TypeError(`${field} contains unsafe field "${unknown[0]}"`);
    }
}

/**
 * Local copy of the shared SA ID rule (same as normalizeSaMiniId):
 * trimmed, non-empty, max 128, no whitespace/control. Returns the trimmed
 * id or '' when invalid. Kept local so this inbox has zero imports.
 */
export function normalizeAttendanceSubmissionId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length > SA_ID_MAX_LENGTH) return '';
    if (SA_ID_FORBIDDEN_RE.test(trimmed)) return '';
    return trimmed;
}

function saId(value, field) {
    const normalized = normalizeAttendanceSubmissionId(value);
    if (!normalized) {
        throw new TypeError(
            `${field} must be a canonical ID (trimmed, 1-128 chars, no whitespace/control)`
        );
    }
    return normalized;
}

function scope(value) {
    exactKeys(value, [...ATTENDANCE_SUBMISSION_SCOPE_KEYS], 'scope');
    return {
        ownerUid: text(value.ownerUid, 'scope.ownerUid'),
        siteId: text(value.siteId, 'scope.siteId'),
        sourceId: text(value.sourceId, 'scope.sourceId')
    };
}

function workDate(value) {
    const result = text(value, 'workDate');
    const match = WORKDATE_RE.exec(result);
    if (!match) throw new TypeError('workDate must be YYYY-MM-DD');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) throw new TypeError('workDate must be YYYY-MM-DD');
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) {
        throw new TypeError('workDate must be YYYY-MM-DD');
    }
    const roundTrip = new Date(Date.UTC(year, month - 1, day))
        .toISOString()
        .slice(0, 10);
    if (roundTrip !== result) throw new TypeError('workDate must be YYYY-MM-DD');
    return result;
}

function errorSummary(value) {
    exactKeys(value, [...ATTENDANCE_SUBMISSION_ERROR_SUMMARY_KEYS], 'errorSummary');
    if (!Number.isSafeInteger(value.unparsedFragments) || value.unparsedFragments < 0) {
        throw new TypeError('errorSummary.unparsedFragments must be an integer >= 0');
    }
    if (!Array.isArray(value.codes)) {
        throw new TypeError('errorSummary.codes must be an array');
    }
    for (let index = 0; index < value.codes.length; index++) {
        if (typeof value.codes[index] !== 'string') {
            throw new TypeError(`errorSummary.codes[${index}] must be a string`);
        }
    }
    return {
        unparsedFragments: value.unparsedFragments,
        codes: [...value.codes]
    };
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function attendanceSubmissionBodyHash(value) {
    const input = canonical(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
        hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

export function attendanceSubmissionKey(saProjectId, submissionId) {
    return `${encodeURIComponent(saProjectId)}|${encodeURIComponent(submissionId)}`;
}

function validateRow(row, index) {
    exactKeys(row, [...ATTENDANCE_SUBMISSION_ROW_KEYS], `rows[${index}]`);
    const miniLocalId = text(row.miniLocalId, `rows[${index}].miniLocalId`);
    const number = text(row.number, `rows[${index}].number`);
    const name = text(row.name, `rows[${index}].name`);
    if (!Number.isFinite(row.normalHours) || row.normalHours < 0) {
        throw new TypeError(`rows[${index}].normalHours must be finite and >= 0`);
    }
    if (!Number.isFinite(row.overtimeHours) || row.overtimeHours < 0) {
        throw new TypeError(`rows[${index}].overtimeHours must be finite and >= 0`);
    }
    const total = row.normalHours + row.overtimeHours;
    if (!(total > 0) || total > 24) {
        throw new TypeError(`rows[${index}] hours must sum to > 0 and <= 24`);
    }
    if (row.status !== 'present') {
        throw new TypeError(`rows[${index}].status must be present`);
    }
    const safe = {
        miniLocalId,
        number,
        name,
        normalHours: row.normalHours,
        overtimeHours: row.overtimeHours,
        status: 'present'
    };
    if ('saEmployeeId' in row) {
        safe.saEmployeeId = saId(row.saEmployeeId, `rows[${index}].saEmployeeId`);
    }
    return safe;
}

export function validateAttendanceSubmission(value, expectedSaProjectId) {
    exactKeys(value, [...ATTENDANCE_SUBMISSION_ENVELOPE_KEYS], 'envelope');
    if (value.schema !== ATTENDANCE_SUBMISSION_SCHEMA) {
        throw new TypeError(`schema must be ${ATTENDANCE_SUBMISSION_SCHEMA}`);
    }
    const submissionId = text(value.submissionId, 'submissionId');
    if (!UUID.test(submissionId)) throw new TypeError('submissionId must be a UUID');
    const saProjectId = saId(value.saProjectId, 'saProjectId');
    if (expectedSaProjectId !== undefined && expectedSaProjectId !== null) {
        const expected = normalizeAttendanceSubmissionId(expectedSaProjectId);
        if (!expected) throw new TypeError('expectedSaProjectId must be a canonical ID');
        if (saProjectId !== expected) throw new TypeError('saProjectId mismatch');
    }
    const normalizedScope = scope(value.scope);
    const deviceId = text(value.deviceId, 'deviceId');
    const rosterVersion = text(value.rosterVersion, 'rosterVersion');
    const capturedAt = iso(value.capturedAt, 'capturedAt');
    const workDay = workDate(value.workDate);
    if (!Array.isArray(value.rows) || !value.rows.length) {
        throw new TypeError('rows are required');
    }
    const rows = value.rows.map((row, index) => validateRow(row, index));
    const seenMini = new Set();
    const seenSa = new Set();
    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (seenMini.has(row.miniLocalId)) {
            throw new TypeError(`rows[${index}].miniLocalId is duplicated`);
        }
        seenMini.add(row.miniLocalId);
        if (row.saEmployeeId !== undefined) {
            if (seenSa.has(row.saEmployeeId)) {
                throw new TypeError(`rows[${index}].saEmployeeId is duplicated`);
            }
            seenSa.add(row.saEmployeeId);
        }
    }
    const envelope = {
        schema: ATTENDANCE_SUBMISSION_SCHEMA,
        submissionId,
        saProjectId,
        scope: normalizedScope,
        deviceId,
        rosterVersion,
        capturedAt,
        workDate: workDay,
        rows
    };
    if ('clientSequence' in value) {
        if (!Number.isSafeInteger(value.clientSequence) || value.clientSequence < 1) {
            throw new TypeError('clientSequence must be a positive integer');
        }
        envelope.clientSequence = value.clientSequence;
    }
    if ('excludedCount' in value) {
        if (!Number.isSafeInteger(value.excludedCount) || value.excludedCount < 0) {
            throw new TypeError('excludedCount must be an integer >= 0');
        }
        envelope.excludedCount = value.excludedCount;
    }
    if ('errorSummary' in value) {
        envelope.errorSummary = errorSummary(value.errorSummary);
    }
    return freeze(envelope);
}

export class AttendanceSubmissionReplayConflictError extends Error {
    constructor(saProjectId, submissionId) {
        super(
            `Submission ${submissionId} for project ${saProjectId} was replayed with different content`
        );
        this.name = 'AttendanceSubmissionReplayConflictError';
        this.saProjectId = saProjectId;
        this.submissionId = submissionId;
        this.key = attendanceSubmissionKey(saProjectId, submissionId);
    }
}

export class AttendanceSubmissionInboxStore {
    constructor({ db, now = () => Date.now() } = {}) {
        if (!db) throw new TypeError('db is required');
        this.db = db;
        this.now = now;
    }

    async importJSON(
        raw,
        { expectedSaProjectId, expectedRosterVersion, currentRosterVersion } = {}
    ) {
        if (typeof raw !== 'string') throw new TypeError('raw JSON is required');
        if (expectedSaProjectId === undefined || expectedSaProjectId === null) {
            throw new TypeError('expectedSaProjectId is required');
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new TypeError('raw JSON is malformed');
        }
        const envelope = validateAttendanceSubmission(parsed, expectedSaProjectId);
        const bodyHash = attendanceSubmissionBodyHash(envelope);
        const key = attendanceSubmissionKey(envelope.saProjectId, envelope.submissionId);
        const existing = await this.db.get(ATTENDANCE_SUBMISSION_INBOX, key);
        if (existing) {
            if (existing.bodyHash !== bodyHash) {
                throw new AttendanceSubmissionReplayConflictError(
                    envelope.saProjectId,
                    envelope.submissionId
                );
            }
            return { outcome: 'duplicate', record: freeze(existing) };
        }
        const rosterRef =
            expectedRosterVersion !== undefined && expectedRosterVersion !== null
                ? expectedRosterVersion
                : currentRosterVersion;
        const record = freeze({
            key,
            saProjectId: envelope.saProjectId,
            submissionId: envelope.submissionId,
            status: 'pending',
            receivedAt: this.now(),
            workDate: envelope.workDate,
            rosterVersion: envelope.rosterVersion,
            blockers:
                rosterRef !== undefined &&
                rosterRef !== null &&
                envelope.rosterVersion !== rosterRef
                    ? ['stale_roster']
                    : [],
            bodyHash,
            sourceSnapshot: envelope
        });
        await this.db.update(ATTENDANCE_SUBMISSION_INBOX, record);
        return { outcome: 'imported', record };
    }

    get(saProjectId, submissionId) {
        if (saProjectId === undefined || saProjectId === null) {
            throw new TypeError('saProjectId is required');
        }
        if (submissionId === undefined || submissionId === null) {
            throw new TypeError('submissionId is required');
        }
        return this.db.get(
            ATTENDANCE_SUBMISSION_INBOX,
            attendanceSubmissionKey(String(saProjectId), String(submissionId))
        );
    }

    async list(filter = null) {
        const records = await this.db.getAll(ATTENDANCE_SUBMISSION_INBOX);
        if (!filter || typeof filter !== 'object') return records;
        const { saProjectId, workDate, status } = filter;
        if (!saProjectId && !workDate && !status) return records;
        return records.filter(record => {
            if (saProjectId && record.saProjectId !== saProjectId) return false;
            if (workDate && record.workDate !== workDate) return false;
            if (status && record.status !== status) return false;
            return true;
        });
    }

    listByProject(saProjectId) {
        if (saProjectId === undefined || saProjectId === null) {
            throw new TypeError('saProjectId is required');
        }
        return this.list({ saProjectId: String(saProjectId) });
    }

    async importSubmission(
        input,
        { expectedSaProjectId, expectedRosterVersion, currentRosterVersion } = {}
    ) {
        const raw = typeof input === 'string' ? input : JSON.stringify(input);
        return this.importJSON(raw, { expectedSaProjectId, expectedRosterVersion, currentRosterVersion });
    }

    async updateStatus(
        saProjectId,
        submissionId,
        nextStatus,
        { blockers = null, metadata = null } = {}
    ) {
        if (saProjectId === undefined || saProjectId === null) {
            throw new TypeError('saProjectId is required');
        }
        if (submissionId === undefined || submissionId === null) {
            throw new TypeError('submissionId is required');
        }
        const cleanStatus = text(nextStatus, 'status');
        const key = attendanceSubmissionKey(String(saProjectId), String(submissionId));
        const existing = await this.db.get(ATTENDANCE_SUBMISSION_INBOX, key);
        if (!existing) {
            throw new Error(
                `Submission ${submissionId} for project ${saProjectId} not found`
            );
        }
        const updated = freeze({
            ...existing,
            status: cleanStatus,
            updatedAt: this.now(),
            ...(blockers !== null ? { blockers: [...blockers] } : {}),
            ...(metadata !== null
                ? { metadata: { ...(existing.metadata || {}), ...metadata } }
                : {})
        });
        await this.db.update(ATTENDANCE_SUBMISSION_INBOX, updated);
        return updated;
    }

    async delete(saProjectId, submissionId) {
        if (saProjectId === undefined || saProjectId === null) {
            throw new TypeError('saProjectId is required');
        }
        if (submissionId === undefined || submissionId === null) {
            throw new TypeError('submissionId is required');
        }
        const key = attendanceSubmissionKey(String(saProjectId), String(submissionId));
        if (typeof this.db.delete === 'function') {
            await this.db.delete(ATTENDANCE_SUBMISSION_INBOX, key);
            return true;
        }
        return false;
    }
}
