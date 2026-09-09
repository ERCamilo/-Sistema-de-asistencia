import {
    MultiDayAttendanceResolver,
    createMultiDayAttendanceResolver,
    adaptResolvedDayToConflictPlan
} from '../modules/features/attendance/MultiDayAttendanceResolver.js';
import { consolidateAttendanceSubmissions } from '../modules/features/attendance/AttendanceConsolidation.js';

const PROJECT_ID = 'PRJ-OBRA-1';
const PROJECT_SCOPE = Object.freeze({ enabled: true, projectId: PROJECT_ID, defaultProjectId: PROJECT_ID });

function sampleSubmission({
    submissionId = '11111111-1111-1111-1111-111111111111',
    deviceId = 'phone-1',
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

describe('MultiDayAttendanceResolver — two-stage isolated resolver', () => {
    let mockState;
    let mockEmployees;
    let mockPositions;
    let mockApplyPlan;
    let applyCalls;

    beforeEach(() => {
        applyCalls = [];
        mockPositions = [
            { id: 'pos-1', name: 'Albañil' },
            { id: 'pos-2', name: 'Fierrero' }
        ];
        mockEmployees = [
            { id: 'EMP-001', number: '001', name: 'Ana Pérez', active: true, positions: ['pos-1'] },
            { id: 'EMP-002', number: '002', name: 'Carlos Gómez', active: true, positions: ['pos-1'] },
            { id: 'EMP-003', number: '003', name: 'David López', active: true, positions: ['pos-1', 'pos-2'] },
            { id: 'EMP-INACTIVE', number: '004', name: 'Elena Inactiva', active: false, positions: ['pos-1'] },
            { id: 'EMP-OTHER', number: '900', name: 'Otro Proyecto', active: true, positions: ['pos-1'], projectId: 'PRJ-OTHER' }
        ];
        mockState = {
            attendance: {}
        };
        mockApplyPlan = jest.fn(async (plan, options) => {
            applyCalls.push({ plan, options });
            // Simulate canonical writer behavior
            const writtenKeys = [];
            for (const write of plan.writes) {
                mockState.attendance[write.key] = write.record;
                writtenKeys.push(write.key);
            }
            return {
                date: plan.date,
                appliedCount: writtenKeys.length,
                writtenKeys,
                keptCount: plan.keptKeys.length,
                keptKeys: [...plan.keptKeys]
            };
        });
    });

    test('1. Two Minis agree: resolved automatically, preserves both sources, ready for day-atomic apply', async () => {
        const sub1 = sampleSubmission({
            submissionId: 'sub-1',
            deviceId: 'dev-1',
            sourceId: 'mini-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const sub2 = sampleSubmission({
            submissionId: 'sub-2',
            deviceId: 'dev-2',
            sourceId: 'mini-2',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm2-1', number: '001', name: 'Ana Perez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub1, sub2],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        const dayState = resolver.getDayState('2026-09-06');
        expect(dayState.status).toBe('ready');
        expect(dayState.canApply).toBe(true);
        expect(dayState.items.length).toBe(1);

        const item = dayState.items[0];
        expect(item.status).toBe('resolved');
        expect(item.normalHours).toBe(8);
        expect(item.overtimeHours).toBe(0);
        expect(item.sources.length).toBe(2);
        expect(item.sources[0].deviceId).toBe('dev-1');
        expect(item.sources[1].deviceId).toBe('dev-2');

        // Apply Day
        const result = await resolver.applyDay('2026-09-06');
        expect(result.appliedCount).toBe(1);
        expect(mockApplyPlan).toHaveBeenCalledTimes(1);

        // Check canonical record written
        const written = mockState.attendance['EMP-001-2026-09-06'];
        expect(written).toBeDefined();
        expect(written.hoursWorked).toBe(8);
        expect(written.overtimeHours).toBe(0);
        expect(written.present).toBe(true);
        expect(written.miniImportAudit.sources).toHaveLength(2);
        expect(written.miniImportAudit.sources[0].deviceId).toBe('dev-1');
        expect(written.miniImportAudit.sources[1].deviceId).toBe('dev-2');

        // Day state is updated to applied
        expect(resolver.getDayState('2026-09-06').status).toBe('applied');
    });

    test('2. Two Minis disagree on hours: blocks day, forbids majority auto-win, requires explicit human source choice', async () => {
        // Mini 1 says 8h, Mini 2 says 10h (with 2h overtime)
        const sub1 = sampleSubmission({
            submissionId: 'sub-1',
            deviceId: 'dev-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const sub2 = sampleSubmission({
            submissionId: 'sub-2',
            deviceId: 'dev-2',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm2-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub1, sub2],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        const dayState = resolver.getDayState('2026-09-06');
        expect(dayState.status).toBe('stage_a_blocked');
        expect(dayState.canApply).toBe(false);
        expect(dayState.stageABlockers).toContain('hours_conflict');

        const item = dayState.items[0];
        expect(item.status).toBe('conflict');
        expect(item.conflictType).toBe('hours_conflict');
        expect(item.normalHours).toBeNull();
        expect(item.overtimeHours).toBeNull();

        // Trying to build apply plan throws because day is blocked
        expect(() => resolver.buildDayApplyPlan('2026-09-06')).toThrow(/not ready to apply/);

        // Explicit choice by human: choose Mini 2's hours (sourceIndex 1)
        resolver.resolveItemHours(item.id, { sourceIndex: 1 });

        const updatedDayState = resolver.getDayState('2026-09-06');
        expect(updatedDayState.status).toBe('ready');
        expect(updatedDayState.canApply).toBe(true);

        const updatedItem = updatedDayState.items[0];
        expect(updatedItem.status).toBe('resolved');
        expect(updatedItem.normalHours).toBe(8);
        expect(updatedItem.overtimeHours).toBe(2);

        // Apply Day
        await resolver.applyDay('2026-09-06');
        expect(mockState.attendance['EMP-001-2026-09-06'].overtimeHours).toBe(2);
    });

    test('3. Missing identity: structured row without saEmployeeId is NEVER auto-linked; requires explicit human resolution', async () => {
        // Mini 1 has an unlinked employee with number "002" and name "Carlos Gómez"
        const sub1 = sampleSubmission({
            submissionId: 'sub-1',
            deviceId: 'dev-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1-1', number: '002', name: 'Carlos Gómez', normalHours: 8, overtimeHours: 0, status: 'present' } // NO saEmployeeId
            ]
        });
        // Mini 2 ALSO has an unlinked row with the identical number and name
        const sub2 = sampleSubmission({
            submissionId: 'sub-2',
            deviceId: 'dev-2',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm2-1', number: '002', name: 'Carlos Gómez', normalHours: 8, overtimeHours: 0, status: 'present' } // NO saEmployeeId
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub1, sub2],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        // Stage A must NOT auto-link them even though number and name match!
        const dayState = resolver.getDayState('2026-09-06');
        expect(dayState.status).toBe('stage_a_blocked');
        expect(dayState.canApply).toBe(false);
        expect(dayState.items.length).toBe(2);
        expect(dayState.items[0].status).toBe('identity_conflict');
        expect(dayState.items[1].status).toBe('identity_conflict');

        // Candidate list follows canonical EntityScope: legacy/no-project employees
        // resolve to the default project, while explicit foreign-project employees are excluded.
        expect(resolver.getIdentityCandidates().map(emp => emp.id)).toContain('EMP-002');
        expect(resolver.getIdentityCandidates().map(emp => emp.id)).not.toContain('EMP-OTHER');
        expect(() => resolver.resolveItemIdentity(dayState.items[0].id, 'EMP-OTHER')).toThrow(/does not belong to project/);

        // Human explicitly resolves first row to EMP-002
        resolver.resolveItemIdentity(dayState.items[0].id, 'EMP-002');

        // Second row is also explicitly resolved to EMP-002 -> they merge into one!
        const secondItem = resolver.items.find(i => i.saEmployeeId === null);
        expect(secondItem).toBeDefined();
        resolver.resolveItemIdentity(secondItem.id, 'EMP-002');

        // Now merged and resolved
        const updatedDayState = resolver.getDayState('2026-09-06');
        expect(updatedDayState.status).toBe('ready');
        expect(updatedDayState.items.length).toBe(1);
        expect(updatedDayState.items[0].saEmployeeId).toBe('EMP-002');
        expect(updatedDayState.items[0].sources.length).toBe(2);

        // Cannot link to inactive employee
        expect(() => resolver.resolveItemIdentity('unknown-id', 'EMP-INACTIVE')).toThrow();
    });

    test('4. Existing SA conflict: differing SA record requires explicit keep-SA/use-imported decision; identical SA record is no-op', async () => {
        // Existing record in SA for EMP-001 has 9h (differs from imported 8h)
        mockState.attendance['EMP-001-2026-09-06'] = {
            employeeId: 'EMP-001',
            date: '2026-09-06',
            present: true,
            hoursWorked: 9,
            overtimeHours: 0,
            selectedPosition: 'pos-1',
            positionHours: [{ positionId: 'pos-1', hours: 9, overtimeHours: 0 }]
        };

        // Existing record in SA for EMP-002 has 8h (identical to imported 8h)
        mockState.attendance['EMP-002-2026-09-06'] = {
            employeeId: 'EMP-002',
            date: '2026-09-06',
            present: true,
            hoursWorked: 8,
            overtimeHours: 0,
            selectedPosition: 'pos-1',
            positionHours: [{ positionId: 'pos-1', hours: 8, overtimeHours: 0 }]
        };

        const sub = sampleSubmission({
            submissionId: 'sub-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'm1-2', number: '002', name: 'Carlos Gómez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        const dayState = resolver.getDayState('2026-09-06');
        // Stage B conflict because EMP-001 differs from existing SA
        expect(dayState.status).toBe('stage_b_conflict');
        expect(dayState.canApply).toBe(false);
        expect(dayState.stageBBlockers).toContain('decision_unacknowledged');

        // Check conflict plan rows
        const conflictRows = dayState.conflictPlan.rows;
        const emp1Row = conflictRows.find(r => r.employeeId === 'EMP-001');
        const emp2Row = conflictRows.find(r => r.employeeId === 'EMP-002');

        // EMP-002 is identical: no-op, auto-acknowledged keep_existing with 0 blockers
        expect(emp2Row.isIdentical).toBe(true);
        expect(emp2Row.decision.action).toBe('keep_existing');
        expect(emp2Row.decision.acknowledged).toBe(true);
        expect(emp2Row.blockers).toHaveLength(0);

        // EMP-001 differs: unacknowledged keep_existing with blocker
        expect(emp1Row.isIdentical).toBe(false);
        expect(emp1Row.decision.acknowledged).toBe(false);
        expect(emp1Row.blockers).toContain('decision_unacknowledged');

        // User explicitly chooses to use imported for EMP-001
        resolver.resolveDayConflict('2026-09-06', 'EMP-001', { action: 'use_imported' });

        const resolvedDayState = resolver.getDayState('2026-09-06');
        expect(resolvedDayState.status).toBe('ready');
        expect(resolvedDayState.canApply).toBe(true);

        // Apply
        const result = await resolver.applyDay('2026-09-06');
        expect(result.appliedCount).toBe(1); // Only EMP-001 written
        expect(result.keptCount).toBe(1); // EMP-002 was no-op keep_existing!
        expect(result.writtenKeys).toEqual(['EMP-001-2026-09-06']);
        expect(result.keptKeys).toEqual(['EMP-002-2026-09-06']);

        // Verify SA was overwritten for EMP-001
        expect(mockState.attendance['EMP-001-2026-09-06'].hoursWorked).toBe(8);
    });

    test('5. Multi-day 2-3 dates: preserves day and period views; resolution and apply remain day-atomic', async () => {
        const sub1 = sampleSubmission({
            submissionId: 'sub-d1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const sub2 = sampleSubmission({
            submissionId: 'sub-d2',
            workDate: '2026-09-07',
            rows: [
                { miniLocalId: 'm2', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 1, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const sub3 = sampleSubmission({
            submissionId: 'sub-d3',
            workDate: '2026-09-08',
            rows: [
                { miniLocalId: 'm3', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 2, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub1, sub2, sub3],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        expect(resolver.workDates).toEqual(['2026-09-06', '2026-09-07', '2026-09-08']);

        // Check Day view
        const dayView = resolver.getConsolidatedView('day');
        expect(dayView.mode).toBe('day');
        expect(dayView.groups.length).toBe(3);
        expect(dayView.groups[0].workDate).toBe('2026-09-06');
        expect(dayView.groups[0].dayState.status).toBe('ready');

        // Check Period view (presentation only)
        const periodView = resolver.getConsolidatedView('period');
        expect(periodView.mode).toBe('period');
        expect(periodView.employeeGroups.length).toBe(1);
        expect(periodView.employeeGroups[0].saEmployeeId).toBe('EMP-001');
        expect(periodView.employeeGroups[0].totalNormalHours).toBe(24);
        expect(periodView.employeeGroups[0].totalOvertimeHours).toBe(3);

        // Apply only Day 2 ('2026-09-07')
        const resultD2 = await resolver.applyDay('2026-09-07');
        expect(resultD2.appliedCount).toBe(1);
        expect(mockState.attendance['EMP-001-2026-09-07'].overtimeHours).toBe(1);

        // Day 1 and Day 3 remain unapplied!
        expect(mockState.attendance['EMP-001-2026-09-06']).toBeUndefined();
        expect(mockState.attendance['EMP-001-2026-09-08']).toBeUndefined();
        expect(resolver.getDayState('2026-09-06').status).toBe('ready');
        expect(resolver.getDayState('2026-09-07').status).toBe('applied');
        expect(resolver.getDayState('2026-09-08').status).toBe('ready');
    });

    test('6. Partial apply where one day remains blocked: ready days apply, blocked day remains untouched with zero writes', async () => {
        // Day 1 has valid resolved data
        const subDay1 = sampleSubmission({
            submissionId: 'sub-day1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        // Day 2 has an unresolved identity conflict
        const subDay2 = sampleSubmission({
            submissionId: 'sub-day2',
            workDate: '2026-09-07',
            rows: [
                { miniLocalId: 'm2', number: '999', name: 'Desconocido', normalHours: 8, overtimeHours: 0, status: 'present' }
            ]
        });

        // Day 3 has valid resolved data
        const subDay3 = sampleSubmission({
            submissionId: 'sub-day3',
            workDate: '2026-09-08',
            rows: [
                { miniLocalId: 'm3', number: '002', name: 'Carlos Gómez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [subDay1, subDay2, subDay3],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        expect(resolver.getDayState('2026-09-06').status).toBe('ready');
        expect(resolver.getDayState('2026-09-07').status).toBe('stage_a_blocked');
        expect(resolver.getDayState('2026-09-08').status).toBe('ready');

        // Apply ready days in batch
        const batchResults = await resolver.applyReadyDays();
        expect(batchResults.length).toBe(2);
        expect(batchResults[0].date).toBe('2026-09-06');
        expect(batchResults[1].date).toBe('2026-09-08');

        // Day 1 and Day 3 were written
        expect(mockState.attendance['EMP-001-2026-09-06']).toBeDefined();
        expect(mockState.attendance['EMP-002-2026-09-08']).toBeDefined();

        // Day 2 was NOT written and remains stage_a_blocked
        expect(resolver.getDayState('2026-09-07').status).toBe('stage_a_blocked');
        expect(Object.keys(mockState.attendance).some(k => k.includes('2026-09-07'))).toBe(false);

        // Later, user resolves Day 2's unlinked identity to EMP-001
        const unlinkedItem = resolver.items.find(i => i.workDate === '2026-09-07');
        resolver.resolveItemIdentity(unlinkedItem.id, 'EMP-001');

        expect(resolver.getDayState('2026-09-07').status).toBe('ready');

        // Now Day 2 can be applied independently
        const resultD2 = await resolver.applyDay('2026-09-07');
        expect(resultD2.appliedCount).toBe(1);
        expect(mockState.attendance['EMP-001-2026-09-07']).toBeDefined();
        expect(resolver.getDayState('2026-09-07').status).toBe('applied');
    });

    test('7. Zero writes before confirmation: no writes occur during intake, Stage A resolution, or Stage B review', () => {
        const sub = sampleSubmission({
            submissionId: 'sub-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        // Query states and views
        resolver.getDayState('2026-09-06');
        resolver.getConsolidatedView('day');
        resolver.getConsolidatedView('period');
        resolver.getMultiDaySummary();

        // ZERO writes to attendance before applyDay/applyReadyDays
        expect(mockApplyPlan).not.toHaveBeenCalled();
        expect(Object.keys(mockState.attendance)).toHaveLength(0);
    });

    test('applyDay never mutates the injected attendance object directly when canonical apply spy does not mutate', async () => {
        const sub = sampleSubmission({
            submissionId: 'sub-no-direct-write',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });
        const attendance = {};
        const nonMutatingApply = jest.fn(async plan => ({
            date: plan.date,
            appliedCount: plan.writes.length,
            writtenKeys: plan.writes.map(write => write.key),
            keptCount: plan.keptKeys.length,
            keptKeys: [...plan.keptKeys]
        }));
        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub],
            employees: mockEmployees,
            attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: nonMutatingApply
        });

        await resolver.applyDay('2026-09-06');

        expect(nonMutatingApply).toHaveBeenCalledTimes(1);
        expect(attendance).toEqual({});
        expect(resolver.getDayState('2026-09-06').status).toBe('applied');
    });

    test('Missing row from another Mini never means absent or deleted (pure non-deletion rule)', () => {
        // Mini 1 submits Ana and Carlos
        const sub1 = sampleSubmission({
            submissionId: 'sub-1',
            deviceId: 'dev-1',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm1-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' },
                { miniLocalId: 'm1-2', number: '002', name: 'Carlos Gómez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-002' }
            ]
        });
        // Mini 2 ONLY submits Ana (does not mention Carlos at all)
        const sub2 = sampleSubmission({
            submissionId: 'sub-2',
            deviceId: 'dev-2',
            workDate: '2026-09-06',
            rows: [
                { miniLocalId: 'm2-1', number: '001', name: 'Ana Pérez', normalHours: 8, overtimeHours: 0, status: 'present', saEmployeeId: 'EMP-001' }
            ]
        });

        const resolver = createMultiDayAttendanceResolver({
            submissions: [sub1, sub2],
            employees: mockEmployees,
            attendance: mockState.attendance,
            positions: mockPositions,
            saProjectId: PROJECT_ID,
            entityScope: PROJECT_SCOPE,
            applyPlan: mockApplyPlan
        });

        const dayState = resolver.getDayState('2026-09-06');
        expect(dayState.items.length).toBe(2);

        // Carlos stands as reported by Mini 1!
        const carlos = dayState.items.find(i => i.saEmployeeId === 'EMP-002');
        expect(carlos).toBeDefined();
        expect(carlos.status).toBe('resolved');
        expect(carlos.normalHours).toBe(8);
        expect(carlos.sources.length).toBe(1);
    });
});
