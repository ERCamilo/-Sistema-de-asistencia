/**
 * 🔧 ProjectOwnershipRepairService.js — R07 A2b (application service)
 *
 * Explicit, reusable, durable service the future UI calls to repair already-
 * damaged project ownership after the user has chosen a resolution action.
 * Orchestration only: all classification/planning logic lives in the pure A1
 * module (ProjectOwnershipReconciliation.js).
 *
 * Supported actions (A2b scope):
 *   MAP_TO_EXISTING        — map selected entities to a valid durable project.
 *   CREATE_PROJECT_AND_MAP — create a recovery project, then map in one tx.
 *   QUARANTINE             — persist legacy-unresolved: sentinel and record provenance.
 *   RESOLVE_LATER          — alias for QUARANTINE (user deferred without choosing).
 *
 * Unsupported (A2b): archive, delete. Returns a stable unsupported result.
 *
 * ─── Durable-truth contract (A2c-1) ──────────────────────────────────────────
 *
 * Caller-selected employee objects are SELECTORS ONLY. Their ids are resolved,
 * but authoritative employees / projects / attendance / positions / leaders
 * are read from IndexedDB inside the SAME readwrite transaction that performs
 * the repair. A forged or stale caller catalog never authorizes a target:
 *   - MAP_TO_EXISTING validates the target against DURABLE projects.
 *   - CREATE_PROJECT_AND_MAP decides existence from DURABLE projects and only
 *     treats an existing id as a safe retry when its identity is compatible.
 *
 * Read-modify-write runs inside ONE native readwrite IDB transaction spanning
 * every store the action needs. Reads (getAll / get) are issued at transaction
 * start; writes are performed synchronously from the final read callback while
 * the transaction is still active. Any request error / abort rejects the
 * promise and leaves both durable state and in-memory state unchanged.
 *
 * Only OWNERSHIP fields are mutated, on the freshest durable objects. Unrelated
 * employee fields (loans/payments/name/salary/positions/…) and unrelated
 * attendance fields are preserved. The post-commit memory update is likewise
 * field-scoped: it merges the repaired projectId into the CURRENT in-memory
 * objects instead of replacing them with durable/caller snapshots, preserving
 * unsaved in-memory edits captured by a suspended save.
 *
 * Idempotency:
 *   - MAP_TO_EXISTING is NO_OP only when both the employee AND all of its
 *     canonically-owned attendance already carry the target projectId.
 *   - QUARANTINE is NO_OP only when the employee AND all of its canonically-
 *     owned attendance already carry the same quarantine id.
 */

import indexedDBService from '../../services/IndexedDBService.js';
import {
    advanceDatasetEpoch,
    beginProjectRepairIsolation,
    endProjectRepairIsolation,
    isFullImportIsolationInProgress,
    resumeSuspendedSaveOptions,
    drainMainSyncOutbox
} from '../../services/PersistenceService.js';
import { MainSyncStore } from '../../services/MainSyncStore.js';
import { peekEntityScope } from './EntityProjectScope.js';
import { stateManager } from '../../core/AppState.js';
import {
    analyzeProjectOwnership,
    planEmployeeProjectReassignment,
    matchEmployeeAttendance,
    isExplicitProjectId,
    isQuarantineProjectId,
    makeQuarantineProjectId
} from './ProjectOwnershipReconciliation.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { Position } from '../employees/Position.js';
import { remapPositionInAttendanceRecord } from '../../services/AttendancePositionAudit.js';
import { slugify } from '../../utils/Helpers.js';

// ─── Constants ───────────────────────────────────────────────────────────────

export const REPAIR_ACTION = Object.freeze({
    MAP_TO_EXISTING:        'MAP_TO_EXISTING',
    CREATE_PROJECT_AND_MAP: 'CREATE_PROJECT_AND_MAP',
    QUARANTINE:             'QUARANTINE',
    RESOLVE_LATER:          'QUARANTINE', // alias
});

export const REPAIR_STATUS = Object.freeze({
    OK:          'OK',
    NO_OP:       'NO_OP',
    CONFLICT:    'CONFLICT',
    ERROR:       'ERROR',
    UNSUPPORTED: 'UNSUPPORTED'
});

/** Key under which reconciliation metadata is stored in the 'settings' IDB store. */
export const RECONCILIATION_META_KEY = 'reconciliationMeta';

