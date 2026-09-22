import { state, invalidateAllStats, buildAttendanceIndex } from '../../core/AppState.js';
import { eventBus } from '../../core/Events.js';
import { Modal } from '../../components/Modal.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { projectSetupService } from './ProjectSetupService.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { analyzeProjectOwnership, CLASSIFICATION } from './ProjectOwnershipReconciliation.js';
import {
    applyOwnershipRepair,
    preflightDependencies,
    REPAIR_ACTION,
    REPAIR_STATUS
} from './ProjectOwnershipRepairService.js';
import {
    getPendingFullImport,
    requestFullImportProjectChoice,
    cancelFullImportProjectChoice,
    closeImportFullModal,
    FULL_IMPORT_RECONCILIATION_EVENT
} from '../export/ExportController.js';
import {
    showImportFullEmbeddedStage,
    updateImportFullEmbeddedContent,
    isImportFullEmbeddedStageActive
} from '../export/ImportFullModal.js';
import { collectPositionDays } from '../../services/AttendancePositionAudit.js';
import { slugify, generateUUID } from '../../utils/Helpers.js';

const ACTIONABLE = new Set([CLASSIFICATION.EXPLICIT_ORPHAN, CLASSIFICATION.PENDING]);
let snapshot = emptySnapshot();
let activeModal = null;
let registered = false;
let refreshGeneration = 0;
let modalState = initialModalState();
let importModal = null;
let importEmbedded = false;
let importModalState = initialImportModalState();

function emptySnapshot() {
    return {
        enabled: false, projects: [], activeProjects: [], employeeRows: [],
        otherIssues: [], pendingEmployeeCount: 0,
        totalPendingCount: 0, validEmployeeCount: 0, issueCount: 0
    };
}
function initialModalState() {
    return {
        selectedIds: new Set(), action: '', targetProjectId: '',
        createName: '', createProjectId: null,
        positionRemaps: {},
        positionCopies: {},
        busy: false, message: ''
    };
}
function initialImportModalState() {
    return {
        pending: null, chosenProjectId: '', busy: false, message: ''
    };
}

function numericEmployeeCompare(a, b) {
    const an = Number.parseInt(String(a?.number ?? ''), 10);
    const bn = Number.parseInt(String(b?.number ?? ''), 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a?.number ?? '').localeCompare(String(b?.number ?? ''), undefined, { numeric: true });
}

function actionable(issue) {
    return ACTIONABLE.has(issue?.status);
}

function signature(model) {
    return JSON.stringify({
        enabled: model.enabled,
        rows: model.employeeRows.map(row => [row.id, row.status, row.projectIds, row.attendanceIssueCount]),
        other: model.otherIssues.map(issue => [issue.collection, issue.recordKey, issue.status]),
        projects: model.projects.map(project => [project.id, project.name, project.status])
    });
}
export function buildLocalReconciliationViewModel(appState, projectState) {
    if (!projectState?.enabled) return emptySnapshot();
    const projects = Array.isArray(projectState.projects) ? projectState.projects : [];
    const defaultProjectId = projectState.defaultProjectId || null;
    const analysis = analyzeProjectOwnership(appState, projects, { enabled: true, defaultProjectId });
    const employeeById = new Map((appState?.employees || []).map(emp => [String(emp?.id || ''), emp]));
    const rowById = new Map();

    for (const issue of analysis.issues.filter(actionable)) {
        if (issue.collection !== 'employees') continue;
        const id = String(issue.employeeId || issue.record?.id || '');
        const employee = employeeById.get(id) || issue.record;
        if (!id || !employee) continue;
        rowById.set(id, {
            id, employee, employeeIssue: issue, attendanceIssues: [],
            projectIds: new Set(issue.projectId ? [issue.projectId] : [])
        });
    }

    for (const issue of analysis.issues.filter(actionable)) {
        if (issue.collection !== 'attendance') continue;
        const id = String(issue.employeeId || issue.record?.employeeId || '');
        const employee = employeeById.get(id);
        if (!id || !employee) continue;
        const row = rowById.get(id) || {
            id, employee, employeeIssue: null, attendanceIssues: [], projectIds: new Set()
        };
        row.attendanceIssues.push(issue);
        if (issue.projectId) row.projectIds.add(issue.projectId);
        rowById.set(id, row);
    }

    const employeeRows = [...rowById.values()].map(row => ({
        ...row,
        projectIds: [...row.projectIds],
        status: row.employeeIssue?.status || row.attendanceIssues[0]?.status || null,
        attendanceIssueCount: row.attendanceIssues.length
    })).sort((a, b) => numericEmployeeCompare(a.employee, b.employee));

    const rowIds = new Set(employeeRows.map(row => row.id));
    const otherIssues = analysis.issues.filter(issue =>
        actionable(issue)
        && issue.collection !== 'employees'
        && !(issue.collection === 'attendance' && rowIds.has(String(issue.employeeId || '')))
    );
    const employeeAnalysis = analyzeProjectOwnership(
        { employees: appState?.employees || [] },
        projects,
        { enabled: true, defaultProjectId, collections: ['employees'] }
    );

    return {
        enabled: true,
        projects,
        defaultProjectId,
        activeProjects: projects.filter(project => project?.status === PROJECT_STATUS.ACTIVE),
        employeeRows,
        otherIssues,
        pendingEmployeeCount: employeeRows.length,
        totalPendingCount: employeeRows.length + otherIssues.length,
        validEmployeeCount: employeeAnalysis.summary.counts[CLASSIFICATION.VALID] || 0,
        issueCount: analysis.summary.issueCount,
        analysis
    };
}

export async function refreshProjectReconciliationSnapshot() {
    const generation = ++refreshGeneration;
    let next = emptySnapshot();
    if (isProjectsEnabled()) {
        try {
            next = buildLocalReconciliationViewModel(state, await projectSetupService.getState());
        } catch (error) {
            console.warn('No se pudo actualizar Pendientes de asignación:', error);
        }
    }
    if (generation === refreshGeneration) snapshot = next;
    return snapshot;
}
export function getProjectReconciliationSnapshot() {
    return snapshot;
}

export function renderProjectReconciliationBanner() {
    if (!snapshot.enabled || snapshot.pendingEmployeeCount <= 0) return '';
    const n = snapshot.pendingEmployeeCount;
    const title = n === 1 ? 'Empleado pendiente de asignación' : 'Empleados pendientes de asignación';
    const ariaLabel = n + ' ' + (n === 1 ? 'empleado pendiente de asignación' : 'empleados pendientes de asignación');
    return '<section class="r07-recon-banner" aria-label="' + escapeHTML(ariaLabel) + '">'
        + '<span class="r07-recon-banner-count" aria-hidden="true">' + n + '</span>'
        + '<span class="r07-recon-banner-copy"><strong>' + escapeHTML(title) + '</strong>'
        + '<span>Revisa a qué obra pertenece cada persona antes de continuar.</span></span>'
        + '<button type="button" class="r07-recon-banner-action" data-app-fn="openProjectReconciliation">Revisar ' + n + ' ' + (n === 1 ? 'problema' : 'problemas') + '</button>'
        + '</section>';
}

