import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';
import { confirmMiniAttendanceDraftDate, createMiniAttendanceDraft, editMiniAttendanceDraftRow,
    excludeMiniAttendanceDraftRow,
    reviewMiniAttendanceDraftRow, setMiniAttendanceAllocationMode, suggestMiniAttendanceDate
} from '../modules/features/attendance/MiniAttendanceDraft.js';

const employees = [
    { id: 'e1', number: '1', name: 'Franklin Henrriquez', positions: ['p1'] },
    { id: 'e501a', number: '501', name: 'Héctor Excavadora', positions: ['p2', 'p3'] },
    { id: 'e501b', number: '501', name: 'Otra Persona', positions: ['p4'] },
    { id: 'e9', number: '9', name: 'Marie-José Núñez', positions: [] }
];

function draftFor(body, options = {}) {
    return createMiniAttendanceDraft({
        parsed: parseMiniAttendanceReport(body),
        employees,
        proposedDate: '2026-07-28',
        regularLimit: 8,
        ...options
    });
}

const aliasScope = { ownerUid: 'owner', siteId: 'site', sourceId: 'mini-principal' };
const aliasRoster = [
    { id: 'numberCandidate', number: '17', name: 'Juan Soto', positions: ['p1'] },
    { id: 'remembered', number: '117', name: 'Pedro Rodríguez', positions: ['p2'] }
];
function rememberedAlias(overrides = {}) {
    return {
        aliasId: 'remembered-alias', ...aliasScope,
        sourceNumberNormalized: '17', sourceNameNormalized: 'pedro',
        targetEmployeeId: 'remembered', active: true, tombstonedAt: null,
        ...overrides
    };
}

describe('MiniAttendanceDraft date setup', () => {
    test('infers the nearest matching year for a report from another day', () => {
        const parsed = parseMiniAttendanceReport(
            '*Asistencia de hoy miércoles, 30 de diciembre* 001. Franklin *8h*'
        );

        expect(suggestMiniAttendanceDate(parsed, '2027-01-02')).toBe('2026-12-30');
    });

    test('requires distinct confirmation of a complete matching ISO date', () => {
        const draft = draftFor('*Asistencia de hoy martes, 28 de julio* 001. Franklin *12h*');

        expect(draft.proposedDate).toBe('2026-07-28');
        expect(draft.confirmedDate).toBeNull();
        expect(draft.dateBlockers).toContain('date_confirmation_required');

        const confirmed = confirmMiniAttendanceDraftDate(draft, '2026-07-28');
        expect(confirmed.confirmedDate).toBe('2026-07-28');
        expect(confirmed.dateBlockers).toEqual([]);
        expect(draft.confirmedDate).toBeNull();
    });

    test('blocks confirmation when parsed weekday disagrees with the ISO date', () => {
        const draft = draftFor('*Asistencia de hoy lunes, 28 de julio* 001. Franklin *8h*');
        const attempted = confirmMiniAttendanceDraftDate(draft, '2026-07-28');

        expect(attempted.confirmedDate).toBeNull();
        expect(attempted.dateBlockers).toContain('date_hint_mismatch');
    });
});