/** Stores read-and-written by a repair transaction (all actions). */
const REPAIR_STORES = ['projects', 'employees', 'attendance', 'positions', 'leaders', 'settings'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepCopy(value) {
    if (value === null || value === undefined) return value;
    try {
        if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) { /* fall through */ }
    return JSON.parse(JSON.stringify(value));
}

function trimId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Index a list of records by trimmed `id`. */
function indexById(list) {
    const m = new Map();
    for (const item of (Array.isArray(list) ? list : [])) {
        if (item && typeof item === 'object') {
            const id = trimId(item.id);
            if (id) m.set(id, item);
        }
    }
    return m;
}

/** Same key derivation as the pure module for list-form records. */
function recordKeyOfListRecord(record, index) {
    const id = trimId(record?.id);
    if (id) return id;
    const num = trimId(record?.number);
    if (num) return `num:${num}`;
    return `index:${index}`;
}

/** Normalize caller attendance (map or array) to a keyed map. */
function collectCallerAttendanceMap(attendance) {
    const map = {};
    if (Array.isArray(attendance)) {
        attendance.forEach((r, i) => {
            if (!r || typeof r !== 'object') return;
            map[recordKeyOfListRecord(r, i)] = r;
        });
    } else if (attendance && typeof attendance === 'object') {
        for (const key of Object.keys(attendance)) {
            const r = attendance[key];
            if (r && typeof r === 'object') map[key] = r;
        }
    }
    return map;
}

/** Durable attendance keyed exactly as stored in IndexedDB. */
function buildDurableAttendanceMap(durableAttendance) {
    const map = {};
    for (const rec of (Array.isArray(durableAttendance) ? durableAttendance : [])) {
        if (!rec || typeof rec !== 'object') continue;
        const key = trimId(rec.key);
        if (key) map[key] = rec;
    }
    return map;
}

/**
 * Caller state is selection/UI context only. If it contains attendance for a
 * selected employee that is not durable yet, fail closed instead of silently
 * creating it or ignoring it and letting a suspended save resurrect it later.
 */
function findCallerOnlyAttendanceConflict(selectedEmployees, callerAttendance, durableAttendanceMap) {
    const callerMap = collectCallerAttendanceMap(callerAttendance);
    if (Object.keys(callerMap).length === 0) return null;

    for (const employee of selectedEmployees) {
        const match = matchEmployeeAttendance(employee, callerMap);
        if (!match.ok) {
            return {
                reason: `caller attendance for employee "${trimId(employee?.id)}" is ambiguous and cannot be reconciled safely`,
                conflicts: match.conflicts || []
            };
        }
        for (const { key } of match.matched) {
            if (!Object.prototype.hasOwnProperty.call(durableAttendanceMap, key)) {
                return {
                    reason: `unpersisted attendance "${key}" for employee "${trimId(employee?.id)}" is not durable yet`,
                    conflicts: [{ kind: 'UNPERSISTED_ATTENDANCE', key, employeeId: trimId(employee?.id) }]
                };
            }
        }
    }
    return null;
}

/** Put a record into a store obtained from an open transaction. */
function txPut(tx, storeName, record) {
    tx.objectStore(storeName).put(record);
}

/** Counts from analyzeProjectOwnership for a given dataset/catalog. */
function analyzeCounts(employees, attendance, positions, leaders, catalog) {
    return analyzeProjectOwnership(
        { employees, positions, leaders, attendance },
        catalog
    ).summary.counts;
}


function moveKeyedEmployeeSetting(container, fromId, toId) {
    const source = container && typeof container === 'object' ? { ...container } : {};
    if (!Object.prototype.hasOwnProperty.call(source, fromId)) return source;
    if (!Object.prototype.hasOwnProperty.call(source, toId)) {
        source[toId] = deepCopy(source[fromId]);
    }
    delete source[fromId];
    return source;
}

/**
 * Detach an operational leader relation that is invalid for the destination
 * project (R07 Direction): a leader belonging to another project is NOT an
 * operational relation to preserve nor a conflict the user must resolve — it is
 * silently detached (leaderId nulled) when reconciling the employee. Historical
 * /audit metadata (e.g. crossProjectLeaderId) is optional and never affects
 * operation. Returns a deep copy only when a change is required.
 */
function detachInvalidLeader(employee, leadersById, targetProjectId) {
    const leaderId = trimId(employee?.leaderId);
    if (!leaderId) return { employee, changed: false, detached: null };
    const leader = leadersById.get(leaderId);
    const invalid = !leader || leader.active === false || trimId(leader?.projectId) !== trimId(targetProjectId);
    if (!invalid) return { employee, changed: false, detached: null };
    const copy = deepCopy(employee);
    copy.leaderId = null;
    return { employee: copy, changed: true, detached: leaderId };
}

function describeDetachedLeader({ leaderId, leader, targetProjectId, entityName, positionId } = {}) {
    const id = trimId(leaderId);
    const name = String(leader?.name || entityName || id || 'Líder');
    const currentProjectId = trimId(leader?.projectId) || null;
    let kind;
    let message;

    if (!leader) {
        kind = 'MISSING_LEADER_DEFINITION';
        message = `Referenced leader "${id}" is missing and will be detached.`;
    } else if (leader.active === false) {
        kind = 'INACTIVE_LEADER';
        message = `Leader "${name}" (${id}) is inactive and will be detached.`;
    } else if (!isExplicitProjectId(currentProjectId)) {
        kind = 'UNRESOLVED_LEADER_OWNERSHIP';
        message = `Leader "${name}" (${id}) has no valid project ownership and will be detached.`;
    } else if (currentProjectId !== trimId(targetProjectId)) {
        kind = 'LEADER_PROJECT_CONFLICT';
        message = `Leader "${name}" (${id}) belongs to another project and will be detached.`;
    } else {
        return null;
    }

    return {
        kind,
        leaderId: id,
        entityId: id,
        entityName: leader?.name || entityName,
        currentProjectId,
        targetProjectId: trimId(targetProjectId),
        message,
        ...(positionId ? { positionId } : {})
    };
}

/**
 * F1: true when an attendance record is owned by a valid durable catalog
 * project DIFFERENT from the repair target. Such a record is legitimate
 * history and must stay byte-stable during position-history migration; only
 * empty/invalid/quarantine-owned/target-owned records may be migrated.
 */
function isRecordOwnedByOtherValidProject(record, catalogIds, targetProjectId) {
    const recPid = trimId(record?.projectId);
    if (!recPid) return false;
    if (recPid === trimId(targetProjectId)) return false;
    return catalogIds.has(recPid);
}

function applyEmployeePositionRemaps(employee, remaps = [], repairTimestamp = Date.now()) {
    const copy = deepCopy(employee);
    let changed = false;
    for (const remap of remaps) {
        const fromId = trimId(remap?.fromPositionId);
        const toId = trimId(remap?.toPositionId);
        if (!fromId || !toId || fromId === toId) continue;
        const positions = Array.isArray(copy.positions) ? copy.positions.map(String) : [];
        const legacyMatch = String(copy.positionId || '') === fromId;
        if (!positions.includes(fromId) && !legacyMatch) continue;
        const nextPositions = positions.includes(fromId)
            ? positions.map(id => id === fromId ? toId : id)
            : [...positions, toId];
        copy.positions = [...new Set(nextPositions)];
        if (legacyMatch) copy.positionId = toId;
        copy.positionSalaries = moveKeyedEmployeeSetting(copy.positionSalaries, fromId, toId);
        copy.positionSalaryModes = moveKeyedEmployeeSetting(copy.positionSalaryModes, fromId, toId);
        copy.customWorkingDays = moveKeyedEmployeeSetting(copy.customWorkingDays, fromId, toId);
        changed = true;
    }
    if (changed) {
        copy.positionsUpdatedAt = repairTimestamp;
        copy.updatedAt = repairTimestamp;
    }
    return { employee: copy, changed };
}

function preparePositionRemaps({ selectedEmployees, durablePositions, targetProjectId, positionRemaps = [], repairTimestamp }) {
    const requested = Array.isArray(positionRemaps) ? positionRemaps : [];
    if (!requested.length) {
        return {
            ok: true,
            conflicts: [],
            byEmployeeId: new Map(),
            previewEmployees: selectedEmployees
        };
    }

    const selectedById = indexById(selectedEmployees);
    const positionsById = indexById(durablePositions);
    const byEmployeeId = new Map();
    const conflicts = [];
    const seen = new Set();

    for (const raw of requested) {
        const employeeId = trimId(raw?.employeeId);
        const fromPositionId = trimId(raw?.fromPositionId);
        const toPositionId = trimId(raw?.toPositionId);
        const key = `${employeeId}\u0000${fromPositionId}`;
        const employee = selectedById.get(employeeId);
        const targetPosition = positionsById.get(toPositionId);

        if (!employeeId || !employee) {
            conflicts.push({ kind: 'POSITION_REMAP_EMPLOYEE_NOT_SELECTED', employeeId });
            continue;
        }
        if (!fromPositionId || !toPositionId || fromPositionId === toPositionId) {
            conflicts.push({ kind: 'POSITION_REMAP_INVALID', employeeId, fromPositionId, toPositionId });
            continue;
        }
        if (seen.has(key)) {
            conflicts.push({ kind: 'POSITION_REMAP_DUPLICATE', employeeId, fromPositionId });
            continue;
        }
        seen.add(key);
        const assignedPositions = Array.isArray(employee.positions) ? employee.positions.map(String) : [];
        const sourceAssigned = assignedPositions.includes(fromPositionId)
            || String(employee.positionId || '') === fromPositionId;
        if (!sourceAssigned) {
            conflicts.push({ kind: 'POSITION_REMAP_SOURCE_NOT_ASSIGNED', employeeId, fromPositionId });
            continue;
        }
        if (!targetPosition) {
            conflicts.push({ kind: 'POSITION_REMAP_TARGET_MISSING', employeeId, toPositionId });
            continue;
        }
        if (trimId(targetPosition.projectId) !== trimId(targetProjectId)) {
            conflicts.push({
                kind: 'POSITION_REMAP_TARGET_WRONG_PROJECT',
                employeeId,
                toPositionId,
                targetProjectId,
                actualProjectId: trimId(targetPosition.projectId) || null
            });
            continue;
        }
        const item = {
            employeeId,
            fromPositionId,
            toPositionId,
            // Phase B: la reconciliación inicial corrige la asignación actual
            // sin reescribir historia. La migración histórica queda como una
            // operación explícita separada y opt-in.
            migrateHistory: raw?.migrateHistory === true
        };
        const list = byEmployeeId.get(employeeId) || [];
        list.push(item);
        byEmployeeId.set(employeeId, list);
    }

    if (conflicts.length) {
        return { ok: false, conflicts, byEmployeeId: new Map(), previewEmployees: selectedEmployees };
    }

    const previewEmployees = selectedEmployees.map(employee =>
        applyEmployeePositionRemaps(
            employee,
            byEmployeeId.get(trimId(employee?.id)) || [],
            repairTimestamp
        ).employee
    );

    return { ok: true, conflicts: [], byEmployeeId, previewEmployees };
}

function preparePositionCopies({
    durablePositions,
    durableLeaders,
    targetProjectId,
    positionCopies = [],
    repairTimestamp
}) {
    const requested = Array.isArray(positionCopies) ? positionCopies : [];
    if (!requested.length) {
        return {
            ok: true,
            conflicts: [],
            writes: [],
            effectivePositions: durablePositions || [],
            copies: [],
            detachedLeaders: []
        };
    }

    const target = trimId(targetProjectId);
    const positionsById = indexById(durablePositions);
    const leadersById = indexById(durableLeaders);
    const conflicts = [];
    const writes = [];
    const copies = [];
    const detachedLeaders = [];
    const seenEquivalentCopies = new Set();
    const initialPositionIds = new Set(positionsById.keys());
    const queuedCopyIds = new Set();
    const effectivePositions = [...(durablePositions || [])];

    for (const raw of requested) {
        const fromPositionId = trimId(raw?.fromPositionId);
        const newPositionId = trimId(raw?.newPositionId);
        const source = positionsById.get(fromPositionId);
        let leaderId = trimId(raw?.leaderId) || null;
        const requestedName = String(raw?.name || '').trim();

        if (!source) {
            conflicts.push({ kind: 'POSITION_COPY_SOURCE_MISSING', fromPositionId });
            continue;
        }
        if (!newPositionId || newPositionId === fromPositionId) {
            conflicts.push({ kind: 'POSITION_COPY_ID_INVALID', fromPositionId, newPositionId });
            continue;
        }

        const equivalentKey = `${target}\u0000${fromPositionId}\u0000${slugify(requestedName || source?.name || '')}`;
        if (seenEquivalentCopies.has(equivalentKey)) {
            // A duplicate generated by the UI reuses the one queued id. A
            // durable id requested again is still a real collision and must
            // fail closed (F2).
            if (initialPositionIds.has(newPositionId) && !queuedCopyIds.has(newPositionId)) {
                conflicts.push({
                    kind: 'POSITION_COPY_ID_COLLISION',
                    fromPositionId,
                    newPositionId,
                    targetProjectId: target
                });
            }
            continue;
        }
        seenEquivalentCopies.add(equivalentKey);

        const existing = positionsById.get(newPositionId);
        if (existing) {
            // F2: any pre-existing newPositionId — same-project or not — is a
            // collision. create-similar must produce a NEW destination-owned id;
            // an id collision fails closed with zero durable writes.
            conflicts.push({
                kind: 'POSITION_COPY_ID_COLLISION',
                fromPositionId,
                newPositionId,
                targetProjectId: target
            });
            continue;
        }

        let detachedLeader = null;
        if (leaderId) {
            const leader = leadersById.get(leaderId);
            detachedLeader = describeDetachedLeader({
                leaderId,
                leader,
                targetProjectId: target,
                positionId: newPositionId
            });
            if (detachedLeader) {
                detachedLeaders.push(detachedLeader);
                leaderId = null;
            }
        }

        const payload = deepCopy(source);
        payload.id = newPositionId;
        payload.projectId = target;
        payload.name = requestedName || source.name;
        payload.leaderId = leaderId;
        payload.active = true;
        payload.updatedAt = repairTimestamp;
        payload.lastStatusChange = null;
        payload.statusHistory = [];
        delete payload.crossProjectLeaderId;

        // Normaliza la copia con el modelo real para no persistir campos fuera
        // del contrato Position.
        const model = new Position(payload);
        const normalized = model.toJSON();
        writes.push(normalized);
        effectivePositions.push(normalized);
        positionsById.set(newPositionId, normalized);
        queuedCopyIds.add(newPositionId);
        copies.push({
            fromPositionId,
            newPositionId,
            payload: normalized,
            created: true
        });
    }

    if (conflicts.length) {
        return {
            ok: false,
            conflicts,
            writes: [],
            effectivePositions: durablePositions || [],
            copies: [],
            detachedLeaders: []
        };
    }

    return { ok: true, conflicts: [], writes, effectivePositions, copies, detachedLeaders };
}

/**
 * F4 (R07 Direction): a destination position the employee ends up on (remap
 * target) may still reference a leader from another project, a missing leader,
 * or an inactive leader. Such a leader is NOT an operational relation to
 * preserve nor a conflict the user must resolve — it is detached (leaderId
 * nulled and crossProjectLeaderId cleared) during the repair and surfaced as
 * non-blocking `detachedPositionLeaders` info.
 */
function preparePositionLeaderDetachments({
    remapPreparation,
    positionsById,
    leadersById,
    targetProjectId,
    repairTimestamp
}) {
    const writes = [];
    const detached = [];
    const visited = new Map();
    const target = trimId(targetProjectId);

    for (const remaps of (remapPreparation?.byEmployeeId?.values() || [])) {
        for (const remap of remaps) {
            const toId = trimId(remap?.toPositionId);
            if (!toId || visited.has(toId)) continue;
            const position = positionsById.get(toId);
            visited.set(toId, position || null);
            if (!position) continue;
            const leaderId = trimId(position?.leaderId);
            if (!leaderId) continue;
            const leader = leadersById.get(leaderId);
            const detachedLeader = describeDetachedLeader({
                leaderId,
                leader,
                targetProjectId: target,
                positionId: toId
            });
            if (!detachedLeader) continue;

            const copy = deepCopy(position);
            copy.leaderId = null;
            delete copy.crossProjectLeaderId;
            copy.updatedAt = repairTimestamp;
            writes.push(copy);
            detached.push(detachedLeader);
        }
    }

    return { writes, detached };
}

// ─── Dependency analysis ──────────────────────────────────────────────────────

/**
 * Inspect whether the selected employees reference positions or leaders whose
 * project ownership would become inconsistent after reassignment. Returns a
 * structured summary for the future UI.
 *
 * Rule for A2b:
 * - A position/leader is "inconsistent" only when it has an EXPLICIT projectId
 *   that differs from the repair target AND is NOT already shared by employees
 *   remaining in the source project. Positions/leaders with no explicit
 *   projectId are legacy-unscoped and are NOT silently moved.
 * - Returns { ok, conflicts, dependencySummary }.
 */
function inspectDependencies({ employees, allEmployees, positions, leaders, targetProjectId }) {
    const selectedIds = new Set(employees.map(e => trimId(e.id)).filter(Boolean));
    const conflicts = [];
    const dependencySummary = {
        positions: [],
        leaders:  [],
        sharedPositions: [],
        sharedLeaders:  [],
        detachedLeaders: []
    };

    // Collect position ids referenced by selected employees.
    const referencedPositionIds = new Set();
    for (const emp of employees) {
        if (Array.isArray(emp.positions)) {
            emp.positions.forEach(pid => {
                const id = trimId(pid);
                if (id) referencedPositionIds.add(id);
            });
        }
        const singlePositionId = trimId(emp.positionId);
        if (singlePositionId) referencedPositionIds.add(singlePositionId);
    }

    // Determine which referenced positions are also referenced by employees NOT
    // in the selected set (i.e., shared across the move boundary).
    const sharedPositionIds = new Set();
    for (const emp of (allEmployees || [])) {
        if (selectedIds.has(trimId(emp.id))) continue;
        const empPosIds = Array.isArray(emp.positions) ? emp.positions.map(trimId) : [];
        if (emp.positionId) empPosIds.push(trimId(emp.positionId));
        for (const pid of empPosIds) {
            if (referencedPositionIds.has(pid)) sharedPositionIds.add(pid);
        }
    }

    const foundPositionIds = new Set();
    for (const pos of (positions || [])) {
        const posId = trimId(pos?.id);
        if (!referencedPositionIds.has(posId)) continue;
        foundPositionIds.add(posId);
        const posProjectId = trimId(pos?.projectId);
        const isShared = sharedPositionIds.has(posId);

        if (isShared) dependencySummary.sharedPositions.push(posId);
        else dependencySummary.positions.push(posId);

        if (!isExplicitProjectId(posProjectId) || posProjectId !== targetProjectId) {
            const kind = !isExplicitProjectId(posProjectId)
                ? 'UNRESOLVED_POSITION_OWNERSHIP'
                : (isShared ? 'SHARED_POSITION_CONFLICT' : 'POSITION_PROJECT_CONFLICT');
            conflicts.push({
                kind,
                entityId: posId,
                entityName: pos.name,
                currentProjectId: posProjectId || null,
                targetProjectId,
                shared: isShared,
                message: `Position "${pos.name}" (${posId}) is not safely owned by target project "${targetProjectId}".`
            });
        }
    }
    for (const posId of referencedPositionIds) {
        if (!foundPositionIds.has(posId)) {
            conflicts.push({
                kind: 'MISSING_POSITION_DEFINITION',
                entityId: posId,
                currentProjectId: null,
                targetProjectId,
                message: `Referenced position "${posId}" is missing from the durable catalog.`
            });
        }
    }

    // Leaders: collect both employee-level relations and the leader attached
    // to a resulting destination position. A missing, unresolved, inactive, or
    // cross-project leader is detached, never surfaced as a blocking conflict.
    const referencedLeaderIds = new Set();
    const leaderPositionById = new Map();
    for (const emp of employees) {
        const leaderId = trimId(emp.leaderId);
        if (leaderId) referencedLeaderIds.add(leaderId);
    }

    // `employees` is the post-remap preview. Only target-owned positions are
    // resulting operational positions; a source position that still blocks
    // remains outside this non-blocking leader summary.
    for (const pos of (positions || [])) {
        const positionId = trimId(pos?.id);
        if (!referencedPositionIds.has(positionId)) continue;
        if (trimId(pos?.projectId) !== trimId(targetProjectId)) continue;
        const leaderId = trimId(pos?.leaderId);
        if (leaderId) {
            referencedLeaderIds.add(leaderId);
            if (!leaderPositionById.has(leaderId)) leaderPositionById.set(leaderId, positionId);
        }
    }

    const foundLeaderIds = new Set();
    for (const lead of (leaders || [])) {
        const leadId = trimId(lead?.id);
        if (!referencedLeaderIds.has(leadId)) continue;
        foundLeaderIds.add(leadId);
        dependencySummary.leaders.push(leadId);
        const detached = describeDetachedLeader({
            leaderId: leadId,
            leader: lead,
            targetProjectId,
            entityName: lead.name,
            positionId: leaderPositionById.get(leadId)
        });
        if (detached) dependencySummary.detachedLeaders.push(detached);
    }
    for (const leadId of referencedLeaderIds) {
        if (!foundLeaderIds.has(leadId)) {
            const detached = describeDetachedLeader({
                leaderId: leadId,
                targetProjectId,
                positionId: leaderPositionById.get(leadId)
            });
            if (detached) dependencySummary.detachedLeaders.push(detached);
        }
    }

    // The same leader can be referenced by both the employee and its position.
    // One summary row is enough; the repair still clears every invalid edge.
    const seenDetachedLeaderIds = new Set();
    dependencySummary.detachedLeaders = dependencySummary.detachedLeaders.filter(item => {
        const id = trimId(item?.entityId);
        if (!id || seenDetachedLeaderIds.has(id)) return false;
        seenDetachedLeaderIds.add(id);
        return true;
    });

    return { ok: conflicts.length === 0, conflicts, dependencySummary };
}

// ─── Reconciliation metadata helpers ─────────────────────────────────────────

/**
 * Merge a repair event into the persisted reconciliation metadata record.
 * The record is stored under key RECONCILIATION_META_KEY in the 'settings' store.
 */
function buildUpdatedMeta(existingMeta, event) {
    const base = existingMeta || { key: RECONCILIATION_META_KEY, repairs: [] };
    const repairs = Array.isArray(base.repairs) ? [...base.repairs] : [];
    repairs.push({
        ...event,
        timestamp: Date.now()
    });
    return { ...base, key: RECONCILIATION_META_KEY, repairs };
}

// ─── In-memory state helpers (field-scoped) ─────────────────────────────────

/**
 * Merge repaired projectIds into the CURRENT in-memory employees/attendance.
 * Field-scoped: only the projectId (and its fresh updatedAt) are touched on the
 * current object, so any unsaved in-memory edit (name, loans, …) captured by a
 * suspended save is preserved instead of being replaced by a durable/caller
 * snapshot. The updatedAt stamp matches the durable write so EntityUploadTracker
 * does not filter the change.
 */
function applyFieldScopedMemoryUpdate(memoryUpdate) {
    if (!memoryUpdate) return;
    const employeeProjectIds = memoryUpdate.employeeProjectIds;
    const attendanceProjectIds = memoryUpdate.attendanceProjectIds;
    const employeePositionPatches = memoryUpdate.employeePositionPatches;
    const attendanceRecordPatches = memoryUpdate.attendanceRecordPatches;
    const employeeLeaderPatches = memoryUpdate.employeeLeaderPatches;
    const positionLeaderPatches = memoryUpdate.positionLeaderPatches;
    const positionCopies = memoryUpdate.positionCopies;
    const repairTimestamp = memoryUpdate.repairTimestamp;

    if ((employeeProjectIds && employeeProjectIds.size) || (employeePositionPatches && employeePositionPatches.size) || (employeeLeaderPatches && employeeLeaderPatches.size)) {
        const newEmployees = (stateManager._state.employees || []).map(e => {
            const empId = trimId(e?.id);
            const pid = employeeProjectIds?.get(empId);
            const positionPatch = employeePositionPatches?.get(empId);
            const leaderPatch = employeeLeaderPatches?.get(empId);
            if (pid === undefined && !positionPatch && leaderPatch === undefined) return e;
            const copy = deepCopy(e);
            if (pid !== undefined) copy.projectId = pid;
            if (leaderPatch !== undefined) copy.leaderId = leaderPatch;
            if (positionPatch) {
                for (const key of ['positions', 'positionSalaries', 'positionSalaryModes', 'customWorkingDays', 'positionsUpdatedAt']) {
                    if (Object.prototype.hasOwnProperty.call(positionPatch, key)) {
                        copy[key] = deepCopy(positionPatch[key]);
                    }
                }
                if (Object.prototype.hasOwnProperty.call(positionPatch, 'positionId')) {
                    if (positionPatch.positionId === undefined) delete copy.positionId;
                    else copy.positionId = positionPatch.positionId;
                }
            }
            if (repairTimestamp != null) copy.updatedAt = repairTimestamp;
            return copy;
        });
        stateManager.setState({ employees: newEmployees });
    }

    if ((attendanceProjectIds && attendanceProjectIds.size) || (attendanceRecordPatches && attendanceRecordPatches.size)) {
        const newAttendance = { ...(stateManager._state.attendance || {}) };
        const keys = new Set([
            ...(attendanceProjectIds ? attendanceProjectIds.keys() : []),
            ...(attendanceRecordPatches ? attendanceRecordPatches.keys() : [])
        ]);
        for (const key of keys) {
            const existing = newAttendance[key];
            if (!existing) continue;
            const copy = deepCopy(existing);
            const pid = attendanceProjectIds?.get(key);
            const recordPatch = attendanceRecordPatches?.get(key);
            if (pid !== undefined) copy.projectId = pid;
            if (recordPatch) {
                if (Object.prototype.hasOwnProperty.call(recordPatch, 'selectedPosition')) {
                    copy.selectedPosition = recordPatch.selectedPosition;
                }
                if (Object.prototype.hasOwnProperty.call(recordPatch, 'positionHours')) {
                    copy.positionHours = deepCopy(recordPatch.positionHours);
                }
            }
            if (repairTimestamp != null) copy.updatedAt = repairTimestamp;
            newAttendance[key] = copy;
        }
        stateManager.setState({ attendance: newAttendance });
    }

    // Destination-owned position copies are merged into the in-memory catalog so
    // the UI sees the created position without a reload (durable/memory parity).
    if (Array.isArray(positionCopies) && positionCopies.length) {
        const positions = Array.isArray(stateManager._state.positions) ? stateManager._state.positions : [];
        const positionsById = new Map(positions.map(p => [trimId(p?.id), p]));
        const nextPositions = [...positions];
        for (const copy of positionCopies) {
            const id = trimId(copy?.id);
            if (!id) continue;
            if (!positionsById.has(id)) {
                positionsById.set(id, copy);
                nextPositions.push(copy);
            }
        }
        if (nextPositions.length !== positions.length) {
            stateManager.setState({ positions: nextPositions });
        }
    }

    // F4: detach cross-project/missing/inactive leaders from destination
    // positions in memory (durable/memory parity for leaderId nulling).
    if (positionLeaderPatches && positionLeaderPatches.size) {
        const positions = Array.isArray(stateManager._state.positions) ? stateManager._state.positions : [];
        const nextPositions = positions.map(p => {
            const patch = positionLeaderPatches.get(trimId(p?.id));
            if (!patch) return p;
            const copy = deepCopy(p);
            if (Object.prototype.hasOwnProperty.call(patch, 'leaderId')) {
                copy.leaderId = patch.leaderId;
            }
            if (patch.crossProjectLeaderId === undefined) delete copy.crossProjectLeaderId;
            else copy.crossProjectLeaderId = patch.crossProjectLeaderId;
            if (repairTimestamp != null) copy.updatedAt = repairTimestamp;
            return copy;
        });
        stateManager.setState({ positions: nextPositions });
    }
}

// ─── Transaction helper ──────────────────────────────────────────────────────

/**
 * Run one native readwrite IDB transaction spanning `storeNames`. Issues a read
 * (getAll for every store, get for the settings meta key) at transaction start,
 * then invokes `planFn(reads, tx)` synchronously from the final read callback
 * while the transaction is still active. `planFn` may perform writes through
 * `tx` and must return a value. Resolves with that value on oncomplete and
 * rejects on onerror/onabort.
 */
function runReadWriteTransaction(db, storeNames, planFn) {
    return new Promise((resolve, reject) => {
        const stores = [...new Set(storeNames)];
        const tx = db.transaction(stores, 'readwrite');
        const reads = {};
        let settled = false;
        let pending = stores.length;
        let result;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            try { tx.abort(); } catch (_) { /* noop */ }
            reject(err || tx.error || new Error('Reconciliation transaction failed'));
        };

        tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);

        for (const name of stores) {
            const store = tx.objectStore(name);
            const req = (name === 'settings')
                ? store.get(RECONCILIATION_META_KEY)
                : store.getAll();
            req.onsuccess = (event) => {
                if (settled) return;
                reads[name] = event.target.result;
                pending -= 1;
                if (pending === 0) {
                    try {
                        result = planFn(reads, tx);
                    } catch (err) {
                        fail(err);
                    }
                }
            };
            req.onerror = () => fail(req.error);
        }
    });
}