export function renderProjectReconciliationSettingsAction() {
    if (!snapshot.enabled) return '';
    let html = '';
    if (snapshot.pendingEmployeeCount <= 0) {
        html += '<div class="r07-recon-health-ok" role="status">'
            + '<span class="r07-recon-health-dot" aria-hidden="true"></span>'
            + '<span><strong>Asignación por obra al día</strong>'
            + '<small>No hay personas pendientes de asignación.</small></span></div>';
    } else {
        const n = snapshot.pendingEmployeeCount;
        const title = n === 1 ? 'Revisar empleado pendiente de asignación' : 'Revisar empleados pendientes de asignación';
        html += '<button type="button" class="stg-action r07-recon-settings-action" data-settings-action="open-project-reconciliation" aria-label="' + n + ' ' + (n === 1 ? 'empleado pendiente de asignación' : 'empleados pendientes de asignación') + '">'
            + '<span class="r07-recon-settings-count" aria-hidden="true">' + n + '</span>'
            + '<span class="stg-action-copy"><strong>' + escapeHTML(title) + '</strong>'
            + '<small>Revisa a qué obra pertenece cada persona.</small></span></button>';
    }
    return html;
}
function selectedEmployees() {
    return (state.employees || []).filter(emp => modalState.selectedIds.has(String(emp?.id || '')));
}

function selectedEmployeesNeedingOwnershipRepair() {
    const ownershipIds = new Set(
        selectedRows().filter(row => row.employeeIssue).map(row => String(row.id || ''))
    );
    return (state.employees || []).filter(emp => ownershipIds.has(String(emp?.id || '')));
}

function ensureCreateProjectId() {
    if (!modalState.createProjectId) {
        modalState.createProjectId = Project.create({ name: 'Borrador' }).id;
    }
    return modalState.createProjectId;
}

function selectedRows() {
    return snapshot.employeeRows.filter(row => modalState.selectedIds.has(row.id));
}

function normalizeProjectName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function duplicateCreateProject() {
    if (modalState.action !== 'create') return null;
    const target = normalizeProjectName(modalState.createName);
    if (!target) return null;
    return snapshot.projects.find(project => normalizeProjectName(project?.name) === target) || null;
}

function currentTargetProjectId() {
    if (modalState.action === 'map') return modalState.targetProjectId || '';
    if (modalState.action === 'create') return ensureCreateProjectId();
    return '';
}

const POSITION_DEPENDENCY_KINDS = new Set([
    'POSITION_PROJECT_CONFLICT',
    'SHARED_POSITION_CONFLICT',
    'UNRESOLVED_POSITION_OWNERSHIP',
    'MISSING_POSITION_DEFINITION',
    'POSITION_REMAP_TARGET_MISSING',
    'POSITION_REMAP_TARGET_WRONG_PROJECT',
    'POSITION_REMAP_INVALID',
    'POSITION_REMAP_SOURCE_NOT_ASSIGNED'
]);

function positionRemapKey(employeeId, fromPositionId) {
    return String(employeeId || '') + '::' + String(fromPositionId || '');
}

function currentPositionRemaps() {
    return Object.values(modalState.positionRemaps || {})
        .filter(item => item?.employeeId && modalState.selectedIds.has(String(item.employeeId))
            && item?.fromPositionId && item?.toPositionId)
        .map(item => ({
            employeeId: item.employeeId,
            fromPositionId: item.fromPositionId,
            toPositionId: item.toPositionId,
            migrateHistory: item.migrateHistory === true
        }));
}

function currentPositionCopies() {
    return Object.values(modalState.positionCopies || {})
        .filter(item => item?.fromPositionId && item?.newPositionId)
        .map(item => ({
            fromPositionId: item.fromPositionId,
            newPositionId: item.newPositionId,
            name: item.name || ''
        }));
}

function targetPositionsForProject(projectId) {
    const target = String(projectId || '');
    if (!target) return [];
    return (state.positions || [])
        .filter(position => position?.active !== false && String(position?.projectId || '') === target)
        .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { numeric: true }));
}

function selectedPositionRemapNeeds() {
    if (!['map', 'create'].includes(modalState.action)) return [];
    const target = currentTargetProjectId();
    if (!target) return [];
    const needs = [];
    // Attendance-only rows keep the employee in its already-valid project;
    // their current position therefore does not need a destination remap.
    for (const row of selectedRows().filter(item => item.employeeIssue)) {
        const employee = row.employee || {};
        const ids = new Set([
            ...(Array.isArray(employee.positions) ? employee.positions : []),
            ...(employee.positionId ? [employee.positionId] : [])
        ].map(String).filter(Boolean));
        for (const fromPositionId of ids) {
            const position = (state.positions || []).find(item => String(item?.id || '') === fromPositionId);
            if (position && String(position.projectId || '') === target) continue;
            needs.push({
                employeeId: row.id,
                employee,
                fromPositionId,
                fromPosition: position || null,
                audit: collectPositionDays(state.attendance || {}, {
                    employeeId: row.id,
                    positionId: fromPositionId
                })
            });
        }
    }
    return needs;
}

function currentPreflight() {
    if (!['map', 'create'].includes(modalState.action)) return { ok: true, conflicts: [] };
    const targetProjectId = currentTargetProjectId();
    if (!targetProjectId) return { ok: false, conflicts: [] };
    return preflightDependencies({
        // Target-project position/leader dependencies apply only to employees
        // whose own ownership is being repaired. Attendance-only rows repair
        // related records while the employee remains in its valid project.
        employees: selectedEmployeesNeedingOwnershipRepair(),
        allEmployees: state.employees || [],
        positions: state.positions || [],
        leaders: state.leaders || [],
        targetProjectId,
        positionRemaps: currentPositionRemaps(),
        positionCopies: currentPositionCopies()
    });
}
function checkSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10"></path></svg>';
}

function choiceIcon(value) {
    const common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    if (value === 'create') {
        return '<svg ' + common + '><path d="M4 20V7l8-4 8 4v13"></path><path d="M12 9v6M9 12h6"></path></svg>';
    }
    if (value === 'later') {
        return '<svg ' + common + '><circle cx="12" cy="12" r="8"></circle><path d="M12 8v5l3 2"></path></svg>';
    }
    return '<svg ' + common + '><path d="M4 20V7l8-4 8 4v13"></path><path d="M8 20v-5h8v5"></path></svg>';
}

function renderPersonRows(preflight = { ok: false }) {
    if (!snapshot.employeeRows.length) {
        return '<div class="r07-recon-empty">No hay empleados pendientes de asignación.</div>';
    }
    return snapshot.employeeRows.map(row => {
        const employee = row.employee || {};
        const checked = modalState.selectedIds.has(row.id);
        const refs = row.status === CLASSIFICATION.PENDING
            ? 'Pendiente de asignación'
            : (row.employeeIssue
                ? 'Obra de origen no disponible'
                : 'Asistencia vinculada a una obra no disponible');
        const targetProject = modalState.action === 'map'
            ? snapshot.projects.find(project => String(project?.id || '') === String(modalState.targetProjectId || ''))
            : null;
        const readyTarget = checked && preflight.ok && targetProject
            ? String(targetProject.name || targetProject.id)
            : '';
        const statusText = readyTarget
            ? 'Listo para asignar a ' + readyTarget
            : (row.status === CLASSIFICATION.PENDING
                ? 'Pendiente'
                : (row.employeeIssue ? 'Obra no disponible' : 'Asistencia pendiente'));
        const statusClass = readyTarget
            ? 'r07-recon-status is-ready'
            : (row.status === CLASSIFICATION.PENDING
                ? 'r07-recon-status is-pending'
                : (row.employeeIssue ? 'r07-recon-status is-orphan' : 'r07-recon-status'));
        return '<label class="r07-recon-person ' + (checked ? 'is-selected' : '') + '">'
            + '<input class="r07-recon-native-control" type="checkbox" data-r07-select="' + escapeHTML(row.id) + '"' + (checked ? ' checked' : '') + '>'
            + '<span class="r07-recon-check" aria-hidden="true">' + checkSvg() + '</span>'
            + '<span class="r07-recon-person-main"><span class="r07-recon-person-title">'
            + '<strong>' + escapeHTML(employee.number || '—') + '</strong>'
            + '<span>' + escapeHTML(employee.name || 'Empleado sin nombre') + '</span></span>'
            + '<span class="r07-recon-person-meta"><span class="' + statusClass + '">' + escapeHTML(statusText) + '</span>'
            + '<span class="r07-recon-project-ref">' + escapeHTML(refs) + '</span>'
            + (row.attendanceIssueCount ? '<span>' + row.attendanceIssueCount + ' asistencia(s) afectada(s)</span>' : '')
            + '</span></span></label>';
    }).join('');
}

