/**
 * 📤 ExportController — Handlers for the export popover and import modal.
 *
 * Side-effectful counterpart to ExportMenuService (pure state ops). This
 * module owns the share/download flows that touch browser APIs:
 *   - navigator.share / navigator.clipboard
 *   - URL.createObjectURL + anchor click
 *   - FileReader for reading Blob contents
 *   - location.reload() after a successful FULL import
 *
 * Sprint 4 extraction: these handlers used to live in app.js as window.*
 * globals. registerLegacyGlobals() re-binds them for the data-app-fn dispatcher.
 */

import { state, stateManager, invalidateAllStats, buildAttendanceIndex } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import {
    saveApplicationData as persistApplicationData,
    saveToIndexedDB,
    sanitizePositions,
    beginFullImportIsolation,
    endFullImportIsolation,
    isFullImportIsolationInProgress,
    isProjectRepairIsolationInProgress,
    resumeSuspendedSaveOptions
} from '../../services/PersistenceService.js';
import { PettyCashStore } from '../pettycash/PettyCashStore.js';

// FULL import uses the ordinary persistence function for explicit options.
// The no-argument call runs only after the atomic FULL commit already succeeded:
// do not persist the same large dataset a second time; only enqueue the cloud
// mirror/entities/settings and wait until that local outbox enqueue is durable.
function saveApplicationData(options) {
    if (options) return persistApplicationData(options);
    return persistApplicationData({
        localAlreadyCommitted: true,
        awaitOutboxEnqueue: true
    });
}
import { openExportMenu, closeExportMenu, buildMiniExportPayload } from './ExportMenuService.js';
import {
    resetImportFullModalStage,
    showImportFullPasteStage,
    showImportFullConfirmStage,
    ensureImportFullAccessibilityHandlers
} from './ImportFullModal.js';
import {
    buildSaMiniRosterPayload,
    resolveSaMiniRosterScope,
    selectSaMiniRosterEmployees
} from './SaMiniRosterExport.js';
import {
    getEntityScope,
    ACTIVE_PROJECT_LS_KEY,
    projectContext
} from '../projects/ProjectContext.js';
import {
    DEFAULT_PROJECT_LS_KEY,
    peekEntityScope,
    replaceEntityScope
} from '../projects/EntityProjectScope.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { projectStore } from '../projects/ProjectStore.js';
import { defaultProjectService } from '../projects/DefaultProject.js';
// R07 A1: pure ownership-reconciliation domain. ExportController only wires
// the preflight; classify/plan logic lives in the domain module (no
// reimplementation here).
import {
    CLASSIFICATION,
    RESOLUTION_KIND,
    PROJECT_OWNED_COLLECTIONS,
    isExplicitProjectId,
    isQuarantineProjectId,
    classifyOwnership,
    analyzeProjectOwnership,
    planResolution
} from '../projects/ProjectOwnershipReconciliation.js';

// ─── Small helpers ───────────────────────────────────────────────────────────

async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
}

function notify(message, type = 'info') {
    if (typeof window !== 'undefined' && window.showNotification) {
        window.showNotification(message, type);
    }
}

/**
 * R07 A2a — metadata de reconciliación del último import FULL que paró antes
 * de mutar (≥2 obras válidas + registros sin dueño). Se expone para la futura
 * UI de reconciliación (A2b) y para verificación en tests; no es estado global.
 */
let lastFullImportReconciliation = null;

export function getLastFullImportReconciliation() {
    return lastFullImportReconciliation;
}

// ─── R07 Phase B — FULL import reconciliation bridge ────────────────────────
// Módulo-level pending payload (NOT `state` — keeps the lint:state ratchet
// intact). On MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS the preflight parks
// the payload here BEFORE throwing; the catch emits an event so the shared UI
// can ask which valid project owns the LEGACY_UNSCOPED records, then retry the
// same FULL import without re-pasting. Cancel = zero durable/local mutation.
export const FULL_IMPORT_RECONCILIATION_EVENT = 'project-reconciliation:import-required';

let pendingFullImport = null;
let pendingConfirmedFullImport = null;
let importFullFocusReturn = null;

function captureImportFullFocusReturn() {
    if (typeof document === 'undefined') return null;
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    return {
        element,
        id: element.id || null,
        appFn: element.dataset?.appFn || null,
        settingsAction: element.dataset?.settingsAction || null
    };
}

