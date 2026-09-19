import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const oldState = () => ({
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
test('saveState already past the epoch entry gate cannot resurrect old records after a FULL atomic commit', async () => {
    const service = new IndexedDBService(`c02new1-${Date.now()}-${Math.random()}`);
    await service.init();

    const epochRef = { value: 0 };
    const originalBatchUpdate = service.batchUpdate.bind(service);
    let releaseFirstBatch;
    let markEntered;
    const enteredFirstBatch = new Promise(resolve => { markEntered = resolve; });
    const firstBatchGate = new Promise(resolve => { releaseFirstBatch = resolve; });
    let firstBatch = true;

    service.batchUpdate = async (storeName, records) => {
        if (firstBatch) {
            firstBatch = false;
            markEntered(storeName);
            await firstBatchGate;
        }
        return originalBatchUpdate(storeName, records);
    };

    const staleSave = service.saveState(oldState(), {
        __datasetEpochRef: epochRef,
        __datasetEpoch: 0
    });

    expect(await enteredFirstBatch).toBe('employees');
    // FULL commits while the old save is already inside saveState().
    await service.saveState(importedState(), { clearFirst: true });
    epochRef.value += 1;

    // The stale save resumes after the FULL commit. It must not write anything.
    releaseFirstBatch();
    await staleSave;

    const employees = await service.getAll('employees');
    const leaders = await service.getAll('leaders');
    const attendance = await service.getAll('attendance');
    const settings = await service.getAll('settings');

    expect(employees.map(row => row.id)).toEqual(['new-e']);
    expect(leaders.map(row => row.id)).toEqual(['new-l']);
    expect(attendance).toEqual([]);
    expect(settings.find(row => row.key === 'app')?.companyName)
        .toBe('Imported Company');

    service.db?.close();
});
