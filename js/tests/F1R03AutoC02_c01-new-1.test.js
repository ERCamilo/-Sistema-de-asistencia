/**
 * C01-NEW-1 (MEDIUM, data_integrity) — regression test.
 *
 * Finding: the isolation re-checks in `_persistLocalState` / `_executeSave`
 * are ENTRY/CATCH-only. A `requireLocalSuccess` save whose non-clearFirst
 * `saveState()` is already in flight when a FULL import starts can STRADDLE
 * the FULL atomic replacement:
 *
 *   (a) The straddled save's later per-store transactions (employees /
 *       attendance / settings) land AFTER the FULL commit and upsert the
 *       PRE-IMPORT dataset into the freshly imported stores. The post-commit
 *       save never clears (`saveApplicationData()` → non-clearFirst), so the
 *       resurrection is durable in 'employees'/'leaders'/'settings'.
 *
 *   (b) On straddled success `_persistLocalState` still returns
 *       `localOk = true` (no re-check after the awaited `saveState`), so
 *       `_executeSave` proceeds to enqueue the mirror/entities/settings
 *       snapshot — the PROVISIONAL imported state — into the MainSyncStore
 *       outbox and flushes it to the cloud BEFORE the durable commit. If the
 *       import is subsequently rolled back (durable save fails), the
 *       rolled-back import has already been uploaded.
 *
 * This test drives the real runtime flow (ExportController → applyFullImport)
 * against the REAL IndexedDBService on fake-indexeddb and inspects the real
 * IndexedDB stores and the FirebaseService cloud surface. It must FAIL on the
 * unfixed candidate, once per finding arm.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService as RealIndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedIDB from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import FirebaseService from '../modules/services/FirebaseService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

const OLD_MARKER = 'c01new1-original-employee';
const IMPORTED_A = 'c01new1-import-a-employee';
const IMPORTED_B = 'c01new1-import-b-employee';

const payloadA = () => ({ data: {
    employees: [{ id: 'new-e-a', number: '2', name: IMPORTED_A }],
    positions: [],
    leaders: [{ id: 'new-l-a', number: '2', name: 'Imported Leader A' }],
    attendance: {},
    settings: { companyName: 'Imported', schemaVersion: 1 }
} });

const payloadB = () => ({ data: {
    employees: [{ id: 'new-e-b', number: '3', name: IMPORTED_B }],
    positions: [],
    leaders: [{ id: 'new-l-b', number: '3', name: 'Imported Leader B' }],
    attendance: {},
    settings: { companyName: 'Imported B', schemaVersion: 1 }
} });

let realIDB;
let original;
let heldNormal;      // pre-import saveState captured in-flight (no clearFirst)
let heldFull;        // FULL durable saveState captured in-flight (clearFirst)
let holdNextNormal;  // arm: hold the next non-clearFirst saveState call
let holdNextFull;    // arm: hold the next clearFirst saveState call
let outboxRows;
let outboxKeySeq;

beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    delete globalThis.currentUser;
    original = JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, settings: state.settings,
        isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB
    }));
    Object.assign(state, {
        employees: [{ id: 'old-e', number: '1', name: OLD_MARKER }],
        positions: [],
        leaders: [{ id: 'old-l', number: '1', name: 'Original Leader' }],
        attendance: {},
        settings: { companyName: 'Original', schemaVersion: 1 },
        isDataLoaded: true,
        useIndexedDB: true
    });
    heldNormal = null;
    heldFull = null;
    holdNextNormal = false;
    holdNextFull = false;
    outboxRows = [];
    realIDB = new RealIndexedDBService('c01new1-db-' + Math.random().toString(36).slice(2));
});

/** Seeds the real stores with the legitimate pre-import dataset. */
async function seedRealStores() {
    await realIDB.init();
    await realIDB.saveState({
        employees: [{ id: 'old-e', number: '1', name: OLD_MARKER }],
        positions: [], leaders: [{ id: 'old-l', number: '1', name: 'Original Leader' }],
        attendance: {}, settings: { companyName: 'Original', schemaVersion: 1 }
    }, { clearFirst: true });
}