function renderChoice(value, title, detail) {
    const checked = modalState.action === value;
    return '<label class="r07-recon-choice ' + (checked ? 'is-selected' : '') + '">'
        + '<input class="r07-recon-native-control" type="radio" name="r07-recon-action" value="' + value + '"' + (checked ? ' checked' : '') + '>'
        + '<span class="r07-recon-choice-icon" aria-hidden="true">' + choiceIcon(value) + '</span>'
        + '<span class="r07-recon-choice-copy"><strong>' + escapeHTML(title) + '</strong><small>' + escapeHTML(detail) + '</small></span></label>';
}
function dependencyConflictText(conflict = {}) {
    const name = conflict.entityName || conflict.entityId || 'La relación';
    const messages = {
        POSITION_PROJECT_CONFLICT: 'El puesto "' + name + '" pertenece a otra obra.',
        SHARED_POSITION_CONFLICT: 'El puesto "' + name + '" también lo usan personas de otra obra y no puede moverse automáticamente.',
        UNRESOLVED_POSITION_OWNERSHIP: 'El puesto "' + name + '" todavía no tiene una obra válida asignada.',
        MISSING_POSITION_DEFINITION: 'No se encontró la definición del puesto "' + name + '".',
        LEADER_PROJECT_CONFLICT: 'El líder "' + name + '" pertenece a otra obra.',
        SHARED_LEADER_CONFLICT: 'El líder "' + name + '" también está relacionado con personas de otra obra y no puede moverse automáticamente.',
        UNRESOLVED_LEADER_OWNERSHIP: 'El líder "' + name + '" todavía no tiene una obra válida asignada.',
        MISSING_LEADER_DEFINITION: 'No se encontró la definición del líder "' + name + '".'
    };
    return messages[conflict.kind] || 'Revisa "' + name + '" antes de continuar.';
}

/** F5: accurate non-blocking per-kind label for a detached leader. */
function leaderDetachLabel(d = {}) {
    const name = d.entityName || d.entityId || 'Líder';
    switch (d.kind) {
        case 'MISSING_LEADER_DEFINITION': return name + ' (líder no disponible)';
        case 'UNRESOLVED_LEADER_OWNERSHIP': return name + ' (líder sin obra asignada)';
        case 'INACTIVE_LEADER': return name + ' (líder inactivo)';
        case 'LEADER_PROJECT_CONFLICT':
        default: return name + ' (líder de otra obra)';
    }
}

function renderDependencyBlocker(preflight) {
    if (preflight.ok || !preflight.conflicts?.length) return '';
    const rows = preflight.conflicts.slice(0, 6).map(conflict =>
        '<li>' + escapeHTML(dependencyConflictText(conflict)) + '</li>'
    ).join('');
    return '<div class="r07-recon-blocker" role="alert">'
        + '<strong>Hay relaciones que deben revisarse antes de mover estas personas.</strong>'
        + '<ul>' + rows + '</ul>'
        + (preflight.conflicts.length > 6
            ? '<span>Y ' + (preflight.conflicts.length - 6) + ' conflicto(s) adicional(es).</span>'
            : '')
        + '</div>';
}


function findEquivalentDestinationPosition(sourceName, targetPositions) {
    const needle = slugify(sourceName);
    if (!needle) return null;
    return targetPositions.find(position => slugify(position?.name) === needle) || null;
}

/**
 * F6: reuse an already-queued "similar position" copy for the same source
 * position + target + normalized name, so a batch of selected employees creates
 * the destination position exactly once.
 */
function findQueuedSimilarCopy(fromPositionId, name) {
    const normalized = slugify(name);
    if (!normalized) return null;
    for (const item of Object.values(modalState.positionCopies || {})) {
        if (String(item?.fromPositionId || '') !== String(fromPositionId)) continue;
        if (slugify(String(item?.name || '')) !== normalized) continue;
        return item;
    }
    return null;
}

function renderPositionRemapControls(preflight) {
    if (!['map', 'create'].includes(modalState.action)) {
        return renderDependencyBlocker(preflight);
    }
    const targetProjectId = currentTargetProjectId();
    if (!targetProjectId) return renderDependencyBlocker(preflight);

    const needs = selectedPositionRemapNeeds();
    if (!needs.length) return renderDependencyBlocker(preflight);
    const targetPositions = targetPositionsForProject(targetProjectId);
    const targetProject = snapshot.projects.find(p => String(p?.id || '') === String(targetProjectId));
    const targetName = targetProject?.name || (modalState.action === 'create' ? modalState.createName.trim() : targetProjectId);
    const remainingConflicts = (preflight.conflicts || []).filter(conflict => !POSITION_DEPENDENCY_KINDS.has(conflict.kind));

    let html = '<section class="r07-position-remap" aria-labelledby="r07-position-remap-title">'
        + '<div class="r07-position-remap-head"><div><strong id="r07-position-remap-title">Puesto en la obra destino</strong>'
        + '<span>Antes de mover a estas personas, resuelve los puestos que pertenecen a otra obra.</span></div>'
        + '<span class="r07-position-remap-project">' + escapeHTML(targetName) + '</span></div>';

    html += needs.map((need, index) => {
        const key = positionRemapKey(need.employeeId, need.fromPositionId);
        const selected = modalState.positionRemaps[key] || {};
        const copyEntry = modalState.positionCopies[key] || null;
        const sourceName = need.fromPosition?.name || need.fromPositionId || 'Puesto no disponible';
        const equivalent = findEquivalentDestinationPosition(sourceName, targetPositions);
        const options = targetPositions.map(position =>
            '<option value="' + escapeHTML(position.id) + '"'
            + (String(selected.toPositionId || '') === String(position.id) ? ' selected' : '') + '>'
            + escapeHTML(position.name || position.id) + '</option>'
        ).join('');
        const audit = need.audit || {};
        const impact = audit.count > 0
            ? audit.count + ' día' + (audit.count === 1 ? '' : 's') + ' · '
                + audit.totalHours + 'h · ' + (audit.firstDate || '—') + ' a ' + (audit.lastDate || '—')
            : 'Sin días trabajados registrados con este puesto';
        const selectId = 'r07-remap-target-' + index;

        let similarAction = '';
        if (copyEntry) {
            similarAction = '<span class="r07-position-similar-note is-queued">Se creará el puesto "'
                + escapeHTML(copyEntry.name || copyEntry.newPositionId) + '" en esta obra.</span>';
        } else if (equivalent) {
            similarAction = '<span class="r07-position-similar-note">Ya existe un puesto equivalente: <strong>'
                + escapeHTML(equivalent.name || equivalent.id) + '</strong>.</span>'
                + '<button type="button" class="btn-secondary r07-recon-note-action"'
                + ' data-r07-action="use-equivalent-position"'
                + ' data-employee-id="' + escapeHTML(need.employeeId) + '"'
                + ' data-from-position-id="' + escapeHTML(need.fromPositionId) + '"'
                + ' data-to-position-id="' + escapeHTML(equivalent.id) + '">Usar este puesto</button>';
        } else {
            similarAction = '<button type="button" class="btn-secondary r07-recon-note-action"'
                + ' data-r07-action="create-similar-position"'
                + ' data-employee-id="' + escapeHTML(need.employeeId) + '"'
                + ' data-from-position-id="' + escapeHTML(need.fromPositionId) + '">Crear puesto similar</button>';
        }

        return '<div class="r07-position-remap-card">'
            + '<div class="r07-position-remap-person"><strong>' + escapeHTML(need.employee?.number || '—')
            + ' · ' + escapeHTML(need.employee?.name || 'Empleado') + '</strong>'
            + '<span>Actual: ' + escapeHTML(sourceName) + '</span></div>'
            + '<div class="r07-recon-control"><label for="' + selectId + '">Nuevo puesto en la obra destino</label>'
            + '<select id="' + selectId + '" data-r07-position-target'
            + ' data-employee-id="' + escapeHTML(need.employeeId) + '" data-from-position-id="' + escapeHTML(need.fromPositionId) + '"'
            + (targetPositions.length ? '' : ' disabled') + '>'
            + '<option value="">Selecciona un puesto</option>' + options + '</select></div>'
            + '<div class="r07-position-remap-similar">' + similarAction + '</div>'
            + '<div class="r07-position-remap-impact is-preserved"><strong>Historial conservado</strong><span>' + escapeHTML(impact) + '</span>'
            + '<small>Solo cambia el puesto actual. Los días ya trabajados conservan el puesto y los valores históricos registrados.</small></div>'
            + '</div>';
    }).join('');

    html += '</section>';
    if (remainingConflicts.length) {
        html += renderDependencyBlocker({ ok: false, conflicts: remainingConflicts });
    }
    return html;
}

