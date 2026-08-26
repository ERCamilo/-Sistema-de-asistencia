/**
 * F1.0.2 — H-01 reproduction against the REAL IndexedDBService at runtime.
 *
 * H-01: an employee record supports a tombstone field `deletedAt` (cloud
 * tombstones, EmployeeMerge), but if the Employee class constructor does not
 * preserve it, re-inflation during loadApplicationData (PersistenceService
 * inflates every IDB record with `new Employee(e)`) silently drops it and the
 * deleted employee resurrects on the next save.
 *
 * Wiring: the real IndexedDBService prototype methods are installed onto the
 * mock-mapped singleton (the same object PersistenceService imported), backed
 * by fake-indexeddb. Every call inside the boot path therefore hits a real
 * IndexedDB store.
 */

import 'fake-indexeddb/auto';
import { loadApplicationData } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { IndexedDBService as RealIndexedDBService } from 'actual/services/IndexedDBService.js';

// jest-environment-jsdom does not expose structuredClone; fake-indexeddb v6
// requires it. Test payloads here are plain JSON-safe POJOs by contract.
if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const DB_NAME = 'attendance-app-db-tombstone';

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

const DELETED_AT = Date.now() - 60_000;

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, settings: state.settings,
        isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
    }));
}

describe('H-01: employee tombstone survives the REAL persistence round trip', () => {
    let snap;

    beforeEach(() => {
        snap = snapshotState();
        localStorage.clear();
    });

    afterEach(() => {
        Object.assign(state, snap);
        localStorage.clear();
    });

    test('deletedAt written into the real employees store survives loadApplicationData inflation', async () => {
        await indexedDBService.clearAll();
        await indexedDBService.batchUpdate('employees', [{
            id: 'EMP-X', key: 'EMP-X', number: '99', name: 'X',
            positions: [], active: false, deletedAt: DELETED_AT, updatedAt: DELETED_AT
        }]);

        // The raw store holds the tombstone before the boot path runs.
        const raw = await indexedDBService.getAll('employees');
        expect(raw.map(e => e.id)).toContain('EMP-X');
        expect(raw.find(e => e.id === 'EMP-X').deletedAt).toBe(DELETED_AT);

        expect(await loadApplicationData()).toBe(true);

        // The app's actual load path inflated records via new Employee(...).
        const loaded = state.employees.find(e => e.id === 'EMP-X');
        expect(loaded).toBeDefined();
        expect(loaded.active).toBe(false);
        expect(loaded.deletedAt).toBe(DELETED_AT);
    });

    test('re-saving what the load produced keeps the tombstone durable (second generation)', async () => {
        await indexedDBService.clearAll();
        await indexedDBService.batchUpdate('employees', [{
            id: 'EMP-Y', key: 'EMP-Y', number: '98', name: 'Y',
            positions: [], active: false, deletedAt: DELETED_AT, updatedAt: DELETED_AT
        }]);
        expect(await loadApplicationData()).toBe(true);

        await indexedDBService.saveState({
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: {},
            settings: state.settings
        });

        const secondGeneration = await indexedDBService.getAll('employees');
        expect(secondGeneration.find(e => e.id === 'EMP-Y').deletedAt).toBe(DELETED_AT);
    });

    // F1.4 — projectId follows the same hasOwnProperty pattern as deletedAt:
    // present → preserved across every inflation point; absent → stays absent
    // (legacy records must remain byte-stable through save/load generations).
    test('F1.4: projectId survives the REAL round trip; absence stays absent', async () => {
        await indexedDBService.clearAll();
        await indexedDBService.batchUpdate('employees', [
            {
                id: 'EMP-PRJ', key: 'EMP-PRJ', number: '97', name: 'P',
                positions: [], active: true, projectId: 'PRJ-K', updatedAt: 1
            },
            {
                id: 'EMP-LEGACY', key: 'EMP-LEGACY', number: '96', name: 'L',
                positions: [], active: true, updatedAt: 1
            }
        ]);
        expect(await loadApplicationData()).toBe(true);

        const stamped = state.employees.find(e => e.id === 'EMP-PRJ');
        expect(stamped.projectId).toBe('PRJ-K');
        const legacy = state.employees.find(e => e.id === 'EMP-LEGACY');
        expect(Object.prototype.hasOwnProperty.call(legacy, 'projectId')).toBe(false);

        await indexedDBService.saveState({
            employees: state.employees,
            positions: state.positions,
            leaders: state.leaders,
            attendance: {},
            settings: state.settings
        });
        const secondGeneration = await indexedDBService.getAll('employees');
        expect(secondGeneration.find(e => e.id === 'EMP-PRJ').projectId).toBe('PRJ-K');
        expect(Object.prototype.hasOwnProperty.call(
            secondGeneration.find(e => e.id === 'EMP-LEGACY'), 'projectId'
        )).toBe(false);
    });

    test('F1.4: a tombstoned employee KEEPS its projectId (H-01 protection intact)', async () => {
        await indexedDBService.clearAll();
        await indexedDBService.batchUpdate('employees', [{
            id: 'EMP-TOMB', key: 'EMP-TOMB', number: '95', name: 'T',
            positions: [], active: false, deletedAt: DELETED_AT,
            projectId: 'PRJ-K', updatedAt: DELETED_AT
        }]);
        expect(await loadApplicationData()).toBe(true);

        const loaded = state.employees.find(e => e.id === 'EMP-TOMB');
        expect(loaded.deletedAt).toBe(DELETED_AT);
        expect(loaded.projectId).toBe('PRJ-K');
    });
});
