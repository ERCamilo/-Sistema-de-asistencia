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
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { assertVoiceFormContext, hasVoiceSource, validVoiceDate } from '../voice/VoiceActionDrafts.js';
import { upsertNote, clearNote } from './NotesService.js';

let voiceNoteContext = null;
const notifyVoiceNote = message => window.showNotification?.(message, 'error');
function changeVoiceNoteDraft() {
    voiceNoteContext?.onChange?.({ text: state.noteModalText, date: state.noteModalDate });
}
/** Prefills the ordinary editor; the existing save button remains the only writer. */
export function openVoiceNoteDraft(employeeId, context) {
    assertVoiceFormContext(context, employeeId);
    if (state.showNoteModal) throw Error('Cierra la nota abierta antes de abrir el borrador de voz.');
    const emp = state.employees.find(e => String(e.id) === String(employeeId));
    if (!emp || !entityInScope(emp, peekEntityScope())) throw Error('Empleado no disponible en la obra activa.');
    openNewNote(employeeId);
    voiceNoteContext = context;
    stateManager.batchSetState(() => {
        state.noteModalText = context.draft.text || '';
        state.noteModalDate = context.draft.date;
        state.noteModalVoice = { transcript: context.transcript, issues: context.issues, needsReview: context.needsReview };
    });
    render();
}

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
    changeVoiceNoteDraft(); voiceNoteContext = null; stateManager.batchSetState(() => {
        state.noteModalVoice = null;
    });

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
    voiceNoteContext = null; stateManager.batchSetState(() => {
        state.noteModalVoice = null;
    });
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

export function changeVoiceNoteEmployee() {
    const context = voiceNoteContext;
    if (!context) return;
    try { assertVoiceFormContext(context, state.noteModalEmployeeId); }
    catch (error) { notifyVoiceNote(error.message); return; }
    closeNoteModal();
    stateManager.batchSetState(() => {
        state.showNotesCenter = false;
    });
    render(); context.changeEmployee?.();
}
export function closeNoteModal() {
    changeVoiceNoteDraft();
    voiceNoteContext = null; stateManager.batchSetState(() => {
        state.noteModalVoice = null;
    });
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
    state.noteModalText = value; changeVoiceNoteDraft();
}

export function setNoteModalDate(value) {
    state.noteModalDate = value; changeVoiceNoteDraft();
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

    const context = voiceNoteContext;
    let finalText = text;
    if (state.noteModalVoice) {
        try {
            if (!context) throw Error('Vuelve a abrir el borrador desde Voz.');
            assertVoiceFormContext(context, employeeId);
            if (!validVoiceDate(state.noteModalDate)) throw Error('Selecciona una fecha válida.');
            const emp = state.employees.find(e => String(e.id) === String(employeeId));
            const existing = state.attendance[`${employeeId}-${dateKey}`];
            if (!emp || !entityInScope(emp, peekEntityScope()) || existing && !entityInScope(existing, peekEntityScope())) throw Error('La nota no pertenece a la obra activa.');
            if (existing?.deletedAt != null) throw Error('La asistencia de ese día fue eliminada. Revisa el registro antes de añadir una nota.');
            if (hasVoiceSource(Object.values(state.attendance).flatMap(a => a.voiceNoteRequests || []), context)) throw Error('Esta grabación ya se utilizó para guardar una nota.');
            finalText = [existing?.notes?.trim(), text].filter(Boolean).join('\n');
        } catch (error) { notifyVoiceNote(error.message); return; }
    }
    const result = upsertNote(state, employeeId, dateKey, finalText, context ? { voiceSource: { voiceRequestId: context.requestId, voiceActorUid: context.uid } } : {});
    if (!result) {
        if (window.showNotification) window.showNotification('❌ Empleado no encontrado', 'error');
        return;
    }

    // Fase 4: coherencia explícita (no depende del proxy ni del modo silencioso)
    invalidateEmployeeStats(employeeId);
    buildAttendanceIndex(dateKey);
    saveApplicationData({ announce: 'Nota guardada' });
    voiceNoteContext = null;
    closeNoteModal();
    context?.onSaved?.();
    render();
}

export function deleteNoteModal() {
    if (state.noteModalVoice) return;
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
    window.changeVoiceNoteEmployee = changeVoiceNoteEmployee;
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
