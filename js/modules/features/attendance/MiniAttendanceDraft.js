const ALLOCATION_MODES = new Set(['all_normal', 'split_at_regular_limit']);
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
function normalizeName(value) {
    return String(value ?? '').trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('es')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ');
}
function normalizeNumber(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/u.test(raw)) return null;
    return raw.replace(/^0+(?=\d)/u, '');
}
export {
    normalizeName as normalizeMiniAttendanceName,
    normalizeNumber as normalizeMiniAttendanceNumber
};

function editDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] +
                    (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
            );
        }
        previous = current;
    }
    return previous[right.length];
}

function characterSimilarity(left, right) {
    if (!left || !right) return 0;
    return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function nameSuggestionScore(sourceName, employeeName) {
    if (!sourceName || !employeeName) return 0;
    if (sourceName === employeeName) return 1;
    const sourceTokens = sourceName.split(' ');
    const employeeTokens = new Set(employeeName.split(' '));
    const sourceTokenCoverage =
        sourceTokens.filter(token => employeeTokens.has(token)).length / sourceTokens.length;
    return Math.max(
        characterSimilarity(sourceName, employeeName),
        sourceTokenCoverage === 1 ? 0.82 : sourceTokenCoverage * 0.75
    );
}

function isLikelyTypo(sourceName, employeeName) {
    if (!sourceName || !employeeName) return false;
    const sourceTokens = sourceName.split(' ');
    const employeeTokens = employeeName.split(' ');
    return sourceTokens.length === employeeTokens.length &&
        characterSimilarity(sourceName, employeeName) >= 0.88;
}

function bestNameSuggestions(name, employees) {
    if (!name) return [];
    return employees
        .map((employee, index) => ({
            employee,
            index,
            score: nameSuggestionScore(name, normalizeName(employee.name))
        }))
        .filter(candidate => candidate.score >= 0.72)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 3)
        .map(candidate => candidate.employee);
}

function uniqueEmployees(...groups) {
    const seen = new Set();
    return groups.flat().filter(employee => {
        if (seen.has(employee.id)) return false;
        seen.add(employee.id);
        return true;
    });
}

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(child => deepFreeze(child, seen));
    return Object.freeze(value);
}

function employeeCandidate(employee) {
    return {
        employeeId: employee.id,
        positionIds: Array.isArray(employee.positions) ? [...employee.positions] : []
    };
}

function rememberedEmployee(sourceRow, employees, aliases, scope) {
    if (!scope || !Array.isArray(aliases) || aliases.length === 0) return null;
    const number = normalizeNumber(sourceRow.rawNumber);
    const name = normalizeName(sourceRow.rawName);
    const matches = aliases.filter(alias =>
        alias?.active === true &&
        alias.tombstonedAt == null &&
        alias.ownerUid === String(scope.ownerUid ?? '').trim() &&
        alias.siteId === String(scope.siteId ?? '').trim() &&
        alias.sourceId === String(scope.sourceId ?? '').trim() &&
        alias.sourceNumberNormalized === number &&
        alias.sourceNameNormalized === name
    );
    if (matches.length !== 1) return null;
    const alias = matches[0];
    const employee = employees.find(item => item.id === alias.targetEmployeeId);
    if (!employee || employee.active === false || employee.deletedAt != null) return null;
    return { alias, employee };
}

function matchEmployee(sourceRow, employees, aliases, aliasScope) {
    const remembered = rememberedEmployee(sourceRow, employees, aliases, aliasScope);
    if (remembered) {
        const candidate = employeeCandidate(remembered.employee);
        return {
            status: 'remembered_match',
            employeeId: remembered.employee.id,
            candidateIds: [remembered.employee.id],
            candidatePositions: [candidate],
            positionIds: candidate.positionIds,
            requiresConfirmation: false,
            rememberedAliasId: remembered.alias.aliasId
        };
    }
    const number = normalizeNumber(sourceRow.rawNumber);
    const name = normalizeName(sourceRow.rawName);
    const byNumber = number
        ? employees.filter(employee => normalizeNumber(employee.number) === number)
        : [];
    const exactNames = candidates =>
        candidates.filter(employee => normalizeName(employee.name) === name);
    const byName = exactNames(employees);
    const globalNameSuggestions = bestNameSuggestions(name, employees);
    let status;
    let candidates;
    let selected = null;
    let requiresConfirmation = false;

    if (byNumber.length === 1) {
        const numberCandidate = byNumber[0];
        const normalizedCandidateName = normalizeName(numberCandidate.name);
        candidates = uniqueEmployees(byNumber, globalNameSuggestions);
        if (normalizedCandidateName === name) {
            status = 'number_match';
            selected = numberCandidate;
        } else if (byName.length === 1) {
            status = 'name_suggestion';
            candidates = uniqueEmployees(byNumber, byName, globalNameSuggestions);
            selected = byName[0];
            requiresConfirmation = true;
        } else if (isLikelyTypo(name, normalizedCandidateName)) {
            status = 'name_suggestion';
            selected = numberCandidate;
            requiresConfirmation = true;
        } else {
            status = 'ambiguous';
        }
    } else if (byNumber.length > 1) {
        const disambiguated = exactNames(byNumber);
        candidates = disambiguated.length === 1
            ? disambiguated
            : uniqueEmployees(byNumber, globalNameSuggestions);
        status = disambiguated.length === 1 ? 'number_name_match' : 'ambiguous';
        selected = disambiguated.length === 1 ? disambiguated[0] : null;
    } else {
        candidates = byName.length ? byName : globalNameSuggestions;
        if (byName.length === 1) {
            status = 'name_suggestion';
            selected = byName[0];
            requiresConfirmation = true;
        } else {
            status = byName.length > 1 ? 'ambiguous' : 'unmatched';
        }
    }

    return {
        status,
        employeeId: selected?.id ?? null,
        candidateIds: candidates.map(employee => employee.id),
        candidatePositions: candidates.map(employeeCandidate),
        positionIds: selected ? employeeCandidate(selected).positionIds : [],
        requiresConfirmation
    };
}

