import { buildMiniAttendanceReviewViewModel } from '../modules/ui/MiniAttendanceReviewViewModel.js';
import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';
import {
    confirmMiniAttendanceDraftDate, createMiniAttendanceConflictPlan, createMiniAttendanceDraft,
    reviewMiniAttendanceConflict, reviewMiniAttendanceDraftRow
} from '../modules/features/attendance/MiniAttendanceDraft.js';
const DATE = '2026-07-28';
const employees = [
    { id: 'e1', number: '1', name: 'Ana Pérez', positions: ['p1'] },
    { id: 'e2', number: '2', name: 'Luis García', positions: ['p1', 'p2'] },
    { id: 'e3', number: '3', name: 'Mara Díaz', positions: ['p2'] },
    { id: 'e4', number: '4', name: 'Nora Ruiz', positions: ['p1'] },
    { id: 'e5', number: '5', name: 'Pablo León', positions: ['p1'] }
];
const positions = [
    { id: 'p1', name: 'Oficial' },
    { id: 'p2', name: 'Ayudante' }
];
function prepare(report, attendance = {}) {
    let draft = createMiniAttendanceDraft({
        parsed: parseMiniAttendanceReport(report),
        employees,
        proposedDate: DATE
    });
    draft = confirmMiniAttendanceDraftDate(draft, DATE);
    return {
        draft,
        conflictPlan: createMiniAttendanceConflictPlan(draft, attendance)
    };
}
function project(state, filter = 'all') {
    return buildMiniAttendanceReviewViewModel({ ...state, employees, positions, filter });
}
describe('Mini attendance review projection', () => {
    test('surfaces inactive employees with inactive issue while keeping selector roster active-only', () => {
        const roster = [
            ...employees,
            { id: 'inactive', number: '6', name: 'Empleado Inactivo', positions: ['p1'],
                active: false }
        ];
        let draft = createMiniAttendanceDraft({
            parsed: parseMiniAttendanceReport('006. Empleado Inactivo *8h*'),
            employees: roster,
            proposedDate: DATE
        });
        draft = confirmMiniAttendanceDraftDate(draft, DATE);
        const conflictPlan = createMiniAttendanceConflictPlan(draft, {});
        const view = buildMiniAttendanceReviewViewModel({
            draft, conflictPlan, employees: roster, positions
        });

        expect(draft.rows[0]).toMatchObject({
            inactiveIdentity: true,
            inactiveEmployeeId: 'inactive'
        });
        expect(view.items.length).toBe(1);
        expect(view.items[0]).toMatchObject({
            isInactive: true,
            issue: 'inactive',
            canReactivate: true
        });
        expect(view.items[0].employeeOptions.map(opt => opt.id)).not.toContain('inactive');
    });

    test('joins draft occurrences to conflicts and derives stable summaries and filters', () => {
        const current = {
            employeeId: 'e3',
            date: DATE,
            hoursWorked: 4,
            overtimeHours: 1,
            selectedPosition: 'p2',
            positionHours: [{ positionId: 'p2', hours: 4, overtimeHours: 1 }]
        };
        let state = prepare(
            '001. Ana Perez *8h* 002. Luis Garcia *10h* 003. Mara Diaz *5h*',
            { [`e3-${DATE}`]: current }
        );
        let reviewedDraft = reviewMiniAttendanceDraftRow(state.draft, 2, { approved: true });
        let conflictPlan = createMiniAttendanceConflictPlan(reviewedDraft, {
            [`e3-${DATE}`]: current
        });
        conflictPlan = reviewMiniAttendanceConflict(conflictPlan, 2, {
            action: 'keep_existing',
            acknowledged: true
        });
        state = { draft: reviewedDraft, conflictPlan };

        const view = project(state);

        expect(view.summary).toEqual({
            total: 3,
            ready: 1,
            needsAttention: 1,
            confirmed: 1,
            ignored: 0
        });
        expect(view.safeBulkSourceIndexes).toEqual([0]);
        expect(view.items.map(item => item.employee?.name))
            .toEqual(['Ana Pérez', 'Luis García', 'Mara Díaz']);
        expect(view.items[1].targetPositionOptions.map(option => option.name))
            .toEqual(['Oficial', 'Ayudante']);
        expect(view.items[2].existingBreakdown).toEqual([{
            positionId: 'p2',
            position: { id: 'p2', name: 'Ayudante' },
            hours: 4,
            overtimeHours: 1
        }]);
        expect(view.items[2].confirmed).toBe(true);
        expect(project(state, 'needsAttention').items.map(item => item.employee.id))
            .toEqual(['e2']);
        expect(project(state, 'ready').items.map(item => item.employee.id))
            .toEqual(['e1']);
        expect(project(state, 'confirmed').items.map(item => item.employee.id))
            .toEqual(['e3']);
        expect(Object.isFrozen(view.items[0].occurrences[0])).toBe(true);
    });
    test('returns one human next action at blocker priority and never leaks blocker codes', () => {
        const parsed = parseMiniAttendanceReport('999. Persona desconocida *25h*');
        const draft = createMiniAttendanceDraft({ parsed, employees, proposedDate: DATE });
        const conflictPlan = createMiniAttendanceConflictPlan(draft, {});

        const view = project({ draft, conflictPlan });

        expect(typeof view.items[0].nextAction).toBe('string');
        expect(view.items[0].nextAction).toBe('Corrige los datos de origen antes de continuar.');
        expect(view.items[0].confirmation).toEqual({
            action: 'fix_source',
            label: 'Corregir datos',
            destructive: false
        });
        expect(JSON.stringify(view)).not.toMatch(
            /source_hours_invalid|employee_unmatched|hours_invalid|date_confirmation_required/
        );
    });
    test('groups unresolved probable duplicates without inventing identity or mutating plans', () => {
        const ambiguousEmployees = [
            { id: 'e501a', number: '501', name: 'Héctor Excavadora', positions: ['p1'] },
            { id: 'e501b', number: '501', name: 'Hector Excavadora', positions: ['p2'] }
        ];
        let draft = createMiniAttendanceDraft({
            parsed: parseMiniAttendanceReport(
                '501. Hector Excavadora *4h* 0501. Héctor excavadora *4h*'
            ),
            employees: ambiguousEmployees,
            proposedDate: DATE
        });
        draft = confirmMiniAttendanceDraftDate(draft, DATE);
        const conflictPlan = createMiniAttendanceConflictPlan(draft, {});
        const before = JSON.stringify({ draft, conflictPlan });

        expect(draft.rows.map(row => row.match.status)).toEqual(['ambiguous', 'ambiguous']);
        expect(conflictPlan.rows).toHaveLength(2);
        const view = buildMiniAttendanceReviewViewModel({
            draft, conflictPlan, employees: ambiguousEmployees, positions
        });

        expect(view.items).toHaveLength(1);
        expect(view.items[0]).toMatchObject({
            sourceIndexes: [0, 1],
            employee: null,
            probableDuplicate: true,
            confirmed: false,
            needsAttention: true,
            nextAction: 'Selecciona o confirma el empleado.'
        });
        expect(view.items[0].occurrences).toEqual([
            { sourceIndex: 0, number: '501', name: 'Hector Excavadora', totalHours: 4 },
            { sourceIndex: 1, number: '0501', name: 'Héctor excavadora', totalHours: 4 }
        ]);
        expect(view.safeBulkSourceIndexes).toEqual([]);
        expect(JSON.stringify({ draft, conflictPlan })).toBe(before);
    });
    test('includes equal Mini/SA hours in ready rows without relaxing other risks', () => {
        const current = {
            employeeId: 'e4',
            date: DATE,
            hoursWorked: 8,
            overtimeHours: 0,
            selectedPosition: 'p1'
        };
        const state = prepare(
            '001. Ana Perez *8h* 999. Mara Diaz *8h* 002. Luis Garcia *8h* ' +
            '004. Nora Ruiz *8h* 005. Pablo Leon *8h* 5. Pablo León *8h*',
            { [`e4-${DATE}`]: current }
        );
        const view = project(state);
        expect(view.safeBulkSourceIndexes).toEqual([0, 3]);
        expect(view.summary).toEqual({
            total: 5,
            ready: 2,
            needsAttention: 3,
            confirmed: 0,
            ignored: 0
        });
        expect(project(state, 'ready').items.map(item => item.employee.id))
            .toEqual(['e1', 'e4']);
        expect(project(state, 'ready').items.map(item => item.readyReason))
            .toEqual([
                { type: 'sa_empty', label: 'SA sin asistencia' },
                { type: 'hours_equal', label: 'Mismas horas' }
            ]);
    });

    test('includes Mini hours with an empty SA record in ready rows', () => {
        const emptyCurrent = {
            employeeId: 'e1',
            date: DATE,
            hoursWorked: 0,
            overtimeHours: 0,
            selectedPosition: 'p1'
        };
        const state = prepare('001. Ana Perez *8h*', {
            [`e1-${DATE}`]: emptyCurrent
        });

        const view = project(state);

        expect(view.summary).toMatchObject({ ready: 1, needsAttention: 0 });
        expect(view.safeBulkSourceIndexes).toEqual([0]);
        expect(view.items[0].readyReason).toEqual({
            type: 'sa_empty',
            label: 'SA sin asistencia'
        });
    });

    test('summarizes problems by count and highest visual severity', () => {
        const attendance = {
            [`e1-${DATE}`]: {
                employeeId: 'e1',
                date: DATE,
                hoursWorked: 6,
                overtimeHours: 0,
                selectedPosition: 'p1'
            },
            [`e2-${DATE}`]: {
                employeeId: 'e2',
                date: DATE,
                hoursWorked: 7,
                overtimeHours: 0,
                selectedPosition: 'p1',
                positionHours: [
                    { positionId: 'p1', hours: 4, overtimeHours: 0 },
                    { positionId: 'p2', hours: 3, overtimeHours: 0 }
                ]
            }
        };
        const state = prepare(
            '001. Ana Perez *9h* 002. Luis Garcia *9h* 999. Persona desconocida *8h*',
            attendance
        );

        const view = project(state);
        const [hoursOnly, positionAndHours, missingEmployee] = view.items;

        expect(hoursOnly.problemSummary).toEqual({
            count: 1, severity: 'caution', label: '1 error'
        });
        expect(positionAndHours.problemSummary).toEqual({
            count: 2, severity: 'warning', label: '2 errores'
        });
        expect(missingEmployee.problemSummary).toEqual({
            count: 1, severity: 'critical', label: '1 error'
        });
        expect(positionAndHours.problems.map(problem => problem.kind))
            .toEqual(['position', 'decision']);
    });
});
