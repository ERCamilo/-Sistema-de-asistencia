import { createAttendanceRangeLoader } from '../modules/services/AttendanceRangeLoader.js';

function makeHarness(overrides = {}) {
    let attendance = {
        'e1-2026-01-10': {
            employeeId: 'e1', date: '2026-01-10', updatedAt: 10, lastAccessed: 100
        }
    };
    const deps = {
        fetchRange: jest.fn().mockResolvedValue({}),
        readAttendance: () => attendance,
        writeAttendance: jest.fn(next => { attendance = next; }),
        persistRecords: jest.fn().mockResolvedValue(undefined),
        onApplied: jest.fn(),
        now: () => 500,
        ...overrides
    };
    return { loader: createAttendanceRangeLoader(deps), deps, getAttendance: () => attendance };
}

describe('AttendanceRangeLoader', () => {
    test('fetches, merges and persists the requested range with a real access timestamp', async () => {
        const remote = {
            'e2-2026-01-10': { employeeId: 'e2', date: '2026-01-10', updatedAt: 20 }
        };
        const { loader, deps, getAttendance } = makeHarness({
            fetchRange: jest.fn().mockResolvedValue(remote)
        });

        const result = await loader.ensureRange('2026-01-01', '2026-01-31');

        expect(deps.fetchRange).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
        expect(getAttendance()['e1-2026-01-10'].lastAccessed).toBe(500);
        expect(getAttendance()['e2-2026-01-10'].lastAccessed).toBe(500);
        expect(deps.persistRecords).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ key: 'e1-2026-01-10', lastAccessed: 500 }),
            expect.objectContaining({ key: 'e2-2026-01-10', lastAccessed: 500 })
        ]));
        expect(deps.onApplied).toHaveBeenCalledWith(['2026-01-10']);
        expect(result).toEqual({ count: 2, dateKeys: ['2026-01-10'] });
    });

    test('does not touch records outside the requested range', async () => {
        const { loader, deps, getAttendance } = makeHarness();

        await loader.ensureRange('2026-02-01', '2026-02-28');

        expect(getAttendance()['e1-2026-01-10'].lastAccessed).toBe(100);
        expect(deps.persistRecords).toHaveBeenCalledWith([]);
    });

    test('coalesces concurrent requests for the same range', async () => {
        let resolveFetch;
        const fetchRange = jest.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
        const { loader } = makeHarness({ fetchRange });

        const first = loader.ensureRange('2026-01-01', '2026-01-31');
        const second = loader.ensureRange('2026-01-01', '2026-01-31');
        resolveFetch({});

        await Promise.all([first, second]);
        expect(fetchRange).toHaveBeenCalledTimes(1);
    });

    test('rejects invalid or inverted ranges before touching dependencies', async () => {
        const { loader, deps } = makeHarness();

        await expect(loader.ensureRange('not-a-date', '2026-01-31')).rejects.toThrow('Invalid attendance range');
        await expect(loader.ensureRange('2026-02-01', '2026-01-31')).rejects.toThrow('Invalid attendance range');

        expect(deps.fetchRange).not.toHaveBeenCalled();
        expect(deps.writeAttendance).not.toHaveBeenCalled();
    });

    test('does not mutate state or IndexedDB when the cloud read fails', async () => {
        const { loader, deps, getAttendance } = makeHarness({
            fetchRange: jest.fn().mockRejectedValue(new Error('offline'))
        });

        await expect(loader.ensureRange('2026-01-01', '2026-01-31')).rejects.toThrow('offline');

        expect(getAttendance()['e1-2026-01-10'].lastAccessed).toBe(100);
        expect(deps.writeAttendance).not.toHaveBeenCalled();
        expect(deps.persistRecords).not.toHaveBeenCalled();
    });

    test('can load the complete history for destructive integrity checks', async () => {
        const { loader, deps } = makeHarness();
        await loader.ensureAll();
        expect(deps.fetchRange).toHaveBeenCalledWith(null, null);
        expect(deps.persistRecords).toHaveBeenCalledWith([
            expect.objectContaining({ key: 'e1-2026-01-10', lastAccessed: 500 })
        ]);
    });
});
