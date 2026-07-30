import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';
import {
    buildMiniAttendanceApplyPlan,
    confirmMiniAttendanceDraftDate,
    createMiniAttendanceConflictPlan,
    createMiniAttendanceDraft,
    editMiniAttendanceDraftRow,
    excludeMiniAttendanceDraftRow,
    reviewMiniAttendanceConflict,
    reviewMiniAttendanceDraftRow
} from '../modules/features/attendance/MiniAttendanceDraft.js';

const DATE = '2026-07-28';
const employees = [
    { id: 'e1', number: '1', name: 'Ana Pérez', positions: ['p1'] },
    { id: 'e2', number: '2', name: 'Luis García', positions: ['p1', 'p2'] }
];

function confirmedDraft(report) {
    let draft = createMiniAttendanceDraft({
        parsed: parseMiniAttendanceReport(report),
        employees,
        proposedDate: DATE,
        regularLimit: 8
    });
    draft = confirmMiniAttendanceDraftDate(draft, DATE);
    draft.rows.forEach((_, index) => {
        draft = reviewMiniAttendanceDraftRow(draft, index, { approved: true });
    });
    return draft;
}

function existing(employeeId, overrides = {}) {
    return {
        employeeId,
        date: DATE,
        present: true,
        hoursWorked: 8,
        overtimeHours: 0,
        selectedPosition: 'p1',
        multiPosition: false,
        positionHours: [{ positionId: 'p1', hours: 8, overtimeHours: 0 }],
        notes: 'keep this note',
        auditTag: 'existing-metadata',
        ...overrides
    };
}

