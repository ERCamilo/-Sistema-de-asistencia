/**
 * Characterization: legacy localStorage ('asistencia-data') → IndexedDB
 * migration via the public boot path only (the migration block is private/
 * inline in PersistenceService ~L1179): empty IndexedDB + seeded blob →
 * saveState receives the migrated state and 'migrated-to-idb' becomes 'true'.
 */

import { loadApplicationData } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import dataService from '../modules/services/DataService.js';
import { Employee } from '../modules/features/employees/Employee.js';
import { Position } from '../modules/features/employees/Position.js';
import { Leader } from '../modules/features/employees/Leader.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';

function legacyBlob() {
    return {
        employees: [{ id: 'emp-legacy-1', number: '1', name: 'Ana Pérez', positions: ['pos-legacy-1'], active: true }],
        positions: [{ id: 'pos-legacy-1', name: 'Operadora', active: true }],
        leaders: [],
        attendance: { 'emp-legacy-1-2026-08-20': { employeeId: 'emp-legacy-1', date: '2026-08-20', present: true } },
        settings: { regularHoursPerDay: 8 }
    };
}

// Mimics the real DataService.loadAll(): parse the blob from localStorage,
// inflate entities into class instances and populate global state.
function loadAllFromLegacyLocalStorage() {
    const data = JSON.parse(localStorage.getItem('asistencia-data') || 'null');
    if (!data) return false;
    if (data.employees) state.employees = data.employees.map(e => new Employee(e));
    if (data.positions) state.positions = data.positions.map(p => new Position(p));
    if (data.leaders) state.leaders = data.leaders.map(l => new Leader(l));
    if (data.attendance) {
        state.attendance = Object.fromEntries(Object.entries(data.attendance)
            .map(([key, value]) => [key, new Attendance(value)]));
    }
    if (data.settings) Object.assign(state.settings, data.settings);
    return true;
}

describe('Legacy localStorage → IndexedDB migration (public boot path)', () => {
    let snap;

    beforeEach(() => {
        localStorage.clear();
        snap = JSON.parse(JSON.stringify({
            employees: state.employees, positions: state.positions, leaders: state.leaders,
            attendance: state.attendance, settings: state.settings, useIndexedDB: state.useIndexedDB
        }));
        indexedDBService.loadFullState.mockResolvedValue(null);
        indexedDBService.isSupported.mockReturnValue(true);
        indexedDBService.saveState.mockClear();
    });

    afterEach(() => {
        Object.assign(state, snap);
        localStorage.clear();
    });

    test('migrates the seeded asistencia-data blob into IndexedDB on first boot', async () => {
        localStorage.setItem('asistencia-data', JSON.stringify(legacyBlob()));
        const loadAllSpy = jest.spyOn(dataService, 'loadAll')
            .mockImplementation(loadAllFromLegacyLocalStorage);

        expect(await loadApplicationData()).toBe(true);

        expect(indexedDBService.saveState).toHaveBeenCalledTimes(1);
        const savedArg = indexedDBService.saveState.mock.calls[0][0];
        expect(savedArg.employees.map(e => e.id)).toEqual(['emp-legacy-1']);
        expect(savedArg.positions.map(p => p.id)).toEqual(['pos-legacy-1']);
        expect(Object.keys(savedArg.attendance)).toContain('emp-legacy-1-2026-08-20');
        expect(localStorage.getItem('migrated-to-idb')).toBe('true');
        // Quirk pinned: after a successful migration the legacy blob is removed
        // so an IDB eviction cannot resurrect stale data (H5).
        expect(localStorage.getItem('asistencia-data')).toBeNull();
        expect(state.useIndexedDB).toBe(true);
        loadAllSpy.mockRestore();
    });

    test('second boot run is idempotent: no duplicate migration write', async () => {
        localStorage.setItem('asistencia-data', JSON.stringify(legacyBlob()));
        const loadAllSpy = jest.spyOn(dataService, 'loadAll')
            .mockImplementation(loadAllFromLegacyLocalStorage);

        await loadApplicationData();
        indexedDBService.saveState.mockClear();

        // Quirk pinned: the IDB mock stays empty and the legacy key was consumed
        // by the first run, so the second run reports "no data anywhere"…
        expect(await loadApplicationData()).toBe(false);
        // …and never re-writes the migration into IndexedDB.
        expect(indexedDBService.saveState).not.toHaveBeenCalled();
        expect(localStorage.getItem('migrated-to-idb')).toBe('true');
        loadAllSpy.mockRestore();
    });
});