function restoreImportFullFocus() {
    if (typeof document === 'undefined' || !importFullFocusReturn) return;
    const saved = importFullFocusReturn;
    importFullFocusReturn = null;
    requestAnimationFrame(() => {
        let target = saved.element?.isConnected ? saved.element : null;
        if (!target && saved.id) target = document.getElementById(saved.id);
        if (!target && saved.appFn) target = document.querySelector('[data-app-fn="' + saved.appFn + '"]');
        if (!target && saved.settingsAction) target = document.querySelector('[data-settings-action="' + saved.settingsAction + '"]');
        target?.focus?.();
    });
}

export function getPendingFullImport() {
    return pendingFullImport;
}

export function parkPendingFullImport(data, projects, defaultProjectId, reason, extra = {}) {
    pendingFullImport = {
        data,
        validProjects: (Array.isArray(projects) ? projects : []).map(project => ({
            id: String(project?.id || '').trim(),
            name: project?.name ?? null,
            status: project?.status ?? null
        })),
        defaultProjectId: String(defaultProjectId || '').trim(),
        reason: reason || 'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS',
        legacyUnscopedCount: Number(extra.legacyUnscopedCount) || 0,
        createdAt: Date.now()
    };
}

export function cancelFullImportProjectChoice() {
    pendingFullImport = null;
}

function clonePendingImportData(data) {
    if (typeof structuredClone === 'function') return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
}

function emitFullImportReconciliation() {
    if (typeof window === 'undefined' || !pendingFullImport) return;
    // Defer so the event fires only after the synchronous catch cleanup
    // (rollback / end isolation) has completed — re-entrancy safety.
    setTimeout(() => {
        if (!pendingFullImport) return;
        window.dispatchEvent(new CustomEvent(FULL_IMPORT_RECONCILIATION_EVENT, { detail: pendingFullImport }));
    }, 0);
}

export async function requestFullImportProjectChoice(targetProjectId) {
    if (!pendingFullImport) {
        return { ok: false, reason: 'No hay una importación pendiente de reconciliación.' };
    }
    const targetId = String(targetProjectId || '').trim();
    if (!isExplicitProjectId(targetId)) {
        return { ok: false, reason: 'El proyecto elegido no es una obra válida.' };
    }
    const valid = pendingFullImport.validProjects.some(project => project.id === targetId);
    if (!valid) {
        return { ok: false, reason: 'El proyecto elegido no está en el respaldo importado.' };
    }
    const data = clonePendingImportData(pendingFullImport.data);
    const assignedRecords = bindUnscopedRecordsToProject(data, targetId, pendingFullImport.validProjects);
    const ok = await applyFullImport({ data });
    if (!ok) {
        return { ok: false, reason: 'La asignación es válida, pero la importación no pudo guardarse. Puedes reintentar sin pegar el respaldo otra vez.' };
    }
    pendingFullImport = null;
    return { ok: true, assignedRecords };
}

// ─── Popover open/close (thin wrappers over ExportMenuService) ────────────────

export function showExportMenuHandler(options) {
    stateManager.batchSetState(() => {
        openExportMenu(state, options || {});
        // MINI v1 (F3.5): el opt-in salarial requiere consentimiento fresco
        // en cada apertura; nunca se hereda de una exportación previa.
        state.exportMiniV1IncludeSalary = false;
    });
    render();
}

export function closeExportMenuHandler() {
    stateManager.batchSetState(() => {
        closeExportMenu(state);
        // MINI v1 (F3.5): al cerrar se revoca el opt-in salarial para que el
        // próximo export exija un nuevo check explícito.
        state.exportMiniV1IncludeSalary = false;
        // The legacy app.js closeExportMenu also dismissed sibling popovers.
        // Replicate that here so the data-app-fn buttons keep the same UX.
        state.showImportFullModal = false;
        state.importFullText = '';
        state.showNotesCenter = false;
        state.notesCenterEmployeeId = null;
        state.showNoteModal = false;
    });
    render();
}

export function toggleShareOptions() {
    stateManager.batchSetState(() => {
        state.showShareOptions = !state.showShareOptions;
    });
}

// ─── Download: save the current blob locally ─────────────────────────────────

export function performDownload() {
    const data = state.exportMenuData;
    if (!data.blob) return;
    try {
        state.isExporting = true;
        render();

        const url = URL.createObjectURL(data.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        notify('✅ Archivo descargado correctamente', 'success');
        closeExportMenuHandler();
    } catch (error) {
        console.error('Error descargando:', error);
        notify('❌ Error al descargar', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
}

// ─── Share: native Web Share API ─────────────────────────────────────────────

export async function performShare() {
    const data = state.exportMenuData;
    if (!data.blob) return;
    try {
        state.isExporting = true;
        render();

        const file = new File([data.blob], data.filename, { type: data.blob.type });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title: data.title, text: data.text, files: [file] });
            notify('✅ Archivo compartido correctamente', 'success');
            closeExportMenuHandler();
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error compartiendo:', error);
            notify('❌ Error al compartir', 'error');
        }
    } finally {
        state.isExporting = false;
        render();
    }
}