// ─── In-transaction planning (durable truth) ────────────────────────────────

function conflictResult(reason, extra = {}) {
    return { status: REPAIR_STATUS.CONFLICT, reason, conflicts: [], affected: [], ...extra };
}

/**
 * Compute the "after" counts by applying the same field-scoped projectId merge
 * (used for memory) to the effective durable dataset. Classification only reads
 * projectId, so unrelated unsaved edits do not affect these counts.
 */
function computeAfterCounts({ effEmployees, effAttendanceMap, effPositions, effLeaders, catalog, employeeProjectIds, attendanceProjectIds }) {
    const afterEmployees = effEmployees.map(e => {
        const pid = employeeProjectIds.get(trimId(e?.id));
        if (pid === undefined) return e;
        const copy = deepCopy(e);
        copy.projectId = pid;
        return copy;
    });
    const afterAttendance = { ...effAttendanceMap };
    for (const [key, pid] of attendanceProjectIds) {
        const existing = afterAttendance[key];
        if (existing) {
            const copy = deepCopy(existing);
            copy.projectId = pid;
            afterAttendance[key] = copy;
        }
    }
    return analyzeCounts(afterEmployees, afterAttendance, effPositions, effLeaders, catalog);
}

/** Plan one employee's reassignment and return durable write + memory info. */
function planEmployeeRepair({
    freshest,
    effAttendanceMap,
    targetProjectId,
    planCatalog,
    repairTimestamp,
    positionRemaps = [],
    leadersById = new Map()
}) {
    const empId = trimId(freshest.id);
    const plan = planEmployeeProjectReassignment({
        employee: freshest,
        attendance: effAttendanceMap,
        targetProjectId,
        catalog: planCatalog
    });
    if (!plan.ok) {
        return { ok: false, conflicts: plan.conflicts, empId };
    }

    // F1: valid other-project catalog ids must stay byte-stable during
    // position-history migration.
    const planCatalogIds = new Set(
        (Array.isArray(planCatalog) ? planCatalog : [])
            .map(p => trimId(p?.id))
            .filter(id => isExplicitProjectId(id))
    );

    const projectChanged = trimId(plan.employee?.projectId) !== trimId(freshest.projectId);
    // Target-project position/leader reconciliation is valid only when the
    // employee itself will belong to the target after this repair. An
    // attendance-only repair may deliberately preserve a valid employee in
    // another project; in that case its current position/leader are unrelated
    // to the attendance target and must remain byte-stable.
    const employeeUsesTargetProject = trimId(plan.employee?.projectId) === trimId(targetProjectId);
    const positionOutcome = employeeUsesTargetProject
        ? applyEmployeePositionRemaps(plan.employee, positionRemaps, repairTimestamp)
        : { employee: plan.employee, changed: false };
    plan.employee = positionOutcome.employee;
    const leaderOutcome = employeeUsesTargetProject
        ? detachInvalidLeader(plan.employee, leadersById, targetProjectId)
        : { employee: plan.employee, changed: false, detached: null };
    plan.employee = leaderOutcome.employee;
    const employeeChanged = projectChanged || positionOutcome.changed || leaderOutcome.changed;
    if (employeeChanged) plan.employee.updatedAt = repairTimestamp;

    const attendanceChanges = [];
    for (const planned of plan.attendanceRecords) {
        const key = planned.key;
        const original = effAttendanceMap[key];
        let record = planned.record;
        let positionChanged = false;

        for (const remap of positionRemaps) {
            if (remap?.migrateHistory !== true) continue;
            // F1: a record already owned by a valid catalog project different
            // from the target is legitimate history — skip its position-history
            // migration so it stays byte-stable (identity, projectId,
            // selectedPosition, positionHours, updatedAt).
            if (isRecordOwnedByOtherValidProject(original, planCatalogIds, targetProjectId)) continue;
            const remapped = remapPositionInAttendanceRecord(record, {
                fromId: remap.fromPositionId,
                toId: remap.toPositionId,
                now: repairTimestamp
            });
            if (remapped.changed) {
                record = remapped.record;
                positionChanged = true;
            }
        }

        const projectChanged = trimId(original?.projectId) !== trimId(record?.projectId);
        if (projectChanged || positionChanged) {
            // Solo los campos que realmente cambian reciben un timestamp fresco.
            // Una asistencia histórica ya vinculada a otra obra válida se deja
            // byte-estable durante una reparación de pertenencia actual.
            record.updatedAt = repairTimestamp;
            attendanceChanges.push({ key, record, positionChanged, projectChanged });
        }
    }

    return {
        ok: true,
        empId,
        employeeChanged,
        projectChanged,
        positionChanged: positionOutcome.changed,
        detachedLeader: leaderOutcome.detached,
        plannedEmployee: plan.employee,
        attendanceChanges
    };
}

