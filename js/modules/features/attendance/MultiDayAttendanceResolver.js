/**
 * MultiDayAttendanceResolver — Two-stage multi-day attendance resolver for SA.
 *
 * Isolated F3.4 slice:
 * - Stage A: Resolves Mini-vs-Mini inconsistencies first (identities & hours conflicts).
 * - Stage B: Adapts each resolved day to the canonical conflict plan and applies via
 *   buildMiniAttendanceApplyPlan / applyMiniAttendancePlan and AttendanceRecordWriter.
 * - ZERO direct writes to state.attendance.
 * - Missing row from a Mini is never absence/deletion.
 * - Structured rows without saEmployeeId require explicit identity resolution; NEVER auto-linked.
 * - Hours conflict requires explicit source choice (or manual hours); no majority auto-win.
 * - Plain existing-record differences default safely to keep-current; complex/inactive cases still require explicit resolution.
 * - Identical existing rows are treated as no-op (keep_existing).
 * - Provenance preserved in miniImportAudit.sources.
 * - Day and period views supported; period is presentation only, resolution/apply remains day-atomic.
 * - Batch apply supports applying all ready days while leaving blocked days untouched.
 * - Zero writes before explicit confirmation.
 */

import {
    consolidateAttendanceSubmissions,
    groupConsolidatedAttendance
} from './AttendanceConsolidation.js';
import {
    isMiniAttendanceEmployeeEligible,
    existingProjection,
    buildMiniAttendanceApplyPlan
} from './MiniAttendanceDraft.js';
import { applyMiniAttendancePlan } from './MiniAttendanceImportService.js';
import { entityInScope } from '../projects/ProjectContext.js';

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(child => deepFreeze(child, seen));
    return Object.freeze(value);
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
    }
    return value;
}

function canDefaultKeepCurrentConflict({ item, employee, existing, positionIds, imported, isIdentical }) {
    if (isIdentical || !existing?.record || !employee) return false;
    if (employee.active === false || employee.deletedAt != null) return false;
    if (item?.status !== 'resolved') return false;
    if (imported?.rosterStatus && imported.rosterStatus !== 'active') return false;
    if (!Array.isArray(positionIds) || positionIds.length !== 1) return false;
    if (Array.isArray(existing.breakdown) && existing.breakdown.length > 1) return false;
    const sources = Array.isArray(item?.sources) ? item.sources : [];
    if (sources.some(source => source?.missingRoster === true)) return false;
    return true;
}

/**
 * Adapts resolved items for a single date to a canonical conflict plan adhering to
 * buildMiniAttendanceApplyPlan's contract.
 *
 * @param {object} options
 * @param {string} options.date - ISO workDate
 * @param {Array<object>} options.items - Consolidated items
 * @param {Array<object>} [options.employees=[]] - SA employees
 * @param {object} [options.attendance={}] - Existing SA attendance
 * @param {Map} [options.decisions=new Map()] - User decisions map for existing SA conflicts
 * @param {number} [options.revision=1]
 * @param {number} [options.draftRevision=1]
 * @returns {object} Canonical conflict plan
 */
