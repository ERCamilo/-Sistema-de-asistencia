/**
 * Characterization: persistence round-trip integrity. A debounced save runs
 * through saveApplicationData() with the proven flush hook, the mocked IDB
 * captures the saveState payload, and that payload is fed back through
 * loadApplicationData(): collections must come back intact.
 */

import {
    saveApplicationData,
    loadApplicationData,
    flushPendingSave
} from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const T0 = 1723000000000;
// Fresh tombstone: must be within the 60-day compaction window to survive load.
const FRESH_DELETED_AT = Date.now();

// Seeds carry every constructor-managed field explicitly: re-inflation on load is structurally identical to what was saved.
function employeeSeed(overrides = {}) {
    return {
        id: 'emp-1', key: 'emp-1', number: '1', name: 'Ana Pérez',
        positions: ['pos-1'], customSalary: null, active: true,
        hireDate: '2025-01-15', phone: '', email: '',
        positionSalaries: { 'pos-1': 12.5 }, positionSalaryModes: { 'pos-1': 'hourly' },
        customWorkingDays: {}, notes: '', advances: [], bonuses: [], deductions: [],
        loans: [{ id: 'loan-1', amount: 100, payments: [{ id: 'loan-1-pay-1' }] }],
        createdDate: '2025-01-15T00:00:00.000Z', lastStatusChange: null,
        statusHistory: [], updatedAt: T0, positionsUpdatedAt: T0, ...overrides
    };
}

function positionSeed(overrides = {}) {
    return {
        id: 'pos-1', name: 'Operadora', color: '#123456', icon: 'gear', active: true,
        salaryConfig: { amount: 120, period: 'day', workDays: [1, 2, 3, 4, 5] },
        baseSalary: 120, hourlyRate: 15, salaryInputMode: 'hourly',
        leaderId: null, workingDays: [1, 2, 3, 4, 5],
        lastStatusChange: null, statusHistory: [], updatedAt: T0, ...overrides
    };
}

function attendanceSeed() {
    const base = {
        hoursWorked: 0, overtimeHours: 0, isHoliday: false, selectedPosition: null,
        multiPosition: false, positionHours: [], notes: '', deviceId: null
    };
    return {
        'emp-1-2026-08-20': {
            ...base, employeeId: 'emp-1', date: '2026-08-20', present: true,
            hoursWorked: 8, overtimeHours: 1, notes: 'puntual', deviceId: 'dev-1',
            updatedAt: T0, deletedAt: null
        },
        'emp-2-2026-08-21': {
            ...base, employeeId: 'emp-2', date: '2026-08-21', present: false,
            updatedAt: T0 + 1000, deletedAt: FRESH_DELETED_AT
        }
    };
}

describe('Persistence round-trip integrity (saveState payload → loadApplicationData)', () => {
    test('restores collections intact, including tombstones and key format', async () => {
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        state.employees = [
            employeeSeed(),
            employeeSeed({ id: 'emp-2', key: 'emp-2', number: '2', name: 'Beto Suárez' })
        ];
        state.positions = [positionSeed()];
        state.attendance = attendanceSeed();
        state.settings = { regularHoursPerDay: 8, syncEnabled: true, schemaVersion: 3 };

        // Debounced save + proven flush hook (see PersistenceServiceTests).
        saveApplicationData({ skipValidation: true });
        expect(flushPendingSave()).toBe(true);
        await sleep(10);

        expect(indexedDBService.saveState).toHaveBeenCalled();
        const captured = JSON.parse(JSON.stringify(
            indexedDBService.saveState.mock.calls.at(-1)[0]
        ));

        indexedDBService.loadFullState.mockResolvedValueOnce(captured);
        expect(await loadApplicationData()).toBe(true);

        // Attendance keys keep the `${employeeId}-${date}` contract…
        const keys = Object.keys(state.attendance);
        expect(keys.sort()).toEqual(['emp-1-2026-08-20', 'emp-2-2026-08-21']);
        for (const [key, record] of Object.entries(state.attendance)) {
            expect(key).toBe(`${record.employeeId}-${record.date}`);
        }

        // Quirk pinned: although loadApplicationData inflates records into
        // Attendance instances, restoring via Object.assign(state, …) passes
        // each value through the state proxy's set trap, whose toRaw()
        // flattens class instances to plain objects. Fidelity survives; classes do not.
        expect(state.attendance['emp-1-2026-08-20'] instanceof Attendance).toBe(false);
        expect(state.attendance['emp-1-2026-08-20'])
            .toEqual(attendanceSeed()['emp-1-2026-08-20']);

        // Tombstone survives the round trip (fresh enough to dodge compaction).
        expect(state.attendance['emp-2-2026-08-21'])
            .toEqual(attendanceSeed()['emp-2-2026-08-21']);

        // Entities also come back as plain objects (same toRaw flattening):
        // compare structurally against the seeds.
        const asJson = e => (typeof e.toJSON === 'function' ? e.toJSON() : e);
        expect(state.employees.map(asJson)).toEqual([
            employeeSeed(),
            employeeSeed({ id: 'emp-2', key: 'emp-2', number: '2', name: 'Beto Suárez' })
        ]);
        expect(asJson(state.positions[0])).toEqual(positionSeed());
        expect(state.settings).toEqual(captured.settings);
    });
});