// ─── Share via clipboard: FULL backup ────────────────────────────────────────

export async function shareExportFull() {
    const data = state.exportMenuData;
    if (!data.blob) {
        notify('❌ No hay datos para compartir', 'error');
        return;
    }
    try {
        state.isExporting = true;
        render();

        let jsonText = '';
        if (data.blob.text) {
            jsonText = await data.blob.text();
        } else {
            jsonText = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result || '');
                reader.onerror = reject;
                reader.readAsText(data.blob);
            });
        }

        const copied = await copyTextToClipboard(jsonText);
        if (!copied) throw new Error('copy failed');

        notify('✅ Datos FULL copiados al portapapeles', 'success');
        closeExportMenuHandler();
    } catch (error) {
        console.error('Error copiando FULL:', error);
        notify('❌ Error al copiar datos FULL', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
}

// ─── Share via clipboard: MINI (format compatible with Mini app) ────────────
export async function shareExportMini(options = {}) {
    try {
        state.isExporting = true;
        render();

        const mini = buildMiniExportPayload(
            state.employees,
            state.positions,
            state.settings,
            options
        );

        const json = JSON.stringify(mini, null, 2);
        const copied = await copyTextToClipboard(json);
        if (!copied) throw new Error('copy failed');

        notify('✅ Datos MINI copiados al portapapeles', 'success');
        closeExportMenuHandler();
    } catch (error) {
        console.error('Error copiando MINI:', error);
        notify('❌ Error al copiar datos MINI', 'error');
    } finally {
        state.isExporting = false;
        render();
    }
}

// ─── Share via clipboard: MINI v1 (roster canónico SA→Mini, F3.5) ───────────
// Transporte: sólo texto JSON al portapapeles. Sólo lectura: no muta storage
// ni registros. Fail-closed: cualquier validación fallida aborta con un error
// accionable y NO copia nada.
export async function shareExportMiniV1(options = {}) {
    try {
        stateManager.batchSetState(() => {
            state.isExporting = true;
        });
        render();

        // Alcance estricto: Proyectos ON + proyecto activo + default (sin
        // ensureDefaultProject ni lecturas crudas de localStorage aquí:
        // getEntityScope() es la única resolución permitida).
        const scope = await getEntityScope();
        const saProjectId = resolveSaMiniRosterScope(scope);
        const inScope = selectSaMiniRosterEmployees(state.employees, scope);

        // Privacidad salarial: sólo opt-in explícito (checkbox "Incluir sueldo").
        const includeSalary = options.includeSalary === true
            || state.exportMiniV1IncludeSalary === true;

        const payload = buildSaMiniRosterPayload({
            saProjectId,
            employees: inScope,
            positions: state.positions,
            settings: state.settings,
            includeSalary,
            scope
        });

        const json = JSON.stringify(payload, null, 2);
        const copied = await copyTextToClipboard(json);
        if (!copied) throw new Error('copy failed');

        notify('✅ Roster SA→Mini (MINI v1) copiado al portapapeles', 'success');
        closeExportMenuHandler();
    } catch (error) {
        console.error('Error copiando MINI v1:', error);
        notify('❌ ' + (error && error.message ? error.message : 'Error al copiar roster MINI v1'), 'error');
    } finally {
        stateManager.batchSetState(() => {
            state.isExporting = false;
        });
        render();
    }
}

// ─── MINI v1: opt-in salarial ("Incluir sueldo", apagado por defecto) ───────
export function toggleMiniV1Salary() {
    stateManager.batchSetState(() => {
        state.exportMiniV1IncludeSalary = state.exportMiniV1IncludeSalary !== true;
    });
}

export function setMiniV1IncludeSalary(value) {
    stateManager.batchSetState(() => {
        state.exportMiniV1IncludeSalary = value === true;
    });
}

// ─── Import FULL: replace all state from pasted JSON ─────────────────────────

export function openImportFullModal() {
    importFullFocusReturn = captureImportFullFocusReturn();
    pendingFullImport = null;
    pendingConfirmedFullImport = null;
    resetImportFullModalStage();
    ensureImportFullAccessibilityHandlers();
    const rawState = stateManager.getState();
    rawState.showImportFullModal = true;
    rawState.importFullText = '';
    render();
    setTimeout(() => document.querySelector('#import-full-textarea')?.focus?.(), 30);
}

export function closeImportFullModal() {
    // La frontera FULL es atómica: mientras está activa, cerrar el shell podría
    // hacer creer al usuario que el proceso terminó o permitir iniciar otro
    // flujo sobre estado provisional. El cierre vuelve a habilitarse al salir
    // de la isolación (éxito o rollback).
    if (isFullImportIsolationInProgress()) {
        notify('La importación está guardando cambios. Espera a que termine.', 'info');
        return false;
    }
    pendingFullImport = null;
    pendingConfirmedFullImport = null;
    resetImportFullModalStage();
    const rawState = stateManager.getState();
    rawState.showImportFullModal = false;
    rawState.importFullText = '';
    render();
    restoreImportFullFocus();
    return true;
}

export function setImportFullText(value) {
    // Draft local: escribirlo no necesita reconstruir toda la app en cada tecla.
    stateManager.getState().importFullText = value;
}

function readLocalStorageValue(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}

function writeLocalStorageValue(key, value) {
    try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
    } catch (_) {}
}

