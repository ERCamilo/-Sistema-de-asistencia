// Independent red acceptance tests: retaining locally is not permission to re-upload.
import { auth, getDoc, setDoc, runTransaction } from '../../js/modules/data/firebase.js';
import { mergeIncomingEmployees } from '../../js/modules/services/EmployeesIncomingMerge.js';
import { createCatalogIncomingMerge } from '../../js/modules/services/CatalogIncomingMerge.js';
import { MainSyncStore } from '../../js/modules/services/MainSyncStore.js';
import FirebaseService from 'actual/services/FirebaseService.js';
import indexedDBService from '../../js/modules/services/IndexedDBService.js';

const live = id => ({ id, name: 'Synthetic ' + id, updatedAt: 100 });
let queued, writes;
beforeEach(() => {
    auth.currentUser = { uid: 'synthetic-egress-owner' };
    FirebaseService.resetEntityUploadTrackers();
    queued = [];
    writes = [];
    indexedDBService.getAll.mockReset().mockImplementation(async () => queued.slice());
    indexedDBService.update.mockReset().mockImplementation(async (store, record) => {
        if (store === 'mainSyncOutbox') queued.push({...record, key: queued.length + 1});
        return 1;
    });
    indexedDBService.delete.mockReset().mockImplementation(async (store,key) => {
        if (store === 'mainSyncOutbox') queued = queued.filter(entry => entry.key !== key);
    });
    getDoc.mockReset().mockResolvedValue({ exists: () => false, data: () => null });
    setDoc.mockReset().mockImplementation(async (_ref, data) => { writes.push(data); });
    runTransaction.mockImplementation(async (_db, callback) => callback({
        get: async () => ({ exists: () => false, data: () => null }),
        set: (_ref,data) => writes.push(data)
    }));
});
afterEach(() => { auth.currentUser = null; });

const guards = () => ({
    hasSession: () => true, isApplyingRemote: () => false, isPaused: () => false,
    cloudWatermark: () => 0,
    saveEntities: (...args) => FirebaseService.saveEntities(...args),
    saveMirror: jest.fn().mockResolvedValue(undefined),
    onCloudResult: jest.fn()
});
test.each([
    ['employee', mergeIncomingEmployees, 0],
    ['position', createCatalogIncomingMerge(), 1],
    ['leader', createCatalogIncomingMerge(), 2]
])('381: %s previously downloaded and now absent stays local but must not be republished', async (_kind, merge, slot) => {
    // This device downloaded the original; it never uploaded that ID.
    const original = live('retained');
    const known = merge([], [original]);
    const retained = merge(known, []);
    expect(retained.map(e=>e.id)).toEqual(['retained']);
    const lists = [[],[],[]];
    lists[slot] = [...retained, live('new-local')];
    await MainSyncStore.enqueueEntities(...lists,3);
    const g = guards();
    await MainSyncStore.flush(g);
    expect(g.onCloudResult).toHaveBeenCalledWith(true,null,expect.objectContaining({kind:'entities'}));
    expect(writes.some(record=>record.id==='new-local')).toBe(true);
    expect(writes.some(record=>record.id==='retained')).toBe(false);
});
