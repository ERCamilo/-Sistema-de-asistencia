import fs from 'fs';
import path from 'path';
import {
    deleteEmployeePhotoCache,
    ensureEmployeePhotoStore,
    getEmployeePhotoCache,
    putEmployeePhotoCache
} from '../modules/services/EmployeePhotoCache.js';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'),
    'utf8'
);

function asyncRequest(action) {
    const request = { result: undefined, error: null };
    queueMicrotask(() => {
        try {
            request.result = action();
            request.onsuccess?.({ target: request });
        } catch (error) {
            request.error = error;
            request.onerror?.({ target: request });
        }
    });
    return request;
}

function createMemoryDb() {
    const records = {
        employeePhotos: new Map(),
        pettyCashReceipts: new Map()
    };
    const operations = [];
    return {
        records,
        operations,
        transaction(storeNames, mode) {
            operations.push({ type: 'transaction', storeNames: [...storeNames], mode });
            return {
                objectStore(storeName) {
                    const store = records[storeName];
                    if (!store) throw new Error(`Unknown store: ${storeName}`);
                    const keyField = storeName === 'employeePhotos' ? 'employeeId' : 'txId';
                    return {
                        put(record) {
                            operations.push({ type: 'put', storeName, record });
                            return asyncRequest(() => {
                                store.set(record[keyField], record);
                                return record[keyField];
                            });
                        },
                        get(key) {
                            operations.push({ type: 'get', storeName, key });
                            return asyncRequest(() => store.get(key));
                        },
                        delete(key) {
                            operations.push({ type: 'delete', storeName, key });
                            return asyncRequest(() => store.delete(key));
                        }
                    };
                }
            };
        }
    };
}

function createService() {
    return {
        db: createMemoryDb(),
        async init() { return this.db; }
    };
}

function photoPayload(label, extra = {}) {
    return {
        thumbnailBlob: new Blob([`thumb-${label}`], { type: 'image/jpeg' }),
        optimizedBlob: new Blob([`optimized-${label}`], { type: 'image/jpeg' }),
        width: 800,
        height: 600,
        version: 2,
        updatedAt: 1787360400000,
        ...extra
    };
}