export function adaptResolvedDayToConflictPlan({
    date,
    items = [],
    employees = [],
    attendance = {},
    decisions = new Map(),
    revision = 1,
    draftRevision = 1
}) {
    if (!date || typeof date !== 'string') {
        throw new TypeError('Valid date string is required');
    }

    const dateItems = items.filter(item => item.workDate === date && !item.excluded);

    // Verify no unresolved Stage A items remain
    const hasUnresolvedItems = dateItems.some(
        item => item.status === 'identity_conflict' || item.status === 'conflict' || !item.saEmployeeId
    );

    if (hasUnresolvedItems) {
        throw new Error(`Cannot adapt day ${date} to conflict plan: unresolved Stage A conflicts present`);
    }

    const rows = dateItems.map(item => {
        const employeeId = item.saEmployeeId;
        const employee = employees.find(e => e.id === employeeId);
        const positionIds = employee && Array.isArray(employee.positions) ? [...employee.positions] : [];
        const key = `${employeeId}-${date}`;
        const existingRecord = attendance[key] || null;
        const existing = existingProjection(existingRecord);

        const imported = {
            normalHours: item.normalHours,
            overtimeHours: item.overtimeHours,
            status: item.sourceStatus || (item.normalHours + item.overtimeHours > 0 ? 'present' : 'unmarked'),
            rosterStatus: item.rosterStatus || null
        };

        const existingNormal = existingRecord && Number.isFinite(existingRecord.hoursWorked)
            ? existingRecord.hoursWorked : 0;
        const existingOvertime = existingRecord && Number.isFinite(existingRecord.overtimeHours)
            ? existingRecord.overtimeHours : 0;
        const isIdentical = Boolean(existingRecord) &&
            existingNormal === imported.normalHours &&
            existingOvertime === imported.overtimeHours;

        const userDecision = decisions.get(key);

        let decision;
        let targetPositionId = null;
        let positionAllocations = [];

        if (userDecision) {
            decision = {
                action: userDecision.action,
                acknowledged: userDecision.acknowledged === true,
                defaulted: userDecision.defaulted === true
            };
            targetPositionId = userDecision.targetPositionId || (positionIds.length === 1 ? positionIds[0] : null);
            positionAllocations = userDecision.positionAllocations || (targetPositionId ? [{
                positionId: targetPositionId,
                normalHours: imported.normalHours,
                overtimeHours: imported.overtimeHours
            }] : []);
        } else if (isIdentical) {
            // Identical existing row: auto-acknowledged keep_existing -> no-op in apply (keptKeys)
            decision = {
                action: 'keep_existing',
                acknowledged: true,
                defaulted: false
            };
            targetPositionId = positionIds[0] || null;
            positionAllocations = targetPositionId ? [{
                positionId: targetPositionId,
                normalHours: imported.normalHours,
                overtimeHours: imported.overtimeHours
            }] : [];
        } else if (existingRecord) {
            // Plain hour differences safely default to preserving the current value.
            // Complex/inactive/missing-roster cases keep the explicit-decision blocker.
            const defaultKeepCurrent = canDefaultKeepCurrentConflict({
                item, employee, existing, positionIds, imported, isIdentical
            });
            decision = {
                action: 'keep_existing',
                acknowledged: defaultKeepCurrent,
                defaulted: defaultKeepCurrent
            };
            targetPositionId = positionIds.length === 1 ? positionIds[0] : null;
            positionAllocations = targetPositionId ? [{
                positionId: targetPositionId,
                normalHours: imported.normalHours,
                overtimeHours: imported.overtimeHours
            }] : [];
        } else {
            // New record: use imported
            decision = {
                action: 'use_imported',
                acknowledged: true,
                defaulted: false
            };
            targetPositionId = positionIds.length === 1 ? positionIds[0] : null;
            positionAllocations = targetPositionId ? [{
                positionId: targetPositionId,
                normalHours: imported.normalHours,
                overtimeHours: imported.overtimeHours
            }] : [];
        }

        const rowBlockers = [];
        if (existingRecord && !isIdentical && !decision.acknowledged) {
            rowBlockers.push('decision_unacknowledged');
        }
        if (decision.action === 'use_imported') {
            if (!positionAllocations.length) {
                rowBlockers.push('target_position_required');
            } else if (positionAllocations.some(p => !p.positionId || !positionIds.includes(p.positionId))) {
                rowBlockers.push('target_position_invalid');
            }
        }

        return {
            key,
            employeeId,
            displayName: item.displayName || employee?.name || '',
            displayNumber: item.displayNumber || employee?.number || '',
            sources: cloneValue(item.sources || []),
            imported,
            existing,
            isIdentical,
            decision,
            targetPositionId,
            employeePositionIds: positionIds,
            positionAllocations,
            blockers: rowBlockers
        };
    });

    const hasBlockingIssues = rows.some(r => r.blockers.length > 0);

    return deepFreeze({
        revision,
        draftRevision,
        date,
        globalBlockers: [],
        hasBlockingIssues,
        rows
    });
}

/**
 * SAFE predicate for day-level Mini↔SA bulk actions.
 * Only plain two-way attendance-hours conflicts are bulk-compatible.
 * Identity conflicts, position choices, paused/blocked/reactivation cases,
 * roster-status differences, missing/not-reported semantics, or any case with
 * more than the simple SA-vs-consolidated hours choice return false.
 */