function snapshotFullImportState() {
    return {
        settings: state.settings, positions: state.positions, employees: state.employees,
        leaders: state.leaders, attendance: state.attendance,
        tempAssignments: state.tempAssignments, dayHoursConfig: state.dayHoursConfig,
        projectPointers: {
            defaultProjectId: readLocalStorageValue(DEFAULT_PROJECT_LS_KEY),
            activeProjectId: readLocalStorageValue(ACTIVE_PROJECT_LS_KEY),
            scope: peekEntityScope()
        }
    };
}

function publishFullImportData(data) {
    stateManager.batchSetState(() => {
        state.settings = data.settings || state.settings;
        state.positions = data.positions || [];
        state.employees = data.employees || [];
        state.leaders = data.leaders || [];
        state.attendance = data.attendance || {};
        state.tempAssignments = data.tempAssignments || [];
        state.dayHoursConfig = data.dayHoursConfig || {};
    });
}

function rollbackFullImportState(previousState) {
    const { projectPointers, ...appState } = previousState || {};
    stateManager.batchSetState(() => Object.assign(state, appState));
    if (projectPointers) {
        writeLocalStorageValue(DEFAULT_PROJECT_LS_KEY, projectPointers.defaultProjectId);
        writeLocalStorageValue(ACTIVE_PROJECT_LS_KEY, projectPointers.activeProjectId);
        replaceEntityScope(projectPointers.scope || { enabled: false, projectId: null, defaultProjectId: null });
    }
    invalidateAllStats();
    buildAttendanceIndex();
    render();
}

function finalizeFullImportPettyCash(data, preparedPettyCash) {
    if (preparedPettyCash?.unrecoverableReceiptCount > 0) {
        notify(`⚠️ ${preparedPettyCash.unrecoverableReceiptCount} comprobante(s) solo local(es) no se pueden recuperar desde este backup.`, 'warning');
    }
    if (data?.pettyCash) {
        console.log('💵 Caja chica restaurada desde el import FULL');
    }
}

function collectExplicitProjectIds(data) {
    const ids = [];
    const collectRecord = record => {
        if (record && record.projectId != null && String(record.projectId).trim()) {
            ids.push(String(record.projectId).trim());
        }
    };
    for (const key of ['employees', 'positions', 'leaders', 'tempAssignments']) {
        for (const record of (Array.isArray(data?.[key]) ? data[key] : [])) collectRecord(record);
    }
    const attendance = data?.attendance;
    if (attendance && typeof attendance === 'object') {
        const records = Array.isArray(attendance) ? attendance : Object.values(attendance);
        for (const record of records) collectRecord(record);
    }
    for (const config of (Array.isArray(data?.projectPayrollConfigs) ? data.projectPayrollConfigs : [])) {
        collectRecord(config);
    }
    const pettyProjects = Array.isArray(data?.pettyCash?.projects) ? data.pettyCash.projects : [];
    for (const project of pettyProjects) {
        if (project?.officialProjectId != null && String(project.officialProjectId).trim()) {
            ids.push(String(project.officialProjectId).trim());
        }
    }
    return ids;
}

/**
 * R07 A2a — vista de las colecciones con dueño de proyecto escaneables por el
 * dominio puro de reconciliación (orden congelado en PROJECT_OWNED_COLLECTIONS).
 */
