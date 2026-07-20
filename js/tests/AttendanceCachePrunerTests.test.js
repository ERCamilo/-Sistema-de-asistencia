import { createAttendanceCachePruner } from '../modules/services/AttendanceCachePruner.js';
const NOW = new Date('2026-07-20T12:00:00').getTime();
function oldRecord(date) {
    return { employeeId: 'e1', date, updatedAt: NOW - 1000 };
}
function makeHarness(overrides = {}) {
    let attendance = {
        'e1-2026-07-01': oldRecord('2026-07-01'),
        'e1-2024-01-01': oldRecord('2024-01-01')
    };
    const deps = {
        readAttendance: () => attendance,
        writeAttendance: jest.fn(next => { attendance = next; }),
        getProtectedDateKeys: jest.fn().mockResolvedValue(new Set()),
        deleteRecords: jest.fn().mockResolvedValue(1),
        onPruned: jest.fn(),
        now: () => NOW,
        ...overrides
    };
    return { pruner: createAttendanceCachePruner(deps), deps, getAttendance: () => attendance };
}
describe('AttendanceCachePruner', () => {
    test('deletes only planned attendance keys and then updates memory', async () => {
        const { pruner, deps, getAttendance } = makeHarness();

        const result = await pruner.prune();

        expect(deps.getProtectedDateKeys).toHaveBeenCalledTimes(1);
        expect(deps.deleteRecords).toHaveBeenCalledWith(['e1-2024-01-01']);
        expect(Object.keys(getAttendance())).toEqual(['e1-2026-07-01']);
        expect(deps.onPruned).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ evicted: 1, cutoffDate: '2025-07-20' });
    });

    test('keeps an old date protected by the outbox', async () => {
        const { pruner, deps, getAttendance } = makeHarness({
            getProtectedDateKeys: jest.fn().mockResolvedValue(new Set(['2024-01-01']))
        });

        const result = await pruner.prune();

        expect(deps.deleteRecords).not.toHaveBeenCalled();
        expect(deps.writeAttendance).not.toHaveBeenCalled();
        expect(getAttendance()['e1-2024-01-01']).toBeDefined();
        expect(result.evicted).toBe(0);
    });

    test('does not remove records from memory when IndexedDB deletion fails', async () => {
        const { pruner, deps, getAttendance } = makeHarness({
            deleteRecords: jest.fn().mockRejectedValue(new Error('quota'))
        });

        await expect(pruner.prune()).rejects.toThrow('quota');

        expect(deps.writeAttendance).not.toHaveBeenCalled();
        expect(getAttendance()['e1-2024-01-01']).toBeDefined();
        expect(deps.onPruned).not.toHaveBeenCalled();
    });
});
