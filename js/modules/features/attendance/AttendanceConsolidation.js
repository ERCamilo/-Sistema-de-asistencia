/**
 * AttendanceConsolidation — Pure cross-Mini attendance consolidation for SA.
 *
 * Foundation approved by F3.4 audit:
 * - Pure cross-Mini consolidation grouped strictly by (saProjectId, saEmployeeId, workDate).
 * - IMPORTANT: For structured P2P submissions, a missing saEmployeeId must become
 *   identity_conflict/unresolved; NEVER auto-link by number or name.
 * - Missing row from another Mini never means absent/deletion.
 * - Preserves complete raw source/provenance for every contributing Mini.
 * - Supports review grouping modes: 'day' and 'period'.
 * - Builds a proposal seam for existing resolver only; never writes to state.attendance.
 * - Pure and mutation-free. Zero Firebase.
 */

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(child => deepFreeze(child, seen));
    return Object.freeze(value);
}

function isGenericDeviceId(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') return true;
    const clean = deviceId.trim().toLowerCase();
    return ['mini-device', 'mini-app', 'device', 'mini', 'generic', 'unknown'].includes(clean);
}

function employeeNumberValue(value) {
    const text = String(value ?? '').trim();
    if (!text || !/^\d+$/.test(text)) return Number.POSITIVE_INFINITY;
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

function compareEmployeeDisplayOrder(a, b) {
    const numberA = employeeNumberValue(a?.displayNumber);
    const numberB = employeeNumberValue(b?.displayNumber);
    if (numberA !== numberB) return numberA - numberB;

    const rawNumberA = String(a?.displayNumber ?? '').trim();
    const rawNumberB = String(b?.displayNumber ?? '').trim();
    const numberTextOrder = rawNumberA.localeCompare(rawNumberB, 'es', { numeric: true, sensitivity: 'base' });
    if (numberTextOrder !== 0) return numberTextOrder;

    const nameA = String(a?.displayName ?? '').trim();
    const nameB = String(b?.displayName ?? '').trim();
    const nameOrder = nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    if (nameOrder !== 0) return nameOrder;

    return String(a?.id ?? a?.saEmployeeId ?? '').localeCompare(String(b?.id ?? b?.saEmployeeId ?? ''));
}

function unwrapSubmission(item) {
    if (!item || typeof item !== 'object') {
        throw new TypeError('Submission must be an object');
    }
    const envelope = item.sourceSnapshot || item;
    if (envelope.schema !== 'attendance-submission/v1') {
        throw new TypeError(`Expected schema attendance-submission/v1, got "${envelope.schema}"`);
    }
    const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
    return { envelope, metadata };
}

/**
 * Consolidates multiple attendance-submission/v1 envelopes across Minis.
 *
 * @param {Array<object>} submissions - List of submissions (bare envelopes or inbox records)
 * @param {object} [options]
 * @param {string} [options.expectedSaProjectId] - Optional project ID filter/validation
 * @returns {object} Consolidated result with items, summary, and provenance
 */
export function consolidateAttendanceSubmissions(submissions, { expectedSaProjectId = null } = {}) {
    if (!Array.isArray(submissions)) {
        throw new TypeError('submissions must be an array');
    }

    const unwrapped = submissions.map(unwrapSubmission);
    const envelopes = unwrapped.map(u => u.envelope);
    const expectedProject = expectedSaProjectId ? String(expectedSaProjectId).trim() : null;

    const contributingSubmissions = [];
    const workDatesSet = new Set();
    const projectsSet = new Set();
    const devicesSet = new Set();

    // Grouping strictly by (saProjectId, saEmployeeId, workDate)
    const resolvedGroups = new Map();
    // Missing saEmployeeId rows become independent identity conflicts; never auto-linked by number or name
    const unresolvedItems = [];
    // Only submissions that explicitly declare full linked-roster coverage may
    // turn a missing row into a meaningful `missing_roster` source. Legacy v1
    // drafts keep the old semantics: missing row = unknown, never absence.
    const fullCoverageByDate = new Map();

    for (let subIndex = 0; subIndex < unwrapped.length; subIndex++) {
        const { envelope: sub, metadata } = unwrapped[subIndex];

        if (expectedProject && sub.saProjectId !== expectedProject) {
            throw new TypeError(
                `Submission ${sub.submissionId} project "${sub.saProjectId}" does not match expected "${expectedProject}"`
            );
        }

        const sourcePeerId = metadata?.sourcePeerId || null;
        const sourcePeerName = metadata?.sourcePeerName || null;
        const provenanceName = sourcePeerName || sourcePeerId;
        const isGeneric = isGenericDeviceId(sub.deviceId);
        const effectiveDeviceId = (isGeneric && provenanceName) ? provenanceName : sub.deviceId;
        if (sub.coverageMode === 'linked-roster-full') {
            if (!fullCoverageByDate.has(sub.workDate)) fullCoverageByDate.set(sub.workDate, []);
            fullCoverageByDate.get(sub.workDate).push({
                submissionId: sub.submissionId,
                deviceId: effectiveDeviceId,
                rawDeviceId: sub.deviceId,
                sourcePeerId,
                sourcePeerName,
                sourceId: sub.scope?.sourceId || '',
                siteId: sub.scope?.siteId || '',
                ownerUid: sub.scope?.ownerUid || '',
                rosterVersion: sub.rosterVersion,
                capturedAt: sub.capturedAt,
                workDate: sub.workDate,
                coverageMode: sub.coverageMode
            });
        }

        projectsSet.add(sub.saProjectId);
        workDatesSet.add(sub.workDate);
        devicesSet.add(effectiveDeviceId);

        contributingSubmissions.push({
            submissionId: sub.submissionId,
            deviceId: effectiveDeviceId,
            rawDeviceId: sub.deviceId,
            sourcePeerId,
            sourcePeerName,
            sourceId: sub.scope?.sourceId || '',
            siteId: sub.scope?.siteId || '',
            ownerUid: sub.scope?.ownerUid || '',
            rosterVersion: sub.rosterVersion,
            capturedAt: sub.capturedAt,
            workDate: sub.workDate,
            coverageMode: sub.coverageMode || null,
            rowsCount: Array.isArray(sub.rows) ? sub.rows.length : 0
        });

        const rows = Array.isArray(sub.rows) ? sub.rows : [];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const rawEmployeeId = row.saEmployeeId;
            const hasSaId = typeof rawEmployeeId === 'string' && rawEmployeeId.trim().length > 0;
            const normalizedSaId = hasSaId ? rawEmployeeId.trim() : null;

            const sourceEntry = {
                submissionId: sub.submissionId,
                deviceId: effectiveDeviceId,
                rawDeviceId: sub.deviceId,
                sourcePeerId,
                sourcePeerName,
                sourceId: sub.scope?.sourceId || '',
                siteId: sub.scope?.siteId || '',
                ownerUid: sub.scope?.ownerUid || '',
                rosterVersion: sub.rosterVersion,
                capturedAt: sub.capturedAt,
                workDate: sub.workDate,
                miniLocalId: row.miniLocalId,
                number: row.number,
                name: row.name,
                normalHours: row.normalHours,
                overtimeHours: row.overtimeHours,
                totalHours: Number(row.normalHours || 0) + Number(row.overtimeHours || 0),
                status: row.status || 'present',
                rosterStatus: row.rosterStatus || null,
                missingRoster: false,
                saEmployeeId: normalizedSaId
            };

            if (!hasSaId) {
                // IMPORTANT: missing saEmployeeId must become identity_conflict/unresolved;
                // NEVER auto-link by number or name.
                unresolvedItems.push({
                    id: `unresolved:${sub.submissionId}:${row.miniLocalId}`,
                    saProjectId: sub.saProjectId,
                    saEmployeeId: null,
                    workDate: sub.workDate,
                    status: 'identity_conflict',
                    conflictType: 'missing_sa_employee_id',
                    displayNumber: row.number,
                    displayName: row.name,
                    miniLocalId: row.miniLocalId,
                    normalHours: row.normalHours,
                    overtimeHours: row.overtimeHours,
                    totalHours: Number(row.normalHours || 0) + Number(row.overtimeHours || 0),
                    sourceStatus: row.status || 'present',
                    rosterStatus: row.rosterStatus || null,
                    sources: [sourceEntry],
                    blockers: ['missing_sa_employee_id', 'identity_conflict']
                });
            } else {
                // Group strictly by (saProjectId, saEmployeeId, workDate)
                const groupKey = `${sub.saProjectId}|${normalizedSaId}|${sub.workDate}`;
                if (!resolvedGroups.has(groupKey)) {
                    resolvedGroups.set(groupKey, []);
                }
                resolvedGroups.get(groupKey).push(sourceEntry);
            }
        }
    }

    const resolvedItems = [];
    for (const [groupKey, rawSources] of resolvedGroups.entries()) {
        const [saProjectId, saEmployeeId, workDate] = groupKey.split('|');
        const sources = [...rawSources];

        // New connected payloads explicitly declare full roster coverage. If an
        // employee exists in another selected Mini but is absent from one of those
        // full snapshots, represent that fact as `missing_roster` instead of
        // silently treating it as 0h. Legacy submissions without coverageMode are
        // intentionally ignored here for backwards compatibility.
        for (const coverage of fullCoverageByDate.get(workDate) || []) {
            if (sources.some(source => source.submissionId === coverage.submissionId)) continue;
            sources.push({
                ...coverage,
                miniLocalId: null,
                number: '',
                name: '',
                normalHours: 0,
                overtimeHours: 0,
                totalHours: 0,
                status: 'missing_roster',
                rosterStatus: 'missing',
                saEmployeeId,
                missingRoster: true
            });
        }

        const firstReal = sources.find(source => !source.missingRoster) || sources[0];
        const normalHoursSet = new Set(sources.map(source => Number(source.normalHours || 0)));
        const overtimeHoursSet = new Set(sources.map(source => Number(source.overtimeHours || 0)));
        const attendanceStatusSet = new Set(sources.map(source => source.status || 'present'));
        const explicitRosterStates = new Set(
            sources.filter(source => !source.missingRoster && source.rosterStatus)
                .map(source => source.rosterStatus)
        );
        const hasMissingRoster = sources.some(source => source.missingRoster);
        const hasRealSource = sources.some(source => !source.missingRoster);
        const conflictReasons = [];
        if (hasMissingRoster && hasRealSource) conflictReasons.push('coverage_conflict');
        if (explicitRosterStates.size > 1) conflictReasons.push('roster_status_conflict');
        if (attendanceStatusSet.size > 1) conflictReasons.push('attendance_status_conflict');
        if (normalHoursSet.size > 1 || overtimeHoursSet.size > 1) conflictReasons.push('hours_conflict');

        if (conflictReasons.length === 0) {
            const normalHours = Number(firstReal?.normalHours || 0);
            const overtimeHours = Number(firstReal?.overtimeHours || 0);
            resolvedItems.push({
                id: `consolidated:${saProjectId}:${saEmployeeId}:${workDate}`,
                saProjectId,
                saEmployeeId,
                workDate,
                status: 'resolved',
                conflictType: null,
                conflictReasons: [],
                displayNumber: firstReal?.number || '',
                displayName: firstReal?.name || '',
                normalHours,
                overtimeHours,
                totalHours: normalHours + overtimeHours,
                sourceStatus: firstReal?.status || 'present',
                rosterStatus: firstReal?.rosterStatus || null,
                sources,
                blockers: []
            });
        } else {
            const conflictType = conflictReasons.length === 1 ? conflictReasons[0] : 'multi_source_conflict';
            resolvedItems.push({
                id: `consolidated:${saProjectId}:${saEmployeeId}:${workDate}`,
                saProjectId,
                saEmployeeId,
                workDate,
                status: 'conflict',
                conflictType,
                conflictReasons,
                displayNumber: firstReal?.number || '',
                displayName: firstReal?.name || '',
                normalHours: null,
                overtimeHours: null,
                totalHours: null,
                sourceStatus: null,
                rosterStatus: null,
                conflictingHours: sources.map(source => ({
                    sourceId: source.sourceId,
                    deviceId: source.deviceId,
                    sourcePeerId: source.sourcePeerId || null,
                    sourcePeerName: source.sourcePeerName || null,
                    normalHours: source.normalHours,
                    overtimeHours: source.overtimeHours,
                    totalHours: Number(source.normalHours || 0) + Number(source.overtimeHours || 0),
                    status: source.status,
                    rosterStatus: source.rosterStatus || null,
                    missingRoster: source.missingRoster === true,
                    capturedAt: source.capturedAt
                })),
                sources,
                blockers: [...conflictReasons]
            });
        }
    }

    // Operational lists are deterministic: workDate, then employee number ascending.
    const allItems = [...resolvedItems, ...unresolvedItems].sort((a, b) => {
        if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
        return compareEmployeeDisplayOrder(a, b);
    });

    const primaryProjectId = projectsSet.size === 1 ? [...projectsSet][0] : (expectedProject || null);

    return deepFreeze({
        saProjectId: primaryProjectId,
        workDates: [...workDatesSet].sort(),
        devices: [...devicesSet].sort(),
        contributingSubmissions,
        items: allItems,
        summary: {
            totalItems: allItems.length,
            resolvedCount: resolvedItems.filter(i => i.status === 'resolved').length,
            hoursConflictCount: resolvedItems.filter(i => i.status === 'conflict').length,
            unresolvedIdentityCount: unresolvedItems.length,
            submissionsCount: envelopes.length
        }
    });
}

