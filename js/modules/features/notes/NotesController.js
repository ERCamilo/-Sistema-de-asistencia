/**
 * 📝 NotesController — Handlers for the Notes Center & Note Editor.
 *
 * Owns the state transitions and side effects for the notes UI. The pure
 * data operations live in NotesService.js. This module is the bridge
 * between the data layer and the UI shell (NotesCenter.js / NoteEditorModal.js).
 *
 * Sprint 3 extraction: these functions used to live in app.js as
 * window.* globals. They are now imported here and re-exposed on window
 * for backwards-compat with the data-app-fn event delegation system.
 */

import { state, stateManager, invalidateEmployeeStats, buildAttendanceIndex } from '../../core/AppState.js';
import { getDateKey } from '../../utils/DateUtils.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { render } from '../../core/RenderManager.js';
import { upsertNote, clearNote } from './NotesService.js';

// ─── Open / close the Notes Center ───────────────────────────────────────────

export function openNotesCenter() {
    stateManager.batchSetState(() => {
        state.showNotesCenter = true;
        if (!state.notesCenterEmployeeId) {
            state.notesCenterEmployeeId = null;
        }
        state.showNoteModal = false;
    });
    render();
}

export function closeNotesCenter() {
    stateManager.batchSetState(() => {
        state.showNotesCenter = false;
        state.notesCenterEmployeeId = null;
        state.showNoteModal = false;
    });
    render();
}

export function selectNotesEmployee(employeeId) {
    state.notesCenterEmployeeId = employeeId;
    render();
}

export function backToNotesList() {
    state.notesCenterEmployeeId = null;
    render();
}

// ─── Open / close the per-note editor ────────────────────────────────────────

export function openNoteEditor(employeeId, dateKey) {
    const key = `${employeeId}-${dateKey}`;
    const att = state.attendance[key];
    if (!att || att.deletedAt != null || !att.notes) return; // Fase 1 (U2c): no abrir un tombstone como si tuviera nota

    stateManager.batchSetState(() => {
        state.showNotesCenter = true;
        state.showNoteModal = true;
        state.noteModalEmployeeId = employeeId;
        state.noteModalDate = dateKey;
        state.noteModalText = att.notes || '';
    });
    render();
}

export function openNewNote(employeeId) {
    if (!employeeId) {
        if (typeof window !== 'undefined' && window.showNotification) {
            window.showNotification('❌ Selecciona un empleado primero', 'error');
        }
        return;
    }
    stateManager.batchSetState(() => {
        state.showNotesCenter = true;
        state.showNoteModal = true;
        state.noteModalEmployeeId = employeeId;
        state.noteModalDate = getDateKey(new Date());
        state.noteModalText = '';
        state.notesCenterEmployeeId = employeeId;
    });
    render();
}

export function closeNoteModal() {
    stateManager.batchSetState(() => {
        state.showNoteModal = false;
        state.noteModalEmployeeId = null;
        state.noteModalDate = '';
        state.noteModalText = '';
        state.showNotesCenter = true;
    });
    render();
}

export function setNoteModalText(value) {
    state.noteModalText = value;
}

export function setNoteModalDate(value) {
    state.noteModalDate = value;
}

// ─── Save / delete the current note ──────────────────────────────────────────

export function saveNoteModal() {
    const employeeId = state.noteModalEmployeeId;
    const text = (state.noteModalText || '').trim();
    const dateKey = getDateKey(state.noteModalDate || new Date());

    if (!employeeId) return;
    if (!text) {
        if (window.showNotification) window.showNotification('❌ La nota está vacía', 'error');
        return;
    }

    const result = upsertNote(state, employeeId, dateKey, text);
    if (!result) {
        if (window.showNotification) window.showNotification('❌ Empleado no encontrado', 'error');
        return;
    }

    // Fase 4: coherencia explícita (no depende del proxy ni del modo silencioso)
    invalidateEmployeeStats(employeeId);
    buildAttendanceIndex(dateKey);
    saveApplicationData({ announce: 'Nota guardada' });
    closeNoteModal();
    render();
}

export function deleteNoteModal() {
    const employeeId = state.noteModalEmployeeId;
    const dateKey = state.noteModalDate;
    if (!employeeId || !dateKey) return;

    const confirmFn = (typeof window !== 'undefined' && window.showConfirm) || null;
    if (!confirmFn) return;

    confirmFn({
        title: 'Eliminar nota',
        message: 'Esta acción eliminará la nota de este día.\n¿Deseas continuar?',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        type: 'warning',
        onConfirm: () => {
            clearNote(state, employeeId, dateKey);
            // Fase 4: coherencia explícita (no depende del proxy ni del modo silencioso)
            invalidateEmployeeStats(employeeId);
            buildAttendanceIndex(dateKey);
            saveApplicationData();
            if (window.showNotification) window.showNotification('✅ Nota eliminada', 'success');
            closeNoteModal();
            render();
        }
    });
}

/**
 * Register handlers on window.* for the legacy data-app-fn event delegation.
 * Called once at app boot from app.js.
 */
export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.openNotesCenter = openNotesCenter;
    window.closeNotesCenter = closeNotesCenter;
    window.selectNotesEmployee = selectNotesEmployee;
    window.backToNotesList = backToNotesList;
    window.openNoteEditor = openNoteEditor;
    window.openNewNote = openNewNote;
    window.closeNoteModal = closeNoteModal;
    window.setNoteModalText = setNoteModalText;
    window.setNoteModalDate = setNoteModalDate;
    window.saveNoteModal = saveNoteModal;
    window.deleteNoteModal = deleteNoteModal;
}
