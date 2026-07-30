import {
    applyMiniAttendancePlan,
    validateMiniAttendanceApplyPlan
} from '../modules/features/attendance/MiniAttendanceImportService.js';

const DATE = '2026-07-28';

function record(employeeId, positionId = 'p1', overrides = {}) {
    return {
        employeeId,
        date: DATE,
        present: true,
        hoursWorked: 8,
        overtimeHours: 0,
        selectedPosition: positionId,
        multiPosition: false,
        positionHours: [{ positionId, hours: 8, overtimeHours: 0 }],
        notes: 'reviewed note',
        auditTag: 'preserve-me',
        ...overrides
    };
}

function applyPlan(writes, keptKeys = []) {
    return {
        draftRevision: 4,
        conflictRevision: 2,
        date: DATE,
        writes,
        keptKeys
    };
}

function dependencies(state, overrides = {}) {
    return {
        state,
        stampAttendanceWrite: jest.fn((value, now) => ({
            ...value,
            updatedAt: now,
            deletedAt: null
        })),
        batchSetState: jest.fn(callback => callback(state)),
        invalidateEmployeeStats: jest.fn(),
        buildAttendanceIndex: jest.fn(),
        saveApplicationData: jest.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('MiniAttendanceImportService', () => {
    test('does not mutate before apply and commits all writes through one coherent batch/save', async () => {
        const untouched = record('other');
        const state = {
            attendance: {
                [`other-${DATE}`]: untouched,
                [`e1-${DATE}`]: record('e1', 'p1', { hoursWorked: 4 })
            }
        };
        const plan = applyPlan([
            { key: `e1-${DATE}`, record: record('e1') },
            { key: `e2-${DATE}`, record: record('e2', 'p2') }
        ], ['kept-key']);
        const deps = dependencies(state);
        const before = JSON.stringify(state);

        validateMiniAttendanceApplyPlan(plan);
        expect(JSON.stringify(state)).toBe(before);
        expect(deps.batchSetState).not.toHaveBeenCalled();

        const result = await applyMiniAttendancePlan(plan, {
            now: 12345,
            announce: 'Imported attendance saved',
            deps
        });

        expect(deps.stampAttendanceWrite).toHaveBeenCalledTimes(2);
        expect(deps.stampAttendanceWrite).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining(plan.writes[0].record),
            12345
        );
        expect(deps.stampAttendanceWrite.mock.calls[0][0]).not.toBe(plan.writes[0].record);
        expect(deps.stampAttendanceWrite.mock.calls[0][0].positionHours)
            .not.toBe(plan.writes[0].record.positionHours);
        expect(deps.batchSetState).toHaveBeenCalledTimes(1);
        expect(deps.invalidateEmployeeStats.mock.calls.map(call => call[0])).toEqual(['e1', 'e2']);
        expect(deps.buildAttendanceIndex).toHaveBeenCalledTimes(1);
        expect(deps.buildAttendanceIndex).toHaveBeenCalledWith(DATE);
        expect(deps.saveApplicationData).toHaveBeenCalledTimes(1);
        expect(deps.saveApplicationData).toHaveBeenCalledWith({
            dateKey: DATE,
            announce: 'Imported attendance saved'
        });
        expect(state.attendance[`other-${DATE}`]).toBe(untouched);
        expect(state.attendance[`e1-${DATE}`]).toMatchObject({
            notes: 'reviewed note',
            auditTag: 'preserve-me',
            updatedAt: 12345,
            deletedAt: null
        });
        expect(result).toEqual({
            date: DATE,
            appliedCount: 2,
            writtenKeys: [`e1-${DATE}`, `e2-${DATE}`],
            keptCount: 1,
            keptKeys: ['kept-key']
        });
    });

    test('thaws a deeply frozen approved record before placing it in reactive state', async () => {
        const frozenRecord = record('e1');
        Object.freeze(frozenRecord.positionHours[0]);
        Object.freeze(frozenRecord.positionHours);
        Object.freeze(frozenRecord);
        const plan = applyPlan([{
            key: `e1-${DATE}`,
            record: frozenRecord
        }]);
        Object.freeze(plan.writes[0]);
        Object.freeze(plan.writes);
        Object.freeze(plan.keptKeys);
        Object.freeze(plan);
        const state = { attendance: {} };
        const deps = dependencies(state);

        await applyMiniAttendancePlan(plan, { deps, now: 12345 });

        const stored = state.attendance[`e1-${DATE}`];
        expect(Object.isFrozen(stored)).toBe(false);
        expect(Object.isFrozen(stored.positionHours)).toBe(false);
        expect(Object.isFrozen(stored.positionHours[0])).toBe(false);
        expect(() => stored.positionHours.find(item => item.positionId === 'p1'))
            .not.toThrow();
        stored.positionHours[0].hours = 7;
        expect(stored.positionHours[0].hours).toBe(7);
    });

    test('invalidates a touched employee only once', async () => {
        const state = { attendance: {} };
        const deps = dependencies(state);
        const plan = applyPlan([
            { key: `e1-${DATE}`, record: record('e1') },
            { key: `e1-${DATE}`, record: record('e1') }
        ]);

        await expect(applyMiniAttendancePlan(plan, { deps }))
            .rejects.toThrow('Duplicate attendance write key');
        expect(deps.invalidateEmployeeStats).not.toHaveBeenCalled();
        expect(state.attendance).toEqual({});
    });

    test('all-kept plans are true no-ops with deterministic counts', async () => {
        const state = { attendance: { stable: record('e1') } };
        const deps = dependencies(state);
        const result = await applyMiniAttendancePlan(
            applyPlan([], ['stable', 'other-kept']),
            { deps }
        );

        expect(result).toEqual({
            date: DATE,
            appliedCount: 0,
            writtenKeys: [],
            keptCount: 2,
            keptKeys: ['stable', 'other-kept']
        });
        for (const dependency of [
            deps.stampAttendanceWrite,
            deps.batchSetState,
            deps.invalidateEmployeeStats,
            deps.buildAttendanceIndex,
            deps.saveApplicationData
        ]) expect(dependency).not.toHaveBeenCalled();
    });

    test.each([
        ['invalid date', { ...applyPlan([]), date: '28-07-2026' }, 'Invalid apply plan date'],
        ['null key', applyPlan([{ key: null, record: record('e1') }]), 'Invalid attendance write key'],
        ['key mismatch', applyPlan([{ key: `e1-${DATE}`, record: record('e2') }]), 'does not match record'],
        ['malformed record', applyPlan([{
            key: `e1-${DATE}`,
            record: record('e1', null, { positionHours: [] })
        }]), 'Malformed attendance write']
    ])('rejects %s before any effect', async (_label, plan, message) => {
        const state = { attendance: { stable: record('e1') } };
        const deps = dependencies(state);
        const before = JSON.stringify(state);

        await expect(applyMiniAttendancePlan(plan, { deps })).rejects.toThrow(message);
        expect(JSON.stringify(state)).toBe(before);
        expect(deps.batchSetState).not.toHaveBeenCalled();
        expect(deps.saveApplicationData).not.toHaveBeenCalled();
    });

    test('propagates save failures instead of reporting success', async () => {
        const state = { attendance: {} };
        const saveError = new Error('disk unavailable');
        const deps = dependencies(state, {
            saveApplicationData: jest.fn().mockRejectedValue(saveError)
        });

        await expect(applyMiniAttendancePlan(
            applyPlan([{ key: `e1-${DATE}`, record: record('e1') }]),
            { deps }
        )).rejects.toBe(saveError);
        expect(deps.saveApplicationData).toHaveBeenCalledTimes(1);
    });
});
