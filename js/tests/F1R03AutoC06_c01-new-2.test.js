/**
 * C01-NEW-2 (MEDIUM_LOW, concurrency) — regression test.
 *
 * Finding: PersistenceService.ensureAttendanceRange persists its fetched
 * range through `indexedDBService.batchUpdate('attendance', records)`
 * DIRECTLY — with no dataset-epoch stamp and no published epoch flight
 * guard. The C02-NEW-1/C03-NEW-1 write-point barrier
 * (IndexedDBService._isDatasetEpochStale) therefore cannot stop it: it only
 * bars writes emitted while the FULL replacement transaction is
 * created-but-uncommitted, or writes belonging to a saveState flight whose
 * epoch stamp fell behind the shared counter. A range fetch/persist whose
 * persist lands AFTER the replacement commits (including the microtask gap
 * between the replacement commit and the post-commit epoch bump — and,
 * with no guard published at all, at ANY later moment) passes the barrier
 * untouched and re-inserts pre-import range rows into the freshly imported
 * attendance store.
 *
 * Reproduction (runtime-driven on real fake-indexeddb transactions, same
 * harness style as the C02/C03/C04 sibling tests): ensureAttendanceRange is
 * started BEFORE the FULL replacement with its fetchRange parked in flight;
 * the FULL replacement (real PersistenceService.saveToIndexedDB with
 * clearFirst, backed by the REAL IndexedDBService atomic replacement)
 * commits; then the fetch resolves with pre-import range rows and the
 * loader's persistRecords writes them through a bare batchUpdate. The
 * freshly imported attendance store must not contain the pre-import rows.
 * It must FAIL on the unfixed candidate.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import mockedFirebase from '../modules/services/FirebaseService.js';
import { state } from '../modules/core/AppState.js';
import { ensureAttendanceRange, saveToIndexedDB } from '../modules/services/PersistenceService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const RANGE_DATE = '2026-09-10';

// Pre-import rows the straddled range fetch carries: they were fetched
// BEFORE the FULL replacement committed and must not survive it.
const preImportRangeRows = () => ({
    [`old-e-${RANGE_DATE}`]: {
        employeeId: 'old-e', date: RANGE_DATE, hours: 8, updatedAt: 100
    }
});

// The dataset the FULL import publishes and durably replaces with: one
// imported employee with one imported attendance row for the same range date.
const importedState = () => ({
    employees: [{ id: 'new-e', number: '2', name: 'Imported Employee' }],
    positions: [],
    leaders: [],
    attendance: {
        [`new-e-${RANGE_DATE}`]: {
            employeeId: 'new-e', date: RANGE_DATE, hours: 6, updatedAt: 500
        }
    },
    settings: { companyName: 'Imported Company', schemaVersion: 3 }
});

let realService;

beforeEach(() => {
    localStorage.clear();
    originalState = {
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, settings: state.settings,
        isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
    };
    realService = new IndexedDBService(`c01new2-${Date.now()}-${Math.random()}`);
    // The range loader's persistRecords wiring calls the (jest-mocked)
    // indexedDBService.batchUpdate directly with NO epoch stamp — delegate it
    // to the REAL service so the write runs through the actual write-point
    // barrier exactly as in production.
    mockedIDB.batchUpdate.mockImplementation(
        (storeName, records) => realService.batchUpdate(storeName, records)
    );
    mockedIDB.saveState.mockImplementation(
        (rawState, options) => realService.saveState(rawState, options)
    );
});

let originalState;

afterEach(async () => {
    mockedIDB.batchUpdate.mockReset();
    mockedIDB.saveState.mockReset();
    mockedFirebase.getAttendanceRange.mockReset();
    try { realService?.db?.close(); } catch (_) { /* noop */ }
    Object.assign(state, originalState);
});

test('a range persist released after the FULL replacement commit must not re-insert pre-import rows into the imported attendance store', async () => {
    await realService.init();

    // Baseline IndexedDB dataset: the pre-import world, already on disk.
    await realService.batchUpdate('employees', [
        { id: 'old-e', number: '1', name: 'Old Employee' }
    ]);
    await realService.batchUpdate('attendance', [
        { key: `old-e-${RANGE_DATE}`, employeeId: 'old-e', date: RANGE_DATE, hours: 8, updatedAt: 100 }
    ]);

    // In-memory state: the FULL import has already published its provisional
    // imported dataset (this is what the replacement below will commit).
    Object.assign(state, {
        employees: [{ id: 'new-e', number: '2', name: 'Imported Employee' }],
        positions: [],
        leaders: [],
        attendance: {
            [`new-e-${RANGE_DATE}`]: {
                employeeId: 'new-e', date: RANGE_DATE, hours: 6, updatedAt: 500
            }
        },
        settings: { companyName: 'Imported Company', schemaVersion: 3 },
        isDataLoaded: true,
        useIndexedDB: true
    });

    // 1. The user navigation/reporting flow asks for the range BEFORE the
    //    FULL replacement commits. Its fetchRange is held in flight across
    //    the commit — the fetch itself straddles the atomic replacement.
    let releaseFetch;
    const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
    mockedFirebase.getAttendanceRange.mockImplementation(() => fetchGate.then(() => preImportRangeRows()));
    const rangePromise = ensureAttendanceRange(RANGE_DATE, RANGE_DATE);

    // 2. The FULL replacement runs to completion through the REAL durable
    //    path (PersistenceService.saveToIndexedDB → IndexedDBService
    //    atomic replacement, then the post-commit epoch bump). Its atomic
    //    readwrite tx clears the attendance store and commits ONLY the
    //    imported rows.
    await saveToIndexedDB({ clearFirst: true });

    // Sanity: right after the commit the imported store is clean.
    const afterCommit = await realService.getAll('attendance');
    expect(afterCommit.map(row => row.key)).toEqual([`new-e-${RANGE_DATE}`]);

    // 3. NOW the straddled fetch resolves: the loader merges the pre-import
    //    range rows and calls persistRecords — a BARE batchUpdate with no
    //    epoch stamp and no published flight guard. _isDatasetEpochStale()
    //    finds neither the in-flight replacement window (it already
    //    committed) nor any epoch guard (the range persist publishes none),
    //    so the write-point barrier passes and the readwrite tx is emitted
    //    AFTER the commit — re-inserting the pre-import rows.
    releaseFetch();
    await rangePromise;

    // The imported attendance store must stay clean: the straddled range
    // persist must not resurrect the pre-import dataset.
    const attendance = await realService.getAll('attendance');
    expect(attendance.map(row => row.key)).toEqual([`new-e-${RANGE_DATE}`]);
});