function getProjectOwnedDataViews(data) {
    return {
        employees: Array.isArray(data?.employees) ? data.employees : [],
        positions: Array.isArray(data?.positions) ? data.positions : [],
        leaders: Array.isArray(data?.leaders) ? data.leaders : [],
        attendance: data?.attendance && typeof data.attendance === 'object' ? data.attendance : {}
    };
}

/**
 * R07 A2a — binding determinista de registros legacy sin dueño (LEGACY_UNSCOPED)
 * hacia un único proyecto válido REAL. Clasificación delegada al helper A1
 * classifyOwnership; jamás materializa el sentinel `legacy-unresolved:*`:
 * sólo se asignan ids de proyectos reales del catálogo.
 */
function bindUnscopedRecordsToProject(data, targetProjectId, catalog, collections = PROJECT_OWNED_COLLECTIONS) {
    if (!isExplicitProjectId(targetProjectId)) {
        throw new Error('No se puede asignar registros legacy a un projectId inválido o cuarentenado.');
    }
    let assigned = 0;
    for (const collection of collections) {
        const value = data?.[collection];
        const records = Array.isArray(value)
            ? value
            : (value && typeof value === 'object' ? Object.values(value) : []);
        for (const record of records) {
            if (!record || typeof record !== 'object') continue;
            const classification = classifyOwnership(record, catalog, {
                enabled: true,
                defaultProjectId: targetProjectId
            });
            if (classification.status === CLASSIFICATION.LEGACY_UNSCOPED) {
                record.projectId = targetProjectId;
                assigned += 1;
            }
        }
    }
    return assigned;
}

/**
 * R07 A2a — reconciliación de registros sin dueño en backups CON superficie:
 * - catálogo con exactamente 1 proyecto válido ⇒ binding determinista de todos
 *   los LEGACY_UNSCOPED hacia ese proyecto (nunca sentinel);
 * - catálogo con ≥2 proyectos válidos ⇒ STOP antes de cualquier mutación con
 *   metadata estructurada de reconciliación (análisis A1 + choices permitidas)
 *   para la futura UI; nunca se adivina el dueño.
 */
function reconcileUnscopedRecordsForSurface(data, projects, defaultProjectId) {
    const analysis = analyzeProjectOwnership(getProjectOwnedDataViews(data), projects, {
        enabled: true,
        defaultProjectId
    });
    const unscopedCount = analysis.summary.counts[CLASSIFICATION.LEGACY_UNSCOPED] || 0;
    if (unscopedCount === 0) {
        return { assignedRecords: 0, assignedProjectId: null };
    }

    const plan = planResolution({ status: CLASSIFICATION.LEGACY_UNSCOPED, validProjects: projects });
    if (plan.ok && plan.kind === RESOLUTION_KIND.ASSIGN_TO_SINGLE_VALID && plan.assignableProjectId) {
        const assignedProjectId = plan.assignableProjectId;
        const assignedRecords = bindUnscopedRecordsToProject(data, assignedProjectId, projects);
        return { assignedRecords, assignedProjectId };
    }

    // R07 Phase B — park the pending payload BEFORE throwing so the UI can offer
    // an explicit project choice and retry the same FULL import (no re-paste).
    parkPendingFullImport(data, projects, defaultProjectId, 'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS', { legacyUnscopedCount: unscopedCount });

    const error = new Error(
        `El backup trae ${unscopedCount} registro(s) de proyecto sin dueño y ${projects.length} obras válidas. ` +
        'Se requiere reconciliación explícita antes de restaurar; el import fue cancelado sin aplicar ningún cambio.'
    );
    error.reconciliation = {
        reconciliationRequired: true,
        reason: 'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS',
        analysis: {
            enabled: analysis.enabled,
            totalRecords: analysis.summary.totalRecords,
            issueCount: analysis.summary.issueCount,
            counts: { ...analysis.summary.counts },
            legacyUnscopedCount: unscopedCount,
            validProjects: projects.map(project => ({
                id: String(project?.id || '').trim(),
                name: project?.name ?? null,
                status: project?.status ?? null
            })),
            issues: analysis.issues
        },
        allowedChoices: [...(plan.allowedChoices || [])],
        requiresUserChoice: plan.requiresUserChoice !== false,
        assignedRecords: 0
    };
    throw error;
}

/**
 * R07 A2a — preflight para backups legacy PUROS (sin superficie de proyecto y
 * sin projectIds explícitos) con Proyectos ON:
 *  1. falla cerrada si el backup trae projectIds explícitos ausentes del
 *     catálogo local (antes de cualquier mutación);
 *  2. resuelve EXACTAMENTE UN proyecto default local real (get-or-recover-or-
 *     create idempotente de DefaultProject; nunca crea un segundo si ya hay
 *     uno válido);
 *  3. asigna todos los registros con dueño de proyecto hacia ese default.
 * Proyectos OFF ⇒ passthrough sin cambios (null).
 */