export function isSafeBulkSaConflict(item, conflictRow, employees = []) {
    if (!item || typeof item !== 'object') return false;
    if (!conflictRow || typeof conflictRow !== 'object') return false;
    if (item.excluded === true) return false;
    if (typeof item.saEmployeeId !== 'string' || !item.saEmployeeId) return false;
    if (item.status !== 'resolved') return false;
    if (conflictRow.employeeId !== item.saEmployeeId) return false;
    if (conflictRow.isIdentical === true) return false;
    if (!conflictRow.decision) return false;
    const blockers = Array.isArray(conflictRow.blockers) ? conflictRow.blockers : [];
    const isDefaultKeepCurrent = conflictRow.decision.action === 'keep_existing' &&
        conflictRow.decision.acknowledged === true && conflictRow.decision.defaulted === true && blockers.length === 0;
    const isUnacknowledgedSimpleChoice = conflictRow.decision.acknowledged !== true &&
        blockers.length === 1 && blockers[0] === 'decision_unacknowledged';
    if (!isDefaultKeepCurrent && !isUnacknowledgedSimpleChoice) return false;
    const positionIds = Array.isArray(conflictRow.employeePositionIds)
        ? conflictRow.employeePositionIds
        : [];
    if (positionIds.length !== 1) return false;
    const allocations = Array.isArray(conflictRow.positionAllocations)
        ? conflictRow.positionAllocations
        : [];
    if (allocations.length !== 1) return false;
    if (allocations[0]?.positionId !== positionIds[0]) return false;
    const existing = conflictRow.existing;
    if (!existing || !existing.record) return false;
    const breakdown = Array.isArray(existing.breakdown) ? existing.breakdown : null;
    if (!breakdown || breakdown.length > 1) return false;
    const list = Array.isArray(employees) ? employees : [];
    const employee = list.find(candidate => candidate?.id === item.saEmployeeId);
    if (!employee) return false;
    if (employee.active === false || employee.deletedAt != null) return false;
    if (item.rosterStatus && item.rosterStatus !== 'active') return false;
    const sources = Array.isArray(item.sources) ? item.sources : [];
    if (sources.some(source => source?.missingRoster === true)) return false;
    if (sources.some(source => source?.rosterStatus && source.rosterStatus !== 'active')) return false;
    const rosterStates = new Set(
        sources.filter(source => source?.rosterStatus).map(source => source.rosterStatus)
    );
    if (rosterStates.size > 1) return false;
    if (!Number.isFinite(item.normalHours) || !Number.isFinite(item.overtimeHours)) return false;
    const total = Number(item.normalHours) + Number(item.overtimeHours);
    if (!(total >= 0 && total <= 24)) return false;
    const effectiveStatus = item.sourceStatus || (total > 0 ? 'present' : 'unmarked');
    if (effectiveStatus !== 'present') return false;
    if (sources.some(source => source?.status != null && source.status !== 'present')) return false;
    if (Array.isArray(item.conflictReasons) && item.conflictReasons.length > 0) return false;
    return true;
}

export class MultiDayAttendanceResolver {
    constructor({
        consolidation = null,
        submissions = null,
        employees = [],
        attendance = {},
        positions = [],
        saProjectId = null,
        regularLimit = 8,
        applyPlan = applyMiniAttendancePlan,
        entityScope = null,
        stage = 'combined',
        completedMiniDates = [],
        mergeOvertimeIntoNormal = false
    } = {}) {
        let baseConsolidation = consolidation;
        if (!baseConsolidation && Array.isArray(submissions)) {
            baseConsolidation = consolidateAttendanceSubmissions(submissions, {
                expectedSaProjectId: saProjectId
            });
        }
        if (!baseConsolidation) {
            throw new TypeError('Either consolidation or submissions array is required');
        }

        this.saProjectId = saProjectId || baseConsolidation.saProjectId || null;
        this.employees = Array.isArray(employees) ? employees : [];
        this.attendance = attendance || {};
        this.positions = Array.isArray(positions) ? positions : [];
        this.regularLimit = regularLimit;
        this.applyPlan = applyPlan;
        this.entityScope = entityScope;
        this.mergeOvertimeIntoNormal = mergeOvertimeIntoNormal === true;
        if (!['combined', 'mini', 'sa'].includes(stage)) {
            throw new TypeError(`Invalid resolver stage: ${stage}`);
        }
        this.stage = stage;
        this.completedMiniDates = new Set(
            Array.isArray(completedMiniDates) ? completedMiniDates.filter(date => typeof date === 'string') : []
        );

        this.workDates = [...(baseConsolidation.workDates || [])].sort();
        this.contributingSubmissions = baseConsolidation.contributingSubmissions || [];
        this.devices = baseConsolidation.devices || [];
        this.items = cloneValue(baseConsolidation.items || []);

        this.dayDecisions = new Map(); // `${employeeId}-${date}` -> decision
        this.dayApplyResults = new Map(); // date -> result
        this.activeViewMode = 'day';

        this._recomputeAllDayStates();
    }

    _recomputeAllDayStates() {
        this.dayStates = new Map();
        for (const date of this.workDates) {
            this._recomputeDayState(date);
        }
    }