describe('Mini attendance conflict planning', () => {
    test('requires acknowledged keep/replace review for every existing record, even equal hours', () => {
        const current = existing('e1');
        const before = JSON.stringify(current);
        const plan = createMiniAttendanceConflictPlan(
            confirmedDraft('001. Ana Perez *8h*'),
            { [`e1-${DATE}`]: current }
        );

        expect(plan.rows[0].decision).toEqual({ action: 'keep_existing', acknowledged: false });
        expect(plan.rows[0].blockers).toContain('decision_unacknowledged');

        const reviewed = reviewMiniAttendanceConflict(plan, 0, {
            action: 'keep_existing',
            acknowledged: true
        });
        const approved = buildMiniAttendanceApplyPlan(reviewed, {
            expectedDraftRevision: reviewed.draftRevision
        });
        expect(approved.writes).toEqual([]);
        expect(approved.keptKeys).toEqual([`e1-${DATE}`]);
        expect(JSON.stringify(current)).toBe(before);
    });

    test('projects full multi-position detail and gates destructive collapse', () => {
        const current = existing('e2', {
            hoursWorked: 7,
            overtimeHours: 2,
            multiPosition: false,
            positionHours: [
                { positionId: 'p1', hours: 4, overtimeHours: 0 },
                { positionId: 'p2', hours: 3, overtimeHours: 2 }
            ]
        });
        const plan = createMiniAttendanceConflictPlan(
            confirmedDraft('002. Luis Garcia *12h*'),
            { [`e2-${DATE}`]: current }
        );
        expect(plan.rows[0].existing.breakdown).toEqual(current.positionHours);

        const noTarget = reviewMiniAttendanceConflict(plan, 0, {
            action: 'use_imported',
            acknowledged: true
        });
        expect(noTarget.rows[0].blockers).toEqual(expect.arrayContaining([
            'target_position_required',
            'collapse_acknowledgement_required'
        ]));

        const invalidTarget = reviewMiniAttendanceConflict(plan, 0, {
            action: 'use_imported',
            acknowledged: true,
            targetPositionId: 'not-owned',
            collapseAcknowledged: true
        });
        expect(invalidTarget.rows[0].blockers).toContain('target_position_invalid');

        const reviewed = reviewMiniAttendanceConflict(plan, 0, {
            action: 'use_imported',
            acknowledged: true,
            targetPositionId: 'p2',
            collapseAcknowledged: true
        });
        const approved = buildMiniAttendanceApplyPlan(reviewed, {
            expectedDraftRevision: reviewed.draftRevision
        });
        expect(approved.writes[0].record).toMatchObject({
            employeeId: 'e2',
            date: DATE,
            present: true,
            hoursWorked: 12,
            overtimeHours: 0,
            selectedPosition: 'p2',
            multiPosition: false,
            positionHours: [{ positionId: 'p2', hours: 12, overtimeHours: 0 }],
            notes: 'keep this note',
            auditTag: 'existing-metadata'
        });
    });

    test('auto-selects one owned position but requires a target for new multi-position records', () => {
        const onePosition = createMiniAttendanceConflictPlan(
            confirmedDraft('001. Ana Perez *8h*'),
            {}
        );
        expect(onePosition.rows[0].targetPositionId).toBe('p1');
        expect(onePosition.rows[0].blockers).toEqual([]);

        const multiPosition = createMiniAttendanceConflictPlan(
            confirmedDraft('002. Luis Garcia *8h*'),
            {}
        );
        expect(multiPosition.rows[0].targetPositionId).toBeNull();
        expect(multiPosition.rows[0].blockers).toContain('target_position_required');
    });

    test('consolidates probable duplicates into one write and blocks conflicting duplicates', () => {
        const probable = createMiniAttendanceConflictPlan(
            confirmedDraft('001. Ana Perez *8h* 1. Ána Pérez *8h*'),
            {}
        );
        expect(probable.rows).toHaveLength(1);
        expect(probable.rows[0].sourceIndexes).toEqual([0, 1]);
        const approved = buildMiniAttendanceApplyPlan(probable, {
            expectedDraftRevision: probable.draftRevision
        });
        expect(approved.writes).toHaveLength(1);

        const conflicting = createMiniAttendanceConflictPlan(
            confirmedDraft('001. Ana Perez *8h* 1. Ana Perez *12h*'),
            {}
        );
        expect(conflicting.hasBlockingIssues).toBe(true);
        expect(() => buildMiniAttendanceApplyPlan(conflicting, {
            expectedDraftRevision: conflicting.draftRevision
        })).toThrow('Conflict plan has unresolved blockers');

        const aliases = confirmedDraft('001. Ana Perez *8h* 999. Ana Perez *12h*');
        const manuallyMatched = reviewMiniAttendanceDraftRow(aliases, 1, { employeeId: 'e1' });
        const canonicalConflict = createMiniAttendanceConflictPlan(manuallyMatched, {});
        expect(canonicalConflict.rows).toHaveLength(1);
        expect(canonicalConflict.rows[0].blockers).toContain('conflicting_duplicate');

        let editedDuplicate = confirmedDraft('001. Ana Perez *8h* 1. Ána Pérez *8h*');
        editedDuplicate = editMiniAttendanceDraftRow(
            editedDuplicate, 1, { normalHours: 6, overtimeHours: 2 }
        );
        editedDuplicate = reviewMiniAttendanceDraftRow(editedDuplicate, 1, { approved: true });
        const allocationConflict = createMiniAttendanceConflictPlan(editedDuplicate, {});
        expect(allocationConflict.rows[0].blockers).toContain('conflicting_duplicate');
    });

    test('requires explicit draft review and approval before importing a row', () => {
        const draft = createMiniAttendanceDraft({
            parsed: parseMiniAttendanceReport('001. Ana Perez *8h*'),
            employees,
            proposedDate: DATE
        });
        const confirmed = confirmMiniAttendanceDraftDate(draft, DATE);
        const plan = createMiniAttendanceConflictPlan(confirmed, {});
        expect(plan.rows[0].blockers).toEqual(expect.arrayContaining([
            'row_review_required',
            'row_not_approved'
        ]));
        expect(() => buildMiniAttendanceApplyPlan(plan, {
            expectedDraftRevision: plan.draftRevision
        })).toThrow('Conflict plan has unresolved blockers');
    });

    test('omits explicitly excluded people from the conflict and apply plans', () => {
        let draft = createMiniAttendanceDraft({
            parsed: parseMiniAttendanceReport('001. Ana Perez *8h* 777. Unknown *6h*'),
            employees,
            proposedDate: DATE
        });
        draft = confirmMiniAttendanceDraftDate(draft, DATE);
        draft = reviewMiniAttendanceDraftRow(draft, 0, { approved: true });
        draft = excludeMiniAttendanceDraftRow(draft, 1);

        const conflictPlan = createMiniAttendanceConflictPlan(draft, {});
        const applyPlan = buildMiniAttendanceApplyPlan(conflictPlan, {
            expectedDraftRevision: conflictPlan.draftRevision
        });

        expect(conflictPlan.rows).toHaveLength(1);
        expect(conflictPlan.rows[0].employeeId).toBe('e1');
        expect(applyPlan.writes).toHaveLength(1);
    });

    test('rejects stale draft revisions and remains deeply immutable', () => {
        const plan = createMiniAttendanceConflictPlan(
            confirmedDraft('001. Ana Perez *8h*'),
            {}
        );
        expect(() => buildMiniAttendanceApplyPlan(plan, {
            expectedDraftRevision: plan.draftRevision + 1
        })).toThrow('Stale draft revision');
        expect(Object.isFrozen(plan.rows[0])).toBe(true);
        expect(Object.isFrozen(plan.rows[0].existing)).toBe(true);
    });
});