describe('MiniAttendanceDraft employee reconciliation', () => {
    test('normalizes numeric numbers and accepts an exact normalized number and name', () => {
        const row = draftFor('001. Franklin Henrriquez *8h*').rows[0];

        expect(row.match).toMatchObject({ status: 'number_match', employeeId: 'e1',
            candidateIds: ['e1'], positionIds: ['p1'], requiresConfirmation: false });
    });

    test('treats a likely name typo on a unique number as a confirmation-required suggestion', () => {
        const row = draftFor('001. Franklin Henriquez *8h*').rows[0];

        expect(row.match).toMatchObject({
            status: 'name_suggestion',
            employeeId: 'e1',
            candidateIds: ['e1'],
            requiresConfirmation: true
        });
        expect(row.blockers).toContain('employee_confirmation_required');
    });

    test('never lets a unique number silently override a contradictory name', () => {
        const roster = [
            { id: 'numberCandidate', number: '17', name: 'Juan Soto', positions: ['p1'] },
            { id: 'exactName', number: '203', name: 'Pedro', positions: ['p2'] },
            { id: 'relatedName', number: '117', name: 'Pedro Rodríguez', positions: ['p3'] }
        ];
        const row = draftFor('017. Pedro *8h*', { employees: roster }).rows[0];

        expect(row.match).toMatchObject({
            status: 'name_suggestion',
            employeeId: 'exactName',
            candidateIds: ['numberCandidate', 'exactName', 'relatedName'],
            requiresConfirmation: true
        });
        expect(row.blockers).toContain('employee_confirmation_required');
    });

    test('exposes number and related-name candidates without selecting a fuzzy contradiction', () => {
        const roster = [
            { id: 'numberCandidate', number: '17', name: 'Juan Soto', positions: ['p1'] },
            { id: 'relatedName', number: '117', name: 'Pedro Rodríguez', positions: ['p3'] }
        ];
        const row = draftFor('17. Pedro *8h*', { employees: roster }).rows[0];

        expect(row.match).toMatchObject({
            status: 'ambiguous',
            employeeId: null,
            candidateIds: ['numberCandidate', 'relatedName'],
            requiresConfirmation: false
        });
        expect(row.blockers).toContain('employee_ambiguous');
    });

    test('gives a valid exact-scoped alias precedence without approving the row', () => {
        const row = draftFor('17. Pedro *8h*', {
            employees: aliasRoster, aliases: [rememberedAlias()], aliasScope
        }).rows[0];

        expect(row.match).toMatchObject({
            status: 'remembered_match',
            employeeId: 'remembered',
            candidateIds: ['remembered'],
            rememberedAliasId: 'remembered-alias'
        });
        expect(row).toMatchObject({ reviewed: false, approved: false });
    });

    test('ignores aliases from another scope or a different normalized name', () => {
        const wrongScope = draftFor('17. Pedro *8h*', {
            employees: aliasRoster,
            aliases: [rememberedAlias({ siteId: 'other-site' })],
            aliasScope
        }).rows[0];
        const wrongName = draftFor('17. Juan Soto *8h*', {
            employees: aliasRoster, aliases: [rememberedAlias()], aliasScope
        }).rows[0];

        expect(wrongScope.match).toMatchObject({ status: 'ambiguous', employeeId: null });
        expect(wrongName.match).toMatchObject({
            status: 'number_match', employeeId: 'numberCandidate'
        });
    });

    test('ignores a remembered alias whose target is inactive', () => {
        const roster = aliasRoster.map(employee =>
            employee.id === 'remembered' ? { ...employee, active: false } : employee);
        const row = draftFor('17. Pedro *8h*', {
            employees: roster, aliases: [rememberedAlias()], aliasScope
        }).rows[0];

        expect(row.match).toMatchObject({ status: 'ambiguous', employeeId: null });
        expect(row.blockers).toContain('employee_ambiguous');
    });

    test('never matches or exposes inactive and deleted employees as import targets', () => {
        const roster = [
            { id: 'active', number: '1', name: 'Persona Activa', positions: ['p1'] },
            { id: 'inactive', number: '2', name: 'Persona Inactiva', positions: ['p1'],
                active: false },
            { id: 'deleted', number: '3', name: 'Persona Eliminada', positions: ['p1'],
                deletedAt: 123 }
        ];
        const draft = draftFor(
            '002. Persona Inactiva *8h* 003. Persona Eliminada *8h*',
            { employees: roster }
        );

        expect(draft.employeeOptions.map(option => option.employeeId)).toEqual(['active']);
        expect(draft.rows.map(row => row.match)).toEqual([
            expect.objectContaining({ status: 'unmatched', employeeId: null }),
            expect.objectContaining({ status: 'unmatched', employeeId: null })
        ]);
        expect(draft.rows).toEqual([
            expect.objectContaining({
                excluded: true, reviewed: true, exclusionReason: 'inactive_employee'
            }),
            expect.objectContaining({
                excluded: true, reviewed: true, exclusionReason: 'inactive_employee'
            })
        ]);
        expect(() => reviewMiniAttendanceDraftRow(draft, 0, { employeeId: 'inactive' }))
            .toThrow('Employee is not in the draft roster: inactive');
    });

    test('does not auto-ignore an inactive identity when an active duplicate exists', () => {
        const roster = [
            { id: 'active', number: '2', name: 'Persona Repetida', positions: ['p1'],
                active: true },
            { id: 'inactive', number: '2', name: 'Persona Repetida', positions: ['p1'],
                active: false }
        ];
        const row = draftFor('002. Persona Repetida *8h*', { employees: roster }).rows[0];

        expect(row).toMatchObject({
            excluded: false,
            match: { status: 'number_match', employeeId: 'active' }
        });
    });

    test('uses normalized exact names to disambiguate employees with the same number', () => {
        const row = draftFor('501. hector, excavadora *4h*').rows[0];

        expect(row.match.status).toBe('number_name_match');
        expect(row.match.employeeId).toBe('e501a');
    });

    test('name-only exact suggestion requires explicit confirmation', () => {
        const draft = draftFor('777. MARIE JOSE NUNEZ *8h*');
        expect(draft.rows[0].match).toMatchObject({
            status: 'name_suggestion',
            employeeId: 'e9',
            requiresConfirmation: true
        });
        expect(draft.rows[0].blockers).toContain('employee_confirmation_required');

        const reviewed = reviewMiniAttendanceDraftRow(draft, 0, { employeeId: 'e9' });
        expect(reviewed.rows[0].match.requiresConfirmation).toBe(false);
        expect(reviewed.rows[0].reviewed).toBe(true);
    });

    test('keeps unresolved equal-number candidates visible as ambiguous', () => {
        const row = draftFor('501. Unknown Name *8h*').rows[0];

        expect(row.match.status).toBe('ambiguous');
        expect(row.match.candidateIds).toEqual(['e501a', 'e501b']);
        expect(row.blockers).toContain('employee_ambiguous');
    });

    test('allows explicit roster assignment for unmatched rows but rejects arbitrary IDs', () => {
        const draft = draftFor('777. Truly Unknown *8h*');
        expect(draft.rows[0].match.status).toBe('unmatched');

        const assigned = reviewMiniAttendanceDraftRow(draft, 0, { employeeId: 'e501a' });
        expect(assigned.rows[0].match).toMatchObject({
            status: 'confirmed', employeeId: 'e501a', positionIds: ['p2', 'p3']
        });
        expect(assigned.rows[0].blockers).not.toContain('employee_unmatched');
        expect(() => reviewMiniAttendanceDraftRow(draft, 0, { employeeId: 'ghost' }))
            .toThrow('Employee is not in the draft roster: ghost');
    });

    test('can explicitly exclude an unmatched source row without approving it', () => {
        const draft = draftFor('777. Truly Unknown *8h*');
        const excluded = excludeMiniAttendanceDraftRow(draft, 0);

        expect(excluded.rows[0]).toMatchObject({
            excluded: true,
            reviewed: true,
            approved: false,
            blockers: []
        });
        expect(excluded.hasBlockingIssues).toBe(true);
        const confirmed = confirmMiniAttendanceDraftDate(excluded, '2026-07-28');
        expect(confirmed.hasBlockingIssues).toBe(false);
    });

    test('preserves duplicate occurrences and distinguishes probable from conflicting duplicates', () => {
        const probable = draftFor('501. Hector Excavadora *4h* 501. Héctor excavadora *4h*');
        expect(probable.rows).toHaveLength(2);
        expect(probable.rows.map(row => row.duplicateStatus)).toEqual([
            'probable_duplicate',
            'probable_duplicate'
        ]);

        const conflicting = draftFor('001. Franklin Henrriquez *8h* 1. Franklin Henrriquez *12h*');
        expect(conflicting.rows.map(row => row.duplicateStatus)).toEqual([
            'conflicting_duplicate',
            'conflicting_duplicate'
        ]);
        expect(conflicting.rows.every(row => row.blockers.includes('conflicting_duplicate'))).toBe(true);
    });

    test('keeps invalid parsed rows and unparsed source as draft blockers', () => {
        const draft = draftFor('001. Franklin *25h* malformed tail');

        expect(draft.rows[0].blockers).toContain('source_hours_invalid');
        expect(draft.sourceBlockers).toContain('unparsed_source');
        expect(draft.hasBlockingIssues).toBe(true);
    });
});