/**
 * Groups consolidated attendance items by 'day' or 'period'.
 *
 * @param {object} consolidation - Result from consolidateAttendanceSubmissions
 * @param {'day'|'period'} [mode='day'] - Grouping mode
 * @returns {object} Deeply frozen grouped structure
 */
export function groupConsolidatedAttendance(consolidation, mode = 'day') {
    if (!consolidation || !Array.isArray(consolidation.items)) {
        throw new TypeError('Invalid consolidation object');
    }

    const cleanMode = mode === 'period' ? 'period' : 'day';

    if (cleanMode === 'day') {
        const sortedDates = [...(consolidation.workDates || [])].sort();
        const groups = sortedDates.map(date => {
            const dateItems = consolidation.items
                .filter(item => item.workDate === date)
                .sort(compareEmployeeDisplayOrder);
            return {
                key: date,
                workDate: date,
                items: dateItems,
                summary: {
                    total: dateItems.length,
                    resolved: dateItems.filter(i => i.status === 'resolved').length,
                    conflicts: dateItems.filter(i => i.status === 'conflict').length,
                    unresolved: dateItems.filter(i => i.status === 'identity_conflict').length
                }
            };
        });

        return deepFreeze({
            mode: 'day',
            saProjectId: consolidation.saProjectId,
            groups,
            totalItems: consolidation.summary.totalItems
        });
    }

    // mode === 'period'
    const sortedDates = [...(consolidation.workDates || [])].sort();
    const periodStart = sortedDates[0] || null;
    const periodEnd = sortedDates[sortedDates.length - 1] || null;

    // Group resolved items by employee across the period
    const employeeMap = new Map();
    const unresolved = [];

    for (const item of consolidation.items) {
        if (!item.saEmployeeId) {
            unresolved.push(item);
            continue;
        }

        if (!employeeMap.has(item.saEmployeeId)) {
            employeeMap.set(item.saEmployeeId, {
                saEmployeeId: item.saEmployeeId,
                displayName: item.displayName,
                displayNumber: item.displayNumber,
                dates: {},
                totalNormalHours: 0,
                totalOvertimeHours: 0,
                hasConflicts: false,
                items: []
            });
        }

        const emp = employeeMap.get(item.saEmployeeId);
        emp.dates[item.workDate] = item;
        emp.items.push(item);
        if (item.status === 'resolved') {
            emp.totalNormalHours += item.normalHours || 0;
            emp.totalOvertimeHours += item.overtimeHours || 0;
        } else if (item.status === 'conflict') {
            emp.hasConflicts = true;
        }
    }

    const employeeGroups = [...employeeMap.values()].sort(compareEmployeeDisplayOrder);
    unresolved.sort(compareEmployeeDisplayOrder);

    return deepFreeze({
        mode: 'period',
        saProjectId: consolidation.saProjectId,
        periodStart,
        periodEnd,
        workDates: sortedDates,
        employeeGroups,
        unresolvedItems: unresolved,
        items: consolidation.items,
        summary: consolidation.summary
    });
}

