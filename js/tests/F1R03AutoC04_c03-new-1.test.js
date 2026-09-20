import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

// C03-NEW-1 (data_integrity): partial single-store resurrection of pre-import
// data when a stale save's write-time epoch check runs while the FULL
// replacement transaction is pending-but-uncommitted.
//
// The write-time epoch barrier in IndexedDBService.batchUpdate checks
// staleness in the instant BEFORE emitting its readwrite transaction, but the
// shared epoch counter is bumped by PersistenceService.saveToIndexedDB only
// AFTER `await saveState(clearFirst)` resolves — i.e. after the replacement
// commits. A stale save parked inside saveState (test-harness gate) whose next
// batchUpdate check runs while the replacement tx is created-but-uncommitted
// still sees the OLD epoch, passes the barrier, and emits a readwrite
// transaction that queues behind the replacement and commits after it:
// pre-import rows are re-inserted into an imported store, and the
// post-import upsert save never clears them.
//
// Runtime-driven reproduction on real fake-indexeddb transactions (no source
// scanning): the replacement's multi-store readwrite tx is observed via the
// live db connection, and the stale save is parked/unparked with a promise
// gate, exactly like the C02-NEW-1 sibling harness.

const preImportState = () => ({
    employees: [{ id: 'old-e', number: '1', name: 'Old Employee' }],
    positions: [],
    leaders: [{ id: 'old-l', number: '1', name: 'Old Leader' }],
    attendance: {
        'old-e-2026-09-15': {
            employeeId: 'old-e', date: '2026-09-15', hours: 8
        }
    },
    settings: { companyName: 'Old Company', schemaVersion: 1 }
});

const importedState = () => ({
    employees: [{ id: 'new-e', number: '2', name: 'Imported Employee' }],
    positions: [],
    leaders: [{ id: 'new-l', number: '2', name: 'Imported Leader' }],
    attendance: {},
    settings: { companyName: 'Imported Company', schemaVersion: 1 }
});

test('a stale save released while the FULL replacement tx is pending-but-uncommitted must not resurrect pre-import rows', async () => {
    const service = new IndexedDBService(`c03new1-${Date.now()}-${Math.random()}`);
    await service.init();

    const epochRef = { value: 0 };

    // ── Runtime probe: signal when the FULL replacement's readwrite
    // transaction is CREATED (its scope spans several saveState-owned stores;
    // primitive writes like the stale batchUpdate use a single-store scope).
    // At that instant the replacement tx is pending-but-uncommitted: its
    // clear+put requests are issued but the commit macrotask has not run.
    let markReplacementTx;
    const replacementTxCreated = new Promise(resolve => { markReplacementTx = resolve; });
    const realTransaction = service.db.transaction.bind(service.db);
    service.db.transaction = (storeNames, mode) => {
        const tx = realTransaction(storeNames, mode);
        if (mode === 'readwrite' && Array.isArray(storeNames) && storeNames.length > 1) {
            markReplacementTx(tx);
        }
        return tx;
    };

    // ── Harness gate: park the stale save inside saveState BEFORE its first
    // batchUpdate runs, so its next write-time epoch check fires exactly when
    // we choose below.
    const originalBatchUpdate = service.batchUpdate.bind(service);
    let releaseStaleSave;
    let markStaleEntered;
    const staleSaveEntered = new Promise(resolve => { markStaleEntered = resolve; });
    const staleSaveGate = new Promise(resolve => { releaseStaleSave = resolve; });
    let parked = true;
    service.batchUpdate = async (storeName, records) => {
        if (parked) {
            parked = false;
            markStaleEntered(storeName);
            await staleSaveGate;
        }
        return originalBatchUpdate(storeName, records);
    };

    // Stale save flight: epoch stamped at launch (epoch 0), parked inside
    // saveState just like a save caught mid-flight by a concurrent import.
    const staleSave = service.saveState(preImportState(), {
        __datasetEpochRef: epochRef,
        __datasetEpoch: 0
    });
    expect(await staleSaveEntered).toBe('employees');

    // ── Start the FULL replacement WITHOUT awaiting it. Wait only until its
    // atomic replacement tx has been created (still uncommitted).
    const replacement = service.saveState(importedState(), { clearFirst: true });
    await replacementTxCreated;

    // ── Release the stale save NOW: its next batchUpdate epoch check runs
    // while the replacement tx is pending-but-uncommitted and the shared
    // epoch has NOT been bumped yet — mirroring saveToIndexedDB, which bumps
    // _datasetEpochRef.value only after `await saveState(clearFirst)` commits.
    releaseStaleSave();
    await staleSave;

    // The replacement commits; only then (same order as saveToIndexedDB) the
    // epoch bumps — too late to stop a transaction that was already emitted.
    await replacement;
    epochRef.value += 1;

    // The imported dataset must be intact: no pre-import row may reappear in
    // the freshly imported employees store.
    const employees = await service.getAll('employees');
    expect(employees.map(row => row.id)).toEqual(['new-e']);

    service.db?.close();
});