/**
 * Split selected employees by whether their employee ownership will actually
 * use the requested target. A valid employee may be selected only because an
 * attendance record is orphaned; that employee must stay out of all
 * target-project position/leader preparation while its attendance is repaired.
 */
function prepareTargetOwnershipScope({ employees, attendance, targetProjectId, catalog, positionRemaps = [], positionCopies = [] }) {
    const target = trimId(targetProjectId);
    const targetEmployees = [];
    const targetEmployeeIds = new Set();

    for (const employee of (employees || [])) {
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: target,
            catalog
        });
        if (!plan.ok) {
            return { ok: false, conflicts: plan.conflicts || [], targetEmployees: [], positionRemaps: [], positionCopies: [] };
        }
        if (trimId(plan.employee?.projectId) === target) {
            targetEmployees.push(employee);
            targetEmployeeIds.add(trimId(employee?.id));
        }
    }

    const scopedRemaps = (Array.isArray(positionRemaps) ? positionRemaps : [])
        .filter(item => targetEmployeeIds.has(trimId(item?.employeeId)));
    const referencedCopyIds = new Set(scopedRemaps.map(item => trimId(item?.toPositionId)).filter(Boolean));
    const scopedCopies = (Array.isArray(positionCopies) ? positionCopies : [])
        .filter(item => referencedCopyIds.has(trimId(item?.newPositionId)));

    return { ok: true, conflicts: [], targetEmployees, positionRemaps: scopedRemaps, positionCopies: scopedCopies };
}

/**
 * MAP_TO_EXISTING: map selected employees (and their canonically-owned
 * attendance) to an existing durable project.
 */