afterEach(() => {
    jest.restoreAllMocks();
    mockedIDB.saveState.mockReset();
    if (realIDB?.db) realIDB.db.close();
    FirebaseService.saveEntities.mockReset();
    FirebaseService.saveFullState.mockReset();
    FirebaseService.saveSettings.mockReset();
    Object.assign(state, original);
    delete globalThis.currentUser;
    delete window.showConfirm;
    jest.clearAllTimers();
    jest.useRealTimers();
});

/** Install the runtime saveState interception over the REAL IndexedDBService. */
function installSaveStateGate() {
    mockedIDB.saveState.mockImplementation((snap, options = {}) => {
        if (options.clearFirst) {
            if (holdNextFull) {
                holdNextFull = false;
                return new Promise((resolve, reject) => { heldFull = { snap, options, resolve, reject }; });
            }
            return realIDB.saveState(snap, options);
        }
        if (holdNextNormal && !heldNormal) {
            holdNextNormal = false;
            // The in-flight save captured its dataset BEFORE the import: the
            // real saveState builds its employee/leader maps synchronously at
            // entry, so freeze the snapshot at hold time to model that.
            const frozen = JSON.parse(JSON.stringify(snap));
            return new Promise(resolve => { heldNormal = { snap: frozen, options, resolve }; });
        }
        return realIDB.saveState(snap, options);
    });
    // Durable in-memory backing for the MainSyncStore outbox store so the
    // runtime flush path (PersistenceService → MainSyncStore → FirebaseService)
    // can be exercised end-to-end.
    let outboxKeySeq = 1;
    mockedIDB.getAll.mockImplementation(async store => {
        if (store !== 'mainSyncOutbox') return [];
        return outboxRows.map(r => JSON.parse(JSON.stringify(r)));
    });
    mockedIDB.update.mockImplementation(async (store, data) => {
        if (store === 'mainSyncOutbox') {
            const row = { ...data, key: data.key ?? outboxKeySeq++ };
            const idx = outboxRows.findIndex(r => r.key === row.key);
            if (idx >= 0) outboxRows[idx] = row; else outboxRows.push(row);
            return 1;
        }
        return 1;
    });
    mockedIDB.delete.mockImplementation(async (store, key) => {
        if (store === 'mainSyncOutbox') {
            outboxRows = outboxRows.filter(r => r.key !== key);
            return;
        }
    });
    mockedIDB.clear.mockImplementation(async store => {
        if (store === 'mainSyncOutbox') { outboxRows = []; return; }
    });
}

/** Resolves the held pre-import save: its per-store writes land on the real stores now. */
async function releaseHeldNormalSave() {
    const h = heldNormal;
    heldNormal = null;
    const stats = await realIDB.saveState(h.snap, h.options);
    h.resolve(stats);
    return stats;
}

