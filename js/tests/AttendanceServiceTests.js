/**
 * 🧪 AttendanceServiceTests — Tests for the core attendance toggle flow
 *
 * Covers:
 *   - createRecord() creates a record when none exists (the "toggle on" case)
 *   - createRecord() returns null when employee doesn't exist
 *   - createRecord() respects custom hoursWorked option
 *   - createRecord() picks employee's first position as selectedPosition by default
 *   - updateRecord() merges updates into existing record
 *   - updateRecord() returns null when record doesn't exist
 *   - deleteRecord() removes an existing record (the "toggle off" case)
 *   - deleteRecord() returns false when nothing to delete
 *   - validateRecord() flags invalid hours
 *   - Attendance class: addPositionHours recalculates totals in multi-position mode
 */

import { AttendanceService } from '../modules/features/attendance/AttendanceService.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildState() {
    return {
        settings: { regularHoursPerDay: 8, holidays: [] },
        employees: [
            { id: 'emp1', name: 'Test Employee', positions: ['pos1', 'pos2'], active: true },
            { id: 'emp2', name: 'No Positions', positions: [], active: true }
        ],
        positions: [
            { id: 'pos1', name: 'Pos1', hourlyRate: 100, active: true },
            { id: 'pos2', name: 'Pos2', hourlyRate: 120, active: true }
        ],
        leaders: [],
        attendance: {}
    };
}

// ─────────────────────────────────────────────────────────────
// Suite: AttendanceService — toggle flow
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("AttendanceService — Toggle Flow", {

    "createRecord: creates a new record when none exists (toggle ON)"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const date = '2026-05-19';
        const record = svc.createRecord('emp1', date);

        testRunner.assert(record !== null, "Record should be created");
        testRunner.assertEquals(record.employeeId, 'emp1', "employeeId should match");
        testRunner.assertEquals(record.present, true, "present must default to true on creation");
        testRunner.assertEquals(
            record.hoursWorked,
            8,
            "hoursWorked should default to settings.regularHoursPerDay (8)"
        );
        testRunner.assert(
            state.attendance['emp1-2026-05-19'] === record,
            "Record should be stored in state.attendance under key empId-date"
        );
    },

    "createRecord: returns null when employee doesn't exist"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const record = svc.createRecord('ghost-emp', '2026-05-19');
        testRunner.assertEquals(record, null, "Should return null for unknown employee");
    },

    "createRecord: respects custom hoursWorked option"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const record = svc.createRecord('emp1', '2026-05-19', { hoursWorked: 4 });
        testRunner.assertEquals(record.hoursWorked, 4, "Custom hoursWorked should be honored");
    },

    "createRecord: picks employee's first position as default selectedPosition"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const record = svc.createRecord('emp1', '2026-05-19');
        testRunner.assertEquals(
            record.selectedPosition,
            'pos1',
            "selectedPosition should default to first position of the employee"
        );
    },

    "updateRecord: merges updates into existing record"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        svc.createRecord('emp1', '2026-05-19');
        const updated = svc.updateRecord('emp1', '2026-05-19', {
            hoursWorked: 10,
            notes: 'overtime'
        });

        testRunner.assert(updated !== null, "Update should succeed");
        testRunner.assertEquals(updated.hoursWorked, 10, "hoursWorked should be updated");
        testRunner.assertEquals(updated.notes, 'overtime', "notes should be updated");
        testRunner.assertEquals(
            updated.employeeId,
            'emp1',
            "Original fields should be preserved"
        );
    },

    "updateRecord: returns null when record doesn't exist"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const result = svc.updateRecord('emp1', '2026-05-19', { notes: 'x' });
        testRunner.assertEquals(result, null, "Should return null for missing record");
    },

    "deleteRecord: removes an existing record (toggle OFF)"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        svc.createRecord('emp1', '2026-05-19');
        testRunner.assert(
            state.attendance['emp1-2026-05-19'],
            "Pre-condition: record exists"
        );

        const result = svc.deleteRecord('emp1', '2026-05-19');
        testRunner.assertEquals(result, true, "Delete should return true");
        testRunner.assert(
            state.attendance['emp1-2026-05-19'] === undefined,
            "Record should be gone after delete"
        );
    },

    "deleteRecord: returns false when nothing to delete"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const result = svc.deleteRecord('emp1', '2026-05-19');
        testRunner.assertEquals(result, false, "Should return false when record doesn't exist");
    },

    "validateRecord: flags invalid hours"() {
        const state = buildState();
        const svc = new AttendanceService(state);

        const bad = svc.validateRecord({
            employeeId: 'emp1',
            date: '2026-05-19',
            hoursWorked: 30,    // too high
            overtimeHours: -1   // negative
        });
        testRunner.assertEquals(bad.valid, false, "Should be invalid");
        testRunner.assert(bad.errors.length >= 2, "Should report at least 2 errors");

        const good = svc.validateRecord({
            employeeId: 'emp1',
            date: '2026-05-19',
            hoursWorked: 8,
            overtimeHours: 0
        });
        testRunner.assertEquals(good.valid, true, "Valid record should pass");
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: Attendance class — multi-position behavior
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("Attendance class — Multi-position hours", {

    "addPositionHours: stores hours per position"() {
        const att = new Attendance({
            employeeId: 'emp1',
            date: '2026-05-19',
            multiPosition: true
        });
        att.addPositionHours('pos1', 5);
        att.addPositionHours('pos2', 3);

        testRunner.assertEquals(
            att.positionHours.length,
            2,
            "Should have 2 position entries"
        );
    },

    "addPositionHours: updates existing entry instead of duplicating"() {
        const att = new Attendance({
            employeeId: 'emp1',
            date: '2026-05-19',
            multiPosition: true
        });
        att.addPositionHours('pos1', 4);
        att.addPositionHours('pos1', 6); // same positionId, updated hours

        testRunner.assertEquals(att.positionHours.length, 1, "Should not duplicate pos1");
        testRunner.assertEquals(att.positionHours[0].hours, 6, "Hours should be updated to 6");
    },

    "recalculateTotals: sums hours across positions in multi-position mode"() {
        const att = new Attendance({
            employeeId: 'emp1',
            date: '2026-05-19',
            multiPosition: true
        });
        att.addPositionHours('pos1', 5, 1);
        att.addPositionHours('pos2', 3, 0);

        testRunner.assertEquals(
            att.hoursWorked,
            8,
            "hoursWorked should equal sum of all position hours"
        );
        testRunner.assertEquals(
            att.overtimeHours,
            1,
            "overtimeHours should equal sum of all position overtime"
        );
    }
});

console.log('🧪 AttendanceService tests cargados.');