async function prepareLegacyProjectBinding(data) {
    const localProjects = await projectStore.listAll();
    const catalogIds = new Set(
        localProjects.map(project => String(project?.id || '').trim()).filter(Boolean)
    );
    for (const explicitId of collectExplicitProjectIds(data)) {
        if (!catalogIds.has(explicitId)) {
            throw new Error(`El backup referencia un projectId inexistente: "${explicitId}".`);
        }
    }

    const defaultProject = await defaultProjectService.ensureDefaultProject();
    if (!defaultProject?.id || !isExplicitProjectId(defaultProject.id)) {
        throw new Error('No se pudo resolver un proyecto local válido para los datos legacy. La importación fue cancelada.');
    }

    const assignedRecords = bindUnscopedRecordsToProject(data, defaultProject.id, localProjects);
    return {
        legacyBinding: {
            projectId: defaultProject.id,
            assignedRecords,
            resolvedExisting: catalogIds.has(defaultProject.id)
        }
    };
}

/**
 * R07 A2a — dispatcher del preflight FULL-import.
 * - Proyectos OFF ⇒ null (comportamiento legacy intacto).
 * - Con superficie ⇒ validación dura existente + reconciliación A1 de unscoped.
 * - Sin superficie ⇒ binding legacy al default local real.
 */
async function prepareFullImportProjectPreflight(data) {
    if (!isProjectsEnabled()) return null;
    if (backupCarriesProjectSurface(data)) {
        const surface = prepareProjectSurfaceForFullImport(data);
        const binding = reconcileUnscopedRecordsForSurface(data, surface.projects, surface.incomingScope.defaultProjectId);
        if (binding.assignedRecords > 0) surface.legacyBinding = binding;
        return surface;
    }
    return prepareLegacyProjectBinding(data);
}

/**
 * R07 A2c-3 H7 — sentinel de cuarentena `legacy-unresolved:*` rechazado como
 * proyecto real. Construye un error fail-closed con metadata de reconciliación
 * (mismo contrato que MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS) para que
 * la futura UI pueda distinguir el motivo y jamás materialice el sentinel.
 */
function sentinelReconciliationError(where, sentinelId) {
    const error = new Error(
        `El backup contiene un id de proyecto cuarentenado (legacy-unresolved:*) en ${where}: "${sentinelId}". ` +
        'No puede importarse como obra válida; el import fue cancelado sin aplicar ningún cambio.'
    );
    error.reconciliation = {
        reconciliationRequired: true,
        reason: 'SENTINEL_PROJECT_ID_IN_BACKUP',
        where,
        sentinelId
    };
    return error;
}

function prepareProjectSurfaceForFullImport(data) {
    if (!isProjectsEnabled() || !backupCarriesProjectSurface(data)) return null;

    const projects = Array.isArray(data?.projects) ? data.projects.map(project => ({ ...project })) : [];
    if (projects.length === 0) {
        throw new Error('El backup multiproyecto no contiene un catálogo de proyectos válido.');
    }

    const ids = new Set();
    for (const project of projects) {
        const id = String(project?.id || '').trim();
        if (!id) throw new Error('El backup contiene un proyecto sin id.');
        if (isQuarantineProjectId(id)) {
            throw sentinelReconciliationError('catálogo de proyectos', id);
        }
        if (ids.has(id)) throw new Error(`El backup contiene el proyecto duplicado "${id}".`);
        ids.add(id);
        project.id = id;
    }

    const projectBackup = data?.projectBackup && typeof data.projectBackup === 'object'
        ? { ...data.projectBackup }
        : {};
    const defaultProjectId = String(projectBackup.defaultProjectId || '').trim();
    if (isQuarantineProjectId(defaultProjectId)) {
        throw sentinelReconciliationError('projectBackup.defaultProjectId', defaultProjectId);
    }
    if (!defaultProjectId || !ids.has(defaultProjectId)) {
        throw new Error('El proyecto predeterminado del backup no existe en su catálogo.');
    }
    const activeProjectId = String(projectBackup.activeProjectId || defaultProjectId).trim();
    if (isQuarantineProjectId(activeProjectId)) {
        throw sentinelReconciliationError('projectBackup.activeProjectId', activeProjectId);
    }
    if (!activeProjectId || !ids.has(activeProjectId)) {
        throw new Error('El proyecto activo del backup no existe en su catálogo.');
    }

    for (const explicitId of collectExplicitProjectIds(data)) {
        if (!ids.has(explicitId)) {
            throw new Error(`El backup referencia un projectId inexistente: "${explicitId}".`);
        }
    }

    const projectPayrollConfigs = Array.isArray(data?.projectPayrollConfigs)
        ? data.projectPayrollConfigs.map(config => ({ ...config, projectId: String(config.projectId || '').trim() }))
        : [];

    return {
        projects,
        projectPayrollConfigs,
        projectBackup,
        incomingScope: {
            enabled: true,
            projectId: activeProjectId,
            defaultProjectId
        }
    };
}