function renderPreflightSummary(preflight) {
    const hasTarget = modalState.action === 'map'
        ? !!modalState.targetProjectId
        : (modalState.action === 'create' && !!modalState.createName.trim());
    if (!['map', 'create'].includes(modalState.action) || !hasTarget) return '';

    const targetProjectId = currentTargetProjectId();
    const targetProject = snapshot.projects.find(p => String(p?.id || '') === String(targetProjectId));
    const targetName = targetProject?.name
        || (modalState.action === 'create' ? modalState.createName.trim() : targetProjectId);

    // Chosen (existing destination) or created (similar) positions.
    const copies = currentPositionCopies();
    const remaps = currentPositionRemaps();
    const positionById = new Map((state.positions || []).map(p => [String(p?.id), p]));
    const positionLines = [];
    const seenCopyIds = new Set();
    for (const copy of copies) {
        // F6: same destination id reused across employees is reported once.
        if (seenCopyIds.has(copy.newPositionId)) continue;
        seenCopyIds.add(copy.newPositionId);
        positionLines.push('Se creará "' + (copy.name || copy.newPositionId) + '"');
    }
    for (const remap of remaps) {
        const isCopy = copies.some(c => c.newPositionId === remap.toPositionId);
        if (isCopy) continue;
        const existing = positionById.get(String(remap.toPositionId));
        positionLines.push(existing?.name || remap.toPositionId);
    }

    const selected = selectedRows();
    const employeeOwnershipRows = selected.filter(row => row.employeeIssue);
    const orphanAttendance = selected.flatMap(row => row.attendanceIssues || []);
    const catalogProjectNames = new Map(snapshot.projects.map(project => [
        String(project?.id || ''),
        project?.name || project?.id || 'obra sin nombre'
    ]));
    const selectedIds = new Set(selected.map(row => String(row.id || '')));
    const attendanceEntries = Array.isArray(state.attendance)
        ? state.attendance.map((record, index) => [record?.key || `index:${index}`, record])
        : Object.entries(state.attendance || {});
    const preservedValidOtherProjectAttendance = attendanceEntries
        .filter(([, record]) => {
            const employeeId = String(record?.employeeId || '');
            const projectId = String(record?.projectId || '').trim();
            return selectedIds.has(employeeId)
                && projectId
                && projectId !== String(targetProjectId)
                && catalogProjectNames.has(projectId);
        })
        .map(([recordKey, record]) => ({ recordKey, record }));

    function attendanceItemLabel(item, fallbackProject = 'sin obra válida') {
        const record = item?.record || {};
        const date = String(record.date || item?.recordKey || 'registro sin fecha');
        const projectId = String(record.projectId || '').trim();
        return date + ' (' + (catalogProjectNames.get(projectId) || fallbackProject) + ')';
    }

    const detached = (preflight?.dependencySummary?.detachedLeaders) || [];

    const updateItems = [];
    if (employeeOwnershipRows.length) {
        updateItems.push(
            employeeOwnershipRows.length + ' empleado' + (employeeOwnershipRows.length === 1 ? '' : 's')
            + ' sin obra válida se asociará' + (employeeOwnershipRows.length === 1 ? '' : 'n')
            + ' a ' + targetName + '.'
        );
    }
    if (orphanAttendance.length) {
        updateItems.push(
            orphanAttendance.length + ' asistencia' + (orphanAttendance.length === 1 ? '' : 's')
            + ' huérfana' + (orphanAttendance.length === 1 ? '' : 's')
            + ' se asociará' + (orphanAttendance.length === 1 ? '' : 'n') + ' a ' + targetName + ': '
            + orphanAttendance.map(item => attendanceItemLabel(item)).join(', ') + '.'
        );
    }
    if (positionLines.length) {
        updateItems.push('Puesto: ' + positionLines.join(', ') + '.');
    }
    const keepItems = [
        'Identidad y datos propios de cada empleado (número, nombre y salarios).',
        'Los préstamos se conservan intactos.'
    ];
    if (preservedValidOtherProjectAttendance.length) {
        keepItems.push(
            preservedValidOtherProjectAttendance.length + ' asistencia'
            + (preservedValidOtherProjectAttendance.length === 1 ? '' : 's')
            + ' válida' + (preservedValidOtherProjectAttendance.length === 1 ? '' : 's')
            + ' en otras obras se conservará' + (preservedValidOtherProjectAttendance.length === 1 ? '' : 'n') + ': '
            + preservedValidOtherProjectAttendance.map(item => attendanceItemLabel(item, 'obra válida')).join(', ') + '.'
        );
    }

    let html = '<section class="r07-preflight-summary" aria-label="Resumen antes de confirmar">'
        + '<strong>Resumen antes de confirmar</strong>'
        + '<div class="r07-preflight-destiny"><span>Obra destino</span><strong>' + escapeHTML(targetName) + '</strong></div>'
        + '<div class="r07-preflight-section"><span class="r07-preflight-tag is-update">Se actualizará</span>'
        + '<ul>' + updateItems.map(item => '<li>' + escapeHTML(item) + '</li>').join('') + '</ul></div>'
        + '<div class="r07-preflight-section"><span class="r07-preflight-tag is-keep">Se conservará</span>'
        + '<ul>' + keepItems.map(item => '<li>' + escapeHTML(item) + '</li>').join('') + '</ul></div>';
    if (detached.length) {
        const detachItems = detached.map(leaderDetachLabel);
        html += '<div class="r07-preflight-section"><span class="r07-preflight-tag is-detach">Se desvinculará</span>'
            + '<ul>' + detachItems.map(item => '<li>' + escapeHTML(item) + '</li>').join('') + '</ul></div>';
    }
    html += '</section>';
    return html;
}

function canApply(preflight) {
    if (modalState.busy || modalState.selectedIds.size === 0 || !modalState.action) return false;
    if (modalState.action === 'map' && !modalState.targetProjectId) return false;
    if (modalState.action === 'create' && !modalState.createName.trim()) return false;
    if (modalState.action === 'create' && duplicateCreateProject()) return false;
    if (['map', 'create'].includes(modalState.action) && !preflight.ok) return false;
    if (modalState.action === 'later' && selectedRows().some(row => !row.employeeIssue)) return false;
    return true;
}

