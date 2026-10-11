import { IDBFactory } from 'fake-indexeddb';
import { measureDeviceStorage, measureSyncQueues, measureLocalStorage } from '../modules/services/DeviceDiagnostics.js';

// jsdom lacks structuredClone. Preserve Blob semantics when fake IDB clones rows.
if (!globalThis.structuredClone) globalThis.structuredClone = function clone(value) {
    if (value instanceof Blob) return value.slice(0, value.size, value.type);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
};

function open(idb, name, stores) {
    return new Promise((resolve, reject) => {
        const request = idb.open(name, 1);
        request.onupgradeneeded = () => stores.forEach(store => request.result.createObjectStore(store, { autoIncrement: true }));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
function write(db, rows) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(rows), 'readwrite');
        for (const [store, values] of Object.entries(rows)) values.forEach(value => tx.objectStore(store).add(value));
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
}
const storage = { length: 1, key: () => 'ab', getItem: () => 'ñ🙂' };
let idb;
beforeEach(() => { idb = new IDBFactory(); });
afterEach(() => { jest.useRealTimers(); });

test('mide UTF-16, incluyendo claves; permisos denegados son desconocidos', () => {
    expect(measureLocalStorage(storage)).toBe(10);
    expect(measureLocalStorage({ get length() { throw Error('Denied'); } })).toBeNull();
});

test('usa la estimación del sitio y mide Blobs de ambas variantes y audios de todas las cuentas', async () => {
    const data = await open(idb, 'attendance-app-db', ['employeePhotos']);
    const voice = await open(idb, 'sa-voice-mvp-v1', ['recordings']);
    await write(data, { employeePhotos: [
        { optimizedBlob: new Blob(['12345']), thumbnailBlob: new Blob(['12']) },
        { thumbnailBlob: new Blob(['123']) }
    ] });
    await write(voice, { recordings: [
        { uid: 'a', audio: new Blob(['1234']) }, { uid: 'b', audio: new Blob(['123']) }, { audioDiscardedAt: 1 }
    ] });
    data.close(); voice.close();
    const result = await measureDeviceStorage({ indexedDB: idb, storage, navigator: { storage: { estimate: async () => ({ usage: 987654, quota: 20971520 }) } } });
    expect(result).toEqual({ usage: 987654, quota: 20971520, localBytes: 10,
        photos: { bytes: 10, count: 2, available: true }, audio: { bytes: 7, count: 2, available: true },
        records: { employees: 0, positions: 0, leaders: 0, attendance: 0, available: true } });
});

test('lecturas no crean ni migran bases de datos ausentes', async () => {
    const result = await measureDeviceStorage({ indexedDB: idb, storage, navigator: {} });
    expect(result.usage).toBeNull();
    expect(result.photos).toEqual({ bytes: 0, count: 0, available: true });
    expect(await measureSyncQueues({ indexedDB: idb })).toEqual({ pending: 0, failed: 0, available: true });
    expect(await idb.databases()).toEqual([]);
});

test('cuenta pendientes y errores durables de asistencia, caja chica y espejo', async () => {
    const db = await open(idb, 'attendance-app-db', ['mainSyncOutbox', 'pettyCashOutbox', 'pettyCashMirrorOutbox']);
    await write(db, {
        mainSyncOutbox: [{ status: 'pending' }, { status: 'dead' }, { status: 'synced' }],
        pettyCashOutbox: [{ status: 'pending' }], pettyCashMirrorOutbox: [{ status: 'dead' }]
    }); db.close();
    expect(await measureSyncQueues({ indexedDB: idb })).toEqual({ pending: 2, failed: 2, available: true });
});

test('conserva los conteos de registros usando count() sin recorrer los datos principales', async () => {
    const db = await open(idb, 'attendance-app-db', ['employees', 'positions', 'leaders', 'attendance']);
    await write(db, { employees: [{ id: 'a' }, { id: 'b' }], positions: [{ id: 'p' }], leaders: [], attendance: [{ key: 'a' }] }); db.close();
    const result = await measureDeviceStorage({ indexedDB: idb, storage, navigator: {} });
    expect(result.records).toEqual({ employees: 2, positions: 1, leaders: 0, attendance: 1, available: true });
});

test.each([undefined, { usage: NaN, quota: Infinity }, { usage: -1, quota: 0 }])('estimación inválida %j no inventa cuota ni porcentaje', async value => {
    const result = await measureDeviceStorage({ indexedDB: idb, storage, navigator: { storage: { estimate: async () => value } } });
    expect(result.usage).toBeNull(); expect(result.quota).toBeNull();
});

test('fallos de estimación e IndexedDB no anuncian cero bytes ni cola vacía', async () => {
    const denied = { open() { throw Error('Denied'); } };
    const result = await measureDeviceStorage({ indexedDB: denied, storage, navigator: { storage: { estimate: async () => { throw Error('Denied'); } } } });
    expect(result.photos.available).toBe(false); expect(result.photos.bytes).toBeNull();
    expect(result.audio.available).toBe(false); expect(result.usage).toBeNull(); expect(result.localBytes).toBe(10);
    expect(await measureSyncQueues({ indexedDB: denied })).toEqual({ available: false, pending: null, failed: null });
});

test('una API de estimación bloqueada termina sin dejar Calculando indefinidamente', async () => {
    jest.useFakeTimers();
    const result = measureDeviceStorage({ indexedDB: null, storage, navigator: { storage: { estimate: () => new Promise(() => {}) } } });
    await jest.advanceTimersByTimeAsync(4001);
    expect((await result).usage).toBeNull();
});

test('apertura bloqueada o tardía termina y cierra una conexión que llega después', async () => {
    jest.useFakeTimers(); const request = {}; const close = jest.fn();
    const result = measureSyncQueues({ indexedDB: { open: () => request } });
    await jest.advanceTimersByTimeAsync(4001);
    expect((await result).available).toBe(false);
    request.result = { close }; request.onsuccess(); expect(close).toHaveBeenCalledTimes(1);
});