function allocate(totalHours, mode, regularLimit) {
    if (!Number.isFinite(totalHours)) return { normalHours: 0, overtimeHours: 0 };
    if (mode === 'all_normal') return { normalHours: totalHours, overtimeHours: 0 };
    return {
        normalHours: Math.min(totalHours, regularLimit),
        overtimeHours: Math.max(0, totalHours - regularLimit)
    };
}

function classifyDuplicates(rows) {
    const groups = new Map();
    rows.forEach((row, index) => {
        const number = normalizeNumber(row.sourceRow.rawNumber);
        if (!number) return;
        const indexes = groups.get(number) || [];
        indexes.push(index);
        groups.set(number, indexes);
    });

    const statuses = Array(rows.length).fill(null);
    for (const indexes of groups.values()) {
        if (indexes.length < 2) continue;
        const names = new Set(indexes.map(index => normalizeName(rows[index].sourceRow.rawName)));
        const hours = new Set(indexes.map(index => rows[index].sourceRow.totalHours));
        const status = names.size === 1 && hours.size === 1
            ? 'probable_duplicate'
            : 'conflicting_duplicate';
        indexes.forEach(index => { statuses[index] = status; });
    }
    return statuses;
}

function rowBlockers(row) {
    if (row.excluded === true) return [];
    const blockers = [];
    if (row.sourceRow.errors.length) blockers.push('source_hours_invalid');
    if (row.match.status === 'ambiguous') blockers.push('employee_ambiguous');
    if (row.match.status === 'unmatched') blockers.push('employee_unmatched');
    if (row.match.requiresConfirmation) blockers.push('employee_confirmation_required');
    if (row.duplicateStatus === 'conflicting_duplicate') blockers.push('conflicting_duplicate');
    const { normalHours, overtimeHours } = row.allocation;
    if (![normalHours, overtimeHours].every(Number.isFinite) ||
        normalHours < 0 || overtimeHours < 0 || normalHours + overtimeHours > 24) {
        blockers.push('hours_invalid');
    }
    return blockers;
}

function inspectDate(parsed, isoDate, confirmed) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate || '');
    if (!match) return { confirmedDate: null, dateBlockers: ['invalid_iso_date'] };
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const valid = date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
    if (!valid) return { confirmedDate: null, dateBlockers: ['invalid_iso_date'] };

    const hint = parsed.header.dateHint;
    const mismatch = hint && (
        hint.day !== day || hint.month !== month ||
        (hint.year !== null && hint.year !== year) ||
        normalizeName(hint.weekday) !== WEEKDAYS[date.getUTCDay()]
    );
    if (mismatch) return { confirmedDate: null, dateBlockers: ['date_hint_mismatch'] };
    return confirmed
        ? { confirmedDate: isoDate, dateBlockers: [] }
        : { confirmedDate: null, dateBlockers: ['date_confirmation_required'] };
}

function finalize(draft) {
    const rows = draft.rows.map(row => ({ ...row, blockers: rowBlockers(row) }));
    const sourceBlockers = draft.parsed.unparsedFragments.length ? ['unparsed_source'] : [];
    return deepFreeze({
        ...draft,
        rows,
        sourceBlockers,
        hasBlockingIssues: draft.dateBlockers.length > 0 ||
            sourceBlockers.length > 0 || rows.some(row => row.blockers.length > 0)
    });
}

