import indexedDBService from '../../services/IndexedDBService.js';
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
    previewOwnershipRepair,
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

const ACTIONABLE = new Set([CLASSIFICATION.LEGACY_UNSCOPED, CLASSIFICATION.EXPLICIT_ORPHAN, CLASSIFICATION.PENDING]);
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
        otherIssues: [], pettyCashRows: [], pettyCashProjects: [], pendingEmployeeCount: 0,
        totalPendingCount: 0, validEmployeeCount: 0, issueCount: 0
    };
}
function initialModalState() {
    return {
        step: 0, pettyCashIds: new Set(), leaderRemaps: {}, leaderCopies: {},
        selectedIds: new Set(), action: '', targetProjectId: '',
        createName: '', createProjectId: null,
        positionRemaps: {},
        positionCopies: {},
        entitySelectedIds: new Set(), entityTargetProjectId: '', entityBusy: false, entityMessage: '',
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
        cash: model.pettyCashRows.map(row => row.id),
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

    const projectIds = new Set(projects.map(project => String(project.id)));
    const pettyCashProjects = (Array.isArray(appState?.pettyCash?.projects) ? appState.pettyCash.projects : []).filter(record => record?.id);
    const pettyCashRows = pettyCashProjects.filter(record => !projectIds.has(String(record.officialProjectId || '').trim()));
    return {
        enabled: true,
        pettyCashRows, pettyCashProjects,
        projects,
        defaultProjectId,
        activeProjects: projects.filter(project => project?.status === PROJECT_STATUS.ACTIVE),
        employeeRows,
        otherIssues,
        pendingEmployeeCount: employeeRows.length,
        totalPendingCount: employeeRows.length + otherIssues.length + pettyCashRows.length,
        validEmployeeCount: employeeAnalysis.summary.counts[CLASSIFICATION.VALID] || 0,
        issueCount: analysis.summary.issueCount + pettyCashRows.length,
        analysis
    };
}

export async function refreshProjectReconciliationSnapshot() {
    const generation = ++refreshGeneration;
    let next = emptySnapshot();
    if (isProjectsEnabled()) {
        try {
            const setup = await projectSetupService.getState();
            await indexedDBService.init();
            const cash = await indexedDBService.getAll('pettyCashProjects');
            next = buildLocalReconciliationViewModel({ ...state,
                pettyCash: { ...(state.pettyCash || {}), projects: Array.isArray(cash) ? cash : (state.pettyCash?.projects || []) }
            }, setup);
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
    if (!snapshot.enabled || snapshot.totalPendingCount <= 0) return '';
    const n = snapshot.totalPendingCount;
    const title = n === snapshot.pendingEmployeeCount ? (n === 1 ? 'Empleado pendiente de asignación' : 'Empleados pendientes de asignación') : 'Datos pendientes de asignación';
    const ariaLabel = n !== snapshot.pendingEmployeeCount ? n + ' datos pendientes de asignación' : n + ' ' + (n === 1 ? 'empleado pendiente de asignación' : 'empleados pendientes de asignación');
    return '<section class="r07-recon-banner" aria-label="' + escapeHTML(ariaLabel) + '">'
        + '<span class="r07-recon-banner-count" aria-hidden="true">' + n + '</span>'
        + '<span class="r07-recon-banner-copy"><strong>' + escapeHTML(title) + '</strong>'
        + '<span>Revisa la obra de los datos pendientes.</span></span>'
        + '<button type="button" class="r07-recon-banner-action" data-app-fn="openProjectReconciliation">Revisar ' + n + ' ' + (n === 1 ? 'problema' : 'problemas') + '</button>'
        + '</section>';
}

export function renderProjectReconciliationSettingsAction() {
    if (!snapshot.enabled) return '';
    let html = '';
    if (snapshot.totalPendingCount <= 0) {
        html += '<div class="r07-recon-health-ok" role="status">'
            + '<span class="r07-recon-health-dot" aria-hidden="true"></span>'
            + '<span><strong>Asignación por obra al día</strong>'
            + '<small>No hay datos pendientes de asignación.</small></span></div>';
    } else {
        const n = snapshot.totalPendingCount;
        const title = n === snapshot.pendingEmployeeCount ? (n === 1 ? 'Revisar empleado pendiente de asignación' : 'Revisar empleados pendientes de asignación') : 'Revisar datos pendientes de asignación';
        html += '<button type="button" class="stg-action r07-recon-settings-action" data-settings-action="open-project-reconciliation" aria-label="' + n + ' ' + (n !== snapshot.pendingEmployeeCount ? 'datos pendientes de asignación' : (n === 1 ? 'empleado pendiente de asignación' : 'empleados pendientes de asignación')) + '">'
            + '<span class="r07-recon-settings-count" aria-hidden="true">' + n + '</span>'
            + '<span class="stg-action-copy"><strong>' + escapeHTML(title) + '</strong>'
            + '<small>Revisa la obra de los datos pendientes.</small></span></button>';
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

function selectedPositionRemapNeeds(includeAssigned = false) {
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
            if (position && (String(position.projectId || '') === target
                || (!includeAssigned && modalState.entitySelectedIds.has('positions:' + fromPositionId)))) continue;
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
    const leaderMap = modalState.leaderRemaps || {};
    const dependency = preflightDependencies({
        // Target-project position/leader dependencies apply only to employees
        // whose own ownership is being repaired. Attendance-only rows repair
        // related records while the employee remains in its valid project.
        employees: selectedEmployeesNeedingOwnershipRepair().map(employee => ({ ...employee,
            leaderId: leaderMap[employee.leaderId]?.toLeaderId || employee.leaderId })),
        allEmployees: state.employees || [],
        positions: (state.positions || []).map(item => ({ ...item,
            projectId: modalState.entitySelectedIds.has('positions:' + item.id) ? targetProjectId : item.projectId,
            leaderId: leaderMap[item.leaderId]?.toLeaderId || item.leaderId })),
        leaders: [...(state.leaders || []).map(item => modalState.entitySelectedIds.has('leaders:' + item.id)
            ? { ...item, projectId: targetProjectId } : item),
            ...Object.values(modalState.leaderCopies).map(item => ({ id: item.newLeaderId, name: item.name, projectId: targetProjectId, active: true }))],
        targetProjectId,
        positionRemaps: currentPositionRemaps(),
        positionCopies: currentPositionCopies()
    });
    if (!dependency.ok || modalState.step < 3) return dependency;
    const planned = previewOwnershipRepair({
        action: modalState.action === 'create' ? REPAIR_ACTION.CREATE_PROJECT_AND_MAP : REPAIR_ACTION.MAP_TO_EXISTING,
        employees: selectedEmployees(), allEmployees: state.employees || [],
        attendance: state.attendance || {}, positions: state.positions || [], leaders: state.leaders || [],
        pettyCashProjects: snapshot.pettyCashProjects, pettyCashIds: [...modalState.pettyCashIds],
        catalog: snapshot.projects, targetProjectId, projectId: modalState.createProjectId,
        projectName: modalState.createName.trim(), positionIds: selectedCatalogIds('positions'),
        leaderIds: selectedCatalogIds('leaders'), leaderRemaps: Object.values(modalState.leaderRemaps),
        leaderCopies: Object.values(modalState.leaderCopies), positionRemaps: currentPositionRemaps(),
        positionCopies: currentPositionCopies(), assignUnpositionedHistory: true
    });
    if (![REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP].includes(planned.status)) {
        return { ...dependency, ok: false, conflicts: planned.conflicts || [] };
    }
    return dependency;
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
        const refs = row.status === CLASSIFICATION.LEGACY_UNSCOPED
            ? 'Sin obra asignada'
            : (row.status === CLASSIFICATION.PENDING
                ? 'Pendiente de asignación'
                : (row.employeeIssue
                    ? 'Obra de origen no disponible'
                    : 'Asistencia vinculada a una obra no disponible'));
        const targetProject = modalState.action === 'map'
            ? snapshot.projects.find(project => String(project?.id || '') === String(modalState.targetProjectId || ''))
            : null;
        const readyTarget = checked && preflight.ok && targetProject
            ? String(targetProject.name || targetProject.id)
            : '';
        const statusText = readyTarget
            ? 'Listo para asignar a ' + readyTarget
            : (row.status === CLASSIFICATION.PENDING || row.status === CLASSIFICATION.LEGACY_UNSCOPED
                ? 'Pendiente'
                : (row.employeeIssue ? 'Obra no disponible' : 'Asistencia pendiente'));
        const statusClass = readyTarget
            ? 'r07-recon-status is-ready'
            : (row.status === CLASSIFICATION.PENDING || row.status === CLASSIFICATION.LEGACY_UNSCOPED
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
    const definition = [...(state.positions || []), ...(state.leaders || [])].find(item => item.id === conflict.entityId);
    const name = conflict.entityName || definition?.name || 'La relación';
    const messages = {
        CATALOG_POSITION_EMPLOYEE_PROJECT: 'El puesto "' + name + '" también lo usa un empleado fuera de esta selección. Inclúyelo si pertenece a esta obra o crea un puesto nuevo.',
        CATALOG_POSITION_ATTENDANCE_PROJECT: 'El puesto "' + name + '" tiene asistencia en otra obra. Usa un puesto de destino o crea uno nuevo.',
        CATALOG_POSITION_LEADER_PROJECT: 'Resuelve el líder del puesto "' + name + '" antes de continuar.',
        CATALOG_LEADER_POSITION_PROJECT: 'El líder "' + name + '" tiene puestos fuera de esta asignación. Incluye sus puestos sin obra o elige otro líder.',
        CATALOG_LEADER_EMPLOYEE_PROJECT: 'El líder "' + name + '" tiene empleados fuera de esta asignación. Inclúyelos o elige otro líder.',
        CATALOG_POSITION_STALE: 'El puesto "' + name + '" ya cambió de obra. Revisa su asignación.',
        CATALOG_LEADER_STALE: 'El líder "' + name + '" ya cambió de obra. Revisa su asignación.',
        POSITION_PROJECT_CONFLICT: 'El puesto "' + name + '" pertenece a otra obra.',
        SHARED_POSITION_CONFLICT: 'El puesto "' + name + '" también lo usan personas de otra obra y no puede moverse automáticamente.',
        UNRESOLVED_POSITION_OWNERSHIP: 'El puesto "' + name + '" todavía no tiene una obra válida asignada.',
        MISSING_POSITION_DEFINITION: 'No se encontró la definición del puesto "' + name + '".',
        POSITION_SPECIAL_SETTING_CONFLICT: 'Un empleado tiene sueldos o jornadas especiales distintos en puestos que intentas unir. Selecciona puestos destino distintos para conservar ambos valores.',
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
    if (!['map', 'create'].includes(modalState.action)) return renderDependencyBlocker(preflight);
    const targetProjectId = currentTargetProjectId();
    if (!targetProjectId) return renderDependencyBlocker(preflight);
    const needs = selectedPositionRemapNeeds(true);
    if (!needs.length) return renderDependencyBlocker(preflight);
    const targetPositions = targetPositionsForProject(targetProjectId);
    const targetProject = snapshot.projects.find(p => String(p?.id || '') === String(targetProjectId));
    const targetName = targetProject?.name || (modalState.action === 'create' ? modalState.createName.trim() : targetProjectId);
    const remainingConflicts = (preflight.conflicts || []).filter(conflict => !POSITION_DEPENDENCY_KINDS.has(conflict.kind));
    const groups = new Map();
    for (const need of needs) {
        const key = String(need.fromPositionId);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(need);
    }
    let html = '<section class="r07-position-remap" aria-labelledby="r07-position-remap-title">'
        + '<div class="r07-position-remap-head"><div><strong id="r07-position-remap-title">Resuelve los puestos</strong>'
        + '<span>Una decisión por puesto se aplicará a todas las personas seleccionadas que lo usan.</span></div>'
        + '<span class="r07-position-remap-project">' + escapeHTML(targetName) + '</span></div>';
    html += [...groups].map(([fromPositionId, members], index) => {
        const first = members[0];
        const selected = modalState.positionRemaps[positionRemapKey(first.employeeId, fromPositionId)] || {};
        const copyEntry = modalState.positionCopies[positionRemapKey(first.employeeId, fromPositionId)] || null;
        const assigned = modalState.entitySelectedIds.has('positions:' + fromPositionId);
        const sourceUnscoped = first.fromPosition && !snapshot.projects.some(project => project.id === first.fromPosition.projectId);
        const sourceName = first.fromPosition?.name || 'Puesto no disponible';
        const equivalent = findEquivalentDestinationPosition(sourceName, targetPositions);
        const options = targetPositions.map(position =>
            '<option value="' + escapeHTML(position.id) + '"'
            + (String(selected.toPositionId || '') === String(position.id) ? ' selected' : '') + '>'
            + escapeHTML(position.name || position.id) + '</option>'
        ).join('');
        const totalDays = members.reduce((sum, item) => sum + (item.audit?.count || 0), 0);
        const totalHours = members.reduce((sum, item) => sum + (item.audit?.totalHours || 0), 0);
        const impact = totalDays ? totalDays + ' días · ' + totalHours + 'h' : 'Sin días registrados con este puesto';
        const selectId = 'r07-remap-target-' + index;
        let similarAction = '';
        if (copyEntry) {
            similarAction = '<span class="r07-position-similar-note is-queued">Se creará el puesto "'
                + escapeHTML(copyEntry.name || copyEntry.newPositionId) + '" en esta obra.</span>';
        } else if (equivalent) {
            similarAction = '<span class="r07-position-similar-note">Ya existe un puesto equivalente: <strong>'
                + escapeHTML(equivalent.name || equivalent.id) + '</strong>.</span>'
                + '<button type="button" class="btn-secondary r07-recon-note-action"'
                + ' data-r07-action="use-equivalent-position" data-from-position-id="' + escapeHTML(fromPositionId) + '"'
                + ' data-to-position-id="' + escapeHTML(equivalent.id) + '">Usar este puesto</button>';
        } else {
            similarAction = '<button type="button" class="btn-secondary r07-recon-note-action"'
                + ' data-r07-action="create-similar-position" data-from-position-id="' + escapeHTML(fromPositionId)
                + '">Crear puesto</button>';
        }
        if (equivalent && !copyEntry) {
            similarAction += '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="create-similar-position" data-from-position-id="'
                + escapeHTML(fromPositionId) + '">Crear puesto</button>';
        }
        if (copyEntry) {
            similarAction += '<div class="r07-recon-control"><label for="r07-copy-name-' + index + '">Nombre del nuevo puesto</label>'
                + '<input id="r07-copy-name-' + index + '" type="text" maxlength="100" data-r07-position-name="' + escapeHTML(fromPositionId)
                + '" value="' + escapeHTML(copyEntry.name) + '"></div>';
        }
        return '<div class="r07-position-remap-card">'
            + '<div class="r07-position-remap-person"><strong>' + escapeHTML(sourceName) + '</strong>'
            + '<span>' + members.length + (members.length === 1 ? ' empleado' : ' empleados') + '</span>'
            + ((assigned || selected.toPositionId) ? '<span class="r07-wizard-resolved" role="img" aria-label="Resuelto">' + checkSvg() + '</span>' : '') + '</div>'
            + (sourceUnscoped ? '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="assign-source-position" data-from-position-id="' + escapeHTML(fromPositionId) + '" aria-pressed="' + assigned + '">' + (assigned ? 'Asignado a esta obra' : 'Asignar a esta obra') + '</button>' : '')
            + '<div class="r07-recon-control"><label for="' + selectId + '">Puesto en la obra destino</label>'
            + '<select id="' + selectId + '" data-r07-position-target data-from-position-id="' + escapeHTML(fromPositionId) + '"'
            + (targetPositions.length ? '' : ' disabled') + '>'
            + '<option value="">Selecciona un puesto</option>' + options + '</select></div>'
            + '<div class="r07-position-remap-similar">' + similarAction + '</div>'
            + '<div class="r07-position-remap-impact is-preserved"><strong>Asistencia</strong><span>' + escapeHTML(impact) + '</span>'
            + '<small>Se conservan horas y sueldos especiales de cada empleado.</small></div>'
            + '</div>';
    }).join('');
    html += '</section>';
    if (remainingConflicts.length) html += renderDependencyBlocker({ ok: false, conflicts: remainingConflicts });
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
            + ' se asociará' + (orphanAttendance.length === 1 ? '' : 'n') + ' a ' + targetName + '.'
        );
    }
    if (positionLines.length) {
        updateItems.push('Puesto: ' + [...new Set(positionLines)].join(', ') + '.');
    }
    for (const collection of ['leaders', 'positions']) {
        const names = (state[collection] || []).filter(item => modalState.entitySelectedIds.has(collection + ':' + item.id))
            .map(item => item.name || 'Sin nombre');
        if (names.length) updateItems.push((collection === 'leaders' ? 'Líderes' : 'Puestos') + ' que se asignarán: ' + names.join(', ') + '.');
    }
    for (const remap of Object.values(modalState.leaderRemaps)) {
        const source = (state.leaders || []).find(item => item.id === remap.fromLeaderId);
        const target = (state.leaders || []).find(item => item.id === remap.toLeaderId);
        const copy = modalState.leaderCopies[remap.fromLeaderId];
        updateItems.push('Líder: ' + (source?.name || 'Sin nombre') + ' → ' + (copy?.name || target?.name || 'Sin nombre') + (copy ? ' (nuevo).' : '.'));
    }
    const unpositionedDays = attendanceEntries.filter(([, record]) =>
        employeeOwnershipRows.some(row => String(row.id) === String(record?.employeeId))
        && record?.present === true && record?.deletedAt == null && !record?.selectedPosition
        && (!record?.projectId || !catalogProjectNames.has(String(record.projectId))
            || String(record.projectId) === String(targetProjectId))
    ).length;
    if (unpositionedDays) {
        updateItems.push(unpositionedDays + ' día(s) sin puesto explícito se asignarán al primer puesto resultante de cada empleado; se conservarán sus horas.');
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
            + ' en otras obras se conservará' + (preservedValidOtherProjectAttendance.length === 1 ? '' : 'n') + '.'
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
    if (modalState.busy || (!modalState.selectedIds.size && !modalState.entitySelectedIds.size && !modalState.pettyCashIds.size) || !modalState.action) return false;
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
            ;
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
            ;
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
    const remainingIssues = snapshot.otherIssues.filter(issue => !['positions', 'leaders'].includes(issue.collection));
    if (!remainingIssues.length) return '';
    const rows = remainingIssues.slice(0, 4).map(issue =>
        '<li>' + escapeHTML(otherIssueLabel(issue)) + '</li>'
    ).join('');
    const remaining = remainingIssues.length - Math.min(remainingIssues.length, 4);
    return '<section class="r07-recon-note r07-recon-other-issues">'
        + '<strong>' + remainingIssues.length + ' ' + (remainingIssues.length === 1 ? 'registro adicional requiere revisión' : 'registros adicionales requieren revisión') + '</strong>'
        + '<span>No se modificarán automáticamente. Revisa su obra antes de continuar con esos registros.</span>'
        + '<ul class="r07-recon-note-list">' + rows
        + (remaining > 0 ? '<li>Y ' + remaining + ' más</li>' : '') + '</ul>'
        + '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="review-other-issues">Revisar</button>'
        + '</section>';
}

function catalogIssues() {
    return snapshot.otherIssues.filter(issue => ['positions', 'leaders'].includes(issue.collection));
}

function catalogIssueKey(issue) {
    return issue.collection + ':' + String(issue.record?.id || issue.recordKey || '');
}

function renderCatalogIssues(collection = 'positions') {
    const used = new Set(selectedPositionRemapNeeds(true).map(item => item.fromPositionId));
    const issues = catalogIssues().filter(issue => issue.collection === collection
        && !(collection === 'positions' && used.has(String(issue.record?.id))));
    if (!issues.length) return '';
    return '<section class="r07-recon-section"><h3>Otros puestos sin obra</h3>'
        + '<p class="r07-recon-hint">Puedes incluirlos en esta asignación.</p>'
        + issues.map(issue => {
            const key = catalogIssueKey(issue);
            const checked = modalState.entitySelectedIds.has(key);
            return '<label class="r07-recon-choice ' + (checked ? 'is-selected' : '') + '">'
                + '<input type="checkbox" data-r07-entity-select="' + escapeHTML(key) + '"' + (checked ? ' checked' : '') + '>'
                + '<span class="r07-recon-choice-copy"><strong>' + escapeHTML(otherIssueLabel(issue)) + '</strong>'
                + '<small>' + (checked ? 'Se asignará a esta obra' : 'Sin obra válida') + '</small></span></label>';
        }).join('') + '</section>';
}

function leaderNeeds() {
    const ids = new Set();
    for (const employee of selectedEmployeesNeedingOwnershipRepair()) {
        if (employee.leaderId) ids.add(String(employee.leaderId));
        for (const id of [...(employee.positions || []), employee.positionId].filter(Boolean)) {
            const position = (state.positions || []).find(item => String(item.id) === String(id));
            if (position?.leaderId) ids.add(String(position.leaderId));
        }
    }
    const target = currentTargetProjectId();
    return (state.leaders || []).filter(leader => String(leader.projectId || '') !== target
        && (ids.has(String(leader.id)) || catalogIssues().some(issue => issue.collection === 'leaders'
            && String(issue.record?.id) === String(leader.id))))
        .map(leader => ({ leader, required: ids.has(String(leader.id)) }));
}

function leaderResolved(id) {
    return modalState.entitySelectedIds.has('leaders:' + id) || !!modalState.leaderRemaps[id]?.toLeaderId;
}

function renderLeaderChoices() {
    const needs = leaderNeeds();
    if (!needs.length) return '<div class="r07-recon-empty">Los líderes ya están listos.</div>';
    const destinations = (state.leaders || []).filter(leader => leader.active !== false
        && String(leader.projectId || '') === currentTargetProjectId());
    return needs.map(({ leader, required }, index) => {
        const assigned = modalState.entitySelectedIds.has('leaders:' + leader.id);
        const chosen = modalState.leaderRemaps[leader.id]?.toLeaderId || '';
        const copy = modalState.leaderCopies[leader.id];
        const unscoped = !snapshot.projects.some(project => project.id === leader.projectId);
        return '<section class="r07-position-remap-card">'
            + '<div class="r07-position-remap-person"><strong>' + escapeHTML(leader.name || 'Líder sin nombre') + '</strong>'
            + '<span>' + (required ? 'Relacionado con los empleados seleccionados' : 'Sin obra · inclusión opcional') + '</span>'
            + (leaderResolved(leader.id) ? '<span class="r07-wizard-resolved" role="img" aria-label="Resuelto">' + checkSvg() + '</span>' : '') + '</div>'
            + (unscoped ? '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="assign-source-leader" data-leader-id="' + escapeHTML(leader.id)
                + '" aria-pressed="' + assigned + '">' + (assigned ? 'Asignado a esta obra' : 'Asignar a esta obra') + '</button>' : '')
            + '<div class="r07-recon-control"><label for="r07-leader-' + index + '">Usar un líder de esta obra</label>'
            + '<select id="r07-leader-' + index + '" data-r07-leader-target="' + escapeHTML(leader.id) + '"><option value="">Selecciona un líder</option>'
            + destinations.map(item => '<option value="' + escapeHTML(item.id) + '"' + (chosen === item.id ? ' selected' : '') + '>' + escapeHTML(item.name) + '</option>').join('')
            + '</select></div>'
            + (copy ? '<div class="r07-recon-control"><label for="r07-new-leader-' + index + '">Nombre del nuevo líder</label><input id="r07-new-leader-' + index
                + '" type="text" maxlength="100" data-r07-leader-name="' + escapeHTML(leader.id) + '" value="' + escapeHTML(copy.name) + '"></div>'
                : '<button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="create-leader" data-leader-id="' + escapeHTML(leader.id) + '">Crear líder</button>')
            + '</section>';
    }).join('');
}

const WIZARD_STEPS = ['Obra', 'Datos', 'Líderes', 'Puestos', 'Resumen'];

function wizardHint(preflight) {
    if (modalState.busy) return 'Guardando cambios…';
    if (modalState.step === 0) {
        if (!modalState.action) return 'Elige una obra existente o crea una nueva.';
        if (modalState.action === 'map' && !modalState.targetProjectId) return 'Selecciona una obra.';
        if (modalState.action === 'create' && !modalState.createName.trim()) return 'Escribe el nombre de la obra.';
        if (modalState.action === 'create' && duplicateCreateProject()) return 'Ya existe una obra con ese nombre.';
        return '';
    }

    if (modalState.step === 2 && leaderNeeds().some(({ leader, required }) => required && !leaderResolved(leader.id))) return 'Resuelve los líderes relacionados para continuar.';
    if (Object.values(modalState.leaderCopies).some(copy => !copy.name.trim())) return 'Escribe el nombre del nuevo líder.';
    if (modalState.step >= 3 && currentPositionCopies().some(copy => !copy.name.trim())) return 'Escribe el nombre del nuevo puesto.';
    if (modalState.step >= 3 && !preflight.ok) return 'Revisa las relaciones pendientes para continuar.';
    if (modalState.step === 4 && !canApply(preflight)) return 'Selecciona personas, puestos, líderes o cajas para asignar.';
    return '';
}

function quickAssignAll() {
    if (modalState.busy || modalState.step !== 0 || wizardHint(currentPreflight())) return;
    modalState.selectedIds = new Set(snapshot.employeeRows.map(row => row.id));
    modalState.entitySelectedIds = new Set(catalogIssues().map(catalogIssueKey));
    modalState.pettyCashIds = new Set(snapshot.pettyCashRows.map(record => record.id));
    modalState.positionRemaps = {};
    modalState.positionCopies = {};
    modalState.leaderRemaps = {};
    modalState.leaderCopies = {};
    // Preview every relationship before allowing the final confirmation.
    modalState.step = 4;
    const preflight = currentPreflight();
    const unresolvedLeaders = leaderNeeds().some(({ leader, required }) => required && !leaderResolved(leader.id));
    if (!preflight.ok || unresolvedLeaders) {
        modalState.step = unresolvedLeaders ? 2 : 3;
        modalState.message = 'Hay relaciones que necesitan una elección. Revisa las indicadas para continuar.';
    } else {
        modalState.message = '';
    }
    rerenderModal();
    activeModal?.element?.querySelector('#r07-wizard-title')?.focus();
}

function changeWizardStep(direction) {
    if (modalState.busy || (direction > 0 && wizardHint(currentPreflight()))) return;
    let next = modalState.step + direction;
    while (next > 0 && next < 4 && (
        (next === 1 && !snapshot.employeeRows.length && !snapshot.pettyCashRows.length)
        || (next === 2 && !leaderNeeds().length)
        || (next === 3 && !selectedPositionRemapNeeds(true).length
            && !catalogIssues().some(issue => issue.collection === 'positions'))
    )) next += direction;
    modalState.step = Math.max(0, Math.min(4, next));
    modalState.message = '';
    const shell = activeModal?.element?.querySelector('.modal-container');
    const from = shell?.getBoundingClientRect();
    rerenderModal();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (shell?.animate && from && !reduced) {
        const to = shell.getBoundingClientRect();
        shell.animate([{ height: from.height + 'px' }, { height: to.height + 'px' }],
            { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    const body = activeModal?.element?.querySelector('.modal-body');
    const content = body?.querySelector('.r07-wizard-content');
    if (content) content.scrollTop = 0;
    activeModal?.element?.querySelector('#r07-wizard-title')?.focus();
}

function renderCashChoices() {
    if (!snapshot.pettyCashRows.length) return '';
    return '<fieldset class="r07-recon-fieldset"><legend>Caja chica sin obra</legend>'
        + '<p class="r07-recon-hint">Cada caja conserva sus períodos, movimientos y comprobantes.</p>'
        + snapshot.pettyCashRows.map(record => '<label class="r07-recon-person">'
            + '<input type="checkbox" id="r07-cash-' + escapeHTML(record.id) + '" data-r07-cash-id="' + escapeHTML(record.id) + '"'
            + (modalState.pettyCashIds.has(record.id) ? ' checked' : '') + '>'
            + '<span><strong>' + escapeHTML(record.name || 'Caja sin nombre') + '</strong></span></label>').join('')
        + '</fieldset>';
}

function modalContent() {
    const preflight = currentPreflight();
    const step = modalState.step;
    const allSelected = snapshot.employeeRows.length > 0 && snapshot.employeeRows.every(row => modalState.selectedIds.has(row.id));
    const selectedCatalog = selectedCatalogIds('positions').length + selectedCatalogIds('leaders').length;
    const stages = [
        '<fieldset class="r07-recon-fieldset"><legend>Elige la obra de destino</legend><div class="r07-recon-choices">'
            + renderChoice('map', 'Usar una obra existente', 'Asigna los datos a una obra activa.')
            + renderChoice('create', 'Crear una obra', 'Define el nombre de la nueva obra.')
            + '</div>' + renderActionControl(preflight) + '</fieldset>'
            + '<div class="r07-wizard-quick"><button type="button" class="btn-secondary r07-recon-note-action" data-r07-action="quick-assign"'
            + (wizardHint(preflight) ? ' disabled' : '') + '>Asignar todo a esta obra</button>'
            + '<small>Incluye los datos pendientes y revisa el resumen antes de guardar.</small></div>',
        '<div class="r07-recon-section-head"><p>' + modalState.selectedIds.size + ' empleados seleccionados</p>'
            + '<button type="button" class="r07-recon-link-button" data-r07-action="toggle-all">' + (allSelected ? 'Deseleccionar todos' : 'Seleccionar todos')
            + '</button></div><div class="r07-recon-people">' + renderPersonRows(preflight) + '</div>' + renderPersonnelManagementLink() + renderCashChoices(),
        renderLeaderChoices(),
        renderPositionRemapControls(preflight) + renderCatalogIssues('positions'),
        '<div class="r07-recon-summary"><div><strong>' + modalState.selectedIds.size + '</strong><span>empleados</span></div>'
            + '<div><strong>' + selectedCatalog + '</strong><span>puestos y líderes asignados</span></div>'
            + '<div><strong>' + (new Set(currentPositionCopies().map(copy => copy.newPositionId)).size + Object.keys(modalState.leaderCopies).length) + '</strong><span>registros nuevos</span></div></div>'
            + '<div class="r07-preflight-destiny"><span>Obra destino</span><strong>' + escapeHTML(snapshot.projects.find(project => project.id === currentTargetProjectId())?.name || modalState.createName.trim()) + '</strong></div>'
            + '<details class="r07-wizard-details"><summary>Ver decisiones y datos conservados</summary>' + renderPreflightSummary(preflight) + '</details>'
            + renderOtherIssuesNote()
            + (modalState.pettyCashIds.size ? '<p class="r07-recon-hint">' + modalState.pettyCashIds.size + ' cajas seleccionadas. Se conservan períodos, movimientos y comprobantes.</p>' : '')
            + '<p class="r07-recon-hint">Se guardarán todas las decisiones juntas. Se conservan los sueldos especiales, las horas y los préstamos.</p>'
    ];
    const hints = ['Elige dónde quedarán los datos.', 'Selecciona personas y cajas de esta obra.',
        'Resuelve cada líder una sola vez.', 'Una decisión por puesto para todos sus empleados.', 'Revisa las decisiones antes de guardar.'];
    const hint = wizardHint(preflight);
    return '<div class="r07-recon-shell r07-wizard" aria-busy="' + modalState.busy + '">'
        + '<div class="r07-wizard-content"><nav aria-label="Progreso de asignación"><ol class="r07-wizard-steps">'
        + WIZARD_STEPS.map((name, index) => '<li' + (index === step ? ' aria-current="step"' : '')
            + ' class="' + (index < step ? 'is-complete' : '') + '"><span>' + (index + 1) + '</span><small>' + name + '</small></li>').join('')
        + '</ol><progress max="5" value="' + (step + 1) + '" aria-label="Paso ' + (step + 1) + ' de 5"></progress></nav>'
        + '<div class="r07-wizard-heading"><span class="r07-recon-kicker">PASO ' + (step + 1) + ' DE 5</span>'
        + '<h2 id="r07-wizard-title" tabindex="-1">' + WIZARD_STEPS[step] + '</h2><p>' + hints[step] + '</p></div>'
        + stages.map((content, index) => '<section data-r07-step="' + index + '"' + (index !== step ? ' hidden' : '') + '>' + content + '</section>').join('')
        + (modalState.message ? '<div class="r07-recon-message" role="status">' + escapeHTML(modalState.message) + '</div>' : '')
        + '</div><div class="r07-recon-footer">'
        + '<button type="button" class="btn-secondary r07-recon-footer-btn" data-r07-action="' + (step ? 'wizard-back' : 'close') + '"' + (modalState.busy ? ' disabled' : '') + '>' + (step ? 'Atrás' : 'Cancelar') + '</button>'
        + '<div class="r07-recon-footer-hint" aria-live="polite">' + escapeHTML(hint) + '</div>'
        + '<button type="button" class="btn-primary r07-recon-footer-btn" data-r07-action="wizard-next"' + (step === 4 ? ' hidden' : '') + (hint || modalState.busy ? ' disabled' : '') + '>Continuar</button>'
        + '<button type="button" class="btn-primary r07-recon-footer-btn" data-r07-action="apply"' + (step !== 4 ? ' hidden' : '') + (!canApply(preflight) || hint || modalState.busy ? ' disabled' : '') + '>' + (modalState.busy ? 'Aplicando…' : 'Aplicar todo') + '</button>'
        + '</div></div>';
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
    const scrollTop = body.querySelector('.r07-wizard-content')?.scrollTop || 0;
    const focusId = active?.id;
    const genericAction = active?.getAttribute?.('data-r07-action');
    const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
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
            focusTarget = () => body.querySelector('[data-r07-position-target][data-from-position-id="' + cssEscape(from) + '"]');
        } else if (active.dataset?.r07Action === 'toggle-all') {
            focusTarget = () => body.querySelector('[data-r07-action="toggle-all"]');
        } else if (active.dataset?.r07Action === 'create-similar-position'
            || active.dataset?.r07Action === 'use-equivalent-position') {
            const employeeId = active.dataset.employeeId || '';
            const fromPositionId = active.dataset.fromPositionId || '';
            focusTarget = () => {
                const positionTarget = body.querySelector(
                    '[data-r07-position-target][data-from-position-id="' + cssEscape(fromPositionId) + '"]'
                );
                if (positionTarget && !positionTarget.disabled) return positionTarget;
                return body.querySelector('[data-r07-action="apply"]:not([disabled])')
                    || body.querySelector('[data-r07-action="close"]');
            };
        }
    }
    body.innerHTML = modalContent();
    const el = focusTarget?.() || (focusId ? body.querySelector('#' + cssEscape(focusId)) : null)
        || (genericAction ? body.querySelector('[data-r07-action="' + cssEscape(genericAction) + '"]:not([hidden])') : null);
    el?.focus();
    if (selection && el?.setSelectionRange && selection[0] !== null) {
        try { el.setSelectionRange(...selection); } catch (_) {}
    }
    const scrollArea = body.querySelector('.r07-wizard-content');
    if (scrollArea) scrollArea.scrollTop = scrollTop;
}

export async function openProjectReconciliation({ onClose } = {}) {
    await refreshProjectReconciliationSnapshot();
    modalState = initialModalState();
    modalState.selectedIds = new Set(snapshot.employeeRows.map(row => row.id));
    if (activeModal?.isOpen) activeModal.close();
    const hasEmployeeFlow = snapshot.employeeRows.length > 0;
    activeModal = new Modal({
        title: 'Asignar datos a una obra',
        subtitle: 'Organiza los datos pendientes de tu obra.',
        size: 'large',
        content: modalContent(),
        buttons: null,
        onClose() {
            if (!this._previouslyFocused?.isConnected) {
                const fallback = currentReconciliationFocusFallback(this);
                if (fallback) this._previouslyFocused = fallback;
            }
            activeModal = null;
            onClose?.();
        }
    });
    activeModal.open();
    activeModal.element.querySelector('.modal-container')?.classList.add('r07-wizard-modal');
    activeModal.element.addEventListener('keydown', event => {
        if (modalState.busy) {
            if (event.key === 'Escape') event.stopPropagation();
            return;
        }
        if (event.key === 'Escape' && modalState.step > 0) {
            event.preventDefault();
            event.stopPropagation();
            changeWizardStep(-1);
        } else if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) {
            if (event.key === 'ArrowRight' && modalState.step < 4) {
                event.preventDefault();
                changeWizardStep(1);
            } else if (event.key === 'ArrowLeft' && modalState.step > 0) {
                event.preventDefault();
                changeWizardStep(-1);
            }
        }
    });
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
    if ((!employees.length && !modalState.entitySelectedIds.size && !modalState.pettyCashIds.size) || !modalState.action) return;
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
            catalog: snapshot.projects,
            pettyCashIds: [...modalState.pettyCashIds],
            leaderRemaps: Object.values(modalState.leaderRemaps),
            leaderCopies: Object.values(modalState.leaderCopies)
        };
        let params;
        if (appliedAction === 'map') {
            params = {
                ...base,
                action: REPAIR_ACTION.MAP_TO_EXISTING,
                targetProjectId: modalState.targetProjectId,
                positionRemaps: currentPositionRemaps(),
                positionCopies: currentPositionCopies(),
                assignUnpositionedHistory: true,
                positionIds: selectedCatalogIds('positions'), leaderIds: selectedCatalogIds('leaders')
            };
        } else if (appliedAction === 'create') {
            params = {
                ...base,
                action: REPAIR_ACTION.CREATE_PROJECT_AND_MAP,
                projectId: ensureCreateProjectId(),
                projectName: modalState.createName.trim(),
                positionRemaps: currentPositionRemaps(),
                positionCopies: currentPositionCopies(),
                assignUnpositionedHistory: true,
                positionIds: selectedCatalogIds('positions'), leaderIds: selectedCatalogIds('leaders')
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
        modalState.step = 0;
        modalState.leaderRemaps = {};
        modalState.leaderCopies = {};
        modalState.action = '';
        modalState.targetProjectId = '';
        modalState.createName = '';
        modalState.createProjectId = null;
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        modalState.entitySelectedIds = new Set();
        modalState.selectedIds = new Set(snapshot.employeeRows.map(row => row.id));

        if ((snapshot.pendingEmployeeCount === 0 && !catalogIssues().length) || appliedAction === 'later') {
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

function setGroupPosition(fromPositionId, toPositionId, copy = null) {
    if (!fromPositionId || modalState.busy) return;
    modalState.entitySelectedIds.delete('positions:' + fromPositionId);
    for (const need of selectedPositionRemapNeeds().filter(item => item.fromPositionId === fromPositionId)) {
        const key = positionRemapKey(need.employeeId, fromPositionId);
        if (copy) modalState.positionCopies[key] = { ...copy };
        else delete modalState.positionCopies[key];
        if (toPositionId) {
            modalState.positionRemaps[key] = {
                employeeId: String(need.employeeId), fromPositionId: String(fromPositionId),
                toPositionId: String(toPositionId), migrateHistory: true
            };
        } else delete modalState.positionRemaps[key];
    }
    rerenderModal();
}

function selectedCatalogIds(collection) {
    return catalogIssues().filter(issue => issue.collection === collection
        && modalState.entitySelectedIds.has(catalogIssueKey(issue)))
        .map(issue => issue.record?.id).filter(Boolean);
}

async function applyCatalogResolution() {
    if (modalState.entityBusy || !modalState.entityTargetProjectId || !modalState.entitySelectedIds.size) return;
    const selected = catalogIssues().filter(issue => modalState.entitySelectedIds.has(catalogIssueKey(issue)));
    modalState.entityBusy = true;
    modalState.entityMessage = '';
    rerenderModal();
    try {
        const result = await applyOwnershipRepair({
            action: REPAIR_ACTION.MAP_CATALOG_ENTITIES,
            employees: [], targetProjectId: modalState.entityTargetProjectId,
            positionIds: selected.filter(issue => issue.collection === 'positions').map(issue => issue.record?.id),
            leaderIds: selected.filter(issue => issue.collection === 'leaders').map(issue => issue.record?.id)
        });
        if (result.status !== REPAIR_STATUS.OK) {
            modalState.entityMessage = result.conflicts?.length
                ? 'Hay relaciones con empleados, puestos o asistencias de otra obra. Resuelve esas relaciones antes de asignar este grupo.'
                : (result.reason || 'No se pudo asignar la selección.');
        } else {
            invalidateAllStats();
            await refreshProjectReconciliationSnapshot();
            modalState.entitySelectedIds = new Set();
            window.render?.();
            window.showNotification?.('Puestos y líderes asignados a la obra.', 'success');
        }
    } catch (error) {
        modalState.entityMessage = error?.message || 'No se pudo guardar la asignación.';
    } finally {
        modalState.entityBusy = false;
        if (activeModal?.isOpen) rerenderModal();
    }
}

function createSimilarPosition(_employeeId, fromPositionId) {
    if (!fromPositionId || modalState.busy) return;
    const source = (state.positions || []).find(p => String(p?.id || '') === String(fromPositionId));
    const sourceName = source?.name || fromPositionId;
    const queued = findQueuedSimilarCopy(fromPositionId, sourceName);
    const newPositionId = queued ? queued.newPositionId : generateUUID();
    setGroupPosition(fromPositionId, newPositionId, {
        fromPositionId: String(fromPositionId), newPositionId, name: sourceName
    });
}

function useEquivalentPosition(_employeeId, fromPositionId, toPositionId) {
    setGroupPosition(fromPositionId, toPositionId);
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
    if (modalState.busy) return;
    if (action === 'quick-assign') return quickAssignAll();
    if (action === 'wizard-next') return changeWizardStep(1);
    if (action === 'wizard-back') return changeWizardStep(-1);
    if (action === 'assign-source-position') {
        const id = target.dataset.fromPositionId;
        setGroupPosition(id, '');
        modalState.entitySelectedIds.add('positions:' + id);
        rerenderModal();
        return;
    }
    if (action === 'assign-source-leader' || action === 'create-leader') {
        const id = target.dataset.leaderId;
        delete modalState.leaderRemaps[id];
        delete modalState.leaderCopies[id];
        modalState.entitySelectedIds.delete('leaders:' + id);
        if (action === 'assign-source-leader') {
            modalState.entitySelectedIds.add('leaders:' + id);
        } else {
            const leader = (state.leaders || []).find(item => item.id === id);
            const newLeaderId = generateUUID();
            modalState.leaderCopies[id] = { fromLeaderId: id, newLeaderId, name: leader?.name || '' };
            modalState.leaderRemaps[id] = { fromLeaderId: id, toLeaderId: newLeaderId };
        }
        rerenderModal();
        return;
    }
    if (action === 'close') return closeProjectReconciliation();
    if (action === 'apply') return applyLocalResolution();
    if (action === 'create-similar-position') {
        return createSimilarPosition(target.dataset.employeeId, target.dataset.fromPositionId);
    }
    if (action === 'use-equivalent-position') {
        return useEquivalentPosition(target.dataset.employeeId, target.dataset.fromPositionId, target.dataset.toPositionId);
    }
    if (action === 'catalog-toggle-all') {
        const issues = catalogIssues();
        const all = issues.every(issue => modalState.entitySelectedIds.has(catalogIssueKey(issue)));
        modalState.entitySelectedIds = all ? new Set() : new Set(issues.map(catalogIssueKey));
        rerenderModal();
        return;
    }
    if (action === 'catalog-apply') return applyCatalogResolution();
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
    if (event.target?.dataset?.r07CashId) {
        if (modalState.busy) return;
        const id = event.target.dataset.r07CashId;
        if (event.target.checked) modalState.pettyCashIds.add(id);
        else modalState.pettyCashIds.delete(id);
        rerenderModal();
        return;
    }
    if (activeModal?.isOpen && modalState.busy) return;
    if (event.target?.dataset?.r07LeaderTarget !== undefined) {
        const id = event.target.dataset.r07LeaderTarget;
        modalState.entitySelectedIds.delete('leaders:' + id);
        delete modalState.leaderCopies[id];
        if (event.target.value) modalState.leaderRemaps[id] = { fromLeaderId: id, toLeaderId: event.target.value };
        else delete modalState.leaderRemaps[id];
        rerenderModal();
        return;
    }
    if (event.target?.name === 'r07-import-project') {
        importModalState.chosenProjectId = event.target.value;
        rerenderImportModal();
        return;
    }
    const entityKey = event.target?.dataset?.r07EntitySelect;
    if (entityKey !== undefined) {
        if (event.target.checked) modalState.entitySelectedIds.add(entityKey);
        else modalState.entitySelectedIds.delete(entityKey);
        rerenderModal();
        return;
    }
    if (event.target?.dataset?.r07CatalogProject !== undefined) {
        modalState.entityTargetProjectId = event.target.value;
        modalState.entityMessage = '';
        rerenderModal();
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
        modalState.entitySelectedIds.clear();
        modalState.leaderRemaps = {};
        modalState.leaderCopies = {};
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        if (modalState.action === 'create') ensureCreateProjectId();
        rerenderModal();
        return;
    }
    if (event.target?.dataset?.r07Control === 'target-project') {
        modalState.targetProjectId = event.target.value;
        modalState.entitySelectedIds.clear();
        modalState.leaderRemaps = {};
        modalState.leaderCopies = {};
        modalState.positionRemaps = {};
        modalState.positionCopies = {};
        rerenderModal();
        return;
    }
    if (event.target?.dataset?.r07PositionTarget !== undefined) {
        setGroupPosition(String(event.target.dataset.fromPositionId || ''), String(event.target.value || ''));
        return;
    }

}

function updateWizardFooter() {
    const preflight = currentPreflight();
    const hint = wizardHint(preflight);
    const body = activeModal?.element?.querySelector('.modal-body');
    const next = body?.querySelector('[data-r07-action="wizard-next"]');
    const apply = body?.querySelector('[data-r07-action="apply"]');
    if (next) next.disabled = !!hint || modalState.busy;
    const quick = body?.querySelector('[data-r07-action="quick-assign"]');
    if (quick) quick.disabled = !!hint || modalState.busy;
    if (apply) apply.disabled = !!hint || !canApply(preflight) || modalState.busy;
    const hintNode = body?.querySelector('.r07-recon-footer-hint');
    if (hintNode) hintNode.textContent = hint;
}

function handleInput(event) {
    if (event.target?.dataset?.r07PositionName !== undefined) {
        const fromId = event.target.dataset.r07PositionName;
        for (const copy of Object.values(modalState.positionCopies)) {
            if (copy.fromPositionId === fromId) copy.name = event.target.value;
        }
        updateWizardFooter();
        return;
    }
    if (event.target?.dataset?.r07LeaderName !== undefined) {
        const copy = modalState.leaderCopies[event.target.dataset.r07LeaderName];
        if (copy) copy.name = event.target.value;
        updateWizardFooter();
        return;
    }
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
    updateWizardFooter();
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
