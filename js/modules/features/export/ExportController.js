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

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData, sanitizePositions } from '../../services/PersistenceService.js';
import { openExportMenu, closeExportMenu } from './ExportMenuService.js';

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
    });
    render();
}

export function closeExportMenuHandler() {
    stateManager.batchSetState(() => {
        closeExportMenu(state);
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
    state.showShareOptions = !state.showShareOptions;
    render();
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

// ─── Share via clipboard: MINI (just #, name, position) ──────────────────────

export async function shareExportMini() {
    try {
        state.isExporting = true;
        render();

        const mini = state.employees.map(emp => {
            const posId = emp.positions && emp.positions.length ? emp.positions[0] : null;
            const pos = posId ? state.positions.find(p => p.id === posId) : null;
            return {
                number: `${emp.number ?? ''}`,
                name: emp.name || '',
                position: pos ? pos.name : ''
            };
        });

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

// ─── Import FULL: replace all state from pasted JSON ─────────────────────────

export function openImportFullModal() {
    state.showImportFullModal = true;
    state.importFullText = '';
    render();
}

export function closeImportFullModal() {
    state.showImportFullModal = false;
    state.importFullText = '';
    render();
}

export function setImportFullText(value) {
    state.importFullText = value;
}

function applyFullImport(importedData) {
    // Batch 7 large state replacements — without this, each one would trigger
    // a render + buildAttendanceIndex run (attendance) + statsCache invalidation.
    stateManager.batchSetState(() => {
        state.settings = importedData.data.settings || state.settings;
        state.positions = importedData.data.positions || [];
        state.employees = importedData.data.employees || [];
        state.leaders = importedData.data.leaders || [];
        state.attendance = importedData.data.attendance || {};
        state.tempAssignments = importedData.data.tempAssignments || [];
        state.dayHoursConfig = importedData.data.dayHoursConfig || {};
    });

    // Defensive sanitization before persisting
    if (typeof sanitizePositions === 'function') {
        sanitizePositions(state);
    }

    saveApplicationData();
    notify('✅ Datos importados correctamente', 'success');
    closeImportFullModal();
    closeExportMenuHandler();
    render();

    // Hard reload to guarantee every cache is in sync with the new data
    setTimeout(() => location.reload(), 1500);
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
    window.openImportFullModal = openImportFullModal;
    window.closeImportFullModal = closeImportFullModal;
    window.setImportFullText = setImportFullText;
    window.confirmImportFull = confirmImportFull;
}
