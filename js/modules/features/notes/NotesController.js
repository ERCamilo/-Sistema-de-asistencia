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
import { attendanceRetentionStart } from '../../services/AttendanceRetentionPolicy.js';
import { ensureAllAttendanceHistory, ensureAttendanceRange, saveApplicationData } from '../../services/PersistenceService.js';
import { render } from '../../core/RenderManager.js';
import { entityInScope, peekEntityScope } from '../projects/ProjectContext.js';
import { assertVoiceFormContext, hasVoiceSource, validVoiceDate } from '../voice/VoiceActionDrafts.js';
import { upsertNote, clearNote, noteCanBeEdited } from './NotesService.js';

let voiceNoteContext = null;
let editor = null;
let saving = false;

function notesScopeKey() {
    return JSON.stringify([window.currentUser?.uid ?? null, peekEntityScope()]);
}

function noteTarget(employeeId, date, scopeKey = notesScopeKey()) {
    const scope = peekEntityScope();
    const employee = state.employees.find(e => e.id === employeeId);
    const row = state.attendance[`${employeeId}-${date}`];
    if (!validVoiceDate(date)) throw Error('Selecciona una fecha válida.');
    if (scopeKey !== notesScopeKey() || !employee || !entityInScope(employee, scope) || row && !entityInScope(row, scope)) {
        throw Error('La nota no pertenece a la cuenta u obra activa.');
    }
    if (row && !noteCanBeEdited(row)) throw Error('La asistencia de ese día fue eliminada. Revisa el registro antes de guardar una nota.');
    return row;
}
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