    _recomputeDayState(date) {
        const dateItems = this.items.filter(item => item.workDate === date && !item.excluded);

        // Check Stage A blockers (unresolved identity or hours conflict)
        const stageABlockers = [];
        const hasMissingId = dateItems.some(item => !item.saEmployeeId || item.status === 'identity_conflict');
        if (hasMissingId) stageABlockers.push('missing_sa_employee_id');

        const hasHoursConflict = dateItems.some(item => item.status === 'conflict');
        if (hasHoursConflict) stageABlockers.push('hours_conflict');

        if (stageABlockers.length > 0) {
            this.dayStates.set(date, deepFreeze({
                date,
                status: 'stage_a_blocked',
                stageABlockers,
                stageBBlockers: [],
                canApply: false,
                items: cloneValue(dateItems),
                conflictPlan: null,
                applyPlan: null,
                applyResult: this.dayApplyResults.get(date) || null
            }));
            return;
        }

        // In staged mode, Mini↔Mini resolution must complete independently
        // before SA attendance is consulted. A completed day can be persisted and
        // resumed without creating/applying any SA conflict plan.
        if (this.stage === 'mini') {
            const completed = this.completedMiniDates.has(date);
            this.dayStates.set(date, deepFreeze({
                date,
                status: completed ? 'mini_day_completed' : 'mini_day_ready',
                stageABlockers: [],
                stageBBlockers: [],
                canApply: false,
                canCompleteMiniDay: !completed,
                items: cloneValue(dateItems),
                conflictPlan: null,
                applyPlan: null,
                applyResult: null
            }));
            return;
        }

        // Stage A is resolved for this day. Adapt to Stage B conflict plan.
        const conflictPlan = adaptResolvedDayToConflictPlan({
            date,
            items: this.items,
            employees: this.employees,
            attendance: this.attendance,
            decisions: this.dayDecisions,
            revision: 1,
            draftRevision: 1
        });

        const stageBBlockers = [];
        if (conflictPlan.hasBlockingIssues) {
            for (const row of conflictPlan.rows) {
                stageBBlockers.push(...row.blockers);
            }
        }

        const isApplied = this.dayApplyResults.has(date);
        let status;
        if (isApplied) {
            status = 'applied';
        } else if (conflictPlan.hasBlockingIssues) {
            status = 'stage_b_conflict';
        } else {
            status = 'ready';
        }

        this.dayStates.set(date, deepFreeze({
            date,
            status,
            stageABlockers: [],
            stageBBlockers: [...new Set(stageBBlockers)],
            canApply: status === 'ready',
            items: cloneValue(dateItems),
            conflictPlan,
            applyPlan: status === 'ready' ? buildMiniAttendanceApplyPlan(conflictPlan, {
                expectedDraftRevision: 1,
                mergeOvertimeIntoNormal: this.mergeOvertimeIntoNormal
            }) : null,
            applyResult: this.dayApplyResults.get(date) || null
        }));
    }

    _employeeInResolverScope(employee) {
        if (!employee) return false;
        const scope = this.entityScope;
        if (scope?.enabled) {
            if (!scope.projectId || scope.projectId !== this.saProjectId) return false;
            return entityInScope(employee, scope);
        }
        if (!this.saProjectId) return true;
        if (employee.projectId == null) return false;
        return String(employee.projectId) === String(this.saProjectId);
    }

    getIdentityCandidates() {
        const numberValue = value => {
            const text = String(value ?? '').trim();
            if (!text) return Number.POSITIVE_INFINITY;
            const numeric = Number(text);
            return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
        };
        return this.employees
            .filter(employee =>
                isMiniAttendanceEmployeeEligible(employee) && this._employeeInResolverScope(employee)
            )
            .slice()
            .sort((left, right) => {
                const leftNumber = numberValue(left?.number);
                const rightNumber = numberValue(right?.number);
                if (leftNumber !== rightNumber) return leftNumber - rightNumber;
                const numberOrder = String(left?.number ?? '').localeCompare(
                    String(right?.number ?? ''), 'es', { numeric: true, sensitivity: 'base' }
                );
                if (numberOrder !== 0) return numberOrder;
                return String(left?.name ?? '').localeCompare(
                    String(right?.name ?? ''), 'es', { sensitivity: 'base' }
                );
            });
    }

    /**
     * Stage A: Explicitly resolves the identity of an item with missing saEmployeeId.
     * NEVER auto-links by number or name.
     *
     * @param {string} itemId - ID of the unresolved item
     * @param {string} targetEmployeeId - SA employee ID
     * @returns {object} Updated item
     */
    resolveItemIdentity(itemId, targetEmployeeId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);

        if (!this.saProjectId || item.saProjectId !== this.saProjectId) {
            throw new TypeError(`Item ${itemId} does not belong to resolver project ${this.saProjectId || '(missing)'}`);
        }

