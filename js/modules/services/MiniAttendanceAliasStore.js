import indexedDBService from './IndexedDBService.js';
import {
    normalizeMiniAttendanceName,
    normalizeMiniAttendanceNumber
} from '../features/attendance/MiniAttendanceDraft.js';

const ALIASES = 'miniAttendanceAliases';
const AUDIT = 'miniAttendanceAliasAudit';
export const DEFAULT_MINI_ATTENDANCE_SITE_ID = 'sa-current-site';
export const DEFAULT_MINI_ATTENDANCE_SOURCE_ID = 'mini-whatsapp';

export function buildDefaultMiniAttendanceAliasScope(ownerUid) {
    return {
        ownerUid: String(ownerUid || 'local-device'),
        siteId: DEFAULT_MINI_ATTENDANCE_SITE_ID,
        sourceId: DEFAULT_MINI_ATTENDANCE_SOURCE_ID
    };
}

function required(value, field) {
    const normalized = String(value ?? '').trim();
    if (!normalized) throw new TypeError(`${field} is required`);
    return normalized;
}

function encodedTuple(values) {
    return values.map(value => encodeURIComponent(value)).join('|');
}

export function normalizeMiniAttendanceAliasScope(scope = {}) {
    const ownerUid = required(scope.ownerUid, 'ownerUid');
    const siteId = required(scope.siteId, 'siteId');
    const sourceId = required(scope.sourceId, 'sourceId');
    return {
        ownerUid,
        siteId,
        sourceId,
        scopeKey: encodedTuple([ownerUid, siteId, sourceId])
    };
}

function identity(scope, rawNumber, rawName) {
    const normalizedScope = normalizeMiniAttendanceAliasScope(scope);
    const sourceNumberNormalized = normalizeMiniAttendanceNumber(rawNumber);
    const sourceNameNormalized = normalizeMiniAttendanceName(rawName);
    if (!sourceNumberNormalized || !sourceNameNormalized) {
        throw new TypeError('Alias source number and name are required');
    }
    return {
        ...normalizedScope,
        sourceNumberNormalized,
        sourceNameNormalized,
        aliasId: encodedTuple([
            'mini-alias-v1',
            normalizedScope.ownerUid,
            normalizedScope.siteId,
            normalizedScope.sourceId,
            sourceNumberNormalized,
            sourceNameNormalized
        ])
    };
}

function employeeIsEligible(employee) {
    return !!employee && employee.active !== false && employee.deletedAt == null;
}

export class MiniAttendanceAliasConflictError extends Error {
    constructor(existing, proposedTargetEmployeeId) {
        super(`Alias already targets employee ${existing.targetEmployeeId}`);
        this.name = 'MiniAttendanceAliasConflictError';
        this.existing = existing;
        this.proposedTargetEmployeeId = proposedTargetEmployeeId;
    }
}

export class MiniAttendanceAliasStore {
    constructor({ db = indexedDBService, now = () => Date.now() } = {}) {
        this.db = db;
        this.now = now;
        this.auditSequence = 0;
    }

    async _write(alias, eventType, previousTargetEmployeeId = null, actorUid = null) {
        const at = this.now();
        const audit = {
            auditId: encodedTuple([
                alias.aliasId,
                String(alias.revision),
                eventType,
                String(at),
                String(++this.auditSequence)
            ]),
            aliasId: alias.aliasId,
            scopeKey: alias.scopeKey,
            eventType,
            revision: alias.revision,
            previousTargetEmployeeId,
            targetEmployeeId: alias.targetEmployeeId,
            actorUid,
            at
        };
        await this.db.atomicUpdate([
            { storeName: ALIASES, data: alias },
            { storeName: AUDIT, data: audit }
        ]);
        return alias;
    }

    async record(input, options = {}) {
        const key = identity(input.scope, input.rawNumber, input.rawName);
        const targetEmployeeId = required(input.targetEmployeeId, 'targetEmployeeId');
        const existing = await this.db.get(ALIASES, key.aliasId);
        if (existing && existing.targetEmployeeId !== targetEmployeeId &&
            options.allowReplace !== true) {
            throw new MiniAttendanceAliasConflictError(existing, targetEmployeeId);
        }
        const at = this.now();
        const alias = {
            ...key,
            sourceNumberSnapshot: String(input.rawNumber).trim(),
            sourceNameSnapshot: String(input.rawName).trim(),
            targetEmployeeId,
            targetNumberSnapshot: input.targetNumberSnapshot ?? null,
            targetNameSnapshot: input.targetNameSnapshot ?? null,
            revision: (existing?.revision || 0) + 1,
            active: true,
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
            tombstonedAt: null
        };
        const eventType = !existing ? 'created'
            : existing.targetEmployeeId === targetEmployeeId ? 'refreshed' : 'replaced';
        return this._write(alias, eventType, existing?.targetEmployeeId || null, options.actorUid);
    }

    async forget(input, options = {}) {
        const key = identity(input.scope, input.rawNumber, input.rawName);
        const existing = await this.db.get(ALIASES, key.aliasId);
        if (!existing) return null;
        const at = this.now();
        return this._write({
            ...existing,
            revision: existing.revision + 1,
            active: false,
            updatedAt: at,
            tombstonedAt: at
        }, 'forgotten', existing.targetEmployeeId, options.actorUid);
    }

    async lookup({ scope, rawNumber, rawName, employees = [] }) {
        const key = identity(scope, rawNumber, rawName);
        const alias = await this.db.get(ALIASES, key.aliasId);
        if (!alias) return { status: 'missing', alias: null, employee: null };
        if (alias.scopeKey !== key.scopeKey || alias.ownerUid !== key.ownerUid ||
            alias.siteId !== key.siteId || alias.sourceId !== key.sourceId) {
            return { status: 'stale', reason: 'scope_mismatch', alias, employee: null };
        }
        if (alias.sourceNumberNormalized !== key.sourceNumberNormalized ||
            alias.sourceNameNormalized !== key.sourceNameNormalized) {
            return { status: 'stale', reason: 'identity_mismatch', alias, employee: null };
        }
        if (!alias.active || alias.tombstonedAt != null) {
            return { status: 'stale', reason: 'tombstoned', alias, employee: null };
        }
        const employee = employees.find(item => item.id === alias.targetEmployeeId);
        if (!employee) return { status: 'stale', reason: 'target_missing', alias, employee: null };
        if (!employeeIsEligible(employee)) {
            return { status: 'stale', reason: 'target_inactive', alias, employee: null };
        }
        return { status: 'remembered', alias, employee };
    }

    async list(scope, { includeInactive = false } = {}) {
        const normalizedScope = normalizeMiniAttendanceAliasScope(scope);
        const aliases = await this.db.query(ALIASES, 'scopeKey', normalizedScope.scopeKey);
        return aliases
            .filter(alias => includeInactive || (alias.active === true && alias.tombstonedAt == null))
            .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    }

    async forgetAll(scope, options = {}) {
        const aliases = await this.list(scope);
        for (const alias of aliases) {
            await this.forget({
                scope,
                rawNumber: alias.sourceNumberSnapshot,
                rawName: alias.sourceNameSnapshot
            }, options);
        }
        return { forgottenCount: aliases.length };
    }

    async history(aliasId) {
        return this.db.query(AUDIT, 'aliasId', aliasId);
    }
}

export const miniAttendanceAliasStore = new MiniAttendanceAliasStore();
export default MiniAttendanceAliasStore;
