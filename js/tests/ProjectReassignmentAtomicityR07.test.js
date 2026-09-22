/**
 * R07 A1 — ProjectReassignmentAtomicityR07
 *
 * The pure reassignment planner must be all-or-nothing: it either returns a
 * complete plan (employee + matching attendance rewritten, everything else
 * preserved) or a conflict result with NO partial mutations. Inputs are never
 * mutated; persistence/transaction wiring is A2.
 */
import {
    planEmployeeProjectReassignment
} from '../modules/features/projects/ProjectOwnershipReconciliation.js';

const CATALOG = [
    { id: 'PRJ-origin-0001', name: 'Obra Origen', status: 'active' },
    { id: 'PRJ-target-0002', name: 'Obra Destino', status: 'active' }
];

function makeEmployee() {
    return {
        id: 'emp-1789749741792',
        number: '34',
        name: 'Andres Sanchez',
        projectId: 'PRJ-origin-0001',
        active: true,
        positions: ['pos-master'],
        loans: [{ id: 'loan-34', amount: 500, balance: 250, status: 'active' }]
    };
}

function makeAttendance() {
    return {
        'emp-1789749741792-2026-09-18': {
            employeeId: 'emp-1789749741792',
            date: '2026-09-18',
            present: true,
            hoursWorked: 8,
            projectId: 'PRJ-origin-0001'
        },
        'emp-1789749741792-2026-09-19': {
            employeeId: 'emp-1789749741792',
            date: '2026-09-19',
            present: false,
            hoursWorked: 0,
            projectId: 'PRJ-origin-0001'
        },
        'emp-1789586033810-2026-09-18': {
            employeeId: 'emp-1789586033810',
            date: '2026-09-18',
            present: true,
            hoursWorked: 8,
            projectId: 'PRJ-origin-0001'
        }
    };
}

function snapshot(value) {
    return JSON.stringify(value);
}