function resolutionHint(preflight) {
    if (modalState.busy) return 'Guardando cambios…';
    if (modalState.selectedIds.size === 0) return 'Selecciona al menos una persona.';
    if (!modalState.action) return 'Elige cómo resolver la selección.';
    if (modalState.action === 'map' && !modalState.targetProjectId) return 'Selecciona una obra de destino.';
    if (modalState.action === 'create' && !modalState.createName.trim()) return 'Escribe un nombre para la nueva obra.';
    const duplicate = duplicateCreateProject();
    if (modalState.action === 'create' && duplicate) return 'Ya existe una obra con ese nombre. Elige otro nombre o asígnala a la obra existente.';
    if (['map', 'create'].includes(modalState.action) && !preflight.ok) return 'Revisa las relaciones indicadas antes de aplicar.';
    if (modalState.action === 'later' && selectedRows().some(row => !row.employeeIssue)) {
        return 'Desmarca las incidencias que solo afectan asistencia.';
    }
    return '';
}

function primaryActionLabel() {
    if (modalState.busy) return 'Aplicando…';
    if (modalState.action === 'map') return 'Asignar a obra';
    if (modalState.action === 'create') return 'Crear y asignar';
    if (modalState.action === 'later') return 'Dejar pendiente';
    return 'Aplicar selección';
}

function renderActionControl(preflight) {
    if (modalState.action === 'map') {
        const options = snapshot.activeProjects.map(project =>
            '<option value="' + escapeHTML(project.id) + '"'
            + (project.id === modalState.targetProjectId ? ' selected' : '') + '>'
            + escapeHTML(project.name || project.id) + '</option>'
        ).join('');
        return '<div class="r07-recon-control"><label for="r07-target-project">Obra de destino</label>'
            + '<select id="r07-target-project" data-r07-control="target-project">'
            + '<option value="">Selecciona una obra activa</option>' + options + '</select></div>'
            + renderPositionRemapControls(preflight);
    }
    if (modalState.action === 'create') {
        const duplicate = duplicateCreateProject();
        const errorText = duplicate
            ? 'Ya existe una obra llamada "' + (duplicate.name || 'sin nombre') + '". Elige otro nombre o usa la obra existente.'
            : '';
        return '<div class="r07-recon-control"><label for="r07-create-project-name">Nombre de la nueva obra</label>'
            + '<input id="r07-create-project-name" type="text" data-r07-control="create-name" maxlength="80" autocomplete="off"'
            + ' aria-describedby="r07-create-project-help r07-create-project-error"'
            + (duplicate ? ' aria-invalid="true"' : '')
            + ' value="' + escapeHTML(modalState.createName) + '" placeholder="Ej. Torre Norte">'
            + '<small id="r07-create-project-help">Se creará una única obra nueva, sin duplicados.</small>'
            + '<small id="r07-create-project-error" class="r07-recon-inline-error" role="status"'
            + (duplicate ? '' : ' hidden') + '>' + escapeHTML(errorText) + '</small></div>'
            + renderPositionRemapControls(preflight);
    }
    if (modalState.action === 'later' && selectedRows().some(row => !row.employeeIssue)) {
        return '<div class="r07-recon-blocker" role="alert">'
            + '<strong>Esta selección contiene una persona cuya obra ya es válida.</strong>'
            + '<span>Solo su asistencia necesita revisión. Elige una obra o desmarca esa persona para evitar pausarla.</span>'
            + '</div>';
    }
    return '';
}

function renderPersonnelManagementLink() {
    const rows = selectedRows();
    if (rows.length !== 1) return '';
    const employee = rows[0]?.employee || {};
    return '<aside class="r07-recon-personnel-link">'
        + '<span><strong>¿Necesitas desactivar o eliminar a ' + escapeHTML(employee.name || 'esta persona') + '?</strong>'
        + '<small>Hazlo desde Personal. SA conservará allí las salvaguardas de historial, antigüedad y préstamos antes de permitir un borrado.</small></span>'
        + '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="manage-person">Gestionar en Personal</button>'
        + '</aside>';
}

function otherIssueLabel(issue = {}) {
    const record = issue.record || {};
    const name = record.name || record.number || 'Registro sin nombre';
    const type = issue.collection === 'positions'
        ? 'Puesto'
        : (issue.collection === 'leaders'
            ? 'Líder'
            : (issue.collection === 'attendance' ? 'Asistencia' : 'Registro'));
    return type + ': ' + name;
}

function renderOtherIssuesNote() {
    if (!snapshot.otherIssues.length) return '';
    const rows = snapshot.otherIssues.slice(0, 4).map(issue =>
        '<li>' + escapeHTML(otherIssueLabel(issue)) + '</li>'
    ).join('');
    const remaining = snapshot.otherIssues.length - Math.min(snapshot.otherIssues.length, 4);
    return '<section class="r07-recon-note r07-recon-other-issues">'
        + '<strong>' + snapshot.otherIssues.length + ' ' + (snapshot.otherIssues.length === 1 ? 'registro adicional requiere revisión' : 'registros adicionales requieren revisión') + '</strong>'
        + '<span>No se modificarán automáticamente. Revisa su obra antes de continuar con esos registros.</span>'
        + '<ul class="r07-recon-note-list">' + rows
        + (remaining > 0 ? '<li>Y ' + remaining + ' más</li>' : '') + '</ul>'
        + '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="review-other-issues">Revisar</button>'
        + '</section>';
}

function modalContent() {
    const preflight = currentPreflight();
    const hasEmployeeFlow = snapshot.employeeRows.length > 0;
    const allSelected = hasEmployeeFlow
        && snapshot.employeeRows.every(row => modalState.selectedIds.has(row.id));
    const hint = hasEmployeeFlow ? resolutionHint(preflight) : '';
    const employeeFlow = hasEmployeeFlow
        ? '<section class="r07-recon-section" aria-labelledby="r07-select-title">'
            + '<div class="r07-recon-section-head"><div><h3 id="r07-select-title">1. Selecciona las personas</h3>'
            + '<p>Solo se modificarán las personas seleccionadas y su asistencia relacionada.</p></div>'
            + '<button type="button" class="r07-recon-link-button" data-r07-action="toggle-all">'
            + (allSelected ? 'Deseleccionar todos' : 'Seleccionar todos') + '</button></div>'
            + '<div class="r07-recon-people">' + renderPersonRows(preflight) + '</div></section>'
            + '<fieldset class="r07-recon-section r07-recon-fieldset"><legend>2. Elige cómo resolverlo</legend>'
            + '<div class="r07-recon-choices">'
            + renderChoice('map', 'Asignar a una obra existente', 'Usa una obra activa que ya existe en SA.')
            + renderChoice('create', 'Crear una obra y asignar', 'Crea una obra nueva y mueve allí las personas seleccionadas.')
            + renderChoice('later', 'Resolver más tarde', 'Mantiene estas personas fuera del flujo normal hasta revisarlas.')
            + '</div>' + renderActionControl(preflight) + '</fieldset>'
            + renderPersonnelManagementLink()
        : '';
    const primary = hasEmployeeFlow
        ? '<button type="button" class="btn-primary r07-recon-footer-btn r07-recon-footer-primary" data-r07-action="apply"'
            + (canApply(preflight) ? '' : ' disabled') + '>' + primaryActionLabel() + '</button>'
        : '';
    return '<div class="r07-recon-shell">'
        + '<div class="r07-recon-kicker">CONCILIACIÓN</div>'
        + '<div class="r07-recon-summary" aria-live="polite">'
        + '<div><strong>' + snapshot.pendingEmployeeCount + '</strong><span>empleados pendientes</span></div>'
        + '<div><strong>' + snapshot.validEmployeeCount + '</strong><span>empleados asignados</span></div>'
        + '<div><strong>' + snapshot.otherIssues.length + '</strong><span>otros avisos</span></div>'
        + '</div>' + employeeFlow + renderPreflightSummary(preflight) + renderOtherIssuesNote()
        + (modalState.message ? '<div class="r07-recon-message" role="status">' + escapeHTML(modalState.message) + '</div>' : '')
        + '<div class="r07-recon-footer">'
        + '<button type="button" class="btn-secondary r07-recon-footer-btn r07-recon-footer-secondary" data-r07-action="close">Cerrar</button>'
        + '<div class="r07-recon-footer-hint" aria-live="polite">' + escapeHTML(hint) + '</div>'
        + primary + '</div></div>';
}

