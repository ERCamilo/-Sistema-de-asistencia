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
import { readNoteCard, updateNoteCard } from './NoteCardState.js';
import { notesEmployees, readNotesCards } from './NotesCenterModel.js';
import { upsertNote, clearNote, noteCanBeEdited } from './NotesService.js';

let voiceNoteContext = null;
let editor = null;
let saving = false;
let center;
const EMPTY_CENTER = { folder: 'active', search: '', searching: false, selected: null, choosing: false, undo: null };

export function notesCenterView() {
    const scope = notesScopeKey();
    if (!center || center.scope !== scope) center = { ...EMPTY_CENTER, scope };
    return center;
}

function findCard(key) {
    return readNotesCards(state).find(card => card.key === key);
}

function updateNotesView(patch) {
    Object.assign(notesCenterView(), patch);
    render();
}

function persistCard(card, change) {
    const { record } = card;
    const key = `${record.employeeId}-${record.date}`;
    // Initialize a legacy note revision on first use so attendance edits
    // on other devices cannot erase the note while filing it.
    const changed = updateNoteCard({
        ...record, noteUpdatedAt: record.noteUpdatedAt ?? Math.max(0, record.updatedAt || 0)
    }, change);
    stateManager.batchSetState(() => {
        state.attendance[key] = { ...changed, _isDirty: true };
        invalidateEmployeeStats(record.employeeId);
        buildAttendanceIndex(record.date);
    });
    // Leave the prior text intact even if the device can't persist the filing.
    Promise.resolve(saveApplicationData({ dateKey: record.date, immediate: true })).then(result => {
        if (result?.localOk === false) notifyVoiceNote('No se pudo guardar el estado de la nota. Revisa el almacenamiento y vuelve a intentarlo.');
    }).catch(() => notifyVoiceNote('No se pudo guardar el estado de la nota.'));
    return changed.noteCard;
}

export function actOnNoteCard(key, action) {
    if (!state.showNotesCenter) return;
    const card = findCard(key);
    if (!card) return;
    const view = notesCenterView();
    if (action === 'open') { updateNotesView({ selected: key }); return; }
    if (action === 'edit' && card.folder !== 'trash') {
        openNoteEditor(card.record.employeeId, card.record.date);
        return;
    }
    const previous = readNoteCard(card.record);
    const changes = {
        pin: { pinned: !card.pinned },
        archive: { folder: 'archive', pinned: false },
        trash: { folder: 'trash', pinned: false },
        restore: { folder: 'active', pinned: false }
    };
    const change = Object.hasOwn(changes, action) ? changes[action] : null;
    if (!change || action === 'pin' && card.folder !== 'active' ||
        action === 'archive' && card.folder !== 'active' ||
        action === 'trash' && card.folder === 'trash' ||
        action === 'restore' && card.folder === 'active') return;
    const revision = persistCard(card, change);
    view.undo = { key, previous, revision, message: {
        pin: card.pinned ? 'Nota desfijada' : 'Nota fijada',
        archive: 'Nota archivada', trash: 'Nota en papelera', restore: 'Nota restaurada'
    }[action] };
    if (change.folder && view.selected === key) view.selected = null;
    render();
}

export function undoNoteCard() {
    if (!state.showNotesCenter) return;
    const view = notesCenterView();
    const undo = view.undo;
    view.undo = null;
    const card = undo && findCard(undo.key);
    if (card && card.updatedAt === undo.revision.updatedAt &&
        card.folder === undo.revision.folder && card.pinned === undo.revision.pinned) {
        persistCard(card, undo.previous);
    }
    render();
}

function registerNotesCenterActions() {
    Object.assign(window, {
        actOnNoteCard,
        undoNoteCard,
        notesBackToInbox: () => updateNotesView({ selected: null, choosing: false }),
        notesChooseEmployee: () => updateNotesView({ choosing: true }),
        notesCreateForEmployee: employeeId => {
            if (!state.showNotesCenter || !notesCenterView().choosing) return;
            const employee = notesEmployees(state).find(item => String(item.id) === String(employeeId));
            if (!employee) return;
            updateNotesView({ choosing: false });
            openNewNote(employee.id);
        },
        notesChooseFolder: folder => {
            if (['active', 'archive', 'trash'].includes(folder)) updateNotesView({ folder, selected: null, search: '' });
        },
        notesToggleSearch: () => {
            const searching = !notesCenterView().searching;
            updateNotesView({ searching, search: '' });
            if (searching) requestAnimationFrame(() => document.querySelector('#notes-search')?.focus());
        },
        notesChangeSearch: value => updateNotesView({ search: String(value).slice(0, 200) }),
        notesDismissFeedback: () => updateNotesView({ undo: null })
    });
    registerNoteSwipes();
}

// Reveal a button rather than filing on release. Vertical scroll and
// keyboard access to the same command remain available through the menu.
let swipesRegistered = false;
function registerNoteSwipes() {
    if (swipesRegistered) return;
    swipesRegistered = true;
    let gesture;
    let ignoreClickUntil = 0;
    document.addEventListener('pointerdown', event => {
        const row = event.target.closest?.('[data-note-swipe]');
        if (row && event.isPrimary && event.button === 0 && !event.target.closest('summary')) {
            gesture = { row, x: event.clientX, y: event.clientY, id: event.pointerId };
        }
    });
    document.addEventListener('pointerup', event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const { row, x, y } = gesture;
        gesture = null;
        const dx = event.clientX - x;
        const dy = event.clientY - y;
        if (!row.isConnected || Math.abs(dx) < 36 || Math.abs(dx) <= Math.abs(dy) * 1.4) return;
        for (const item of row.closest('.notes-center').querySelectorAll('[data-note-swipe]')) {
            const reveal = item === row && dx < 0;
            item.classList.toggle('is-revealed', reveal);
            item.querySelector('.notes-center__swipe-action').hidden = !reveal;
        }
        ignoreClickUntil = Date.now() + 140;
    });
    document.addEventListener('pointercancel', () => { gesture = null; });
    document.addEventListener('click', event => {
        if (Date.now() < ignoreClickUntil && event.target.closest?.('.notes-center__card-open')) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
}


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
    if (row && readNoteCard(row).folder === 'trash') throw Error('Restaura la nota desde la papelera antes de editar ese día.');
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
    center = { ...EMPTY_CENTER, scope: notesScopeKey() };
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
    center = null;
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
    registerNotesCenterActions();
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