function computeMapToExisting(reads, tx, p) {
    const target = trimId(p.targetProjectId);
    const durableProjects = reads.projects || [];
    const durableProjectsById = indexById(durableProjects);

    // H1: the target must be an explicit, DURABLE project. A forged/stale caller
    // catalog must not authorize a target absent from IndexedDB.
    if (!isExplicitProjectId(target)) {
        return { result: conflictResult(`targetProjectId "${target}" is not a valid explicit project id`) };
    }
    if (!durableProjectsById.has(target)) {
        return { result: conflictResult(`targetProjectId "${target}" does not exist in the durable project store`) };
    }

    const durableEmployeesById = indexById(reads.employees);
    const effAllEmployees = Array.isArray(reads.employees) ? reads.employees : [];
    const effPositions = Array.isArray(reads.positions) ? reads.positions : [];
    const effLeaders = Array.isArray(reads.leaders) ? reads.leaders : [];
    const effAttendanceMap = buildDurableAttendanceMap(reads.attendance);
    const leadersById = indexById(effLeaders);

    // Caller employees are selectors only. Every selected id must already be
    // durable before a reconciliation can mutate ownership.
    const freshestSelected = [];
    for (const sel of p.employees) {
        const empId = trimId(sel?.id);
        if (!empId) continue;
        const freshest = durableEmployeesById.get(empId);
        if (!freshest) {
            return { result: conflictResult(`selected employee "${empId}" is not a durable employee yet`) };
        }
        freshestSelected.push(freshest);
    }

    const callerAttendanceConflict = findCallerOnlyAttendanceConflict(
        freshestSelected,
        p.attendance,
        effAttendanceMap
    );
    if (callerAttendanceConflict) {
        return {
            result: conflictResult(callerAttendanceConflict.reason, {
                conflicts: callerAttendanceConflict.conflicts
            })
        };
    }

    const targetScope = prepareTargetOwnershipScope({
        employees: freshestSelected,
        attendance: effAttendanceMap,
        targetProjectId: target,
        catalog: durableProjects,
        positionRemaps: p.positionRemaps,
        positionCopies: p.positionCopies
    });
    if (!targetScope.ok) {
        return { result: conflictResult('Selected employee ownership cannot be planned safely', { conflicts: targetScope.conflicts }) };
    }

    // Validate the complete caller proposal first so stale/colliding copy IDs
    // still fail closed even when their employee turns out to be attendance-only.
    // A second scoped preparation below controls what may actually be written.
    const copyValidation = preparePositionCopies({
        durablePositions: effPositions,
        durableLeaders: effLeaders,
        targetProjectId: target,
        positionCopies: p.positionCopies,
        repairTimestamp: p.repairTimestamp
    });
    if (!copyValidation.ok) {
        return {
            result: conflictResult('Position copy proposal is not safe to apply', {
                conflicts: copyValidation.conflicts
            })
        };
    }

    const copyPreparation = preparePositionCopies({
        durablePositions: effPositions,
        durableLeaders: effLeaders,
        targetProjectId: target,
        positionCopies: targetScope.positionCopies,
        repairTimestamp: p.repairTimestamp
    });
    if (!copyPreparation.ok) {
        return {
            result: conflictResult('Position copy proposal is not safe to apply', {
                conflicts: copyPreparation.conflicts
            })
        };
    }

    const remapPreparation = preparePositionRemaps({
        selectedEmployees: targetScope.targetEmployees,
        durablePositions: copyPreparation.effectivePositions,
        targetProjectId: target,
        positionRemaps: targetScope.positionRemaps,
        repairTimestamp: p.repairTimestamp
    });
    if (!remapPreparation.ok) {
        return {
            result: conflictResult('Position remap is not safe to apply', {
                conflicts: remapPreparation.conflicts
            })
        };
    }

    // H9: dependency validation uses the explicit post-remap current-position
    // preview, so a user-selected target position can resolve a cross-project
    // position blocker without moving the position entity itself.
    if (!p.skipDependencyCheck) {
        const depResult = inspectDependencies({
            employees: remapPreparation.previewEmployees,
            allEmployees: effAllEmployees,
            positions: copyPreparation.effectivePositions,
            leaders: effLeaders,
            targetProjectId: target
        });
        if (!depResult.ok) {
            return {
                result: conflictResult('Dependency conflicts prevent repair without risk of inconsistency', {
                    conflicts: depResult.conflicts,
                    dependencySummary: depResult.dependencySummary
                })
            };
        }
    }

    const before = analyzeCounts(effAllEmployees, effAttendanceMap, effPositions, effLeaders, durableProjects);

    // F4: calculate position-leader detachments before the no-op decision. A
    // selected employee may already be mapped to the target while its
    // resulting position still carries an invalid leader.
    const positionLeaderDetachment = preparePositionLeaderDetachments({
        remapPreparation,
        positionsById: indexById(copyPreparation.effectivePositions),
        leadersById,
        targetProjectId: target,
        repairTimestamp: p.repairTimestamp
    });

    const skipped = [];
    const affected = [];
    const writeEmployees = [];
    const writeAttendance = [];
    const employeeProjectIds = new Map();
    const attendanceProjectIds = new Map();
    const employeePositionPatches = new Map();
    const attendanceRecordPatches = new Map();
    const employeeLeaderPatches = new Map();
    const detachedLeaders = [];

    for (const freshest of freshestSelected) {
        const empId = trimId(freshest.id);
        const employeeRemaps = remapPreparation.byEmployeeId.get(empId) || [];
        const r = planEmployeeRepair({
            freshest,
            effAttendanceMap,
            targetProjectId: target,
            planCatalog: durableProjects,
            repairTimestamp: p.repairTimestamp,
            positionRemaps: employeeRemaps,
            leadersById
        });
        if (!r.ok) {
            return { result: conflictResult(`planEmployeeProjectReassignment rejected employee "${empId}"`, { conflicts: r.conflicts }) };
        }
        if (r.detachedLeader) {
            detachedLeaders.push({ employeeId: empId, leaderId: r.detachedLeader });
            employeeLeaderPatches.set(empId, null);
        }
        const needsChange = r.employeeChanged || r.attendanceChanges.length > 0;
        if (!needsChange) {
            skipped.push(empId);
            continue;
        }
        if (r.employeeChanged) {
            writeEmployees.push(r.plannedEmployee);
            employeeProjectIds.set(empId, r.plannedEmployee.projectId);
            if (r.positionChanged) {
                employeePositionPatches.set(empId, {
                    positions: deepCopy(r.plannedEmployee.positions || []),
                    positionId: r.plannedEmployee.positionId,
                    positionSalaries: deepCopy(r.plannedEmployee.positionSalaries || {}),
                    positionSalaryModes: deepCopy(r.plannedEmployee.positionSalaryModes || {}),
                    customWorkingDays: deepCopy(r.plannedEmployee.customWorkingDays || {}),
                    positionsUpdatedAt: r.plannedEmployee.positionsUpdatedAt,
                    updatedAt: r.plannedEmployee.updatedAt
                });
            }
        }
        let remappedHistoryCount = 0;
        for (const { key, record, positionChanged, projectChanged } of r.attendanceChanges) {
            writeAttendance.push({ key, record });
            if (projectChanged) attendanceProjectIds.set(key, record.projectId);
            if (positionChanged) {
                remappedHistoryCount += 1;
                attendanceRecordPatches.set(key, {
                    projectId: record.projectId,
                    selectedPosition: record.selectedPosition,
                    positionHours: deepCopy(record.positionHours),
                    updatedAt: record.updatedAt
                });
            }
        }
        affected.push({
            employeeId: empId,
            attendanceCount: r.attendanceChanges.length,
            remappedHistoryCount
        });
    }

    if (affected.length === 0
        && positionLeaderDetachment.writes.length === 0
        && copyPreparation.writes.length === 0) {
        return {
            result: {
                status: REPAIR_STATUS.NO_OP,
                reason: skipped.length > 0
                    ? `All ${skipped.length} selected employee(s) and their attendance are already mapped to "${target}"`
                    : 'No employees to process',
                skipped,
                affected: [],
                before,
                after: before
            }
        };
    }

    const metaEvent = {
        action: REPAIR_ACTION.MAP_TO_EXISTING,
        targetProjectId: target,
        employeeIds: affected.map(a => a.employeeId),
        detachedLeaders: detachedLeaders.map(d => d.leaderId),
        positionRemaps: (p.positionRemaps || []).map(item => ({
            employeeId: trimId(item?.employeeId),
            fromPositionId: trimId(item?.fromPositionId),
            toPositionId: trimId(item?.toPositionId),
            migrateHistory: item?.migrateHistory === true
        })),
        positionCopies: copyPreparation.copies.map(item => ({
            fromPositionId: item.fromPositionId,
            newPositionId: item.newPositionId,
            created: item.created
        }))
    };
    const updatedMeta = buildUpdatedMeta(reads.settings, metaEvent);

    const positionLeaderPatches = new Map();
    for (const pos of positionLeaderDetachment.writes) {
        positionLeaderPatches.set(trimId(pos.id), { leaderId: null, crossProjectLeaderId: undefined });
    }

    for (const copy of copyPreparation.writes) txPut(tx, 'positions', copy);
    for (const pos of positionLeaderDetachment.writes) txPut(tx, 'positions', pos);
    for (const emp of writeEmployees) txPut(tx, 'employees', emp);
    for (const { key, record } of writeAttendance) txPut(tx, 'attendance', { ...record, key });
    txPut(tx, 'settings', updatedMeta);

    const after = computeAfterCounts({
        effEmployees: effAllEmployees,
        effAttendanceMap,
        effPositions: copyPreparation.effectivePositions,
        effLeaders,
        catalog: durableProjects,
        employeeProjectIds,
        attendanceProjectIds
    });

    return {
        result: {
            status: REPAIR_STATUS.OK,
            action: REPAIR_ACTION.MAP_TO_EXISTING,
            targetProjectId: target,
            affected,
            skipped,
            detachedLeaders,
            detachedPositionLeaders: [
                ...copyPreparation.detachedLeaders,
                ...positionLeaderDetachment.detached
            ],
            before,
            after,
            durableCommitted: true,
            createdPositions: copyPreparation.writes.map(deepCopy)
        },
        memoryUpdate: {
            employeeProjectIds,
            attendanceProjectIds,
            employeePositionPatches,
            attendanceRecordPatches,
            employeeLeaderPatches,
            positionLeaderPatches,
            positionCopies: copyPreparation.writes.map(deepCopy),
            repairTimestamp: p.repairTimestamp
        },
        repairAttendanceRecords: writeAttendance
    };
}