export async function loadNotesHistory() {
    const scopeKey = notesScopeKey();
    try { await ensureAllAttendanceHistory(); }
    catch (_) {
        if (scopeKey === notesScopeKey()) notifyVoiceNote('No se pudo cargar más historial. Puedes seguir consultando las notas disponibles.');
    }
    if (scopeKey === notesScopeKey() && state.showNotesCenter) render();
}

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
    changeVoiceNoteDraft();
    editor = null;
    voiceNoteContext = null;
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
    if (!att || !noteCanBeEdited(att) || !att.notes) return; // Fase 1 (U2c): no abrir un tombstone como si tuviera nota
    try { noteTarget(employeeId, dateKey); } catch (error) { notifyVoiceNote(error.message); return; }
    editor = { date: dateKey, scope: notesScopeKey(), text: att.notes };
    changeVoiceNoteDraft(); voiceNoteContext = null; stateManager.batchSetState(() => {
        state.noteModalVoice = null;
    });

    stateManager.batchSetState(() => {
        state.showNotesCenter = true;
        state.showNoteModal = true;
        state.noteModalEmployeeId = employeeId;
        state.noteModalDate = dateKey;
        state.noteModalEditing = true;
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
    editor = { date: null, scope: notesScopeKey() };
    voiceNoteContext = null;
    stateManager.batchSetState(() => {
        state.noteModalVoice = null;
        state.showNotesCenter = true;
        state.showNoteModal = true;
        state.noteModalEmployeeId = employeeId;
        state.noteModalDate = getDateKey(new Date());
        state.noteModalEditing = false;
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
    editor = null;
    changeVoiceNoteDraft();
    voiceNoteContext = null; stateManager.batchSetState(() => {
        state.noteModalVoice = null;
    });
    stateManager.batchSetState(() => {
        state.showNoteModal = false;
        state.noteModalEmployeeId = null;
        state.noteModalDate = '';
        state.noteModalText = '';
        state.noteModalEditing = false;
        state.showNotesCenter = true;
    });
    render();
}

export function setNoteModalText(value) {
    state.noteModalText = value; changeVoiceNoteDraft();
}

export function setNoteModalDate(value) {
    if (editor?.date) return;
    state.noteModalDate = value; changeVoiceNoteDraft();
}

// ─── Save / delete the current note ──────────────────────────────────────────

export async function saveNoteModal() {
    if (saving) return;
    const employeeId = state.noteModalEmployeeId;
    const text = (state.noteModalText || '').trim();
    const dateKey = editor?.date ?? state.noteModalDate;
    const opening = editor;

    if (!employeeId) return;
    if (!text) {
        if (window.showNotification) window.showNotification('❌ La nota está vacía', 'error');
        return;
    }

    const context = voiceNoteContext;
    const key = `${employeeId}-${dateKey}`;
    let existing;
    try {
        existing = noteTarget(employeeId, dateKey, opening?.scope);
        if (!existing && dateKey < attendanceRetentionStart()) {
            await ensureAttendanceRange(dateKey, dateKey);
            if (editor !== opening || state.noteModalEmployeeId !== employeeId || state.noteModalDate !== dateKey || state.noteModalText.trim() !== text) return;
            existing = noteTarget(employeeId, dateKey, opening?.scope);
        }
        if (opening?.date && existing?.notes !== opening.text) throw Error('La nota cambió en otro lugar. Vuelve a abrirla para revisar el texto actual.');
        if (state.noteModalVoice) {
            if (!context) throw Error('Vuelve a abrir el borrador desde Voz.');
            assertVoiceFormContext(context, employeeId);
            if (hasVoiceSource(Object.values(state.attendance).flatMap(a => a.voiceNoteRequests || []), context)) throw Error('Esta grabación ya se utilizó para guardar una nota.');
        }
    } catch (error) { notifyVoiceNote(error.message); return; }

    const finalText = opening && !opening.date ? [existing?.notes?.trim(), text].filter(Boolean).join('\n') : text;
    const result = upsertNote(state, employeeId, dateKey, finalText, context ? { voiceSource: { voiceRequestId: context.requestId, voiceActorUid: context.uid } } : {});
    if (!result) {
        if (window.showNotification) window.showNotification('❌ Empleado no encontrado', 'error');
        return;
    }

    // Fase 4: coherencia explícita (no depende del proxy ni del modo silencioso)
    invalidateEmployeeStats(employeeId);
    buildAttendanceIndex(dateKey);
    const options = { dateKey, announce: 'Nota guardada' };
    if (context) {
        saving = true;
        let saved;
        try {
            saved = await saveApplicationData({ ...options, immediate: true, requireLocalSuccess: true });
        } catch (_) {
            saved = null;
        } finally {
            saving = false;
        }
        if (!saved?.localOk) {
            if (opening?.scope === notesScopeKey() && state.attendance[key]?.noteUpdatedAt === result.noteUpdatedAt) {
                stateManager.batchSetState(() => {
                    const current = state.attendance[key];
                    if (!existing && current.updatedAt === -1) delete state.attendance[key];
                    else {
                        const restored = { ...current, notes: existing?.notes ?? '' };
                        for (const field of ['noteUpdatedAt', 'voiceNoteRequests']) {
                            if (existing?.[field] === undefined) delete restored[field];
                            else restored[field] = existing[field];
                        }
                        state.attendance[key] = restored;
                    }
                    buildAttendanceIndex(dateKey);
                });
            }
            notifyVoiceNote('No se pudo guardar la nota en este dispositivo. El borrador de voz sigue disponible.');
            return;
        }
        context.onSaved?.();
    } else {
        saveApplicationData(options);
    }
    if (editor === opening) {
        voiceNoteContext = null;
        closeNoteModal();
    }
    render();
}

export function deleteNoteModal() {
    if (state.noteModalVoice) return;
    const employeeId = state.noteModalEmployeeId;
    const opening = editor;
    const dateKey = opening?.date;
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
            if (editor !== opening) return;
            try {
                if (noteTarget(employeeId, dateKey, opening.scope)?.notes !== opening.text) {
                    throw Error('La nota cambió. Vuelve a abrirla antes de eliminarla.');
                }
                if (!clearNote(state, employeeId, dateKey)) return;
            } catch (error) { notifyVoiceNote(error.message); return; }
            // Fase 4: coherencia explícita (no depende del proxy ni del modo silencioso)
            invalidateEmployeeStats(employeeId);
            buildAttendanceIndex(dateKey);
            saveApplicationData({ dateKey, announce: 'Nota eliminada' });
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
    window.loadNotesHistory = loadNotesHistory;
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