describe('ProjectReassignmentAtomicityR07', () => {
    test('happy path: plan rewrites employee + matching attendance only, preserving id/number/loans', () => {
        const employee = makeEmployee();
        const attendance = makeAttendance();
        const before = snapshot({ employee, attendance });

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(true);
        expect(plan.conflicts).toEqual([]);

        // employee: ownership rewritten; identity + loans untouched
        expect(plan.employee.projectId).toBe('PRJ-target-0002');
        expect(plan.employee.id).toBe('emp-1789749741792');
        expect(plan.employee.number).toBe('34');
        expect(plan.employee.loans).toEqual([{ id: 'loan-34', amount: 500, balance: 250, status: 'active' }]);

        // attendance: only THIS employee's records are matched, keys preserved.
        // Their VALID origin ownership is preserved (R07 repair is NOT a future
        // transfer A->B; valid historical ownership remains historical truth).
        expect(plan.attendanceRecords.map(r => r.key).sort()).toEqual([
            'emp-1789749741792-2026-09-18',
            'emp-1789749741792-2026-09-19'
        ]);
        for (const { record } of plan.attendanceRecords) {
            expect(record.projectId).toBe('PRJ-origin-0001');
            expect(record.employeeId).toBe('emp-1789749741792');
        }

        // inputs were NOT mutated
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('other employees attendance is left untouched (not claimed, not a conflict)', () => {
        const employee = makeEmployee();
        const attendance = makeAttendance(); // includes emp-1789586033810 record
        const before = snapshot({ employee, attendance });

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(true);
        // only this employee's records are rewritten; emp-405 record untouched
        expect(plan.attendanceRecords.map(r => r.key)).not.toContain('emp-1789586033810-2026-09-18');
        expect(attendance['emp-1789586033810-2026-09-18'].projectId).toBe('PRJ-origin-0001');
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('conflict: attendance record keyed for this employee but owned by another employee fails whole plan', () => {
        const employee = makeEmployee();
        const attendance = {
            'emp-1789749741792-2026-09-18': {
                employeeId: 'emp-1789586033810', // contradiction: keyed as emp-34, owned by emp-405
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };
        const before = snapshot({ employee, attendance });

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts.some(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH')).toBe(true);
        const mismatch = plan.conflicts.find(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH');
        expect(mismatch.expectedEmployeeId).toBe('emp-1789749741792');
        expect(mismatch.actualEmployeeId).toBe('emp-1789586033810');

        // no partial mutation leaked into inputs
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('conflict: invalid target (empty / quarantine sentinel / not in catalog) fails closed', () => {
        const employee = makeEmployee();

        const empty = planEmployeeProjectReassignment({
            employee, attendance: {}, targetProjectId: '   ', catalog: CATALOG
        });
        expect(empty.ok).toBe(false);
        expect(empty.conflicts.some(c => c.code === 'INVALID_TARGET_PROJECT')).toBe(true);

        const sentinel = planEmployeeProjectReassignment({
            employee, attendance: {}, targetProjectId: 'legacy-unresolved:num:34', catalog: CATALOG
        });
        expect(sentinel.ok).toBe(false);
        expect(sentinel.conflicts.some(c => c.code === 'INVALID_TARGET_PROJECT')).toBe(true);

        const ghost = planEmployeeProjectReassignment({
            employee, attendance: {}, targetProjectId: 'PRJ-ghost-9999', catalog: CATALOG
        });
        expect(ghost.ok).toBe(false);
        expect(ghost.conflicts.some(c => c.code === 'TARGET_PROJECT_NOT_IN_CATALOG')).toBe(true);

        // every failure returns no partial plan
        for (const plan of [empty, sentinel, ghost]) {
            expect(plan.employee).toBeNull();
            expect(plan.attendanceRecords).toBeNull();
        }
    });

    test('no partial returned mutations: plan is deep-copied, mutating it does not touch inputs', () => {
        const employee = makeEmployee();
        const attendance = makeAttendance();
        const before = snapshot({ employee, attendance });

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(true);

        // tamper with the plan output
        plan.employee.projectId = 'PRJ-TAMPERED';
        plan.employee.loans[0].balance = 999999;
        plan.attendanceRecords[0].record.projectId = 'PRJ-TAMPERED';

        expect(snapshot({ employee, attendance })).toBe(before);
        expect(employee.projectId).toBe('PRJ-origin-0001');
        expect(attendance['emp-1789749741792-2026-09-18'].projectId).toBe('PRJ-origin-0001');
    });

    test('all-or-nothing across combined conflicts: target invalid + key/owner mismatch => single fail', () => {
        const employee = makeEmployee();
        const attendance = {
            'emp-1789749741792-2026-09-18': {
                employeeId: 'emp-1789586033810',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-ghost-9999',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        // both conflicts reported; nothing half-applied
        expect(plan.conflicts.some(c => c.code === 'TARGET_PROJECT_NOT_IN_CATALOG')).toBe(true);
        expect(plan.conflicts.some(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH')).toBe(true);
    });

    test('employee id prefix collision does not claim another employee attendance (emp-1 vs emp-10)', () => {
        const employee = {
            ...makeEmployee(),
            id: 'emp-1',
            number: '1',
            projectId: 'PRJ-origin-0001'
        };
        const attendance = {
            'emp-10-2026-09-18': {
                employeeId: 'emp-10',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(true);
        expect(plan.conflicts).toEqual([]);
        expect(plan.attendanceRecords).toEqual([]);
        expect(attendance['emp-10-2026-09-18'].projectId).toBe('PRJ-origin-0001');
    });

    test('attendance records without employeeId are not claimed (not clearly owned)', () => {
        const employee = makeEmployee();
        const attendance = {
            'orphan-2026-09-18': { date: '2026-09-18', present: true, hoursWorked: 4 }
        };

        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });

        expect(plan.ok).toBe(true);
        expect(plan.attendanceRecords).toEqual([]);
    });

    test('R07-hardening: stable employee.id is required — number-only employee never returns a successful plan', () => {
        const numberOnly = { number: '34', name: 'Sin Id', projectId: 'PRJ-origin-0001', loans: [] };
        const plan = planEmployeeProjectReassignment({
            employee: numberOnly,
            attendance: {},
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts.some(c => c.code === 'INVALID_EMPLOYEE')).toBe(true);

        const emptyId = { id: '   ', number: '34', name: 'Id Vacio', projectId: 'PRJ-origin-0001' };
        const emptyPlan = planEmployeeProjectReassignment({
            employee: emptyId,
            attendance: {},
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(emptyPlan.ok).toBe(false);
        expect(emptyPlan.conflicts.some(c => c.code === 'INVALID_EMPLOYEE')).toBe(true);

        const missing = planEmployeeProjectReassignment({
            employee: null,
            attendance: {},
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(missing.ok).toBe(false);
        expect(missing.conflicts.some(c => c.code === 'INVALID_EMPLOYEE')).toBe(true);
    });

    test('R07-hardening: canonical key mismatch fails closed (owner is emp but key contradicts employeeId-date)', () => {
        const employee = makeEmployee();
        const attendance = {
            // Payload says emp-34 / 2026-09-18, so canonical is emp-34-2026-09-18 — this key lies.
            'emp-1789749741792-2026-09-19': {
                employeeId: 'emp-1789749741792',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };
        const before = snapshot({ employee, attendance });
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts.some(c => c.code === 'ATTENDANCE_KEY_MISMATCH' || c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH')).toBe(true);
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('R07-hardening: map key claiming this employee with missing payload owner fails closed', () => {
        const employee = makeEmployee();
        const attendance = {
            'emp-1789749741792-2026-09-18': {
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
                // no employeeId, but the key is exactly this employee's canonical key
            }
        };
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts.some(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH')).toBe(true);
    });

    test('R07-hardening M1: namespace-occupying key with disagreeing payload fails closed (emp-34 vs emp-405)', () => {
        // GLM MEDIUM M1: key `emp-34-2026-09-18` occupies emp-34's canonical
        // namespace (safe delimiter prefix `emp-34-`) yet the payload claims
        // a different owner/date (`emp-405`/`2026-09-19`). Exact canonical
        // equality alone misses this (dates differ), so the delimiter-prefix
        // namespace check must fail closed. Arrays/synthetic keys stay exempt;
        // `emp-1` vs `emp-10` safety is preserved by the delimiter.
        const employee = { ...makeEmployee(), id: 'emp-34', number: '34', projectId: 'PRJ-origin-0001' };
        const attendance = {
            'emp-34-2026-09-18': {
                employeeId: 'emp-405',
                date: '2026-09-19',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };
        const before = snapshot({ employee, attendance });
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts.some(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH')).toBe(true);
        const mismatch = plan.conflicts.find(c => c.code === 'ATTENDANCE_EMPLOYEE_MISMATCH');
        expect(mismatch.attendanceKey).toBe('emp-34-2026-09-18');
        expect(mismatch.expectedEmployeeId).toBe('emp-34');
        expect(mismatch.actualEmployeeId).toBe('emp-405');
        // No partial mutation leaked into inputs.
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('R07-hardening: substring in key never claims attendance (emp-1 must not match prefix-emp-1-suffix)', () => {
        const employee = { ...makeEmployee(), id: 'emp-1', number: '1' };
        const attendance = {
            // Contains "emp-1" as a substring but is not the canonical "emp-1-2026-09-18".
            'prefix-emp-1-suffix': {
                employeeId: 'emp-2',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            },
            'emp-10-2026-09-18': {
                employeeId: 'emp-10',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(true);
        expect(plan.conflicts).toEqual([]);
        expect(plan.attendanceRecords).toEqual([]);
    });

    test('R07-hardening: array attendance + synthetic list keys are never mistaken for canonical map keys', () => {
        const employee = { ...makeEmployee(), id: 'emp-1', number: '1' };
        // Array form: matched purely by owner, keys are synthetic and ignored.
        const arrayPlan = planEmployeeProjectReassignment({
            employee,
            attendance: [
                { employeeId: 'emp-1', date: '2026-09-18', present: true, hoursWorked: 8, projectId: 'PRJ-origin-0001' },
                { employeeId: 'emp-2', date: '2026-09-18', present: true, hoursWorked: 8, projectId: 'PRJ-origin-0001' }
            ],
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(arrayPlan.ok).toBe(true);
        expect(arrayPlan.attendanceRecords).toHaveLength(1);
        expect(arrayPlan.attendanceRecords[0].record.employeeId).toBe('emp-1');
        expect(arrayPlan.attendanceRecords[0].record.projectId).toBe('PRJ-origin-0001');

        // Keyed map with synthetic ":" keys: owner match wins, no canonical mismatch.
        const syntheticPlan = planEmployeeProjectReassignment({
            employee,
            attendance: {
                'num:1': { employeeId: 'emp-1', date: '2026-09-18', present: true, hoursWorked: 8, projectId: 'PRJ-origin-0001' },
                'index:0': { employeeId: 'emp-2', date: '2026-09-18', present: true, hoursWorked: 8, projectId: 'PRJ-origin-0001' }
            },
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(syntheticPlan.ok).toBe(true);
        expect(syntheticPlan.attendanceRecords).toHaveLength(1);
        expect(syntheticPlan.attendanceRecords[0].key).toBe('num:1');
    });

    test('R07-hardening: other employees valid canonical attendance stays untouched (no conflict)', () => {
        const employee = { ...makeEmployee(), id: 'emp-1', number: '1' };
        const attendance = {
            'emp-2-2026-09-18': {
                employeeId: 'emp-2',
                date: '2026-09-18',
                present: true,
                hoursWorked: 8,
                projectId: 'PRJ-origin-0001'
            }
        };
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG
        });
        expect(plan.ok).toBe(true);
        expect(plan.attendanceRecords).toEqual([]);
        expect(attendance['emp-2-2026-09-18'].projectId).toBe('PRJ-origin-0001');
    });

    test('R07-hardening: enabled:false returns disabled no-op without mutating', () => {
        const employee = makeEmployee();
        const attendance = makeAttendance();
        const before = snapshot({ employee, attendance });
        const plan = planEmployeeProjectReassignment({
            employee,
            attendance,
            targetProjectId: 'PRJ-target-0002',
            catalog: CATALOG,
            enabled: false
        });
        expect(plan.disabled).toBe(true);
        expect(plan.enabled).toBe(false);
        expect(plan.ok).toBe(false);
        expect(plan.employee).toBeNull();
        expect(plan.attendanceRecords).toBeNull();
        expect(plan.conflicts).toEqual([]);
        expect(snapshot({ employee, attendance })).toBe(before);
    });

    test('R07-hardening: deep copy survives structuredClone absence (safe JSON fallback)', () => {
        const hadClone = typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone : undefined;
        try {
            // Force the fallback path even on modern runtimes.
            globalThis.structuredClone = undefined;
            const employee = makeEmployee();
            const attendance = makeAttendance();
            const before = snapshot({ employee, attendance });
            const plan = planEmployeeProjectReassignment({
                employee,
                attendance,
                targetProjectId: 'PRJ-target-0002',
                catalog: CATALOG
            });
            expect(plan.ok).toBe(true);
            plan.employee.loans[0].balance = 999999;
            plan.attendanceRecords[0].record.hoursWorked = 999;
            expect(snapshot({ employee, attendance })).toBe(before);
        } finally {
            if (hadClone) globalThis.structuredClone = hadClone;
            else delete globalThis.structuredClone;
        }
    });
});