export function createMiniAttendanceDraft({
    parsed,
    employees = [],
    aliases = [],
    aliasScope = null,
    proposedDate = null,
    regularLimit = 8
}) {
    const allocationMode = 'all_normal';
    const rows = parsed.rows.map(sourceRow => ({
        sourceRow,
        match: matchEmployee(sourceRow, employees, aliases, aliasScope),
        allocation: allocate(sourceRow.totalHours, allocationMode, regularLimit),
        duplicateStatus: null,
        excluded: false,
        reviewed: false,
        approved: false
    }));
    const duplicateStatuses = classifyDuplicates(rows);
    const dated = inspectDate(parsed, proposedDate, false);
    return finalize({
        revision: 1,
        parsed,
        proposedDate,
        ...dated,
        regularLimit,
        allocationMode,
        employeeOptions: employees.map(employeeCandidate),
        rows: rows.map((row, index) => ({ ...row, duplicateStatus: duplicateStatuses[index] }))
    });
}

export function confirmMiniAttendanceDraftDate(draft, isoDate) {
    return finalize({
        ...draft,
        revision: draft.revision + 1,
        proposedDate: isoDate,
        ...inspectDate(draft.parsed, isoDate, true)
    });
}

export function setMiniAttendanceAllocationMode(draft, mode) {
    if (!ALLOCATION_MODES.has(mode)) throw new RangeError(`Unknown allocation mode: ${mode}`);
    if (mode === draft.allocationMode) return draft;
    return finalize({
        ...draft,
        revision: draft.revision + 1,
        allocationMode: mode,
        rows: draft.rows.map(row => ({
            ...row,
            allocation: allocate(row.sourceRow.totalHours, mode, draft.regularLimit),
            reviewed: false,
            approved: false
        }))
    });
}

export function editMiniAttendanceDraftRow(draft, rowIndex, allocation) {
    if (!draft.rows[rowIndex]) throw new RangeError(`Unknown draft row: ${rowIndex}`);
    return finalize({
        ...draft,
        revision: draft.revision + 1,
        rows: draft.rows.map((row, index) => index === rowIndex
            ? { ...row, allocation: { ...allocation }, reviewed: false, approved: false }
            : row)
    });
}

export function reviewMiniAttendanceDraftRow(draft, rowIndex, review = {}) {
    const current = draft.rows[rowIndex];
    if (!current) throw new RangeError(`Unknown draft row: ${rowIndex}`);
    let match = current.match;
    if (review.employeeId) {
        const candidate = draft.employeeOptions.find(item => item.employeeId === review.employeeId);
        if (!candidate) throw new RangeError(`Employee is not in the draft roster: ${review.employeeId}`);
        match = {
            ...match,
            status: 'confirmed',
            employeeId: review.employeeId,
            positionIds: candidate.positionIds,
            requiresConfirmation: false
        };
    }
    return finalize({
        ...draft,
        revision: draft.revision + 1,
        rows: draft.rows.map((row, index) => index === rowIndex
            ? {
                ...row,
                match,
                excluded: false,
                reviewed: true,
                approved: review.approved === true
            }
            : row)
    });
}

export function excludeMiniAttendanceDraftRow(draft, rowIndex) {
    const current = draft.rows[rowIndex];
    if (!current) throw new RangeError(`Unknown draft row: ${rowIndex}`);
    return finalize({
        ...draft,
        revision: draft.revision + 1,
        rows: draft.rows.map((row, index) => index === rowIndex
            ? { ...row, excluded: true, reviewed: true, approved: false }
            : row)
    });
}

function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
    }
    return value;
}

function existingProjection(record) {
    if (!record) return null;
    const snapshot = cloneValue(record);
    const breakdown = Array.isArray(snapshot.positionHours) && snapshot.positionHours.length
        ? cloneValue(snapshot.positionHours)
        : snapshot.selectedPosition ? [{
            positionId: snapshot.selectedPosition,
            hours: snapshot.hoursWorked || 0,
            overtimeHours: snapshot.overtimeHours || 0
        }] : [];
    return { record: snapshot, breakdown };
}

function conflictBlockers(row) {
    const blockers = [...row.draftBlockers];
    if (row.existing && !row.decision.acknowledged) blockers.push('decision_unacknowledged');
    if (row.decision.action === 'use_imported') {
        if (!row.allReviewed) blockers.push('row_review_required');
        if (!row.allApproved) blockers.push('row_not_approved');
        if (!row.targetPositionId) {
            blockers.push('target_position_required');
        } else if (!row.employeePositionIds.includes(row.targetPositionId)) {
            blockers.push('target_position_invalid');
        }
        if (row.existing?.breakdown.length > 1 && !row.decision.collapseAcknowledged) {
            blockers.push('collapse_acknowledgement_required');
        }
    }
    return [...new Set(blockers)];
}

