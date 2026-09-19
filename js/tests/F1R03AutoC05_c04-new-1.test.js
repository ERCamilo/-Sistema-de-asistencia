import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

// C04-NEW-1 (persistence): a save with clearAttendance (executeAutoRepair /
// MaintenanceUI path) parked at IndexedDBService.clear('attendance'), or a
// pruner batchDelete, emits its readwrite transaction WITHOUT the write-time
// dataset-epoch / _fullReplacementTxInFlight barrier that C02-NEW-1 installed
// on batchUpdate/update.
//
// When that primitive is released while the FULL replacement's multi-store
// readwrite tx is created-but-uncommitted, the single-store clear tx queues
// BEHIND the replacement and commits AFTER it — wiping every freshly imported
// attendance row. Recovery depends on a later full re-persist; a page close
// before it makes the loss durable.
//
// Runtime-driven reproduction on real fake-indexeddb transactions (no source
// scanning): the replacement's multi-store readwrite tx is observed via the
// live db connection, and the clearAttendance save is parked/unparked with a
// promise gate, exactly like the C02-NEW-1/C03-NEW-1 sibling harnesses.

const clearAttendanceState = () => ({
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
    attendance: {
        'new-e-2026-09-15': {
            employeeId: 'new-e', date: '2026-09-15', hours: 6
        }
    },
    settings: { companyName: 'Imported Company', schemaVersion: 1 }
});

test('a clearAttendance save released while the FULL replacement tx is pending-but-uncommitted must not wipe freshly imported attendance rows', async () => {
    const service = new IndexedDBService(`c04new1-${Date.now()}-${Math.random()}`);
    await service.init();

    const epochRef = { value: 0 };

    // ── Runtime probe: signal when the FULL replacement's readwrite
    // transaction is CREATED (its scope spans several saveState-owned stores;
    // the parked clear uses a single-store scope). At that instant the
    // replacement tx is pending-but-uncommitted.
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

    // ── Harness gate: park the clearAttendance save INSIDE saveState at
    // this.clear('attendance') — the exact write point named by the finding —
    // so its clear tx is emitted precisely when we choose below.
    const originalClear = service.clear.bind(service);
    let releaseClear;
    let markClearEntered;
    const clearEntered = new Promise(resolve => { markClearEntered = resolve; });
    const clearGate = new Promise(resolve => { releaseClear = resolve; });
    let parked = true;
    service.clear = async (storeName) => {
        if (parked && storeName === 'attendance') {
            parked = false;
            markClearEntered(storeName);
            await clearGate;
        }
        return originalClear(storeName);
    };

    // clearAttendance save flight (executeAutoRepair path): epoch stamped at
    // launch (epoch 0), parked at clear('attendance') just like a save caught
    // mid-flight by a concurrent FULL import.
    const clearAttendanceSave = service.saveState(clearAttendanceState(), {
        clearAttendance: true,
        __datasetEpochRef: epochRef,
        __datasetEpoch: 0
    });
    expect(await clearEntered).toBe('attendance');

    // ── Start the FULL replacement WITHOUT awaiting it. Wait only until its
    // atomic replacement tx has been created (still uncommitted).
    const replacement = service.saveState(importedState(), { clearFirst: true });
    await replacementTxCreated;

    // ── Release the clearAttendance save NOW: its clear('attendance') tx is
    // emitted while the replacement tx is pending-but-uncommitted and the
    // shared epoch guard window is open — the write-time barrier that
    // batchUpdate/update honor must also stop clear/delete/batchDelete.
    releaseClear();
    await clearAttendanceSave;

    // The replacement commits.
    await replacement;

    // The imported attendance row must be intact: the parked clear must not
    // have committed after the replacement and wiped the imported store.
    const attendance = await service.getAll('attendance');
    expect(attendance.map(row => row.key)).toEqual(['new-e-2026-09-15']);

    service.db?.close();
});
