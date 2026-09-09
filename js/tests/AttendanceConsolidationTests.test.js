import {
    consolidateAttendanceSubmissions,
    groupConsolidatedAttendance,
    buildConsolidationProposal
} from '../modules/features/attendance/AttendanceConsolidation.js';

const PROJECT_ID = 'PRJ-OBRA-NORTE';

function buildSubmission({
    submissionId = '123e4567-e89b-42d3-a456-426614174001',
    deviceId = 'phone-mini-1',
    sourceId = 'mini-1',
    workDate = '2026-09-06',
    capturedAt = '2026-09-07T12:00:00.000Z',
    rows = []
} = {}) {
    return {
        schema: 'attendance-submission/v1',
        submissionId,
        saProjectId: PROJECT_ID,
        scope: { ownerUid: 'owner-1', siteId: 'obra-1', sourceId },
        deviceId,
        rosterVersion: 'roster-1',
        capturedAt,
        workDate,
        rows
    };
}

describe('AttendanceConsolidation — pure cross-Mini consolidation', () => {
    test('strictly groups by (saProjectId, saEmployeeId, workDate) when saEmployeeId is present', () => {
        const subMini1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            rows: [
                {
                    miniLocalId: 'm1-u1',
                    number: '001',
                    name: 'Ana Pérez',
                    normalHours: 8,
                    overtimeHours: 0,
                    status: 'present',
                    saEmployeeId: 'EMP-001'
                }
            ]
        });

        const subMini2 = buildSubmission({
            submissionId: '22222222-2222-2222-2222-222222222222',
            deviceId: 'dev-2',
            sourceId: 'mini-2',
            rows: [
                {
                    miniLocalId: 'm2-u1',
                    number: '001',
                    name: 'Ana Perez',
                    normalHours: 8,
                    overtimeHours: 0,
                    status: 'present',
                    saEmployeeId: 'EMP-001'
                }
            ]
        });

        const result = consolidateAttendanceSubmissions([subMini1, subMini2]);
        expect(result.items.length).toBe(1);

        const item = result.items[0];
        expect(item.saEmployeeId).toBe('EMP-001');
        expect(item.saProjectId).toBe(PROJECT_ID);
        expect(item.workDate).toBe('2026-09-06');
        expect(item.status).toBe('resolved');
        expect(item.normalHours).toBe(8);
        expect(item.overtimeHours).toBe(0);
        expect(item.sources.length).toBe(2);
        expect(item.sources[0].deviceId).toBe('dev-1');
        expect(item.sources[1].deviceId).toBe('dev-2');
    });

    test('missing saEmployeeId MUST become identity_conflict/unresolved; NEVER auto-links by number or name', () => {
        // Mini 1 has an unlinked employee with number "001" and name "Carlos Gomez"
        const subMini1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            rows: [
                {
                    miniLocalId: 'm1-u1',
                    number: '001',
                    name: 'Carlos Gomez',
                    normalHours: 8,
                    overtimeHours: 0,
                    status: 'present'
                    // NO saEmployeeId
                }
            ]
        });

        // Mini 2 also has an unlinked employee with the EXACT SAME number and name
        const subMini2 = buildSubmission({
            submissionId: '22222222-2222-2222-2222-222222222222',
            deviceId: 'dev-2',
            sourceId: 'mini-2',
            rows: [
                {
                    miniLocalId: 'm2-u1',
                    number: '001',
                    name: 'Carlos Gomez',
                    normalHours: 8,
                    overtimeHours: 0,
                    status: 'present'
                    // NO saEmployeeId
                }
            ]
        });

        const result = consolidateAttendanceSubmissions([subMini1, subMini2]);

        // CRITICAL: Must NEVER auto-link! They must remain 2 separate unresolved items!
        expect(result.items.length).toBe(2);
        expect(result.summary.unresolvedIdentityCount).toBe(2);
        expect(result.summary.resolvedCount).toBe(0);

        for (const item of result.items) {
            expect(item.status).toBe('identity_conflict');
            expect(item.conflictType).toBe('missing_sa_employee_id');
            expect(item.saEmployeeId).toBeNull();
            expect(item.blockers).toContain('missing_sa_employee_id');
            expect(item.sources.length).toBe(1);
        }
    });

    test('missing row from another Mini never means absent or deletion', () => {
        // Mini 1 reports Ana (EMP-001) and Bob (EMP-002)
        const subMini1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'm2', number: '2', name: 'Bob', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        });

        // Mini 2 only reports Bob (EMP-002). Mini 2 does NOT mention Ana!
        const subMini2 = buildSubmission({
            submissionId: '22222222-2222-2222-2222-222222222222',
            deviceId: 'dev-2',
            sourceId: 'mini-2',
            rows: [
                { miniLocalId: 'm2', number: '2', name: 'Bob', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        });

        const result = consolidateAttendanceSubmissions([subMini1, subMini2]);

        // Ana must NOT be deleted or marked absent! She is reported by Mini 1.
        expect(result.items.length).toBe(2);
        const anaItem = result.items.find(i => i.saEmployeeId === 'EMP-001');
        expect(anaItem).toBeTruthy();
        expect(anaItem.status).toBe('resolved');
        expect(anaItem.normalHours).toBe(8);
        expect(anaItem.sources.length).toBe(1);
        expect(anaItem.sources[0].deviceId).toBe('dev-1');
    });

    test('detects hours conflict when multiple Minis report different hours for the same employee and date', () => {
        const subMini1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const subMini2 = buildSubmission({
            submissionId: '22222222-2222-2222-2222-222222222222',
            deviceId: 'dev-2',
            sourceId: 'mini-2',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 4, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const result = consolidateAttendanceSubmissions([subMini1, subMini2]);
        expect(result.items.length).toBe(1);
        const item = result.items[0];

        expect(item.status).toBe('conflict');
        expect(item.conflictType).toBe('hours_conflict');
        expect(item.normalHours).toBeNull();
        expect(item.overtimeHours).toBeNull();
        expect(item.blockers).toContain('hours_conflict');
        expect(item.conflictingHours.length).toBe(2);
    });

    test('preserves complete raw source provenance across multiple submissions and devices', () => {
        const subMini1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            capturedAt: '2026-09-07T10:00:00.000Z',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const result = consolidateAttendanceSubmissions([subMini1]);
        const source = result.items[0].sources[0];

        expect(source.submissionId).toBe('11111111-1111-1111-1111-111111111111');
        expect(source.deviceId).toBe('dev-1');
        expect(source.sourceId).toBe('mini-1');
        expect(source.capturedAt).toBe('2026-09-07T10:00:00.000Z');
        expect(source.miniLocalId).toBe('m1');
        expect(source.number).toBe('1');
        expect(source.name).toBe('Ana');
    });

    test('groups consolidation result by day and by period', () => {
        const subDay1 = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const subDay2 = buildSubmission({
            submissionId: '22222222-2222-2222-2222-222222222222',
            workDate: '2026-09-07',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 1, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const consolidated = consolidateAttendanceSubmissions([subDay1, subDay2]);

        // Mode: day
        const byDay = groupConsolidatedAttendance(consolidated, 'day');
        expect(byDay.mode).toBe('day');
        expect(byDay.groups.length).toBe(2);
        expect(byDay.groups[0].workDate).toBe('2026-09-06');
        expect(byDay.groups[1].workDate).toBe('2026-09-07');

        // Mode: period
        const byPeriod = groupConsolidatedAttendance(consolidated, 'period');
        expect(byPeriod.mode).toBe('period');
        expect(byPeriod.periodStart).toBe('2026-09-06');
        expect(byPeriod.periodEnd).toBe('2026-09-07');
        expect(byPeriod.employeeGroups.length).toBe(1);
        expect(byPeriod.employeeGroups[0].saEmployeeId).toBe('EMP-001');
        expect(byPeriod.employeeGroups[0].totalNormalHours).toBe(16);
        expect(byPeriod.employeeGroups[0].totalOvertimeHours).toBe(1);
    });

    test('buildConsolidationProposal creates proposal seam without writing to attendance', () => {
        const sub = buildSubmission({
            submissionId: '11111111-1111-1111-1111-111111111111',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'm2', number: '2', name: 'Bob', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' },
                { miniLocalId: 'm3', number: '3', name: 'Carl', normalHours: 8, overtimeHours: 0, status: 'present' /* no saEmployeeId */ }
            ]
        });

        const consolidated = consolidateAttendanceSubmissions([sub]);

        // Mock existing attendance: EMP-001 has 8h (matching), EMP-002 has 4h (conflict)
        const mockAttendance = {
            'EMP-001-2026-09-06': { employeeId: 'EMP-001', date: '2026-09-06', hoursWorked: 8, overtimeHours: 0 },
            'EMP-002-2026-09-06': { employeeId: 'EMP-002', date: '2026-09-06', hoursWorked: 4, overtimeHours: 0 }
        };

        const proposal = buildConsolidationProposal(consolidated, { attendance: mockAttendance });

        expect(proposal.canAutoApply).toBe(false); // Explicit: never auto apply directly
        expect(proposal.proposals.length).toBe(3);

        const pAna = proposal.proposals.find(p => p.item.saEmployeeId === 'EMP-001');
        expect(pAna.status).toBe('matched_existing');
        expect(pAna.hasDiff).toBe(false);
        expect(pAna.canApply).toBe(true);

        const pBob = proposal.proposals.find(p => p.item.saEmployeeId === 'EMP-002');
        expect(pBob.status).toBe('conflict_existing');
        expect(pBob.hasDiff).toBe(true);
        expect(pBob.canApply).toBe(false);
        expect(pBob.diff.existingNormal).toBe(4);
        expect(pBob.diff.proposedNormal).toBe(8);

        const pCarl = proposal.proposals.find(p => p.item.miniLocalId === 'm3');
        expect(pCarl.status).toBe('blocked');
        expect(pCarl.reason).toBe('missing_sa_employee_id');
        expect(pCarl.canApply).toBe(false);
    });

    test('returns deeply frozen immutable results', () => {
        const sub = buildSubmission({
            rows: [{ miniLocalId: 'm1', number: '1', name: 'Ana', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }]
        });

        const consolidated = consolidateAttendanceSubmissions([sub]);
        expect(Object.isFrozen(consolidated)).toBe(true);
        expect(Object.isFrozen(consolidated.items)).toBe(true);
        expect(Object.isFrozen(consolidated.items[0])).toBe(true);
    });
});