function finalizeConflictPlan(plan) {
    const rows = plan.rows.map(row => ({ ...row, blockers: conflictBlockers(row) }));
    return deepFreeze({
        ...plan,
        rows,
        hasBlockingIssues: plan.globalBlockers.length > 0 ||
            rows.some(row => row.blockers.length > 0)
    });
}

function groupDraftRows(draft) {
    const groups = new Map();
    draft.rows.forEach((row, sourceIndex) => {
        if (row.excluded === true) return;
        const key = row.match.employeeId || `unresolved:${sourceIndex}`;
        const group = groups.get(key) || [];
        group.push({ row, sourceIndex });
        groups.set(key, group);
    });
    return [...groups.values()];
}

export function createMiniAttendanceConflictPlan(draft, attendance = {}) {
    const rows = groupDraftRows(draft).map(group => {
        const representative = group[0].row;
        const employeeId = representative.match.employeeId;
        const employee = draft.employeeOptions.find(option => option.employeeId === employeeId);
        const key = employeeId && draft.confirmedDate
            ? `${employeeId}-${draft.confirmedDate}`
            : null;
        const existing = existingProjection(key ? attendance[key] : null);
        const positionIds = employee?.positionIds || [];
        const draftBlockers = group.flatMap(item => item.row.blockers);
        const allocations = new Set(group.map(item => JSON.stringify(item.row.allocation)));
        if (group.length > 1 &&
            (!group.every(item => item.row.duplicateStatus === 'probable_duplicate') ||
                allocations.size > 1)) {
            draftBlockers.push('conflicting_duplicate');
        }
        return {
            key,
            employeeId,
            employeePositionIds: [...positionIds],
            sourceIndexes: group.map(item => item.sourceIndex),
            sourceRows: group.map(item => item.row.sourceRow),
            allReviewed: group.every(item => item.row.reviewed),
            allApproved: group.every(item => item.row.approved),
            imported: { ...representative.allocation },
            existing,
            targetPositionId: positionIds.length === 1 ? positionIds[0] : null,
            decision: existing
                ? { action: 'keep_existing', acknowledged: false }
                : { action: 'use_imported', acknowledged: true },
            draftBlockers: [...new Set(draftBlockers)],
            blockers: []
        };
    });
    return finalizeConflictPlan({
        revision: 1,
        draftRevision: draft.revision,
        date: draft.confirmedDate,
        globalBlockers: [...draft.dateBlockers, ...draft.sourceBlockers],
        rows
    });
}

export function reviewMiniAttendanceConflict(plan, rowIndex, review) {
    const current = plan.rows[rowIndex];
    if (!current) throw new RangeError(`Unknown conflict row: ${rowIndex}`);
    if (!['keep_existing', 'use_imported'].includes(review.action)) {
        throw new RangeError(`Unknown conflict action: ${review.action}`);
    }
    const decision = {
        action: review.action,
        acknowledged: review.acknowledged === true,
        ...(review.action === 'use_imported'
            ? { collapseAcknowledged: review.collapseAcknowledged === true }
            : {})
    };
    return finalizeConflictPlan({
        ...plan,
        revision: plan.revision + 1,
        rows: plan.rows.map((row, index) => index === rowIndex ? {
            ...row,
            targetPositionId: review.targetPositionId ?? row.targetPositionId,
            decision
        } : row)
    });
}

function importedRecord(row, date) {
    const existing = row.existing?.record || {};
    const { normalHours, overtimeHours } = row.imported;
    return {
        notes: '',
        isHoliday: false,
        ...cloneValue(existing),
        employeeId: row.employeeId,
        date,
        present: true,
        hoursWorked: normalHours,
        overtimeHours,
        selectedPosition: row.targetPositionId,
        multiPosition: false,
        positionHours: [{
            positionId: row.targetPositionId,
            hours: normalHours,
            overtimeHours
        }]
    };
}

export function buildMiniAttendanceApplyPlan(plan, { expectedDraftRevision } = {}) {
    if (expectedDraftRevision !== plan.draftRevision) throw new Error('Stale draft revision');
    if (plan.hasBlockingIssues) throw new Error('Conflict plan has unresolved blockers');
    const writes = [];
    const keptKeys = [];
    const writtenKeys = new Set();
    for (const row of plan.rows) {
        if (row.decision.action === 'keep_existing') {
            keptKeys.push(row.key);
            continue;
        }
        if (writtenKeys.has(row.key)) throw new Error(`Duplicate write key: ${row.key}`);
        writtenKeys.add(row.key);
        writes.push({ key: row.key, record: importedRecord(row, plan.date) });
    }
    return deepFreeze({
        draftRevision: plan.draftRevision,
        conflictRevision: plan.revision,
        date: plan.date,
        writes,
        keptKeys
    });
}