        const employee = this.employees.find(e => e.id === targetEmployeeId);
        if (!employee) throw new Error(`Employee not found: ${targetEmployeeId}`);
        if (!isMiniAttendanceEmployeeEligible(employee)) {
            throw new TypeError(`Employee ${targetEmployeeId} is inactive or ineligible for attendance import`);
        }
        if (!this._employeeInResolverScope(employee)) {
            throw new TypeError(`Employee ${targetEmployeeId} does not belong to project ${this.saProjectId}`);
        }

        item.saEmployeeId = employee.id;
        item.displayName = employee.name;
        item.displayNumber = employee.number;

        // Check if another item on the SAME (saProjectId, saEmployeeId, workDate) exists
        const duplicateIndex = this.items.findIndex(
            other => other !== item &&
                other.saProjectId === item.saProjectId &&
                other.saEmployeeId === employee.id &&
                other.workDate === item.workDate &&
                !other.excluded
        );

        if (duplicateIndex !== -1) {
            const other = this.items[duplicateIndex];
            // Merge sources
            const mergedSources = [...item.sources, ...other.sources];
            item.sources = mergedSources;

            const normalHoursSet = new Set(mergedSources.map(s => s.normalHours));
            const overtimeHoursSet = new Set(mergedSources.map(s => s.overtimeHours));
            const hoursAgree = normalHoursSet.size === 1 && overtimeHoursSet.size === 1;

            if (hoursAgree) {
                item.status = 'resolved';
                item.conflictType = null;
                item.normalHours = mergedSources[0].normalHours;
                item.overtimeHours = mergedSources[0].overtimeHours;
                item.blockers = [];
            } else {
                item.status = 'conflict';
                item.conflictType = 'hours_conflict';
                item.normalHours = null;
                item.overtimeHours = null;
                item.conflictingHours = mergedSources.map(s => ({
                    sourceId: s.sourceId,
                    deviceId: s.deviceId,
                    normalHours: s.normalHours,
                    overtimeHours: s.overtimeHours,
                    capturedAt: s.capturedAt
                }));
                item.blockers = ['hours_conflict'];
            }

            // Remove other item
            this.items.splice(duplicateIndex, 1);
        } else {
            item.status = 'resolved';
            item.conflictType = null;
            item.blockers = [];
        }