function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value ?? '').replace(/["\\]/g, '\\$&');
}

function rerenderModal() {
    if (!activeModal?.element) return;
    const body = activeModal.element.querySelector('.modal-body');
    if (!body) return;
    // Preserve focus across the innerHTML swap (design.md §7 keyboard flow):
    // remember the focused control and restore the equivalent node afterwards.
    const active = document.activeElement;
    let focusTarget = null;
    if (active && body.contains(active)) {
        if (active.dataset?.r07Select !== undefined) {
            focusTarget = () => body.querySelector('[data-r07-select="' + cssEscape(active.dataset.r07Select) + '"]');
        } else if (active.name === 'r07-recon-action') {
            focusTarget = () => body.querySelector('input[name="r07-recon-action"][value="' + cssEscape(active.value) + '"]');
        } else if (active.dataset?.r07Control === 'target-project') {
            focusTarget = () => body.querySelector('[data-r07-control="target-project"]');
        } else if (active.dataset?.r07Control === 'create-name') {
            focusTarget = () => body.querySelector('[data-r07-control="create-name"]');
        } else if (active.dataset?.r07PositionTarget !== undefined) {
            const emp = active.dataset.employeeId || '';
            const from = active.dataset.fromPositionId || '';
            focusTarget = () => body.querySelector('[data-r07-position-target][data-employee-id="' + cssEscape(emp) + '"][data-from-position-id="' + cssEscape(from) + '"]');
        } else if (active.dataset?.r07Action === 'toggle-all') {
            focusTarget = () => body.querySelector('[data-r07-action="toggle-all"]');
        } else if (active.dataset?.r07Action === 'create-similar-position'
            || active.dataset?.r07Action === 'use-equivalent-position') {
            const employeeId = active.dataset.employeeId || '';
            const fromPositionId = active.dataset.fromPositionId || '';
            focusTarget = () => {
                const positionTarget = body.querySelector(
                    '[data-r07-position-target][data-employee-id="' + cssEscape(employeeId)
                    + '"][data-from-position-id="' + cssEscape(fromPositionId) + '"]'
                );
                if (positionTarget && !positionTarget.disabled) return positionTarget;
                return body.querySelector('[data-r07-action="apply"]:not([disabled])')
                    || body.querySelector('[data-r07-action="close"]');
            };
        }
    }
    body.innerHTML = modalContent();
    if (focusTarget) {
        const el = focusTarget();
        if (el) el.focus();
    }
}

export async function openProjectReconciliation() {
    await refreshProjectReconciliationSnapshot();
    modalState = initialModalState();
    modalState.selectedIds = new Set(snapshot.employeeRows.map(row => row.id));
    if (activeModal?.isOpen) activeModal.close();
    const hasEmployeeFlow = snapshot.employeeRows.length > 0;
    activeModal = new Modal({
        title: hasEmployeeFlow ? 'Pendientes de asignación' : 'Relaciones entre obras',
        subtitle: hasEmployeeFlow
            ? 'Asigna cada persona a una obra sin perder su historial.'
            : 'Revisa los avisos pendientes de asignación entre obras.',
        size: 'large',
        content: modalContent(),
        buttons: null,
        onClose() {
            if (!this._previouslyFocused?.isConnected) {
                const fallback = currentReconciliationFocusFallback(this);
                if (fallback) this._previouslyFocused = fallback;
            }
            activeModal = null;
        }
    });
    activeModal.open();
    return activeModal;
}

function currentReconciliationFocusFallback(modal) {
    const selectors = [
        '[data-app-fn="openProjectReconciliation"]',
        '[data-settings-action="open-project-reconciliation"]'
    ];
    for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate?.isConnected && !modal?.element?.contains(candidate)) return candidate;
    }
    return null;
}

export function closeProjectReconciliation() {
    const modal = activeModal;
    if (modal && !modal._previouslyFocused?.isConnected) {
        const fallback = currentReconciliationFocusFallback(modal);
        if (fallback) modal._previouslyFocused = fallback;
    }
    modal?.close();
    activeModal = null;
}

async function applyLocalResolution() {
    if (modalState.busy) return;
    const employees = selectedEmployees();
    if (!employees.length || !modalState.action) return;
    const preflight = currentPreflight();
    if (['map', 'create'].includes(modalState.action) && !preflight.ok) {
        modalState.message = 'Hay relaciones de puesto o líder que deben revisarse antes de aplicar este cambio.';
        rerenderModal();
        return;
    }
    if (modalState.action === 'later' && selectedRows().some(row => !row.employeeIssue)) {
        modalState.message = 'Desmarca las personas cuya única incidencia está en asistencia antes de dejarlas pendientes.';
        rerenderModal();
        return;
    }

    // R07 Direction (addendum): "Resolver más tarde" es un no-op real. Sin
    // llamada al servicio, sin escrituras en IndexedDB y sin cambios en la
    // detección de pendientes. Se conserva la notificación de éxito.
    if (modalState.action === 'later') {
        window.showNotification?.('La selección se mantuvo pendiente para revisarla después.', 'success');
        closeProjectReconciliation();
        return;
    }

    modalState.busy = true;
    modalState.message = '';
    rerenderModal();
    const appliedAction = modalState.action;
    try {
        const base = {
            employees,
            allEmployees: state.employees || [],
            attendance: state.attendance || {},
            positions: state.positions || [],
            leaders: state.leaders || [],
            catalog: snapshot.projects
        };
        let params;
        if (appliedAction === 'map') {
            params = {
                ...base,
                action: REPAIR_ACTION.MAP_TO_EXISTING,
                targetProjectId: modalState.targetProjectId,
                positionRemaps: currentPositionRemaps(),
                positionCopies: currentPositionCopies()
            };
        } else if (appliedAction === 'create') {
            params = {
                ...base,
                action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
                projectId: ensureCreateProjectId(),
                projectName: modalState.createName.trim(),
                positionRemaps: currentPositionRemaps(),
                positionCopies: currentPositionCopies()
            };
        } else {
            params = { ...base, action: REPAIR_ACTION.QUARANTINE };
        }

        const result = await applyOwnershipRepair(params);
        if (![REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP].includes(result.status)) {
            modalState.busy = false;
            modalState.message = result.reason || 'No se pudo completar la asignación.';
            rerenderModal();
            return;
        }

        invalidateAllStats();
        buildAttendanceIndex();
        const createdProject = result.createdProject || null;
        const before = signature(snapshot);
        await refreshProjectReconciliationSnapshot();
        const changed = before !== signature(snapshot);
        if (changed && typeof window?.render === 'function') window.render();
        if (result.cloudQueued === false) {
            window.showNotification?.('Asignación guardada localmente. La sincronización quedó pendiente.', 'warning');
        } else if (appliedAction === 'later') {
            window.showNotification?.('La selección se mantuvo pendiente para revisarla después.', 'success');
        } else {
            window.showNotification?.('Asignación actualizada correctamente.', 'success');
        }

        modalState.busy = false;
        modalState.message = '';
        modalState.action = '';
        modalState.targetProjectId = '';
        modalState.createName = '';
        modalState.createProjectId = null;
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        modalState.selectedIds = new Set(snapshot.employeeRows.map(row => row.id));

        if (snapshot.pendingEmployeeCount === 0 || appliedAction === 'later') {
            closeProjectReconciliation();
        } else {
            rerenderModal();
        }

        // Emit only after this modal has consumed the post-commit snapshot.
        // Otherwise the projects:created listener starts a competing async
        // refresh that can make this refresh stale and leave an old modal open
        // even though the durable repair already reached zero pending.
        if (createdProject && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('projects:created', { detail: { project: createdProject } }));
        }
    } catch (error) {
        console.error('Error en Pendientes de asignación:', error);
        modalState.busy = false;
        modalState.message = error?.message || 'No se pudo aplicar la asignación.';
        rerenderModal();
    }
}