test('in-flight pre-import requireLocalSuccess save straddling the FULL atomic replacement must neither resurrect pre-import data into the committed stores nor upload a rolled-back import to the cloud', async () => {
    installSaveStateGate();

    // Baseline: seed the real stores with the legitimate pre-import dataset.
    await seedRealStores();

    // ── ARM A — finding (a): straddled save upserts pre-import data into the
    // freshly imported (committed) stores; post-commit save never clears. ──
    holdNextNormal = true; // park the pre-import save inside saveState
    const savePromise = saveApplicationData({
        immediate: true,
        requireLocalSuccess: true,
        skipValidation: true
    });
    expect(heldNormal).not.toBeNull(); // pre-import save is parked inside saveState

    let fullConfirm = null;
    window.showConfirm = opts => { fullConfirm = opts.onConfirm; };
    setImportFullText(JSON.stringify(payloadA()));
    confirmImportFull();
    expect(fullConfirm).toBeInstanceOf(Function);
    const fullPromiseA = fullConfirm();
    expect(state.employees[0].id).toBe('new-e-a'); // provisional state is live

    // FULL durable atomic replacement is NOT held here: it commits for real.
    await fullPromiseA;
    // Post-commit durable save drained too (routes through the same gate).
    await jest.advanceTimersByTimeAsync(50);

    // Release the straddled pre-import save AFTER the FULL commit: its
    // per-store transactions must not resurrect the pre-import dataset into
    // the freshly imported stores.
    await releaseHeldNormalSave();
    await savePromise;

    // CONTRACT (a): after a committed FULL import, the local stores contain
    // exactly the imported dataset — the pre-import employees/settings must
    // not be resurrected durably (post-commit save never clears them).
    const employeesInStore = await realIDB.getAll('employees');
    expect(employeesInStore.some(e => e.id === 'old-e')).toBe(false);
    const settingsInStore = await realIDB.getAll('settings');
    expect(settingsInStore.find(s => s.key === 'app')?.companyName).toBe('Imported');
    const leadersInStore = await realIDB.getAll('leaders');
    expect(leadersInStore.some(l => l.id === 'old-l')).toBe(false);

    // ── ARM B — finding (b): straddled success (localOk=true) while the FULL
    // durable commit is still pending lets _executeSave enqueue and flush the
    // PROVISIONAL imported snapshot to the cloud outbox; the import is then
    // rolled back, but the upload already happened. ──
    globalThis.currentUser = { uid: 'test-user' };
    FirebaseService.saveEntities.mockClear();
    FirebaseService.saveFullState.mockClear();
    FirebaseService.saveSettings.mockClear();

    holdNextNormal = true; // arm the next pre-import save
    const savePromiseB = saveApplicationData({
        immediate: true,
        requireLocalSuccess: true,
        skipValidation: true
    });
    expect(heldNormal).not.toBeNull();

    holdNextFull = true; // hold the FULL durable save in flight
    window.showConfirm = opts => { fullConfirm = opts.onConfirm; };
    setImportFullText(JSON.stringify(payloadB()));
    confirmImportFull();
    expect(fullConfirm).toBeInstanceOf(Function);
    const fullPromiseB = fullConfirm();
    expect(heldFull).not.toBeNull(); // durable commit pending
    expect(state.employees[0].id).toBe('new-e-b'); // provisional B live

    // The straddled save resolves while FULL isolation is active and the
    // durable commit has not happened yet → localOk=true → the provisional
    // imported snapshot must NOT reach the cloud outbox before the commit.
    await releaseHeldNormalSave();
    const resultB = await savePromiseB;
    await jest.advanceTimersByTimeAsync(50); // settle the fire-and-forget flush

    // CONTRACT (b): a subsequently ROLLED BACK import can never have been
    // uploaded. The provisional B snapshot must not have been flushed to the
    // cloud surface (entities/mirror/settings) before the durable commit.
    const uploadedPayloads = [
        ...FirebaseService.saveEntities.mock.calls,
        ...FirebaseService.saveFullState.mock.calls,
        ...FirebaseService.saveSettings.mock.calls
    ].map(call => JSON.stringify(call[0] || {}));
    expect(uploadedPayloads.some(json => json.includes(IMPORTED_B))).toBe(false);

    // Now settle the FULL flow: its durable save fails → rollback path.
    heldFull.reject(new DOMException('Injected FULL failure (C01-NEW-1)', 'QuotaExceededError'));
    await fullPromiseB;

    // Rollback restored the phase-A dataset (the import never committed).
    expect(state.employees[0].id).toBe('new-e-a');
    // Defensive: nothing from the rolled-back import is left pending to flush.
    const pending = await MainSyncStore.pendingCount();
    expect(JSON.stringify(pending).includes(IMPORTED_B)).toBe(false);
});