describe('MiniAttendanceDraft allocation revisions', () => {
    test('defaults all imported hours to normal hours', () => {
        const draft = draftFor('001. Franklin Henrriquez *12h*');

        expect(draft.allocationMode).toBe('all_normal');
        expect(draft.rows[0].allocation).toEqual({ normalHours: 12, overtimeHours: 0 });
    });

    test('splits at the configured regular limit only when explicitly selected', () => {
        const split = setMiniAttendanceAllocationMode(
            draftFor('001. Franklin Henrriquez *12h*'),
            'split_at_regular_limit'
        );

        expect(split.rows[0].allocation).toEqual({ normalHours: 8, overtimeHours: 4 });
    });

    test('supports valid edits and blocks negative or over-24 allocations', () => {
        const draft = draftFor('001. Franklin Henrriquez *12h*');
        const edited = editMiniAttendanceDraftRow(draft, 0, { normalHours: 7, overtimeHours: 2 });
        expect(edited.rows[0].allocation).toEqual({ normalHours: 7, overtimeHours: 2 });
        expect(edited.rows[0].blockers).not.toContain('hours_invalid');

        const invalid = editMiniAttendanceDraftRow(edited, 0, { normalHours: 20, overtimeHours: 5 });
        expect(invalid.rows[0].blockers).toContain('hours_invalid');
    });

    test('mode changes create an immutable revision and clear row reviews and approvals', () => {
        const original = draftFor('001. Franklin Henrriquez *12h*');
        const reviewed = reviewMiniAttendanceDraftRow(original, 0, { approved: true });
        const split = setMiniAttendanceAllocationMode(reviewed, 'split_at_regular_limit');

        expect(split.revision).toBe(reviewed.revision + 1);
        expect(split.rows[0]).toMatchObject({ reviewed: false, approved: false });
        expect(split.rows[0].allocation).toEqual({ normalHours: 8, overtimeHours: 4 });
        expect(reviewed.rows[0]).toMatchObject({ reviewed: true, approved: true });
        expect(Object.isFrozen(split.rows[0].allocation)).toBe(true);
    });
});
