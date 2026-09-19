/**
 * OBS-R03B-1 (MEDIUM_LOW, persistence) — regression test.
 *
 * Finding: a pre-import local save (`_persistLocalState` reached through
 * `saveApplicationData({ requireLocalSuccess: true })`) that is already
 * awaiting `indexedDBService.saveState()` can be overtaken by a FULL import:
 * `beginFullImportIsolation()` raises the isolation depth and the FULL flow
 * publishes PROVISIONAL imported data into `state`. When the pre-import
 * `saveState` then rejects, the catch block of `_persistLocalState` falls back
 * to `dataService.saveAll()` WITHOUT re-checking `_fullImportIsolationDepth`,
 * so the provisional imported state is written to the localStorage fallback
 * ('asistencia-data').
 *
 * This test drives the real runtime flow (ExportController → applyFullImport)
 * and asserts that the localStorage fallback never contains imported
 * provisional data. It must FAIL on the unfixed candidate.
 */

import mockedIDB from '../modules/services/IndexedDBService.js';
import dataServiceMock from '../modules/services/DataService.js';
import { DataService as RealDataService } from 'actual/services/DataService.js';
import { state } from '../modules/core/AppState.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

// Distinctive token for the imported provisional data: after the finding
// reproduces, it leaks into the 'asistencia-data' localStorage blob.
const IMPORTED_MARKER = 'obs-r03b-1-imported-employee';

const payload = () => ({ data: {
    employees: [{ id: 'new-e', number: '2', name: IMPORTED_MARKER }],
    positions: [],
    leaders: [{ id: 'new-l', number: '2', name: 'Imported Leader' }],
    attendance: {},
    settings: { companyName: 'Imported' }
} });

let original;

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    original = JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, settings: state.settings,
        isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
    }));
    Object.assign(state, {
        employees: [{ id: 'old-e', number: '1', name: 'Original' }],
        positions: [],
        leaders: [{ id: 'old-l', number: '1', name: 'Original Leader' }],
        attendance: {},
        settings: { companyName: 'Original' },
        isDataLoaded: true,
        useIndexedDB: true
    });
    // Baseline: a legitimate pre-import local fallback blob already on disk.
    localStorage.setItem('asistencia-data', JSON.stringify({
        employees: [{ id: 'old-e', number: '1', name: 'Original' }],
        version: '2.0'
    }));
});

afterEach(() => {
    jest.restoreAllMocks();
    mockedIDB.saveState.mockReset();
    dataServiceMock.saveAll.mockReset();
    Object.assign(state, original);
    delete window.showConfirm;
    jest.clearAllTimers();
    jest.useRealTimers();
});

test('pre-import local save that fails while FULL isolation is active must not write provisional imported state to the localStorage fallback', async () => {
    // Both durable-save calls are held in-flight so the test controls the race:
    // the normal save's saveState (no clearFirst) and the FULL import's
    // durable saveState (clearFirst).
    let rejectNormalSave = null;
    let rejectFullSave = null;
    mockedIDB.saveState.mockImplementation((_s, options = {}) => {
        if (options.clearFirst) {
            return new Promise((_, reject) => { rejectFullSave = reject; });
        }
        return new Promise((_, reject) => { rejectNormalSave = reject; });
    });

    // The PersistenceService-facing dataService fallback is wired to the REAL
    // DataService + StorageService, so the assertion runs against the real
    // localStorage 'asistencia-data' key exactly as in production.
    const realDataService = new RealDataService();
    dataServiceMock.saveAll.mockImplementation(() => realDataService.saveAll());

    // 1. Pre-import: a normal local save starts and hangs inside
    //    indexedDBService.saveState (_persistLocalState in flight).
    const savePromise = saveApplicationData({
        immediate: true,
        requireLocalSuccess: true,
        skipValidation: true
    });
    expect(rejectNormalSave).toBeInstanceOf(Function);

    // 2. While that save is in-flight, the FULL import flow raises isolation
    //    and publishes provisional imported state into the live state.
    let fullConfirm = null;
    window.showConfirm = opts => { fullConfirm = opts.onConfirm; };
    setImportFullText(JSON.stringify(payload()));
    confirmImportFull();
    expect(fullConfirm).toBeInstanceOf(Function);
    const fullPromise = fullConfirm();
    expect(state.employees[0].name).toBe(IMPORTED_MARKER); // provisional state is live
    expect(rejectFullSave).toBeInstanceOf(Function); // FULL durable save in flight

    // 3. The pre-import saveState now rejects: the catch path of
    //    _persistLocalState must NOT fall back to dataService.saveAll() while
    //    isolation is active — the fallback would persist the provisional
    //    imported state to 'asistencia-data'.
    rejectNormalSave(new Error('Injected IndexedDB failure (OBS-R03B-1)'));
    const result = await savePromise;

    // 4. The localStorage fallback must never contain provisional imported
    //    data, and the legitimate baseline blob must survive untouched.
    const stored = localStorage.getItem('asistencia-data');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(IMPORTED_MARKER);
    expect(stored).not.toContain('Imported Leader');
    expect(JSON.parse(stored).employees.some(e => e.id === 'old-e')).toBe(true);
    expect(result.localOk).toBe(false);

    // 5. Settle the FULL flow: its own durable save fails → rollback path
    //    (isolation ends, provisional state rolled back).
    rejectFullSave(new DOMException('Injected FULL failure', 'QuotaExceededError'));
    await fullPromise;
});
