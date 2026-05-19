/**
 * 🧪 NotesServiceTests — Tests for the notes data layer.
 *
 * NotesService is a thin extraction of the data part of window.saveNoteModal
 * and window.deleteNoteModal (currently in app.js). These tests pin the
 * contract so Sprint 3's extraction of NotesCenter UI can rely on them.
 */

import { upsertNote, clearNote, listNotes } from '../modules/features/notes/NotesService.js';

function buildState() {
    return {
        employees: [
            { id: 'emp1', name: 'Ada', positions: ['pos1', 'pos2'] },
            { id: 'emp2', name: 'Grace', positions: [] }
        ],
        attendance: {}
    };
}

testRunner.addSuite("NotesService — upsertNote", {

    "creates a minimal attendance record when none exists"() {
        const state = buildState();
        const rec = upsertNote(state, 'emp1', '2026-05-19', 'first note');

        testRunner.assert(rec !== null, "Record should be returned");
        testRunner.assertEquals(rec.notes, 'first note', "Note text should be saved");
        testRunner.assertEquals(rec.present, false, "Default present must be false");
        testRunner.assertEquals(rec.hoursWorked, 0, "Default hoursWorked must be 0");
        testRunner.assertEquals(
            rec.selectedPosition,
            'pos1',
            "selectedPosition defaults to employee's first position"
        );
        testRunner.assert(
            state.attendance['emp1-2026-05-19'] === rec,
            "Record should be stored under attendance[empId-date]"
        );
    },

    "updates an existing record's notes without changing other fields"() {
        const state = buildState();
        state.attendance['emp1-2026-05-19'] = {
            employeeId: 'emp1',
            date: '2026-05-19',
            present: true,
            hoursWorked: 8,
            overtimeHours: 1,
            selectedPosition: 'pos2',
            notes: ''
        };

        upsertNote(state, 'emp1', '2026-05-19', 'late arrival');

        const rec = state.attendance['emp1-2026-05-19'];
        testRunner.assertEquals(rec.notes, 'late arrival', "Note should be updated");
        testRunner.assertEquals(rec.present, true, "present should be preserved");
        testRunner.assertEquals(rec.hoursWorked, 8, "hoursWorked should be preserved");
        testRunner.assertEquals(rec.overtimeHours, 1, "overtimeHours should be preserved");
        testRunner.assertEquals(rec.selectedPosition, 'pos2', "selectedPosition should be preserved");
    },

    "trims the note text"() {
        const state = buildState();
        const rec = upsertNote(state, 'emp1', '2026-05-19', '   padded note   ');
        testRunner.assertEquals(rec.notes, 'padded note', "Whitespace must be trimmed");
    },

    "returns null when the note is empty after trim"() {
        const state = buildState();
        const rec = upsertNote(state, 'emp1', '2026-05-19', '   ');
        testRunner.assertEquals(rec, null, "Should reject empty notes");
        testRunner.assertEquals(
            Object.keys(state.attendance).length,
            0,
            "No record should be created for empty note"
        );
    },

    "returns null when the employee doesn't exist"() {
        const state = buildState();
        const rec = upsertNote(state, 'ghost', '2026-05-19', 'orphan note');
        testRunner.assertEquals(rec, null, "Unknown employee should be rejected");
    },

    "sets _isDirty flag for sync"() {
        const state = buildState();
        const rec = upsertNote(state, 'emp1', '2026-05-19', 'sync me');
        testRunner.assertEquals(rec._isDirty, true, "_isDirty flag must be set");
    }
});

testRunner.addSuite("NotesService — clearNote", {

    "clears the note but keeps the record"() {
        const state = buildState();
        state.attendance['emp1-2026-05-19'] = {
            employeeId: 'emp1',
            date: '2026-05-19',
            present: true,
            hoursWorked: 8,
            notes: 'something to delete'
        };

        const result = clearNote(state, 'emp1', '2026-05-19');
        const rec = state.attendance['emp1-2026-05-19'];

        testRunner.assertEquals(result, true, "Should return true");
        testRunner.assertEquals(rec.notes, '', "Notes should be empty");
        testRunner.assertEquals(rec.present, true, "Record itself should be preserved");
        testRunner.assertEquals(rec.hoursWorked, 8, "hoursWorked should be preserved");
        testRunner.assertEquals(rec._isDirty, true, "_isDirty should be set");
    },

    "returns false when no record exists"() {
        const state = buildState();
        const result = clearNote(state, 'emp1', '2026-05-19');
        testRunner.assertEquals(result, false, "Should return false for missing record");
    }
});

testRunner.addSuite("NotesService — listNotes", {

    "returns only records with non-empty notes, newest first"() {
        const state = buildState();
        state.attendance = {
            'emp1-2026-05-10': { employeeId: 'emp1', date: '2026-05-10', notes: 'A' },
            'emp1-2026-05-19': { employeeId: 'emp1', date: '2026-05-19', notes: 'B' },
            'emp1-2026-05-15': { employeeId: 'emp1', date: '2026-05-15', notes: '' },
            'emp2-2026-05-12': { employeeId: 'emp2', date: '2026-05-12', notes: 'C' }
        };

        const all = listNotes(state);
        testRunner.assertEquals(all.length, 3, "Should return 3 non-empty notes");
        testRunner.assertEquals(all[0].date, '2026-05-19', "Newest first");
        testRunner.assertEquals(all[2].date, '2026-05-10', "Oldest last");
    },

    "filters by employeeId when provided"() {
        const state = buildState();
        state.attendance = {
            'emp1-2026-05-10': { employeeId: 'emp1', date: '2026-05-10', notes: 'A' },
            'emp2-2026-05-12': { employeeId: 'emp2', date: '2026-05-12', notes: 'B' }
        };
        const onlyEmp1 = listNotes(state, 'emp1');
        testRunner.assertEquals(onlyEmp1.length, 1, "Should filter to emp1");
        testRunner.assertEquals(onlyEmp1[0].employeeId, 'emp1', "Should only contain emp1 notes");
    }
});

console.log('🧪 NotesService tests cargados.');
