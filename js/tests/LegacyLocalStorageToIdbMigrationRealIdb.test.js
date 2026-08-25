/**
 * F1.0.1 — Legacy localStorage ('asistencia-data') → migration driven through
 * the PUBLIC boot path (loadApplicationData) with a REAL IndexedDBService
 * underneath (fake-indexeddb), instead of the mocked stores used by
 * LegacyLocalStorageToIdbMigration.test.js.
 *
 * Wiring: PersistenceService holds the mock-mapped singleton; the real class
 * prototype methods are installed onto that same object so every boot-path
 * call (loadFullState / isSupported / saveState / getAll…) executes real IDB
 * code. dataService.loadAll keeps the established local legacy-blob loader
 * technique from the mocked suite.
 */

import 'fake-indexeddb/auto';
import { loadApplicationData } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import dataService from '../modules/services/DataService.js';
import { IndexedDBService as RealIndexedDBService } from 'actual/services/IndexedDBService.js';
import { Employee } from '../modules/features/employees/Employee.js';
import { Position } from '../modules/features/employees/Position.js';
import { Leader } from '../modules/features/employees/Leader.js';
import { Attendance } from '../modules/features/attendance/Attendance.js';

// jest-environment-jsdom does not expose structuredClone; fake-indexeddb v6
// requires it. Test payloads here are plain JSON-safe POJOs by contract.
if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const DB_NAME = 'attendance-app-db-migration-real';

function wireRealIdbIntoMockSingleton() {
    const real = new RealIndexedDBService(DB_NAME);
    Object.assign(indexedDBService, {
        dbName: real.dbName,
        version: real.version,
        db: null,
        isInitialized: false
    });
    for (const name of Object.getOwnPropertyNames(RealIndexedDBService.prototype)) {
        if (name !== 'constructor') indexedDBService[name] = RealIndexedDBService.prototype[name];
    }
}
wireRealIdbIntoMockSingleton();

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

describe('Legacy localStorage → REAL IndexedDB migration (public boot path)', () => {
    let snap;
    let loadAllSpy;

    beforeEach(async () => {
        snap = JSON.parse(JSON.stringify({
            employees: state.employees, positions: state.positions, leaders: state.leaders,
            attendance: state.attendance, settings: state.settings,
            isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
        }));
        localStorage.clear();
        await indexedDBService.clearAll();
        loadAllSpy = jest.spyOn(dataService, 'loadAll')
            .mockImplementation(loadAllFromLegacyLocalStorage);
    });

    afterEach(() => {
        Object.assign(state, snap);
        localStorage.clear();
        loadAllSpy.mockRestore();
    });

    test('first boot migrates the seeded blob into the REAL stores and flags migrated-to-idb', async () => {
        localStorage.setItem('asistencia-data', JSON.stringify(legacyBlob()));

        expect(await loadApplicationData()).toBe(true);

        expect(localStorage.getItem('migrated-to-idb')).toBe('true');
        expect(localStorage.getItem('asistencia-data')).toBeNull();
        expect(state.useIndexedDB).toBe(true);

        // The migrated data physically reached the real object stores.
        const emps = await indexedDBService.getAll('employees');
        expect(emps.map(e => e.id)).toContain('emp-legacy-1');
        expect(emps.find(e => e.id === 'emp-legacy-1').name).toBe('Ana Pérez');
        const att = await indexedDBService.getAll('attendance');
        expect(att.map(r => r.key)).toContain('emp-legacy-1-2026-08-20');
        const settingsRow = await indexedDBService.get('settings', 'app');
        expect(settingsRow.regularHoursPerDay).toBe(8);
    });

    test('migration consumes its input: second boot serves from real IDB and nothing re-migrates', async () => {
        localStorage.setItem('asistencia-data', JSON.stringify(legacyBlob()));
        await loadApplicationData();
        expect(localStorage.getItem('asistencia-data')).toBeNull();

        // The consumed blob cannot resurrect stale data: with the real IDB
        // emptied, a further boot finds no data anywhere (no re-migration).
        await indexedDBService.clearAll();
        expect(await loadApplicationData()).toBe(false);
        expect(localStorage.getItem('migrated-to-idb')).toBe('true');
        expect(await indexedDBService.getAll('employees')).toEqual([]);
    });
});
