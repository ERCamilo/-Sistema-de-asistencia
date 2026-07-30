const INBOX = 'miniAttendanceInbox';
const ENVELOPE_SCHEMA = 'mini-attendance/v1';
const ROSTER_SCHEMA = 'mini-roster/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function text(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
    return value.trim();
}
function iso(value, field) {
    const result = text(value, field);
    if (new Date(result).toISOString() !== result) throw new TypeError(`${field} must be ISO-8601`);
    return result;
}
function exactKeys(value, allowed, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${field} must be an object`);
    }
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new TypeError(`${field} contains unsafe field "${unknown[0]}"`);
}
function scope(value) {
    exactKeys(value, ['ownerUid', 'siteId', 'sourceId'], 'scope');
    return {
        ownerUid: text(value.ownerUid, 'scope.ownerUid'),
        siteId: text(value.siteId, 'scope.siteId'),
        sourceId: text(value.sourceId, 'scope.sourceId')
    };
}
function scopeKey(value) {
    return [value.ownerUid, value.siteId, value.sourceId]
        .map(part => encodeURIComponent(part)).join('|');
}
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort()
            .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
export function miniIntegrityChecksum(value) {
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

export function validateMiniAttendanceEnvelope(value, expectedScope) {
    exactKeys(value, [
        'schema', 'eventId', 'scope', 'deviceId', 'clientSequence',
        'rosterVersion', 'capturedAt', 'rows'
    ], 'envelope');
    if (value.schema !== ENVELOPE_SCHEMA) throw new TypeError(`schema must be ${ENVELOPE_SCHEMA}`);
    const eventId = text(value.eventId, 'eventId');
    if (!UUID.test(eventId)) throw new TypeError('eventId must be a UUID');
    if (!Number.isSafeInteger(value.clientSequence) || value.clientSequence < 1) {
        throw new TypeError('clientSequence must be a positive integer');
    }
    if (!Array.isArray(value.rows) || !value.rows.length) throw new TypeError('rows are required');
    const normalizedScope = scope(value.scope);
    if (expectedScope && scopeKey(normalizedScope) !== scopeKey(scope(expectedScope))) {
        throw new TypeError('Envelope scope mismatch');
    }
    const rows = value.rows.map((row, index) => {
        exactKeys(row, ['sourceEmployeeId', 'number', 'name', 'status', 'hours'], `rows[${index}]`);
        if (row.status !== 'present') throw new TypeError(`rows[${index}].status must be present`);
        if (!Number.isFinite(row.hours) || row.hours <= 0 || row.hours > 24) {
            throw new TypeError(`rows[${index}].hours must be greater than 0 and at most 24`);
        }
        return {
            sourceEmployeeId: text(row.sourceEmployeeId, `rows[${index}].sourceEmployeeId`),
            number: text(row.number, `rows[${index}].number`),
            name: text(row.name, `rows[${index}].name`),
            status: 'present',
            hours: row.hours
        };
    });
    return freeze({
        schema: ENVELOPE_SCHEMA,
        eventId,
        scope: normalizedScope,
        deviceId: text(value.deviceId, 'deviceId'),
        clientSequence: value.clientSequence,
        rosterVersion: text(value.rosterVersion, 'rosterVersion'),
        capturedAt: iso(value.capturedAt, 'capturedAt'),
        rows
    });
}

export class MiniAttendanceReplayConflictError extends Error {
    constructor(eventId) {
        super(`Event ${eventId} was replayed with different content`);
        this.name = 'MiniAttendanceReplayConflictError';
        this.eventId = eventId;
    }
}

export class MiniAttendanceInboxStore {
    constructor({ db, now = () => Date.now() } = {}) {
        if (!db) throw new TypeError('db is required');
        this.db = db;
        this.now = now;
    }
    async importJSON(raw, { expectedScope, currentRosterVersion } = {}) {
        if (typeof raw !== 'string') throw new TypeError('raw JSON is required');
        const envelope = validateMiniAttendanceEnvelope(JSON.parse(raw), expectedScope);
        const bodyHash = miniIntegrityChecksum(envelope);
        const existing = await this.db.get(INBOX, envelope.eventId);
        if (existing) {
            if (existing.bodyHash !== bodyHash) {
                throw new MiniAttendanceReplayConflictError(envelope.eventId);
            }
            return { outcome: 'duplicate', record: freeze(existing) };
        }
        const record = freeze({
            eventId: envelope.eventId,
            scopeKey: scopeKey(envelope.scope),
            status: 'pending',
            receivedAt: this.now(),
            rosterVersion: envelope.rosterVersion,
            blockers: currentRosterVersion &&
                envelope.rosterVersion !== currentRosterVersion ? ['stale_roster'] : [],
            bodyHash,
            sourceSnapshot: envelope
        });
        await this.db.update(INBOX, record);
        return { outcome: 'imported', record };
    }
    get(eventId) {
        return this.db.get(INBOX, eventId);
    }
    list() {
        return this.db.getAll(INBOX);
    }
}

export function createMiniRosterPackage({ scope: rawScope, rosterVersion, generatedAt, employees }) {
    if (!Array.isArray(employees)) throw new TypeError('employees must be an array');
    const ids = new Set();
    const safeEmployees = employees.map((employee, index) => {
        const id = text(employee?.id, `employees[${index}].id`);
        if (ids.has(id)) throw new TypeError(`duplicate employee id "${id}"`);
        ids.add(id);
        const safe = {
            id,
            number: text(employee.number, `employees[${index}].number`),
            name: text(employee.name, `employees[${index}].name`)
        };
        if (employee.position != null) safe.position = text(employee.position, `employees[${index}].position`);
        return safe;
    });
    const body = {
        schema: ROSTER_SCHEMA,
        scope: scope(rawScope),
        rosterVersion: text(rosterVersion, 'rosterVersion'),
        generatedAt: iso(generatedAt, 'generatedAt'),
        employees: safeEmployees
    };
    return freeze({ ...body, checksum: miniIntegrityChecksum(body) });
}

export function exportMiniRosterJSON(input) {
    return JSON.stringify(createMiniRosterPackage(input));
}

export const MINI_ROSTER_CHECKSUM_NOTICE =
    'Integrity checksum only; not an authenticity signature.';