/**
 * Builds a proposal seam comparing consolidated submissions against existing SA attendance.
 *
 * Rule: NEVER applies or writes to state.attendance.
 * Generates proposal records with status, diffs, and blockers for the resolver to consume.
 *
 * @param {object} consolidation - Result from consolidateAttendanceSubmissions
 * @param {object} [options]
 * @param {Array<object>} [options.employees=[]] - SA employee records
 * @param {object} [options.attendance={}] - Existing SA attendance records keyed by `${employeeId}-${date}`
 * @returns {object} Deeply frozen proposal plan
 */
export function buildConsolidationProposal(consolidation, { employees = [], attendance = {} } = {}) {
    if (!consolidation || !Array.isArray(consolidation.items)) {
        throw new TypeError('Invalid consolidation object');
    }

    const proposals = consolidation.items.map(item => {
        // Missing saEmployeeId cannot be matched to attendance
        if (item.status === 'identity_conflict' || !item.saEmployeeId) {
            return {
                id: item.id,
                item,
                status: 'blocked',
                action: 'require_identity_resolution',
                reason: 'missing_sa_employee_id',
                canApply: false,
                hasDiff: true,
                existingRecord: null,
                proposedHours: { normalHours: item.normalHours, overtimeHours: item.overtimeHours }
            };
        }

        // Hours conflict between multiple Minis cannot be applied without human resolution
        if (item.status === 'conflict') {
            return {
                id: item.id,
                item,
                status: 'blocked',
                action: 'require_hours_resolution',
                reason: 'hours_conflict',
                canApply: false,
                hasDiff: true,
                existingRecord: null,
                proposedHours: null
            };
        }

        // Resolved item with valid saEmployeeId and agreed hours:
        const attKey = `${item.saEmployeeId}-${item.workDate}`;
        const existing = attendance[attKey] || null;

        if (existing) {
            const existingNormal = Number.isFinite(existing.hoursWorked) ? existing.hoursWorked : 0;
            const existingOvertime = Number.isFinite(existing.overtimeHours) ? existing.overtimeHours : 0;
            const isIdentical = existingNormal === item.normalHours && existingOvertime === item.overtimeHours;

            if (isIdentical) {
                return {
                    id: item.id,
                    item,
                    status: 'matched_existing',
                    action: 'keep_existing',
                    canApply: true,
                    hasDiff: false,
                    existingRecord: existing,
                    proposedHours: { normalHours: item.normalHours, overtimeHours: item.overtimeHours }
                };
            }

            return {
                id: item.id,
                item,
                status: 'conflict_existing',
                action: 'conflict_with_existing_attendance',
                canApply: false,
                hasDiff: true,
                existingRecord: existing,
                proposedHours: { normalHours: item.normalHours, overtimeHours: item.overtimeHours },
                diff: {
                    existingNormal,
                    existingOvertime,
                    proposedNormal: item.normalHours,
                    proposedOvertime: item.overtimeHours
                }
            };
        }

        // No existing record: proposal to create new attendance
        return {
            id: item.id,
            item,
            status: 'ready_new',
            action: 'create_attendance',
            canApply: true,
            hasDiff: true,
            existingRecord: null,
            proposedHours: { normalHours: item.normalHours, overtimeHours: item.overtimeHours }
        };
    });

    const hasBlockers = proposals.some(p => !p.canApply);

    return deepFreeze({
        saProjectId: consolidation.saProjectId,
        generatedAt: Date.now(),
        proposals,
        hasBlockers,
        canAutoApply: false, // Freeze decision: Never apply directly to state.attendance
        summary: {
            total: proposals.length,
            readyToApply: proposals.filter(p => p.canApply).length,
            blockedCount: proposals.filter(p => !p.canApply).length,
            matchedExisting: proposals.filter(p => p.status === 'matched_existing').length,
            newRecords: proposals.filter(p => p.status === 'ready_new').length,
            existingConflicts: proposals.filter(p => p.status === 'conflict_existing').length,
            unresolvedIdentities: proposals.filter(p => p.reason === 'missing_sa_employee_id').length,
            hoursConflicts: proposals.filter(p => p.reason === 'hours_conflict').length
        }
    });
}
