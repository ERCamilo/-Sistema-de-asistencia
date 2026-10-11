// Read-only measurements. Blob sizes describe file payloads, not database overhead.
const DATA_DB = 'attendance-app-db';
const VOICE_DB = 'sa-voice-mvp-v1';
const QUEUES = ['mainSyncOutbox', 'pettyCashOutbox', 'pettyCashMirrorOutbox'];
const RECORDS = ['employees', 'positions', 'leaders', 'attendance'];
const TIMEOUT_MS = 4000;

function boundedEstimate(navigator) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Estimate timeout')), TIMEOUT_MS);
        Promise.resolve().then(() => navigator?.storage?.estimate?.())
            .then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

export function measureLocalStorage(storage) {
    try {
        let bytes = 0;
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key !== null) bytes += (key.length + (storage.getItem(key) || '').length) * 2;
        }
        return bytes;
    } catch { return null; }
}

// Opening an absent database aborts creation; diagnostics never initialize/migrate stores.
function openExisting(indexedDB, name) {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
        let settled = false;
        const request = indexedDB.open(name);
        const finish = (error, db) => {
            if (settled) { db?.close(); return; }
            settled = true; clearTimeout(timer);
            error ? reject(error) : resolve(db);
        };
        const timer = setTimeout(() => finish(new Error('Storage timeout')), TIMEOUT_MS);
        request.onupgradeneeded = () => { request.transaction.abort(); finish(null, null); };
        request.onerror = () => finish(request.error);
        request.onblocked = () => finish(new Error('Storage blocked'));
        request.onsuccess = () => finish(null, request.result);
    });
}

async function scan(indexedDB, name, stores, visit, countStores = []) {
    const db = await openExisting(indexedDB, name);
    if (!db) return;
    try {
        const available = [...stores, ...countStores].filter(store => db.objectStoreNames.contains(store));
        if (!available.length) return;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(available, 'readonly');
            const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Storage timeout')); }, TIMEOUT_MS);
            tx.oncomplete = () => { clearTimeout(timer); resolve(); };
            tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Storage read failed')); };
            for (const store of available) {
                if (countStores.includes(store)) {
                    const request = tx.objectStore(store).count();
                    request.onsuccess = () => visit(store, { count: request.result });
                    continue;
                }
                const request = tx.objectStore(store).openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (cursor) { visit(store, cursor.value); cursor.continue(); }
                };
            }
        });
    } finally { db.close(); }
}

export async function measureSyncQueues({ indexedDB = globalThis.indexedDB } = {}) {
    const result = { pending: 0, failed: 0, available: true };
    try {
        await scan(indexedDB, DATA_DB, QUEUES, (_, row) => {
            if (row.status === 'pending') result.pending++;
            if (row.status === 'dead') result.failed++;
        });
    } catch { return { pending: null, failed: null, available: false }; }
    return result;
}

export async function measureDeviceStorage({ indexedDB = globalThis.indexedDB, navigator = globalThis.navigator, storage } = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
    const result = {
        usage: null, quota: null, localBytes: measureLocalStorage(storage),
        photos: { bytes: 0, count: 0, available: true },
        audio: { bytes: 0, count: 0, available: true },
        records: { employees: 0, positions: 0, leaders: 0, attendance: 0, available: true }
    };
    const reads = await Promise.allSettled([
        boundedEstimate(navigator),
        scan(indexedDB, DATA_DB, ['employeePhotos'], (store, row) => {
            if (store !== 'employeePhotos') { result.records[store] = row.count; return; }
            result.photos.count++;
            result.photos.bytes += (row.optimizedBlob?.size || 0) + (row.thumbnailBlob?.size || 0);
        }, RECORDS),
        scan(indexedDB, VOICE_DB, ['recordings'], (_, row) => {
            if (row.audio?.size > 0) { result.audio.count++; result.audio.bytes += row.audio.size; }
        })
    ]);
    const estimate = reads[0].status === 'fulfilled' ? reads[0].value : null;
    if (Number.isFinite(estimate?.usage) && estimate.usage >= 0) result.usage = estimate.usage;
    if (Number.isFinite(estimate?.quota) && estimate.quota > 0) result.quota = estimate.quota;
    if (reads[1].status === 'rejected') {
        result.photos = { bytes: null, count: null, available: false };
        result.records = { available: false };
    }
    if (reads[2].status === 'rejected') result.audio = { bytes: null, count: null, available: false };
    return result;
}