function createSimilarPosition(employeeId, fromPositionId) {
    if (!employeeId || !fromPositionId || modalState.busy) return;
    const source = (state.positions || []).find(p => String(p?.id || '') === String(fromPositionId));
    const sourceName = source?.name || fromPositionId;
    const key = positionRemapKey(employeeId, fromPositionId);
    // F6: reuse an already-queued destination id for the same source position +
    // target + normalized name so the batch creates the position once.
    const queued = findQueuedSimilarCopy(fromPositionId, sourceName);
    const newPositionId = queued ? queued.newPositionId : generateUUID();
    // Destination-owned copy: a new unique id, never the source project/leader
    // or cross-project relations (the service drops those on commit).
    modalState.positionCopies[key] = {
        fromPositionId: String(fromPositionId),
        newPositionId,
        name: sourceName
    };
    modalState.positionRemaps[key] = {
        employeeId: String(employeeId),
        fromPositionId: String(fromPositionId),
        toPositionId: newPositionId,
        migrateHistory: false
    };
    rerenderModal();
}

function useEquivalentPosition(employeeId, fromPositionId, toPositionId) {
    if (!employeeId || !fromPositionId || !toPositionId || modalState.busy) return;
    const key = positionRemapKey(employeeId, fromPositionId);
    delete modalState.positionCopies[key];
    modalState.positionRemaps[key] = {
        employeeId: String(employeeId),
        fromPositionId: String(fromPositionId),
        toPositionId: String(toPositionId),
        migrateHistory: false
    };
    rerenderModal();
}

function handleClick(event) {
    const importTarget = event.target.closest?.('[data-r07-import-action]');
    if (importTarget) {
        const action = importTarget.dataset.r07ImportAction;
        if (action === 'cancel') return cancelImportChoice();
        if (action === 'apply') return applyImportChoice();
        return;
    }
    const target = event.target.closest?.('[data-r07-action]');
    if (!target) return;
    const action = target.dataset.r07Action;
    if (action === 'close') return closeProjectReconciliation();
    if (action === 'apply') return applyLocalResolution();
    if (action === 'create-similar-position') {
        return createSimilarPosition(target.dataset.employeeId, target.dataset.fromPositionId);
    }
    if (action === 'use-equivalent-position') {
        return useEquivalentPosition(target.dataset.employeeId, target.dataset.fromPositionId, target.dataset.toPositionId);
    }
    if (action === 'review-other-issues') {
        const first = snapshot.otherIssues[0] || null;
        closeProjectReconciliation();
        if (first?.collection === 'positions') {
            window.openPuestosPersonal?.();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const id = first.record?.id || first.recordKey;
                if (id) window.openPositionForm?.(id);
            }));
        } else if (first?.collection === 'leaders') {
            window.openLideresPersonal?.();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const id = first.record?.id || first.recordKey;
                if (id) window.openLeaderForm?.(id);
            }));
        } else {
            window.changeTab?.('attendance');
        }
        return;
    }
    if (action === 'manage-person') {
        const row = selectedRows()[0] || null;
        if (!row?.id || selectedRows().length !== 1) return;
        closeProjectReconciliation();
        window.openEmpleadosPersonal?.();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.openEmployeeEditor?.(row.id);
        }));
        return;
    }
    if (action === 'toggle-all') {
        const allSelected = snapshot.employeeRows.length > 0
            && snapshot.employeeRows.every(row => modalState.selectedIds.has(row.id));
        modalState.selectedIds = allSelected
            ? new Set()
            : new Set(snapshot.employeeRows.map(row => row.id));
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        rerenderModal();
    }
}

function handleChange(event) {
    if (event.target?.name === 'r07-import-project') {
        importModalState.chosenProjectId = event.target.value;
        rerenderImportModal();
        return;
    }
    const selectId = event.target?.dataset?.r07Select;
    if (selectId !== undefined) {
        if (event.target.checked) {
            modalState.selectedIds.add(selectId);
        } else {
            modalState.selectedIds.delete(selectId);
            for (const key of Object.keys(modalState.positionRemaps || {})) {
                if (key.startsWith(String(selectId) + '::')) delete modalState.positionRemaps[key];
            }
            for (const key of Object.keys(modalState.positionCopies || {})) {
                if (key.startsWith(String(selectId) + '::')) delete modalState.positionCopies[key];
            }
        }
        rerenderModal();
        return;
    }
    if (event.target?.name === 'r07-recon-action') {
        modalState.action = event.target.value;
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        if (modalState.action === 'create') ensureCreateProjectId();
        rerenderModal();
        return;
    }
    if (event.target?.dataset?.r07Control === 'target-project') {
        modalState.targetProjectId = event.target.value;
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        rerenderModal();
        return;
    }
    if (event.target?.dataset?.r07PositionTarget !== undefined) {
        const employeeId = String(event.target.dataset.employeeId || '');
        const fromPositionId = String(event.target.dataset.fromPositionId || '');
        const key = positionRemapKey(employeeId, fromPositionId);
        const toPositionId = String(event.target.value || '');
        if (!toPositionId) {
            delete modalState.positionRemaps[key];
        } else {
            // Choosing an existing destination position replaces any queued
            // "similar position" copy for the same source.
            delete modalState.positionCopies[key];
            modalState.positionRemaps[key] = {
                employeeId,
                fromPositionId,
                toPositionId,
                migrateHistory: false
            };
        }
        rerenderModal();
        return;
    }

}

function handleInput(event) {
    if (event.target?.dataset?.r07Control !== 'create-name') return;
    modalState.createName = event.target.value;
    const duplicate = duplicateCreateProject();
    const input = event.target;
    const body = activeModal?.element?.querySelector('.modal-body');
    const error = body?.querySelector('#r07-create-project-error');
    const button = body?.querySelector('[data-r07-action="apply"]');
    const hint = body?.querySelector('.r07-recon-footer-hint');

    if (duplicate) {
        input.setAttribute('aria-invalid', 'true');
        if (error) {
            error.hidden = false;
            error.textContent = 'Ya existe una obra llamada "' + (duplicate.name || 'sin nombre')
                + '". Elige otro nombre o usa la obra existente.';
        }
    } else {
        input.removeAttribute('aria-invalid');
        if (error) {
            error.hidden = true;
            error.textContent = '';
        }
    }

    const preflight = currentPreflight();
    if (button) button.disabled = !canApply(preflight);
    if (hint) hint.textContent = resolutionHint(preflight);
}

async function refreshAndRenderIfChanged() {
    const before = signature(snapshot);
    await refreshProjectReconciliationSnapshot();
    if (before !== signature(snapshot) && typeof window?.render === 'function') {
        window.render();
    }
}

function queueRefresh() {
    setTimeout(() => refreshAndRenderIfChanged(), 0);
}

// ─── R07 Phase B — FULL import reconciliation (shared modal, import context) ──
// Note: create-project-in-import is deliberately NOT offered here. The FULL
// import operates on a pending clone of the backup; materializing a new project
// surface/manifest inside that clone risks projectBackup integrity. The safe,
// supported action is binding the LEGACY_UNSCOPED records to an existing valid
// imported project, or cancelling with zero mutation.
function importProjects() {
    return Array.isArray(importModalState.pending?.validProjects)
        ? importModalState.pending.validProjects
        : [];
}

