import {
    isMiniAttendanceEmployeeEligible
} from '../features/attendance/MiniAttendanceDraft.js';

function deepFreeze(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(child => deepFreeze(child, seen));
    return Object.freeze(value);
}
function employeeView(employee) {
    if (!employee) return null;
    return {
        id: employee.id,
        number: employee.number ?? '',
        name: employee.name ?? '',
        positionIds: Array.isArray(employee.positions) ? [...employee.positions] : []
    };
}
function positionView(position) {
    return position ? { id: position.id, name: position.name ?? '' } : null;
}
function compareEmployeeOrder(left, right) {
    const leftNumber = String(left.number ?? '').trim();
    const rightNumber = String(right.number ?? '').trim();
    const leftNumeric = /^\d+$/u.test(leftNumber) ? Number(leftNumber) : Number.POSITIVE_INFINITY;
    const rightNumeric = /^\d+$/u.test(rightNumber) ? Number(rightNumber) : Number.POSITIVE_INFINITY;
    return leftNumeric - rightNumeric ||
        leftNumber.localeCompare(rightNumber, 'es', { numeric: true, sensitivity: 'base' }) ||
        String(left.name ?? '').localeCompare(String(right.name ?? ''), 'es', {
            sensitivity: 'base'
        });
}
function normalizeName(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
function duplicatePresentationKey(draft, row) {
    if (row.employeeId || row.existing) return null;
    const rows = (row.sourceIndexes || []).map(index => draft.rows[index]).filter(Boolean);
    if (!rows.length || !rows.every(item => item.duplicateStatus === 'probable_duplicate')) return null;
    const signatures = new Set(rows.map(item => {
        const source = item.sourceRow;
        const number = String(source.rawNumber ?? '').replace(/^0+(?=\d)/u, '');
        return `${number}|${normalizeName(source.rawName)}|${source.totalHours}`;
    }));
    if (signatures.size !== 1) return null;
    const semantics = JSON.stringify({
        imported: row.imported, decision: row.decision, targetPositionId: row.targetPositionId
    });
    return `${[...signatures][0]}|${semantics}`;
}
function presentationRows(draft, conflictPlan) {
    const clusters = new Map();
    (conflictPlan?.rows || []).forEach((row, index) => {
        const key = duplicatePresentationKey(draft, row) || `row:${index}`;
        clusters.set(key, [...(clusters.get(key) || []), row]);
    });
    return [...clusters.values()].map(rows => rows.length === 1 ? rows[0] : ({
        ...rows[0],
        sourceIndexes: rows.flatMap(row => row.sourceIndexes),
        allReviewed: rows.every(row => row.allReviewed),
        allApproved: rows.every(row => row.allApproved),
        draftBlockers: [...new Set(rows.flatMap(row => row.draftBlockers || []))],
        blockers: [...new Set(rows.flatMap(row => row.blockers || []))]
    }));
}
const ISSUE_GROUPS = {
    source: new Set(['unparsed_source', 'source_hours_invalid']),
    date: new Set(['invalid_iso_date', 'date_hint_mismatch', 'date_confirmation_required']),
    identity: new Set(['employee_ambiguous', 'employee_unmatched', 'employee_confirmation_required']),
    duplicate: new Set(['conflicting_duplicate']),
    hours: new Set([
        'hours_invalid',
        'position_allocation_invalid',
        'position_allocation_required',
        'position_allocation_exceeds_day'
    ]),
    position: new Set([
        'target_position_required',
        'target_position_invalid',
        'position_allocation_duplicate'
    ]),
    decision: new Set(['decision_unacknowledged', 'collapse_acknowledgement_required']),
    confirmation: new Set(['row_review_required', 'row_not_approved'])
};
const ACTIONS = {
    source: ['Corrige los datos de origen antes de continuar.', 'fix_source', 'Corregir datos', false],
    date: ['Confirma una fecha válida para continuar.', 'confirm_date', 'Confirmar fecha', false],
    stale: ['Actualiza la revisión después de los cambios del borrador.', 'refresh_review',
        'Actualizar revisión', false],
    identity: ['Selecciona o confirma el empleado.', 'select_employee', 'Revisar empleado', false],
    duplicate: ['Confirma que las apariciones duplicadas corresponden a la misma persona.',
        'review_duplicate', 'Revisar duplicado', false],
    hours: ['Corrige la distribución de horas.', 'edit_hours', 'Corregir horas', false],
    position: ['Selecciona un puesto válido.', 'select_position', 'Seleccionar puesto', false],
    decision: ['Elige si conservar la asistencia existente o usar la importada.', 'review_existing',
        'Revisar asistencia existente', false],
    collapse: ['Confirma el reemplazo de la distribución de puestos existente.', 'confirm_collapse',
        'Confirmar reemplazo', true],
    confirmation: ['Confirma esta asistencia para importarla.', 'confirm_row',
        'Confirmar asistencia', false],
    unknown: ['Revisa esta asistencia antes de continuar.', 'review_row', 'Revisar asistencia', false],
    complete: ['Lista para importar.', 'none', 'Confirmada', false]
};
function hasAny(blockers, group) {
    return blockers.some(blocker => group.has(blocker));
}
function resolveIssue({ blockers, globalBlockers, probableDuplicate, reviewed, approved, stale }) {
    if (hasAny(blockers, ISSUE_GROUPS.source) || hasAny(globalBlockers, ISSUE_GROUPS.source)) {
        return 'source';
    }
    if (hasAny(blockers, ISSUE_GROUPS.date) || hasAny(globalBlockers, ISSUE_GROUPS.date)) {
        return 'date';
    }
    if (stale) return 'stale';
    if (hasAny(blockers, ISSUE_GROUPS.identity)) return 'identity';
    if (hasAny(blockers, ISSUE_GROUPS.duplicate) ||
        (probableDuplicate && (!reviewed || !approved))) {
        return 'duplicate';
    }
    if (hasAny(blockers, ISSUE_GROUPS.hours)) return 'hours';
    if (hasAny(blockers, ISSUE_GROUPS.position)) return 'position';
    if (blockers.includes('decision_unacknowledged')) return 'decision';
    if (blockers.includes('collapse_acknowledgement_required')) return 'collapse';
    if (hasAny(blockers, ISSUE_GROUPS.confirmation)) return 'confirmation';
    return blockers.length || globalBlockers.length ? 'unknown' : 'complete';
}
function actionView(issue) {
    const [nextAction, action, label, destructive] = ACTIONS[issue];
    return { nextAction, confirmation: { action, label, destructive } };
}
function occurrenceView(draft, sourceIndex) {
    const source = draft.rows[sourceIndex]?.sourceRow || {};
    return {
        sourceIndex,
        number: source.rawNumber ?? '',
        name: source.rawName ?? '',
        totalHours: source.totalHours ?? null
    };
}
function isSafeBulkItem({ issue, row, draftRows, probableDuplicate, stale }) {
    if (issue !== 'confirmation' || stale || probableDuplicate || row.existing) return false;
    if (row.sourceIndexes.length !== 1 || row.employeePositionIds.length !== 1) return false;
    const draftRow = draftRows[0];
    if (!draftRow ||
        !['number_match', 'number_name_match', 'remembered_match']
            .includes(draftRow.match?.status)) {
        return false;
    }
    if (draftRow.match.requiresConfirmation || draftRow.sourceRow.errors?.length) return false;
    const { normalHours, overtimeHours } = row.imported || {};
    return [normalHours, overtimeHours].every(Number.isFinite) &&
        normalHours >= 0 && overtimeHours >= 0 && normalHours + overtimeHours <= 24 &&
        row.employeePositionIds.includes(row.targetPositionId);
}
export function buildMiniAttendanceReviewViewModel({
    draft, conflictPlan, employees = [], positions = [], filter = 'all'
}) {
    const eligibleEmployees = employees.filter(isMiniAttendanceEmployeeEligible);
    const employeeById = new Map(eligibleEmployees.map(employee => [employee.id, employee]));
    const positionById = new Map(positions.map(position => [position.id, position]));
    const employeeOptions = eligibleEmployees.map(employeeView).sort(compareEmployeeOrder);
    const globalBlockers = [
        ...(draft?.dateBlockers || []),
        ...(draft?.sourceBlockers || []),
        ...(conflictPlan?.globalBlockers || [])
    ];
    const stale = draft?.revision !== conflictPlan?.draftRevision;
    const allItems = presentationRows(draft, conflictPlan).map((row, index) => {
        const sourceIndexes = [...(row.sourceIndexes || [])];
        const draftRows = sourceIndexes.map(sourceIndex => draft.rows[sourceIndex]).filter(Boolean);
        const probableDuplicate = sourceIndexes.length > 1 &&
            draftRows.every(draftRow => draftRow.duplicateStatus === 'probable_duplicate');
        const blockers = [...new Set([
            ...(row.blockers || []),
            ...draftRows.flatMap(draftRow => draftRow.blockers || [])
        ])];
        const issue = resolveIssue({
            blockers,
            globalBlockers,
            probableDuplicate,
            reviewed: row.allReviewed,
            approved: row.allApproved, stale
        });
        const safeBulk = isSafeBulkItem({ issue, row, draftRows, probableDuplicate, stale });
        const confirmed = issue === 'complete';
        const employee = employeeById.get(row.employeeId);
        const matchStatuses = draftRows.map(draftRow => draftRow.match?.status);
        const { nextAction, confirmation } = actionView(issue);
        const positionAllocations = (row.positionAllocations || []).map(allocation => ({
            positionId: allocation.positionId,
            normalHours: allocation.normalHours,
            overtimeHours: allocation.overtimeHours
        }));
        const appliedAllocation = positionAllocations.reduce((summary, allocation) => ({
            normalHours: summary.normalHours + allocation.normalHours,
            overtimeHours: summary.overtimeHours + allocation.overtimeHours
        }), { normalHours: 0, overtimeHours: 0 });
        return {
            id: row.key || `mini-review-${sourceIndexes.join('-') || index}`,
            sourceIndexes,
            occurrences: sourceIndexes.map(sourceIndex => occurrenceView(draft, sourceIndex)),
            employee: employeeView(employee),
            employeeOptions,
            allocation: {
                normalHours: row.imported?.normalHours ?? 0,
                overtimeHours: row.imported?.overtimeHours ?? 0
            },
            positionAllocations,
            appliedAllocation,
            targetPositionOptions: (row.employeePositionIds || [])
                .map(positionId => positionView(positionById.get(positionId)))
                .filter(Boolean),
            existingBreakdown: (row.existing?.breakdown || []).map(entry => ({
                positionId: entry.positionId,
                position: positionView(positionById.get(entry.positionId)),
                hours: entry.hours ?? 0,
                overtimeHours: entry.overtimeHours ?? 0
            })),
            decision: row.decision ? { ...row.decision } : null,
            targetPositionId: row.targetPositionId || null,
            rememberedMatch: matchStatuses.includes('remembered_match'),
            canRememberMatch: matchStatuses.some(status =>
                ['ambiguous', 'unmatched', 'name_suggestion', 'confirmed'].includes(status)
            ),
            canIgnore: matchStatuses.length > 0 &&
                matchStatuses.every(status => status === 'unmatched'),
            probableDuplicate,
            issue,
            confirmed,
            needsAttention: !confirmed && !safeBulk,
            nextAction,
            confirmation,
            safeBulk
        };
    });
    const summary = {
        total: allItems.length,
        ready: allItems.filter(item => item.safeBulk).length,
        needsAttention: allItems.filter(item => item.needsAttention).length,
        confirmed: allItems.filter(item => item.confirmed).length,
        ignored: (draft?.rows || []).filter(row => row.excluded === true).length
    };
    const safeBulkSourceIndexes = allItems
        .filter(item => item.safeBulk)
        .flatMap(item => item.sourceIndexes);
    const status = typeof filter === 'string' ? filter : filter?.status;
    const items = allItems.filter(item => {
        if (!status || status === 'all') return true;
        if (status === 'ready') return item.safeBulk;
        if (status === 'needsAttention') return item.needsAttention;
        if (status === 'confirmed') return item.confirmed;
        return true;
    }).map(({ safeBulk: _safeBulk, ...item }) => item);
    return deepFreeze({ summary, safeBulkSourceIndexes, items });
}
export default buildMiniAttendanceReviewViewModel;
