import { stampAttendanceWrite, tombstoneAttendanceWrite } from './AttendanceRecordWriter.js';

function cloneAttendanceRecord(record) {
    if (!record) return null;
    return {
        ...record,
        positionHours: Array.isArray(record.positionHours)
            ? record.positionHours.map(item => ({ ...item }))
            : []
    };
}

/**
 * Builds the writes required to mark only the visible, absent employees present.
 * The returned plan is pure and can be applied inside a single state batch.
 */
export function buildMarkVisiblePresentPlan({
    employees,
    attendance,
    dateKey,
    dayHours,
    isHoliday,
    now = Date.now()
}) {
    return employees.flatMap(employee => {
        const key = `${employee.id}-${dateKey}`;
        const previous = attendance[key];
        if (previous?.present) return [];

        return [{
            key,
            employeeId: employee.id,
            previous: cloneAttendanceRecord(previous),
            next: stampAttendanceWrite({
                employeeId: employee.id,
                date: dateKey,
                present: true,
                hoursWorked: dayHours,
                overtimeHours: 0,
                isHoliday,
                selectedPosition: employee.positions?.[0] || null,
                multiPosition: false,
                positionHours: [],
                notes: ''
            }, now)
        }];
    });
}

/**
 * Builds tombstones for visible employees that currently have attendance.
 */
export function buildClearVisibleAttendancePlan({
    employees,
    attendance,
    dateKey,
    now = Date.now()
}) {
    return employees.flatMap(employee => {
        const key = `${employee.id}-${dateKey}`;
        const previous = attendance[key];
        if (!previous?.present) return [];

        return [{
            key,
            employeeId: employee.id,
            previous: cloneAttendanceRecord(previous),
            next: tombstoneAttendanceWrite(previous, now)
        }];
    });
}

/**
 * Restores a bulk-operation snapshot through the same local-write choke point.
 */
export function buildBulkUndoPlan(changes, attendance, now = Date.now()) {
    return changes.map(change => ({
        key: change.key,
        employeeId: change.employeeId,
        next: change.previous
            ? stampAttendanceWrite(cloneAttendanceRecord(change.previous), now)
            : tombstoneAttendanceWrite(attendance[change.key], now)
    }));
}