/**
 * CREATE_PROJECT_AND_MAP: create a recovery project with a caller-supplied
 * stable id/name (or safely retry when the durable id already exists with a
 * compatible identity), then map selected employees to it in the SAME tx.
 */
function computeCreateProjectAndMap(reads, tx, p) {
    const resolvedName = String(p.projectName || '').trim();
    const target = trimId(p.projectId);

    if (!resolvedName) {
        return { result: conflictResult('projectName is required for CREATE_PROJECT_AND_MAP') };
    }
    if (!isExplicitProjectId(target)) {
        return { result: conflictResult('A stable explicit projectId is required for CREATE_PROJECT_AND_MAP') };
    }

    const durableProjects = reads.projects || [];
    const durableProjectsById = indexById(durableProjects);
    const existingProject = durableProjectsById.get(target) || null;

    let projectAlreadyExists = false;
    let createdProject = false;
    let projectPayload = null;

    if (existingProject) {
        // H3: existence is decided from DURABLE IDB. Only a safe retry when the
        // durable identity is compatible with the requested project.
        if (!isExplicitProjectId(trimId(existingProject.id))) {
            return { result: conflictResult(`durable project "${target}" has an invalid (sentinel) id`) };
        }
        const existingName = trimId(existingProject.name);
        if (existingName && existingName.toLowerCase() !== resolvedName.toLowerCase()) {
            return {
                result: conflictResult(
                    `requested name "${resolvedName}" conflicts with existing durable project "${existingName}" (id "${target}")`
                )
            };
        }
        projectAlreadyExists = true;
        projectPayload = deepCopy(existingProject);
    } else {
        createdProject = true;
        const project = new Project({
            id: target,
            name: resolvedName,
            status: p.projectStatus || PROJECT_STATUS.ACTIVE,
            createdAt: Date.now()
        });
        projectPayload = project?.toJSON ? project.toJSON() : { ...project };
    }

    // Effective catalog for planning includes the project being created.
    const planCatalog = projectAlreadyExists ? durableProjects : [...durableProjects, projectPayload];

    const durableEmployeesById = indexById(reads.employees);
    const effAllEmployees = Array.isArray(reads.employees) ? reads.employees : [];
    const effPositions = Array.isArray(reads.positions) ? reads.positions : [];
    const effLeaders = Array.isArray(reads.leaders) ? reads.leaders : [];
    const effAttendanceMap = buildDurableAttendanceMap(reads.attendance);
    const leadersById = indexById(effLeaders);

    const freshestSelected = [];
    for (const sel of p.employees) {
        const empId = trimId(sel?.id);
        if (!empId) continue;
        const freshest = durableEmployeesById.get(empId);
        if (!freshest) {
            return { result: conflictResult(`selected employee "${empId}" is not a durable employee yet`) };
        }
        freshestSelected.push(freshest);
    }

    const callerAttendanceConflict = findCallerOnlyAttendanceConflict(
        freshestSelected,
        p.attendance,
        effAttendanceMap
    );
    if (callerAttendanceConflict) {
        return {
            result: conflictResult(callerAttendanceConflict.reason, {
                conflicts: callerAttendanceConflict.conflicts
            })
        };
    }

    const targetScope = prepareTargetOwnershipScope({
        employees: freshestSelected,
        attendance: effAttendanceMap,
        targetProjectId: target,
        catalog: planCatalog,
        positionRemaps: p.positionRemaps,
        positionCopies: p.positionCopies
    });
    if (!targetScope.ok) {
        return { result: conflictResult('Selected employee ownership cannot be planned safely', { conflicts: targetScope.conflicts }) };
    }

    // Validate the complete caller proposal first so stale/colliding copy IDs
    // still fail closed even when their employee turns out to be attendance-only.
    // A second scoped preparation below controls what may actually be written.
    const copyValidation = preparePositionCopies({
        durablePositions: effPositions,
        durableLeaders: effLeaders,
        targetProjectId: target,
        positionCopies: p.positionCopies,
        repairTimestamp: p.repairTimestamp
    });
    if (!copyValidation.ok) {
        return {
            result: conflictResult('Position copy proposal is not safe to apply', {
                conflicts: copyValidation.conflicts
            })
        };
    }

    const copyPreparation = preparePositionCopies({
        durablePositions: effPositions,
        durableLeaders: effLeaders,
        targetProjectId: target,
        positionCopies: targetScope.positionCopies,
        repairTimestamp: p.repairTimestamp
    });
    if (!copyPreparation.ok) {
        return {
            result: conflictResult('Position copy proposal is not safe to apply', {
                conflicts: copyPreparation.conflicts
            })
        };
    }

    const remapPreparation = preparePositionRemaps({
        selectedEmployees: targetScope.targetEmployees,
        durablePositions: copyPreparation.effectivePositions,
        targetProjectId: target,
        positionRemaps: targetScope.positionRemaps,
        repairTimestamp: p.repairTimestamp
    });
    if (!remapPreparation.ok) {
        return {
            result: conflictResult('Position remap is not safe to apply', {
                conflicts: remapPreparation.conflicts
            })
        };
    }

    if (!p.skipDependencyCheck) {
        const depResult = inspectDependencies({
            employees: remapPreparation.previewEmployees,
            allEmployees: effAllEmployees,
            positions: copyPreparation.effectivePositions,
            leaders: effLeaders,
            targetProjectId: target
        });
        if (!depResult.ok) {
            return {
                result: conflictResult('Dependency conflicts prevent repair without risk of inconsistency', {
                    conflicts: depResult.conflicts,
                    dependencySummary: depResult.dependencySummary
                })
            };
        }
    }

    const before = analyzeCounts(effAllEmployees, effAttendanceMap, effPositions, effLeaders, durableProjects);

    // F4: calculate position-leader detachments before deciding whether an
    // existing-project repair is a no-op (see MAP_TO_EXISTING above).
    const positionLeaderDetachment = preparePositionLeaderDetachments({
        remapPreparation,
        positionsById: indexById(copyPreparation.effectivePositions),
        leadersById,
        targetProjectId: target,
        repairTimestamp: p.repairTimestamp
    });

    const skipped = [];
    const affected = [];
    const writeEmployees = [];
    const writeAttendance = [];
    const employeeProjectIds = new Map();
    const attendanceProjectIds = new Map();
    const employeePositionPatches = new Map();
    const attendanceRecordPatches = new Map();
    const employeeLeaderPatches = new Map();
    const detachedLeaders = [];

    for (const freshest of freshestSelected) {
        const empId = trimId(freshest.id);
        const employeeRemaps = remapPreparation.byEmployeeId.get(empId) || [];
        const r = planEmployeeRepair({
            freshest,
            effAttendanceMap,
            targetProjectId: target,
            planCatalog,
            repairTimestamp: p.repairTimestamp,
            positionRemaps: employeeRemaps,
            leadersById
        });
        if (!r.ok) {
            return { result: conflictResult(`planEmployeeProjectReassignment rejected employee "${empId}"`, { conflicts: r.conflicts }) };
        }
        if (r.detachedLeader) {
            detachedLeaders.push({ employeeId: empId, leaderId: r.detachedLeader });
            employeeLeaderPatches.set(empId, null);
        }
        const needsChange = r.employeeChanged || r.attendanceChanges.length > 0;
        if (!needsChange) {
            skipped.push(empId);
            continue;
        }
        if (r.employeeChanged) {
            writeEmployees.push(r.plannedEmployee);
            employeeProjectIds.set(empId, r.plannedEmployee.projectId);
            if (r.positionChanged) {
                employeePositionPatches.set(empId, {
                    positions: deepCopy(r.plannedEmployee.positions || []),
                    positionId: r.plannedEmployee.positionId,
                    positionSalaries: deepCopy(r.plannedEmployee.positionSalaries || {}),
                    positionSalaryModes: deepCopy(r.plannedEmployee.positionSalaryModes || {}),
                    customWorkingDays: deepCopy(r.plannedEmployee.customWorkingDays || {}),
                    positionsUpdatedAt: r.plannedEmployee.positionsUpdatedAt,
                    updatedAt: r.plannedEmployee.updatedAt
                });
            }
        }
        let remappedHistoryCount = 0;
        for (const { key, record, positionChanged, projectChanged } of r.attendanceChanges) {
            writeAttendance.push({ key, record });
            if (projectChanged) attendanceProjectIds.set(key, record.projectId);
            if (positionChanged) {
                remappedHistoryCount += 1;
                attendanceRecordPatches.set(key, {
                    projectId: record.projectId,
                    selectedPosition: record.selectedPosition,
                    positionHours: deepCopy(record.positionHours),
                    updatedAt: record.updatedAt
                });
            }
        }
        affected.push({ employeeId: empId, attendanceCount: r.attendanceChanges.length, remappedHistoryCount });
    }

    if (projectAlreadyExists
        && affected.length === 0
        && positionLeaderDetachment.writes.length === 0
        && copyPreparation.writes.length === 0) {
        return {
            result: {
                status: REPAIR_STATUS.NO_OP,
                action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
                targetProjectId: target,
                projectAlreadyExisted: true,
                createdProject: null,
                reason: 'Project already exists and all selected employees are already mapped to it',
                skipped,
                affected: [],
                durableCommitted: false
            }
        };
    }

    const metaEvent = {
        action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
        targetProjectId: target,
        projectName: resolvedName,
        projectAlreadyExisted: projectAlreadyExists,
        employeeIds: affected.map(a => a.employeeId),
        detachedLeaders: detachedLeaders.map(d => d.leaderId),
        positionRemaps: (p.positionRemaps || []).map(item => ({
            employeeId: trimId(item?.employeeId),
            fromPositionId: trimId(item?.fromPositionId),
            toPositionId: trimId(item?.toPositionId),
            migrateHistory: item?.migrateHistory === true
        })),
        positionCopies: copyPreparation.copies.map(item => ({
            fromPositionId: item.fromPositionId,
            newPositionId: item.newPositionId,
            created: item.created
        }))
    };
    const updatedMeta = buildUpdatedMeta(reads.settings, metaEvent);

    const positionLeaderPatches = new Map();
    for (const pos of positionLeaderDetachment.writes) {
        positionLeaderPatches.set(trimId(pos.id), { leaderId: null, crossProjectLeaderId: undefined });
    }

    if (createdProject) txPut(tx, 'projects', projectPayload);
    for (const copy of copyPreparation.writes) txPut(tx, 'positions', copy);
    for (const pos of positionLeaderDetachment.writes) txPut(tx, 'positions', pos);
    for (const emp of writeEmployees) txPut(tx, 'employees', emp);
    for (const { key, record } of writeAttendance) txPut(tx, 'attendance', { ...record, key });
    txPut(tx, 'settings', updatedMeta);

    const afterCatalog = projectAlreadyExists ? durableProjects : [...durableProjects, projectPayload];
    const after = computeAfterCounts({
        effEmployees: effAllEmployees,
        effAttendanceMap,
        effPositions: copyPreparation.effectivePositions,
        effLeaders,
        catalog: afterCatalog,
        employeeProjectIds,
        attendanceProjectIds
    });

    return {
        result: {
            status: REPAIR_STATUS.OK,
            action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
            targetProjectId: target,
            createdProject: createdProject ? projectPayload : null,
            projectAlreadyExisted: projectAlreadyExists,
            createdPositions: copyPreparation.writes.map(deepCopy),
            affected,
            skipped,
            detachedLeaders,
            detachedPositionLeaders: [
                ...copyPreparation.detachedLeaders,
                ...positionLeaderDetachment.detached
            ],
            before,
            after,
            durableCommitted: true
        },
        memoryUpdate: {
            employeeProjectIds,
            attendanceProjectIds,
            employeePositionPatches,
            attendanceRecordPatches,
            employeeLeaderPatches,
            positionLeaderPatches,
            positionCopies: copyPreparation.writes.map(deepCopy),
            repairTimestamp: p.repairTimestamp
        },
        repairAttendanceRecords: writeAttendance
    };
}