function readBlobText(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

describe('IndexedDB employee photo schema', () => {
    test('upgrade creates the employeePhotos store once when it is absent', () => {
        const db = {
            objectStoreNames: { contains: jest.fn(() => false) },
            createObjectStore: jest.fn()
        };

        ensureEmployeePhotoStore(db);

        expect(db.createObjectStore).toHaveBeenCalledTimes(1);
        expect(db.createObjectStore).toHaveBeenCalledWith(
            'employeePhotos',
            { keyPath: 'employeeId' }
        );
    });

    test('upgrade leaves an existing employeePhotos store intact', () => {
        const db = {
            objectStoreNames: { contains: jest.fn(() => true) },
            createObjectStore: jest.fn()
        };

        ensureEmployeePhotoStore(db);

        expect(db.createObjectStore).not.toHaveBeenCalled();
    });

    test('version 16 invokes the employee-photo schema guard', () => {
        expect(SRC).toMatch(/version\s*=\s*16/);
        expect(SRC).toContain('ensureEmployeePhotoStore(db)');
        ['saveEmployeePhoto', 'getEmployeePhoto', 'replaceEmployeePhoto', 'deleteEmployeePhoto']
            .forEach(method => expect(SRC).toContain(`${method}(`));
    });

    test('employee photos remain separate from receipts and main-state clearFirst stores', () => {
        expect(SRC).toMatch(/createObjectStore\(['"]pettyCashReceipts['"]/);
        const ownStores = SRC.match(/const ownStores\s*=\s*\[[^\]]*\]/)?.[0] || '';
        const exportBlock = SRC.match(/async exportDB\(\)[\s\S]*?async loadFullState/)?.[0] || '';
        expect(ownStores).not.toContain('employeePhotos');
        expect(ownStores).not.toContain('pettyCashReceipts');
        expect(exportBlock).not.toContain("getAll('employeePhotos')");
    });
});

describe('IndexedDB employee photo cache CRUD', () => {
    test('saves and retrieves a whitelisted binary record', async () => {
        const service = createService();

        const saved = await putEmployeePhotoCache(service, 'employee-1', photoPayload('one', {
            dataUrl: 'data:image/jpeg;base64,must-not-persist'
        }));
        const loaded = await getEmployeePhotoCache(service, 'employee-1');

        expect(saved.employeeId).toBe('employee-1');
        expect(loaded.employeeId).toBe('employee-1');
        expect(loaded.thumbnailBlob).toBeInstanceOf(Blob);
        expect(loaded.optimizedBlob).toBeInstanceOf(Blob);
        expect(loaded.dataUrl).toBeUndefined();
        expect(await readBlobText(loaded.thumbnailBlob)).toBe('thumb-one');
    });

    test('replace atomically overwrites the same employee record with one put', async () => {
        const service = createService();
        await putEmployeePhotoCache(service, 'employee-1', photoPayload('old'));
        const operationCount = service.db.operations.length;

        await putEmployeePhotoCache(service, 'employee-1', photoPayload('new', { version: 3 }));
        const loaded = await getEmployeePhotoCache(service, 'employee-1');
        const replacementOperations = service.db.operations.slice(operationCount);

        expect(service.db.records.employeePhotos.size).toBe(1);
        expect(await readBlobText(loaded.optimizedBlob)).toBe('optimized-new');
        expect(loaded.version).toBe(3);
        expect(replacementOperations.filter(op => op.type === 'put')).toHaveLength(1);
        expect(replacementOperations.filter(op => op.type === 'delete')).toHaveLength(0);
    });

    test('accepts a remote thumbnail without eagerly caching the original', async () => {
        const service = createService();
        const saved = await putEmployeePhotoCache(service, 'employee-1', {
            thumbnailBlob: new Blob(['remote-thumb'], { type: 'image/webp' }),
            optimizedBlob: null,
            width: null,
            height: null,
            version: 4,
            updatedAt: 1787360400000,
            remoteSyncedVersion: 4,
            signedUrl: 'https://must-not-persist.invalid'
        });

        expect(saved.thumbnailBlob).toBeInstanceOf(Blob);
        expect(saved.optimizedBlob).toBeNull();
        expect(saved.width).toBeNull();
        expect(saved.remoteSyncedVersion).toBe(4);
        expect(saved.signedUrl).toBeUndefined();
    });

    test('persists a bounded deletion tombstone without retaining image blobs or transient secrets', async () => {
        const service = createService();
        const saved = await putEmployeePhotoCache(service, 'employee-1', {
            pendingDelete: true,
            pendingDeleteVariants: ['original'],
            deleteIntentAt: 1787360400000,
            signedUrl: 'https://must-not-persist.invalid',
            idToken: 'must-not-persist'
        });

        expect(saved.pendingDelete).toBe(true);
        expect(saved.pendingDeleteVariants).toEqual(['original']);
        expect(saved.thumbnailBlob).toBeNull();
        expect(saved.optimizedBlob).toBeNull();
        expect(saved.signedUrl).toBeUndefined();
        expect(saved.idToken).toBeUndefined();
        await expect(getEmployeePhotoCache(service, 'employee-1')).resolves.toEqual(saved);
    });

    test('delete removes only the selected employee photo', async () => {
        const service = createService();
        await putEmployeePhotoCache(service, 'employee-1', photoPayload('one'));
        await putEmployeePhotoCache(service, 'employee-2', photoPayload('two'));

        await deleteEmployeePhotoCache(service, 'employee-1');

        expect(await getEmployeePhotoCache(service, 'employee-1')).toBeNull();
        expect(await getEmployeePhotoCache(service, 'employee-2')).not.toBeNull();
    });

    test('employee photos and petty-cash receipts use independent stores', async () => {
        const service = createService();
        service.db.records.pettyCashReceipts.set('tx-1', {
            txId: 'tx-1',
            dataUrl: 'data:image/jpeg;base64,receipt'
        });
        await putEmployeePhotoCache(service, 'tx-1', photoPayload('employee'));

        await deleteEmployeePhotoCache(service, 'tx-1');

        expect(service.db.records.employeePhotos.size).toBe(0);
        expect(service.db.records.pettyCashReceipts.size).toBe(1);
        expect(service.db.records.pettyCashReceipts.get('tx-1')).toBeDefined();
    });

    test('rejects transient or non-image values instead of persisting them', async () => {
        const service = createService();

        await expect(putEmployeePhotoCache(service, 'employee-1', {
            ...photoPayload('invalid'),
            thumbnailBlob: 'data:image/jpeg;base64,temporary'
        })).rejects.toThrow(/Blob/);

        expect(service.db.records.employeePhotos.size).toBe(0);
    });
});