function commitProjectSurfacePointers(projectSurface, previousPointers = null) {
    if (!projectSurface?.incomingScope) return;
    const scope = projectSurface.incomingScope;
    writeLocalStorageValue(DEFAULT_PROJECT_LS_KEY, scope.defaultProjectId);
    writeLocalStorageValue(ACTIVE_PROJECT_LS_KEY, scope.projectId);
    replaceEntityScope(scope);
    try {
        projectContext.notifyProjectChanged({
            previousProjectId: previousPointers?.activeProjectId || null,
            projectId: scope.projectId,
            source: 'full-import'
        });
    } catch (_) {}
}

function rememberFullImportReconciliation(error) {
    if (error?.reconciliation) lastFullImportReconciliation = error.reconciliation;
    // R07 Phase B — emit AFTER the catch has rolled back / cleared isolation
    // (re-entrancy safety); the UI listens and offers the explicit project choice.
    if (error?.reconciliation?.reason === 'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS') {
        emitFullImportReconciliation();
    }
}

/** R07 H3: un repair de proyectos activo bloquea el FULL import antes de mutar. */
function assertProjectRepairAllowed() {
    if (isProjectRepairIsolationInProgress()) {
        throw new Error('Reparación de proyectos en curso; importación FULL bloqueada.');
    }
}

function clearImportedPettyCash() {
    delete stateManager.getState()?.pettyCash;
    delete state.pettyCash;
}

function handleFullImportFailure(error, ctx) {
    rememberFullImportReconciliation(error);
    if (!ctx.durableCommitted && ctx.published) rollbackFullImportState(ctx.previousState);
    if (ctx.isolationActive) endFullImportIsolation();
    if (!ctx.durableCommitted) resumeSuspendedSaveOptions(ctx.suspendedSaveOptions);
    if (error?.reconciliation?.reason === 'MULTIPLE_VALID_PROJECTS_WITH_UNSCOPED_RECORDS') {
        console.info('Importación FULL en espera de asignación de obra.');
        notify('Hay datos sin obra asignada. Elige una obra para continuar la importación.', 'warning');
    } else {
        console.error('Error importando FULL:', error);
        notify('❌ Error al importar: ' + (error?.message || 'falló el guardado'), 'error');
    }
    return false;
}

async function applyFullImport(importedData) {
    const data=importedData.data || {};
    const previousState=snapshotFullImportState();
    let suspendedSaveOptions=null,isolationActive=false,durableCommitted=false,published=false;
    let preparedPettyCash=null,projects=null;
    lastFullImportReconciliation = null;
    try {
        assertProjectRepairAllowed();
        suspendedSaveOptions = beginFullImportIsolation();
        isolationActive = true;
        projects = isProjectsEnabled() ? await prepareFullImportProjectPreflight(data) : null;
        stateManager.getState().importFullText = '';
        publishFullImportData(data);
        published = true;
        if (typeof sanitizePositions === 'function') sanitizePositions(state);
        invalidateAllStats();
        buildAttendanceIndex();
        if (data.pettyCash && typeof data.pettyCash === 'object') {
            preparedPettyCash = await restorePettyCashFromImport(data.pettyCash);
        }
        let ok;
        if (projects) ok = await saveToIndexedDB({ clearFirst: true, projectSurface: projects, entityScope: projects.incomingScope });
        else ok = await saveToIndexedDB({ clearFirst: true });
        if (!ok) throw new Error('no se pudo guardar en IndexedDB');
        durableCommitted = true;
        if (projects) commitProjectSurfacePointers(projects, previousState.projectPointers);
        endFullImportIsolation({ commit: true });
        isolationActive = false;
        finalizeFullImportPettyCash(data, preparedPettyCash);
        const cloudSave = await saveApplicationData();
        if (cloudSave?.localOk === false) {
            notify('⚠️ Datos importados localmente; la sincronización posterior quedó pendiente.', 'warning');
        }
        notify('✅ Datos importados correctamente', 'success');
        closeImportFullModal();
        closeExportMenuHandler();
        render();
        setTimeout(() => location.reload(), 1500);
        return true;
    } catch (error) {
        return handleFullImportFailure(error, {
            previousState, suspendedSaveOptions, isolationActive, durableCommitted, published
        });
    } finally {
        clearImportedPettyCash();
    }
}