        this._recomputeDayState(item.workDate);
        return item;
    }

    /**
     * Stage A: Explicitly resolves an hours conflict between Minis.
     * Requires explicit source choice or manual hours; NO majority auto-win.
     *
     * @param {string} itemId - ID of the conflicting item
     * @param {object} choice - { sourceIndex } or { normalHours, overtimeHours }
     * @returns {object} Updated item
     */
    resolveItemHours(itemId, choice) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);

        let normalHours;
        let overtimeHours;

        if (choice && Number.isInteger(choice.sourceIndex)) {
            const src = item.sources[choice.sourceIndex];
            if (!src) throw new RangeError(`Invalid sourceIndex: ${choice.sourceIndex}`);
            normalHours = src.normalHours;
            overtimeHours = src.overtimeHours;
        } else if (choice && typeof choice.deviceId === 'string') {
            const src = item.sources.find(s => s.deviceId === choice.deviceId);
            if (!src) throw new Error(`Source with deviceId ${choice.deviceId} not found`);
            normalHours = src.normalHours;
            overtimeHours = src.overtimeHours;
        } else if (choice && Number.isFinite(choice.normalHours)) {
            normalHours = choice.normalHours;
            overtimeHours = Number.isFinite(choice.overtimeHours) ? choice.overtimeHours : 0;
            if (normalHours < 0 || overtimeHours < 0 || normalHours + overtimeHours > 24) {
                throw new RangeError('Invalid hours specification');
            }
        } else {
            throw new TypeError('Explicit source choice or valid manual hours required');
        }

        item.normalHours = normalHours;
        item.overtimeHours = overtimeHours;
        item.totalHours = normalHours + overtimeHours;
        if (choice && Number.isInteger(choice.sourceIndex)) {
            const selected = item.sources[choice.sourceIndex];
            item.sourceStatus = selected?.status || (item.totalHours > 0 ? 'present' : 'unmarked');
            item.rosterStatus = selected?.rosterStatus || null;
            item.resolutionSource = {
                submissionId: selected?.submissionId || null,
                deviceId: selected?.deviceId || null,
                sourcePeerId: selected?.sourcePeerId || null,
                sourcePeerName: selected?.sourcePeerName || null,
                missingRoster: selected?.missingRoster === true
            };
        } else if (choice && typeof choice.deviceId === 'string') {
            const selected = item.sources.find(source => source.deviceId === choice.deviceId);
            item.sourceStatus = selected?.status || (item.totalHours > 0 ? 'present' : 'unmarked');
            item.rosterStatus = selected?.rosterStatus || null;
            item.resolutionSource = {
                submissionId: selected?.submissionId || null,
                deviceId: selected?.deviceId || null,
                sourcePeerId: selected?.sourcePeerId || null,
                sourcePeerName: selected?.sourcePeerName || null,
                missingRoster: selected?.missingRoster === true
            };
        } else {
            item.sourceStatus = item.totalHours > 0 ? 'present' : 'unmarked';
            item.rosterStatus = 'active';
            item.resolutionSource = { manual: true };
        }
        item.status = 'resolved';
        item.conflictType = null;
        item.conflictReasons = [];
        item.blockers = [];

        this._recomputeDayState(item.workDate);
        return item;
    }

    /** Selects one Mini as the source for every compatible row of one day.
     * Identity conflicts and rows absent from the selected Mini remain pending. */
    resolveDayFromSource(date, deviceId) {
        if (typeof deviceId !== 'string' || !deviceId) {
            throw new TypeError('A Mini deviceId is required');
        }
        const dateItems = this.items.filter(item => item.workDate === date && !item.excluded);
        let resolvedCount = 0;
        let skippedCount = 0;
        for (const item of dateItems) {
            if (!item.saEmployeeId || item.status === 'identity_conflict') {
                skippedCount += 1;
                continue;
            }
            const source = Array.isArray(item.sources)
                ? item.sources.find(candidate => candidate.deviceId === deviceId && candidate.missingRoster !== true)
                : null;
            if (!source) {
                skippedCount += 1;
                continue;
            }
            if (item.sources.length > 1 || item.status === 'conflict' || item.resolutionSource) {
                this.resolveItemHours(item.id, { deviceId });
                resolvedCount += 1;
            }
        }
        this._recomputeDayState(date);
        return deepFreeze({ date, deviceId, resolvedCount, skippedCount });
    }

    /**
     * Excludes an item from consolidation and apply.
     *
     * @param {string} itemId
     * @returns {object} Excluded item
     */
    excludeItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error(`Item not found: ${itemId}`);

        item.excluded = true;
        item.status = 'excluded';
        item.blockers = [];

        this._recomputeDayState(item.workDate);
        return item;
    }

    /**
     * Stage B: Resolves an existing SA conflict for a specific employee and date.
     *
     * @param {string} date - ISO workDate
     * @param {string} employeeId - SA employee ID
     * @param {object} resolution - { action: 'keep_existing' | 'use_imported', targetPositionId, positionAllocations }
     * @returns {object} Updated day state
     */
    resolveDayConflict(date, employeeId, { action, targetPositionId = null, positionAllocations = null } = {}) {
        if (!['keep_existing', 'use_imported'].includes(action)) {
            throw new TypeError(`Invalid conflict action: "${action}". Expected "keep_existing" or "use_imported"`);
        }

        const key = `${employeeId}-${date}`;
        this.dayDecisions.set(key, {
            action,
            acknowledged: true,
            defaulted: false,
            targetPositionId,
            positionAllocations
        });

        this._recomputeDayState(date);
        return this.getDayState(date);
    }

    /**
     * Day-level bulk resolution for consolidated Mini↔SA, limited to SAFE
     * compatible plain attendance-hours conflicts only. Never bulk-resolves
     * identity conflicts, position choices, paused/blocked/reactivation cases,
     * roster-status differences, missing/not-reported semantics, or any case
     * with more than the simple two-way hours choice. Affects only the given
     * day and unresolved compatible rows, persists through dayDecisions and
     * the canonical conflict plan, and never writes attendance directly.
     */
    resolveDaySafeBulkConflicts(date, action) {
        if (!['keep_existing', 'use_imported'].includes(action)) {
            throw new TypeError(`Invalid conflict action: "${action}". Expected "keep_existing" or "use_imported"`);
        }
        const dayState = this.getDayState(date);
        if (!dayState) throw new Error(`Unknown date: ${date}`);
        if (!dayState.conflictPlan) {
            return deepFreeze({
                date,
                action,
                resolvedCount: 0,
                skippedCount: (dayState.items || []).length
            });
        }
        const rowsByEmployee = new Map(
            (dayState.conflictPlan.rows || []).map(row => [row.employeeId, row])
        );
        const targets = [];
        let skippedCount = 0;
        for (const item of (dayState.items || [])) {
            const conflictRow = rowsByEmployee.get(item.saEmployeeId);
            if (isSafeBulkSaConflict(item, conflictRow, this.employees)) {
                targets.push(item.saEmployeeId);
            } else {
                skippedCount += 1;
            }
        }
        for (const employeeId of targets) {
            this.dayDecisions.set(`${employeeId}-${date}`, {
                action,
                acknowledged: true,
                defaulted: false,
                targetPositionId: null,
                positionAllocations: null
            });
        }
        if (targets.length) this._recomputeDayState(date);
        return deepFreeze({ date, action, resolvedCount: targets.length, skippedCount });
    }


    setMergeOvertimeIntoNormal(enabled) {
        this.mergeOvertimeIntoNormal = enabled === true;
        for (const date of this.workDates) {
            if (!this.dayApplyResults.has(date)) this._recomputeDayState(date);
        }
        return this.mergeOvertimeIntoNormal;
    }

    /**
     * Returns the state for a single date.
     *
     * @param {string} date
     * @returns {object} Day state
     */
    getDayState(date) {
        return this.dayStates.get(date) || null;
    }

    /**
     * Returns all day states as an array sorted by date.
     *
     * @returns {Array<object>}
     */
    getAllDayStates() {
        return this.workDates.map(date => this.getDayState(date));
    }

    /** Completes one Mini↔Mini day after all Stage A conflicts are resolved. */
    completeMiniDay(date) {
        if (this.stage !== 'mini') throw new Error('completeMiniDay is only available in mini stage');
        const state = this.getDayState(date);
        if (!state) throw new Error(`Unknown date: ${date}`);
        if (state.status !== 'mini_day_ready') {
            throw new Error(`Day ${date} is not ready for Mini consolidation (status: ${state.status})`);
        }
        this.completedMiniDates.add(date);
        this._recomputeDayState(date);
        return this.getMiniProgressSnapshot();
    }

    reopenMiniDay(date) {
        if (this.stage !== 'mini') throw new Error('reopenMiniDay is only available in mini stage');
        this.completedMiniDates.delete(date);
        this._recomputeDayState(date);
        return this.getDayState(date);
    }

    isMiniStageComplete() {
        return this.stage === 'mini' && this.workDates.length > 0 &&
            this.workDates.every(date => this.completedMiniDates.has(date));
    }

    getMiniProgressSnapshot() {
        if (this.stage !== 'mini') throw new Error('Mini progress snapshot is only available in mini stage');
        return deepFreeze({
            schema: 'mini-attendance-consolidation-progress/v1',
            saProjectId: this.saProjectId,
            sourceSubmissionIds: this.contributingSubmissions.map(item => item.submissionId).filter(Boolean),
            workDates: [...this.workDates],
            completedDays: [...this.completedMiniDates].sort(),
            devices: [...this.devices],
            contributingSubmissions: cloneValue(this.contributingSubmissions),
            items: cloneValue(this.items),
            summary: {
                totalItems: this.items.filter(item => !item.excluded).length,
                resolvedCount: this.items.filter(item => !item.excluded && item.status === 'resolved').length,
                hoursConflictCount: this.items.filter(item => !item.excluded && item.status === 'conflict').length,
                unresolvedIdentityCount: this.items.filter(item => !item.excluded && item.status === 'identity_conflict').length,
                submissionsCount: this.contributingSubmissions.length
            }
        });
    }

    buildMiniConsolidatedDraft({ consolidationId, revision = 1, now = Date.now() } = {}) {
        if (this.stage !== 'mini') throw new Error('Mini consolidated draft can only be built in mini stage');
        if (!this.isMiniStageComplete()) throw new Error('All Mini consolidation days must be completed first');
        if (typeof consolidationId !== 'string' || !consolidationId.trim()) {
            throw new TypeError('consolidationId is required');
        }
        const items = cloneValue(this.items.filter(item => !item.excluded));
        if (items.some(item => item.status === 'conflict' || item.status === 'identity_conflict' || !item.saEmployeeId)) {
            throw new Error('Mini consolidated draft contains unresolved items');
        }
        return deepFreeze({
            schema: 'mini-attendance-consolidated/v1',
            consolidationId: consolidationId.trim(),
            revision,
            status: 'mini_consolidated',
            saProjectId: this.saProjectId,
            sourceSubmissionIds: this.contributingSubmissions.map(item => item.submissionId).filter(Boolean),
            workDates: [...this.workDates],
            completedDays: [...this.completedMiniDates].sort(),
            devices: [...this.devices],
            contributingSubmissions: cloneValue(this.contributingSubmissions),
            items,
            summary: {
                totalItems: items.length,
                resolvedCount: items.filter(item => item.status === 'resolved').length,
                hoursConflictCount: 0,
                unresolvedIdentityCount: 0,
                submissionsCount: this.contributingSubmissions.length
            },
            createdAt: now,
            updatedAt: now
        });
    }

    /**
     * Builds the apply plan for a specific date if it is ready.
     *
     * @param {string} date
     * @returns {object} Canonical apply plan
     */
    buildDayApplyPlan(date) {
        const dayState = this.getDayState(date);
        if (!dayState) throw new Error(`Unknown date: ${date}`);
        if (dayState.status !== 'ready') {
            throw new Error(`Day ${date} is not ready to apply (status: "${dayState.status}")`);
        }
        return dayState.applyPlan;
    }

    /**
     * Applies a single day atomically using the canonical apply plan and writer.
     *
     * @param {string} date
     * @param {object} [options]
     * @returns {Promise<object>} Apply result
     */
    async applyDay(date, { now = Date.now(), announce = 'Asistencia importada', deps = {} } = {}) {
        const applyPlan = this.buildDayApplyPlan(date);
        const result = await this.applyPlan(applyPlan, { now, announce, deps });

        this.dayApplyResults.set(date, result);

        // The canonical apply service/writer owns attendance mutation. The resolver
        // records only the apply result and never writes into attendance directly.
        this._recomputeDayState(date);
        return result;
    }

    /**
     * Applies all days that are currently ready.
     * Blocked days remain untouched and blocked.
     *
     * @param {object} [options]
     * @returns {Promise<Array<object>>} Results of applied days
     */
    async applyReadyDays(options = {}) {
        const readyDates = this.workDates.filter(date => this.getDayState(date).status === 'ready');
        const results = [];
        for (const date of readyDates) {
            const result = await this.applyDay(date, options);
            results.push({ date, ...result });
        }
        return results;
    }

    /**
     * Returns a multi-day summary across all dates.
     *
     * @returns {object} Summary metrics
     */
    getMultiDaySummary() {
        const states = this.getAllDayStates();
        const nonExcludedItems = this.items.filter(i => !i.excluded);

        return deepFreeze({
            workDates: [...this.workDates],
            totalDays: this.workDates.length,
            readyDaysCount: states.filter(s => s.status === 'ready' || s.status === 'mini_day_ready').length,
            blockedDaysCount: states.filter(s => s.status === 'stage_a_blocked' || s.status === 'stage_b_conflict').length,
            appliedDaysCount: states.filter(s => s.status === 'applied').length,
            completedMiniDaysCount: states.filter(s => s.status === 'mini_day_completed').length,
            stageAConflictCount: states.filter(s => s.status === 'stage_a_blocked').length,
            stageBConflictCount: states.filter(s => s.status === 'stage_b_conflict').length,
            totalItems: nonExcludedItems.length,
            resolvedItemsCount: nonExcludedItems.filter(i => i.status === 'resolved').length
        });
    }

    /**
     * Returns grouped view for day or period presentation.
     * Period is presentation only; resolution/apply remains day-atomic.
     *
     * @param {'day'|'period'} [mode='day']
     * @returns {object} Grouped presentation
     */
    getConsolidatedView(mode = 'day') {
        const cleanMode = mode === 'period' ? 'period' : 'day';
        const consolidationSnapshot = {
            saProjectId: this.saProjectId,
            workDates: [...this.workDates],
            devices: [...this.devices],
            contributingSubmissions: this.contributingSubmissions,
            items: cloneValue(this.items.filter(i => !i.excluded)),
            summary: {
                totalItems: this.items.filter(i => !i.excluded).length,
                resolvedCount: this.items.filter(i => !i.excluded && i.status === 'resolved').length,
                hoursConflictCount: this.items.filter(i => !i.excluded && i.status === 'conflict').length,
                unresolvedIdentityCount: this.items.filter(i => !i.excluded && i.status === 'identity_conflict').length,
                submissionsCount: this.contributingSubmissions.length
            }
        };

        const grouped = groupConsolidatedAttendance(consolidationSnapshot, cleanMode);

        if (cleanMode === 'day') {
            const enrichedGroups = grouped.groups.map(group => ({
                ...group,
                dayState: this.getDayState(group.workDate)
            }));
            return deepFreeze({
                ...grouped,
                groups: enrichedGroups,
                summary: this.getMultiDaySummary()
            });
        }

        return deepFreeze({
            ...grouped,
            summary: this.getMultiDaySummary(),
            dayStates: this.getAllDayStates()
        });
    }
}

export function createMultiDayAttendanceResolver(options) {
    return new MultiDayAttendanceResolver(options);
}

export default MultiDayAttendanceResolver;