/**
 * QUARANTINE: persist a legacy-unresolved: sentinel for each selected employee
 * (and any canonically-owned attendance still pointing elsewhere) without
 * auto-mapping to any real project. Preserves original orphan projectId as
 * provenance. Already-quarantined employees are only a NO_OP when all their
 * canonically-owned attendance already carries the same quarantine id.
 */
function computeQuarantine(reads, tx, p) {
    const durableProjects = reads.projects || [];
    const durableProjectsById = indexById(durableProjects);
    const durableEmployeesById = indexById(reads.employees);

    const effAllEmployees = Array.isArray(reads.employees) ? reads.employees : [];
    const effPositions = Array.isArray(reads.positions) ? reads.positions : [];
    const effLeaders = Array.isArray(reads.leaders) ? reads.leaders : [];
    const effAttendanceMap = buildDurableAttendanceMap(reads.attendance);

    const before = analyzeCounts(effAllEmployees, effAttendanceMap, effPositions, effLeaders, durableProjects);

    const skipped = [];
    const provenance = [];
    const writeEmployees = [];
    const writeAttendance = [];
    const employeeProjectIds = new Map();
    const attendanceProjectIds = new Map();

    const freshestSelected = [];
    for (const sel of p.employees) {
        const empId = trimId(sel?.id);
        if (!empId) continue;
        const freshest = durableEmployeesById.get(empId);
        if (!freshest) {
            return { result: conflictResult(`selected employee "${empId}" is not a durable employee yet`) };
        }
        freshestSelected.push(freshest);
    }

    const callerAttendanceConflict = findCallerOnlyAttendanceConflict(
        freshestSelected,
        p.attendance,
        effAttendanceMap
    );
    if (callerAttendanceConflict) {
        return {
            result: conflictResult(callerAttendanceConflict.reason, {
                conflicts: callerAttendanceConflict.conflicts
            })
        };
    }

    for (const freshest of freshestSelected) {
        const empId = trimId(freshest.id);
        const currentPid = trimId(freshest.projectId);
        const alreadyQuarantined = isQuarantineProjectId(currentPid);
        const quarantineId = alreadyQuarantined ? currentPid : makeQuarantineProjectId(empId);

        // Canonically-owned attendance (fail-closed).
        const match = matchEmployeeAttendance(freshest, effAttendanceMap);
        if (!match.ok) {
            return { result: conflictResult(`canonical attendance for "${empId}" is ambiguous`, { conflicts: match.conflicts }) };
        }
        const attendanceChanges = [];
        for (const { key, record } of match.matched) {
            const recPid = trimId(record?.projectId);
            // R07 Direction (addendum, defense in depth): a record already owned
            // by a valid durable catalog project is legitimate history and must
            // be preserved byte-stable. Only empty/invalid/quarantine-mismatched
            // ids are rewritten to this employee's quarantine id.
            const ownedByValidCatalog = isExplicitProjectId(recPid) && durableProjectsById.has(recPid);
            if (recPid !== quarantineId && !ownedByValidCatalog) {
                const copy = deepCopy(record);
                copy.projectId = quarantineId;
                copy.updatedAt = p.repairTimestamp;
                attendanceChanges.push({ key, record: copy });
            }
        }

        const employeeChanged = !alreadyQuarantined;
        const needsChange = employeeChanged || attendanceChanges.length > 0;
        if (!needsChange) {
            skipped.push(empId);
            continue;
        }

        const originalProjectId = currentPid || null;
        if (employeeChanged) {
            const copy = deepCopy(freshest);
            copy.projectId = quarantineId;
            copy.updatedAt = p.repairTimestamp;
            writeEmployees.push(copy);
            employeeProjectIds.set(empId, quarantineId);
        }
        for (const { key, record } of attendanceChanges) {
            writeAttendance.push({ key, record });
            attendanceProjectIds.set(key, quarantineId);
        }
        provenance.push({ employeeId: empId, originalProjectId, quarantineId });
    }

    if (writeEmployees.length === 0 && writeAttendance.length === 0) {
        return {
            result: {
                status: REPAIR_STATUS.NO_OP,
                reason: skipped.length > 0
                    ? `All ${skipped.length} selected employee(s) are already quarantined`
                    : 'No employees to process',
                skipped,
                affected: [],
                before,
                after: before
            }
        };
    }

    const metaEvent = {
        action: REPAIR_ACTION.QUARANTINE,
        provenance,
        employeeIds: provenance.map(p => p.employeeId)
    };
    const updatedMeta = buildUpdatedMeta(reads.settings, metaEvent);

    for (const emp of writeEmployees) txPut(tx, 'employees', emp);
    for (const { key, record } of writeAttendance) txPut(tx, 'attendance', { ...record, key });
    txPut(tx, 'settings', updatedMeta);

    const after = computeAfterCounts({
        effEmployees: effAllEmployees,
        effAttendanceMap,
        effPositions,
        effLeaders,
        catalog: durableProjects,
        employeeProjectIds,
        attendanceProjectIds
    });

    return {
        result: {
            status: REPAIR_STATUS.OK,
            action: REPAIR_ACTION.QUARANTINE,
            affected: provenance,
            skipped,
            before,
            after,
            durableCommitted: true
        },
        memoryUpdate: { employeeProjectIds, attendanceProjectIds, repairTimestamp: p.repairTimestamp },
        repairAttendanceRecords: writeAttendance
    };
}

/** Dispatch to the correct in-transaction planner for the given action. */
function computeRepair(action, reads, tx, p) {
    switch (action) {
        case REPAIR_ACTION.MAP_TO_EXISTING:
            return computeMapToExisting(reads, tx, p);
        case REPAIR_ACTION.CREATE_PROJECT_AND_MAP:
            return computeCreateProjectAndMap(reads, tx, p);
        case REPAIR_ACTION.QUARANTINE:
            return computeQuarantine(reads, tx, p);
        default:
            return { result: conflictResult(`Action "${action}" is not supported`) };
    }
}

// ─── H2: propagación a la nube (outbox durable, independiente de la red) ────

/** Clon profundo defensivo (los datos para el outbox deben ser inmutables). */
function cloneForOutbox(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return {};
    }
}

/**
 * Scope del remitente para un patch de reparación. Reusa peekEntityScope sólo
 * como fuente de defaultProjectId; `projectId` debe coincidir con el projectId
 * reparado de CADA registro para que el filtrado de scope de
 * saveDailyAttendance no descarte el registro.
 */
function buildRepairPatchScope(repairedProjectId) {
    const current = peekEntityScope();
    return {
        enabled: true,
        projectId: repairedProjectId || null,
        defaultProjectId: current?.defaultProjectId ?? null
    };
}

/**
 * Agrupa los registros de asistencia cambiados por (dateKey, projectId). Una
 * fecha con cambios para varios projectIds produce entradas separadas, cada una
 * con su scope de remitente correspondiente.
 */
function groupRepairAttendanceByDateAndProject(attendanceChanges) {
    const groups = new Map();
    for (const { key, record } of (Array.isArray(attendanceChanges) ? attendanceChanges : [])) {
        if (!record || typeof record !== 'object') continue;
        const dateKey = trimId(record.date);
        const projectId = trimId(record.projectId);
        if (!dateKey) continue;
        const groupKey = `${dateKey}\u0000${projectId || ''}`;
        let group = groups.get(groupKey);
        if (!group) {
            group = { dateKey, projectId: projectId || null, records: {} };
            groups.set(groupKey, group);
        }
        group.records[key] = record;
    }
    return [...groups.values()];
}

/**
 * Encola el trabajo de propagación cloud de una reparación comprometida.
 * - Entidades: snapshot COMPLETO actual (empleados/puestos/líderes), no sólo los
 *   reparados — enqueueEntities coalesce la entrada 'entities' pendiente previa,
 *   así que subir el estado completo evita perder ediciones ajenas pendientes.
 * - Asistencia: patches daily 'ownership-repair' agrupados por fecha+proyecto.
 * - Flush best-effort vía el drenado existente (los guards se re-evalúan ahí:
 *   offline/logout deja las entradas pendientes). Nunca se espera la red.
 *
 * Devuelve { queued, error } SIN lanzar: un fallo de encolado NO revierte la
 * reparación local ya comprometida.
 */