function renderImportProjectChoices() {
    const projects = importProjects();
    if (!projects.length) {
        return '<div class="r07-recon-empty">El respaldo no declara obras válidas para elegir.</div>';
    }
    return projects.map(project => {
        const checked = importModalState.chosenProjectId === project.id;
        return '<label class="r07-recon-choice ' + (checked ? 'is-selected' : '') + '">'
            + '<input class="r07-recon-native-control" type="radio" name="r07-import-project" value="' + escapeHTML(project.id) + '"' + (checked ? ' checked' : '') + '>'
            + '<span class="r07-recon-choice-icon" aria-hidden="true">' + choiceIcon('map') + '</span>'
            + '<span class="r07-recon-choice-copy"><strong>' + escapeHTML(project.name || 'Obra sin nombre') + '</strong>'
            + '<small>' + escapeHTML(project.id) + '</small></span></label>';
    }).join('');
}

function importModalContent() {
    const pending = importModalState.pending || {};
    const count = pending.legacyUnscopedCount || 0;
    const projects = importProjects();
    const canApply = !importModalState.busy && projects.length > 0 && !!importModalState.chosenProjectId;
    const hint = importModalState.busy
        ? 'Importando datos…'
        : (!importModalState.chosenProjectId ? 'Selecciona una obra para continuar.' : '');
    return '<div class="r07-recon-shell">'
        + '<div class="r07-recon-kicker">IMPORTACIÓN FULL</div>'
        + '<div class="r07-recon-summary" aria-live="polite">'
        + '<div><strong>' + count + '</strong><span>registros sin obra</span></div>'
        + '<div><strong>' + projects.length + '</strong><span>obras válidas</span></div>'
        + '</div>'
        + '<fieldset class="r07-recon-section r07-recon-fieldset"><legend>Elige a qué obra pertenecen estos datos</legend>'
        + '<p class="r07-recon-hint">Solo se vincularán los registros sin obra asignada. El resto del respaldo se importa tal cual.</p>'
        + '<div class="r07-recon-choices">' + renderImportProjectChoices() + '</div></fieldset>'
        + (importModalState.message ? '<div class="r07-recon-message" role="status">' + escapeHTML(importModalState.message) + '</div>' : '')
        + '<div class="r07-recon-footer">'
        + '<button type="button" class="btn-secondary r07-recon-footer-btn r07-recon-footer-secondary" data-r07-import-action="cancel">Cancelar importación</button>'
        + '<div class="r07-recon-footer-hint" aria-live="polite">' + escapeHTML(hint) + '</div>'
        + '<button type="button" class="btn-primary r07-recon-footer-btn r07-recon-footer-primary" data-r07-import-action="apply"'
        + (canApply ? '' : ' disabled') + '>'
        + (importModalState.busy ? 'Importando…' : 'Asignar e importar')
        + '</button></div></div>';
}

export function buildImportReconciliationViewModel(pending) {
    if (!pending) return { available: false, legacyUnscopedCount: 0, validProjects: [] };
    return {
        available: true,
        legacyUnscopedCount: Number(pending.legacyUnscopedCount) || 0,
        validProjects: Array.isArray(pending.validProjects) ? pending.validProjects : [],
        defaultProjectId: pending.defaultProjectId || ''
    };
}

export function openImportReconciliation() {
    const pending = getPendingFullImport();
    if (!pending) return null;
    importModalState = initialImportModalState();
    importModalState.pending = pending;

    // Real FULL-import flow: keep the same overlay/shell and morph only its
    // content. Isolated tests without that shell retain the shared Modal path.
    if (typeof document !== 'undefined' && document.querySelector('.import-full-dialog')) {
        if (importModal?.isOpen) importModal.close();
        importModal = null;
        importEmbedded = true;
        showImportFullEmbeddedStage({
            title: 'Reconciliación de importación',
            subtitle: 'Asigna los datos sin obra antes de continuar.',
            content: importModalContent()
        });
        return { isOpen: true, embedded: true };
    }

    importEmbedded = false;
    if (importModal?.isOpen) importModal.close();
    importModal = new Modal({
        title: 'Reconciliación de importación',
        subtitle: 'Asigna los datos sin obra a una obra existente del respaldo antes de importar.',
        size: 'medium',
        content: importModalContent(),
        buttons: null,
        onClose() {
            importModal = null;
            cancelFullImportProjectChoice();
        }
    });
    importModal.open();
    return importModal;
}

export function closeImportReconciliation() {
    if (importEmbedded) {
        importEmbedded = false;
        closeImportFullModal();
        return;
    }
    importModal?.close();
    importModal = null;
}

function rerenderImportModal() {
    if (importEmbedded && isImportFullEmbeddedStageActive()) {
        const active = document.activeElement;
        const activeValue = active?.name === 'r07-import-project' ? active.value : null;
        updateImportFullEmbeddedContent(importModalContent());
        if (activeValue) {
            requestAnimationFrame(() => {
                document.querySelector(
                    '.import-full-dialog input[name="r07-import-project"][value="' + cssEscape(activeValue) + '"]'
                )?.focus?.();
            });
        }
        return;
    }

    if (!importModal?.element) return;
    const body = importModal.element.querySelector('.modal-body');
    if (!body) return;
    const active = document.activeElement;
    let focusTarget = null;
    if (active && body.contains(active) && active.name === 'r07-import-project') {
        focusTarget = () => body.querySelector('input[name="r07-import-project"][value="' + cssEscape(active.value) + '"]');
    }
    body.innerHTML = importModalContent();
    if (focusTarget) {
        const el = focusTarget();
        if (el) el.focus();
    }
}

async function applyImportChoice() {
    if (importModalState.busy || !importModalState.chosenProjectId) return;
    importModalState.busy = true;
    importModalState.message = '';
    rerenderImportModal();
    try {
        const result = await requestFullImportProjectChoice(importModalState.chosenProjectId);
        importModalState.busy = false;
        if (!result.ok) {
            importModalState.message = result.reason || 'No se pudo asignar la obra.';
            rerenderImportModal();
            return;
        }
        closeImportReconciliation();
    } catch (error) {
        console.error('Error en reconciliación de importación:', error);
        importModalState.busy = false;
        importModalState.message = error?.message || 'No se pudo completar la importación.';
        rerenderImportModal();
    }
}

function cancelImportChoice() {
    cancelFullImportProjectChoice();
    closeImportReconciliation();
}

export function registerProjectReconciliationGlobals() {
    if (registered || typeof window === 'undefined') return;
    registered = true;
    window.openProjectReconciliation = openProjectReconciliation;
    window.closeProjectReconciliation = closeProjectReconciliation;
    window.refreshProjectReconciliation = refreshProjectReconciliationSnapshot;
    window.openImportReconciliation = openImportReconciliation;
    window.closeImportReconciliation = closeImportReconciliation;
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    window.addEventListener('app:ready', queueRefresh);
    window.addEventListener('projects:setup-changed', queueRefresh);
    window.addEventListener('projects:created', queueRefresh);
    eventBus.on('data:saved', queueRefresh);
    window.addEventListener(FULL_IMPORT_RECONCILIATION_EVENT, () => openImportReconciliation());
}

export default {
    buildLocalReconciliationViewModel,
    refreshProjectReconciliationSnapshot,
    getProjectReconciliationSnapshot,
    renderProjectReconciliationBanner,
    renderProjectReconciliationSettingsAction,
    openProjectReconciliation,
    closeProjectReconciliation,
    buildImportReconciliationViewModel,
    openImportReconciliation,
    closeImportReconciliation,
    registerProjectReconciliationGlobals
};
