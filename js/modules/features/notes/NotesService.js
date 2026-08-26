/**
 * 📝 NotesService — Pure data operations for employee notes.
 *
 * Notes live inside attendance records (attendance[empId-date].notes).
 * This module isolates the upsert/clear logic so the UI handlers in app.js
 * (saveNoteModal, deleteNoteModal) can call into a tested core.
 *
 * Sprint 3 will extract the UI shell (NotesCenter, NoteEditorModal) into
 * sibling files; the UI will use these helpers instead of inlining the logic.
 */

import { stampBirthProject } from '../attendance/AttendanceRecordWriter.js';

/**
 * Insert or update a note for an employee on a given date.
 *
 * If no attendance record exists for the date, a minimal one is created
 * (present=false, hoursWorked=0). This matches the existing behavior of
 * window.saveNoteModal in app.js — writing a note doesn't mark the employee
 * as present.
 *
 * @param {object} state         - global state (must have .attendance and .employees)
 * @param {string} employeeId
 * @param {string} dateKey       - 'YYYY-MM-DD'
 * @param {string} text          - the note body (trimmed by caller)
 * @param {object} [opts]
 * @param {boolean} [opts.isHoliday=false]
 * @returns {object|null} the updated attendance record, or null on validation failure
 */
export function upsertNote(state, employeeId, dateKey, text, opts = {}) {
    if (!employeeId || !dateKey) return null;
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return null;

    const key = `${employeeId}-${dateKey}`;
    // F1.5: una nota que NACE con registro mínimo también nace project-aware;
    // un registro preexistente conserva su propio dueño (jamás re-etiquetado).
    const existing = state.attendance[key] || stampBirthProject({
        employeeId,
        date: dateKey,
        present: false,
        hoursWorked: 0,
        overtimeHours: 0,
        isHoliday: !!opts.isHoliday,
        selectedPosition: emp.positions?.[0] || null,
        multiPosition: false,
        positionHours: [],
        notes: ''
    });

    if (!existing.selectedPosition && emp.positions?.[0]) {
        existing.selectedPosition = emp.positions[0];
    }

    existing.notes = trimmed;
    existing._isDirty = true;
    existing.updatedAt = Date.now();
    state.attendance[key] = existing;

    return existing;
}

/**
 * Clear the note on an existing attendance record. The record itself stays
 * (hoursWorked, present, etc. are preserved), only `.notes` is reset.
 *
 * @param {object} state
 * @param {string} employeeId
 * @param {string} dateKey
 * @returns {boolean} true if a record existed and was modified
 */
export function clearNote(state, employeeId, dateKey) {
    if (!employeeId || !dateKey) return false;
    const key = `${employeeId}-${dateKey}`;
    const att = state.attendance[key];
    if (!att) return false;

    att.notes = '';
    att.updatedAt = Date.now();
    att._isDirty = true;
    state.attendance[key] = att;
    return true;
}

/**
 * Return all attendance records that carry a non-empty note, optionally
 * filtered by employeeId. Sorted by date descending (newest first).
 */
export function listNotes(state, employeeId = null) {
    const records = Object.values(state.attendance || {})
        // Fase 1 (U2c): un tombstone no debe mostrar su nota vieja.
        .filter(att => att.deletedAt == null && att.notes && att.notes.trim().length > 0);

    const filtered = employeeId
        ? records.filter(r => r.employeeId === employeeId)
        : records;

    return filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