async function enqueueRepairCloudPropagation(txOutcome) {
    try {
        const rawState = stateManager.getState();
        const snapshot = cloneForOutbox(rawState);

        await MainSyncStore.enqueueEntities(
            snapshot.employees || [],
            snapshot.positions || [],
            snapshot.leaders || [],
            snapshot.settings?.schemaVersion
        );

        const groups = groupRepairAttendanceByDateAndProject(txOutcome.repairAttendanceRecords);
        let deferredQuarantinePatches = 0;
        for (const group of groups) {
            // Un sentinel legacy-unresolved:* NO es una obra válida. Encolarlo
            // como scope.projectId haría que el writer diario lo tratara como
            // una obra real. La cuarentena queda durable/local y el estado se
            // reporta explícitamente para una sincronización futura segura.
            if (isQuarantineProjectId(group.projectId)) {
                deferredQuarantinePatches += 1;
                continue;
            }
            await MainSyncStore.enqueueDailyRepairPatch(
                group.dateKey,
                group.records,
                buildRepairPatchScope(group.projectId)
            );
        }

        drainMainSyncOutbox().catch(e =>
            console.warn('⚠️ El drenado del outbox tras la reparación falló (las entradas quedan pendientes):', e)
        );

        return { queued: true, deferredQuarantinePatches };
    } catch (error) {
        console.warn('⚠️ La propagación cloud de la reparación no se pudo encolar (la reparación local queda durable):', error);
        return { queued: false, error: error?.message || String(error) };
    }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point: apply an explicit repair action to a selected set of
 * employees. Never repairs globally unless the caller explicitly supplies the
 * complete target set.
 *
 * @param {object} params
 * @param {string}          params.action               - REPAIR_ACTION value
 * @param {Array<object>}   params.employees            - explicit selected employees (selectors; required)
 * @param {object|Array}    [params.attendance]         - caller attendance snapshot (fallback only)
 * @param {Array<object>}   [params.positions]          - caller positions snapshot (fallback only)
 * @param {Array<object>}   [params.leaders]            - caller leaders snapshot (fallback only)
 * @param {Array<object>}   [params.allEmployees]       - all employees (for shared-entity checks; fallback only)
 * @param {Array<object>}   params.catalog              - caller catalog (backward-compatible; NOT authorization)
 * @param {string}          [params.targetProjectId]    - for MAP_TO_EXISTING
 * @param {string}          params.projectId            - stable id required for CREATE_PROJECT_AND_MAP
 * @param {string}          [params.projectName]        - for CREATE_PROJECT_AND_MAP
 * @param {string}          [params.projectStatus]      - for CREATE_PROJECT_AND_MAP
 * @param {boolean}         [params.skipDependencyCheck] - advanced: bypass dep inspection
 * @param {Array<object>}   [params.positionRemaps]     - explicit employee position/history remaps for MAP_TO_EXISTING / CREATE_PROJECT_AND_MAP
 * @param {Array<object>}   [params.positionCopies]     - destination-owned "similar position" copies for MAP_TO_EXISTING / CREATE_PROJECT_AND_MAP
 * @param {object}          [params._db]                - injectable IDB service (tests)
 *
 * @returns {Promise<object>} result with status, affected, before/after counts,
 *   durableCommitted, and phase-B UI hooks.
 */
export async function applyOwnershipRepair(params = {}) {
    const {
        action,
        employees,
        attendance  = {},
        positions   = [],
        leaders     = [],
        allEmployees = null,
        catalog     = [],
        targetProjectId,
        projectId,
        projectName,
        projectStatus,
        skipDependencyCheck = false,
        positionRemaps = [],
        positionCopies = [],
        _db = indexedDBService
    } = params;

    // --- Input guard: employees must be an explicit non-empty array.
    if (!Array.isArray(employees) || employees.length === 0) {
        return {
            status: REPAIR_STATUS.CONFLICT,
            reason: 'employees must be a non-empty explicit array; global repair is not supported',
            conflicts: [],
            affected: []
        };
    }

    const supportedActions = new Set(Object.values(REPAIR_ACTION));
    if (!supportedActions.has(action)) {
        return {
            status: REPAIR_STATUS.UNSUPPORTED,
            reason: `Action "${action}" is not supported in A2b. Supported: MAP_TO_EXISTING, CREATE_PROJECT_AND_MAP, QUARANTINE.`,
            supportedActions: Object.keys(REPAIR_ACTION),
            affected: []
        };
    }

    await _db.init();

    // H3: mutual exclusion — un FULL import es dueño de la mutación del dataset
    // ahora mismo. Chequeo síncrono inmediatamente ANTES de entrar en la
    // isolación de reparación (sin await entre ambos) para que un FULL import no
    // pueda colarse en el hueco.
    if (isFullImportIsolationInProgress()) {
        return {
            status: REPAIR_STATUS.CONFLICT,
            reason: 'A FULL import is in progress; project repair is blocked until it completes.',
            conflicts: [{ kind: 'FULL_IMPORT_ISOLATION_ACTIVE' }],
            affected: []
        };
    }

    const effectiveAllEmployees = Array.isArray(allEmployees) ? allEmployees : employees;
    const suspendedSaveOptions = beginProjectRepairIsolation();
    const repairTimestamp = Date.now();

    const computeParams = {
        targetProjectId,
        projectId,
        projectName,
        projectStatus,
        employees,
        attendance,
        positions,
        leaders,
        allEmployees: effectiveAllEmployees,
        catalog,
        skipDependencyCheck,
        positionRemaps,
        positionCopies,
        repairTimestamp
    };

    try {
        const rawDb = _db.db || _db;
        let txOutcome = null;

        await runReadWriteTransaction(rawDb, REPAIR_STORES, (reads, tx) => {
            const durable = {
                projects: reads.projects || [],
                employees: reads.employees || [],
                attendance: reads.attendance || [],
                positions: reads.positions || [],
                leaders: reads.leaders || [],
                settings: reads.settings || null
            };
            txOutcome = computeRepair(action, durable, tx, computeParams);
            return txOutcome.result;
        });

        if (!txOutcome || !txOutcome.result) {
            throw new Error('Reconciliation produced no result');
        }

        const result = txOutcome.result;
        if (result.status === REPAIR_STATUS.OK && txOutcome.memoryUpdate) {
            advanceDatasetEpoch();
            applyFieldScopedMemoryUpdate(txOutcome.memoryUpdate);

            // H2: propagación cloud vía outbox durable — ocurre DESPUÉS del
            // commit local y nunca revierte la reparación si el encolado falla.
            const cloudOutcome = await enqueueRepairCloudPropagation(txOutcome);
            result.cloudQueued = cloudOutcome.queued;
            if (cloudOutcome.deferredQuarantinePatches > 0) {
                result.cloudDeferredQuarantine = true;
                result.cloudDeferredQuarantinePatches = cloudOutcome.deferredQuarantinePatches;
            }
            if (!cloudOutcome.queued) result.cloudError = cloudOutcome.error;
        }

        return result;
    } finally {
        endProjectRepairIsolation();
        resumeSuspendedSaveOptions(suspendedSaveOptions);
    }
}

/**
 * Read the persisted reconciliation metadata (for future UI phase B).
 */
export async function getReconciliationMeta(db = indexedDBService) {
    await db.init();
    return db.get('settings', RECONCILIATION_META_KEY);
}

/**
 * Dependency summary for a proposed repair (pre-flight, no mutation).
 * Returns { ok, conflicts, dependencySummary } — the UI can show this
 * before asking the user to confirm. Caller-supplied data only (no IDB).
 */
export function preflightDependencies({
    employees,
    allEmployees,
    positions,
    leaders,
    targetProjectId,
    positionRemaps = [],
    positionCopies = []
}) {
    // UI preview only. The transaction re-reads and revalidates the same
    // remaps/copies against durable positions before committing anything.
    const copyPreparation = preparePositionCopies({
        durablePositions: positions || [],
        durableLeaders: leaders || [],
        targetProjectId,
        positionCopies,
        repairTimestamp: Date.now()
    });
    if (!copyPreparation.ok) {
        return {
            ok: false,
            conflicts: copyPreparation.conflicts,
            dependencySummary: { positions: [], leaders: [], sharedPositions: [], sharedLeaders: [], detachedLeaders: [] }
        };
    }
    const prepared = preparePositionRemaps({
        selectedEmployees: employees || [],
        durablePositions: copyPreparation.effectivePositions,
        targetProjectId,
        positionRemaps,
        repairTimestamp: Date.now()
    });
    if (!prepared.ok) {
        return {
            ok: false,
            conflicts: prepared.conflicts,
            dependencySummary: { positions: [], leaders: [], sharedPositions: [], sharedLeaders: [], detachedLeaders: [] }
        };
    }
    const dependencyResult = inspectDependencies({
        employees: prepared.previewEmployees,
        allEmployees: allEmployees || employees,
        positions: copyPreparation.effectivePositions,
        leaders,
        targetProjectId
    });

    // Preflight must show every leader that the durable repair will detach,
    // including leaders attached to resulting positions and invalid leaders
    // supplied on a destination-owned copy. These are informational only.
    const positionLeaderDetachment = preparePositionLeaderDetachments({
        remapPreparation: prepared,
        positionsById: indexById(copyPreparation.effectivePositions),
        leadersById: indexById(leaders),
        targetProjectId,
        repairTimestamp: Date.now()
    });
    const detached = [
        ...(dependencyResult.dependencySummary?.detachedLeaders || []),
        ...(copyPreparation.detachedLeaders || []),
        ...positionLeaderDetachment.detached
    ];
    const seen = new Set();
    dependencyResult.dependencySummary.detachedLeaders = detached.filter(item => {
        const id = trimId(item?.entityId);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    return dependencyResult;
}

export default { applyOwnershipRepair, getReconciliationMeta, preflightDependencies, REPAIR_ACTION, REPAIR_STATUS, RECONCILIATION_META_KEY };
