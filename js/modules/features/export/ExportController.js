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
    endFullImportIsolation
} from '../../services/PersistenceService.js';
import { preparePettyCashBackupForRestore } from '../../services/SnapshotSanitizer.js';
import { PettyCashStore } from '../pettycash/PettyCashStore.js';

// FULL import uses the ordinary persistence function for explicit options.
// The no-argument call runs only after the atomic FULL commit already succeeded:
// do not persist the same large dataset a second time; only enqueue the cloud
// mirror/entities/settings and wait until that local outbox enqueue is durable.
function saveApplicationData(options) {
    if (options) return persistApplicationData(options);
    return persistApplicationData({
        immediate: true,
        localAlreadyCommitted: true,
        awaitOutboxEnqueue: true
    });
}
import { openExportMenu, closeExportMenu, buildMiniExportPayload } from './ExportMenuService.js';
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
    stateManager.batchSetState(() => {
        state.showImportFullModal = true;
        state.importFullText = '';
    });
}

export function closeImportFullModal() {
    stateManager.batchSetState(() => {
        state.showImportFullModal = false;
        state.importFullText = '';
    });
}

export function setImportFullText(value) {
    state.importFullText = value;
}

/**
 * F1 ronda-02 — FULL import desde portapapeles. Contratos:
 *  - Reemplazo de dataset síncrono en batchSetState (round-trip caracterizado).
 *  - Restaura la caja chica con el patrón del restore por archivo
 *    (preparePettyCashBackupForRestore + PettyCashStore.applyRemote).
 *  - Espera la persistencia durable (saveToIndexedDB clearFirst) ANTES del reload.
 *  - Con Projects ON, la superficie projects/projectPayrollConfigs/projectBackup
 *    se valida primero y participa en la misma frontera transaccional durable.
 *    Los punteros default/active y el scope sólo avanzan después del commit.
 */
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
        // Keep the imported in-memory payload verbatim. Historical protection is
        // attached only to the durable IndexedDB representation during the atomic
        // FULL commit, so round-trip state semantics remain unchanged.
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

async function resumeSuspendedSave(suspendedSaveOptions) {
    if (!suspendedSaveOptions) return;
    try {
        await saveApplicationData({ ...suspendedSaveOptions, immediate: true });
    } catch (resumeError) {
        console.warn('No se pudo reanudar el guardado previo tras rollback FULL:', resumeError);
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
        if (ids.has(id)) throw new Error(`El backup contiene el proyecto duplicado "${id}".`);
        ids.add(id);
        project.id = id;
    }

    const projectBackup = data?.projectBackup && typeof data.projectBackup === 'object'
        ? { ...data.projectBackup }
        : {};
    const defaultProjectId = String(projectBackup.defaultProjectId || '').trim();
    if (!defaultProjectId || !ids.has(defaultProjectId)) {
        throw new Error('El proyecto predeterminado del backup no existe en su catálogo.');
    }
    const activeProjectId = String(projectBackup.activeProjectId || defaultProjectId).trim();
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

async function applyFullImport(importedData) {
    const data = importedData.data || {};
    const previousState = snapshotFullImportState();
    const suspendedSaveOptions = beginFullImportIsolation();
    let isolationActive = true;
    let durableCommitted = false;
    let preparedPettyCash = null;
    let projectSurface = null;
    try {
        projectSurface = prepareProjectSurfaceForFullImport(data);
        state.importFullText = '';
        publishFullImportData(data);
        if (typeof sanitizePositions === 'function') sanitizePositions(state);
        invalidateAllStats();
        buildAttendanceIndex();
        if (data.pettyCash && typeof data.pettyCash === 'object') {
            preparedPettyCash = await restorePettyCashFromImport(data.pettyCash);
        }
        let ok;
        // projects + projectPayrollConfigs.
        if (projectSurface) {
            ok = await saveToIndexedDB({
                clearFirst: true,
                projectSurface,
                entityScope: projectSurface.incomingScope
            });
        } else {
            ok = await saveToIndexedDB({ clearFirst: true });
        }
        if (!ok) throw new Error('no se pudo guardar en IndexedDB');
        durableCommitted = true;
        if (projectSurface) {
            commitProjectSurfacePointers(projectSurface, previousState.projectPointers);
        }
        endFullImportIsolation({ commit: true });
        isolationActive = false;
        finalizeFullImportPettyCash(data, preparedPettyCash);
        const cloudSave = await saveApplicationData();
        if (cloudSave && cloudSave.localOk === false) {
            notify('⚠️ Datos importados localmente; la sincronización posterior quedó pendiente.', 'warning');
        }
        notify('✅ Datos importados correctamente', 'success');
        closeImportFullModal();
        closeExportMenuHandler();
        render();
        setTimeout(() => location.reload(), 1500);
    } catch (error) {
        if (!durableCommitted) rollbackFullImportState(previousState);
        if (isolationActive) {
            endFullImportIsolation();
            isolationActive = false;
        }
        if (!durableCommitted) await resumeSuspendedSave(suspendedSaveOptions);
        console.error('Error importando FULL:', error);
        notify('❌ Error al importar: ' + (error?.message || 'falló el guardado'), 'error');
    } finally {
        delete stateManager.getState()?.pettyCash;
        delete state.pettyCash;
    }
}

export function confirmImportFull() {
    try {
        const text = (state.importFullText || '').trim();
        if (!text) {
            notify('❌ Pega los datos FULL primero', 'error');
            return;
        }

        const importedData = JSON.parse(text);
        if (!importedData.data) throw new Error('Formato de datos inválido');

        const employeesCount = (importedData.data.employees || []).length;

        // Close the import modal before asking for confirmation
        state.showImportFullModal = false;
        render();

        if (window.showConfirm) {
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
        console.error('Error importando FULL:', error);
        notify('❌ Error al importar: ' + error.message, 'error');
    }
}

/**
 * 💵 Prepara la caja chica del import FULL de forma pura y segura.
 * No borra ni escribe stores durables de forma aislada: valida y calcula el merge
 * de proyectos, períodos y movimientos para que sea persistido atómicamente en
 * una única frontera multi-store con los datos principales.
 */
async function restorePettyCashFromImport(pettyCashBackup) {
    const prepared = await PettyCashStore.prepareForFullImport(pettyCashBackup);
    if (prepared) {
        stateManager.getState().pettyCash = prepared;
    }
    return prepared;
}

/**
 * 🗂️ ¿El payload trae superficie de proyecto (S1)? Solo lectura: NO adopta,
 * NO reescribe ni toca stores/punteros — el catálogo y la configuración local
 * se preservan tal cual.
 */
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
}