export function confirmImportFull() {
    try {
        const text = (state.importFullText || '').trim();
        if (!text) {
            notify('Pega los datos FULL primero.', 'warning');
            return;
        }
        // A brand-new FULL import supersedes any previously-parked pending
        // payload (the pending bridge is only for a retry of THIS import).
        pendingFullImport = null;

        const importedData = JSON.parse(text);
        if (!importedData.data) throw new Error('Formato de datos inválido');

        const employeesCount = (importedData.data.employees || []).length;
        pendingConfirmedFullImport = importedData;

        // Real UI path: keep the exact same overlay/shell and morph its content
        // from paste -> confirmation (design.md §4.4 / §5.8).
        if (typeof document !== 'undefined' && document.querySelector('.import-full-dialog')) {
            showImportFullConfirmStage({ employeesCount });
            return;
        }

        // Compatibility path for controller-level tests and non-DOM callers.
        // Historically this path closed the paste modal before opening the
        // confirmation dialog. Keep that contract without affecting the real
        // morphing DOM flow above.
        if (window.showConfirm) {
            const rawState = stateManager.getState();
            rawState.showImportFullModal = false;
            render();
            window.showConfirm({
                title: 'Importar datos FULL',
                message:
                    `Se encontraron ${employeesCount} empleados.\n\n` +
                    'Esto reemplazará TODOS tus datos actuales por estos nuevos.\n\n' +
                    '¿Deseas continuar?',
                confirmText: 'Importar',
                cancelText: 'Cancelar',
                type: 'warning',
                onConfirm: () => applyFullImport(importedData),
                onCancel: () => {}
            });
        }
    } catch (error) {
        pendingConfirmedFullImport = null;
        console.error('Error importando FULL:', error);
        notify('No se pudo leer el respaldo: ' + error.message, 'error');
    }
}

export function backToImportFullPaste() {
    pendingConfirmedFullImport = null;
    pendingFullImport = null;
    showImportFullPasteStage();
}

export async function applyConfirmedFullImport() {
    const importedData = pendingConfirmedFullImport;
    if (!importedData?.data) {
        showImportFullPasteStage();
        notify('Vuelve a pegar el respaldo para continuar.', 'warning');
        return false;
    }
    return applyFullImport(importedData);
}

async function restorePettyCashFromImport(pettyCashBackup) {
    const prepared = await PettyCashStore.prepareForFullImport(pettyCashBackup);
    if (prepared) stateManager.getState().pettyCash = prepared;
    return prepared;
}

function backupCarriesProjectSurface(data) {
    if (!data || typeof data !== 'object') return false;
    if (Array.isArray(data.projects) && data.projects.length > 0) return true;
    if (Array.isArray(data.projectPayrollConfigs) && data.projectPayrollConfigs.length > 0) return true;
    return Boolean(data.projectBackup && typeof data.projectBackup === 'object');
}

/**
 * Bind handlers to window.* for the legacy data-app-fn event delegation.
 * Call once at app boot from app.js.
 */
let importInputDelegated = false;
export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.showExportMenu = showExportMenuHandler;
    window.closeExportMenu = closeExportMenuHandler;
    window.toggleShareOptions = toggleShareOptions;
    window.performShare = performShare;
    window.performDownload = performDownload;
    window.shareExportFull = shareExportFull;
    window.shareExportMini = shareExportMini;
    window.shareExportMiniV1 = shareExportMiniV1;
    window.toggleMiniV1Salary = toggleMiniV1Salary;
    window.setMiniV1IncludeSalary = setMiniV1IncludeSalary;
    window.openImportFullModal = openImportFullModal;
    window.closeImportFullModal = closeImportFullModal;
    window.setImportFullText = setImportFullText;
    window.confirmImportFull = confirmImportFull;
    window.backToImportFullPaste = backToImportFullPaste;
    window.applyConfirmedFullImport = applyConfirmedFullImport;
    // R07 Phase B a11y — delegated input for the FULL import textarea (replaces
    // the inline oninput), registered once without breaking data-app-fn click
    // delegation.
    if (!importInputDelegated) {
        importInputDelegated = true;
        document.addEventListener('input', (event) => {
            const target = event.target?.closest?.('[data-import-full-input]');
            if (target) setImportFullText(target.value);
        });
    }
}
