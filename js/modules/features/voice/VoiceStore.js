import { voiceAudioExpiry, voiceStorageStatus } from './VoiceRetention.js';
import { normalizeVoiceName } from './VoiceCore.js';

// Separate, device-local MVP data. Never enters business backups/cloud payloads.
export class VoiceStore {
    constructor({ indexedDB = globalThis.indexedDB, name = 'sa-voice-mvp-v1' } = {}) { this.idb = indexedDB; this.name = name; this.db = null; }
    async open() {
        if (this.db) return this.db;
        if (!this.idb) throw Error('IndexedDB no está disponible para conservar el audio.');
        if (!this.opening) this.opening = new Promise((resolve, reject) => {
            const request = this.idb.open(this.name, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('recordings', { keyPath: ['uid', 'requestId'] });
                request.result.createObjectStore('aliases', { keyPath: ['uid', 'projectKey', 'employeeId'] });
            };
            request.onerror = () => reject(Error('No se pudo abrir el archivo local de voz.'));
            request.onblocked = () => reject(Error('Cierra las otras pestañas para abrir el archivo de voz.'));
            request.onsuccess = () => { this.db = request.result; this.db.onversionchange = () => this.close(); resolve(this.db); };
        }).catch(error => { this.opening = null; throw error; });
        return this.opening;
    }
    async operation(store, mode, callback) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode); const request = callback(tx.objectStore(store));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = tx.onabort = () => reject(Error('No se pudo conservar el audio o borrador local. Revisa el espacio disponible.'));
        });
    }
    put(record) { return this.operation('recordings', 'readwrite', store => store.put(record)); }
    get(uid, requestId) { return this.operation('recordings', 'readonly', store => store.get([uid, requestId])); }
    remove(uid, requestId) { return this.operation('recordings', 'readwrite', store => store.delete([uid, requestId])); }
    async list(uid, projectKey) {
        const records = await this.operation('recordings', 'readonly', store => store.getAll());
        return records.filter(x => x.uid === uid && x.projectKey === projectKey).sort((a, b) => b.createdAt - a.createdAt);
    }
    async aliases(uid, projectKey) {
        const aliases = await this.operation('aliases', 'readonly', store => store.getAll());
        return aliases.filter(x => x.uid === uid && x.projectKey === projectKey);
    }
    async saveAlias(uid, projectKey, employeeId, alias) {
        alias = normalizeVoiceName(alias).slice(0, 160); if (!alias) return;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('aliases', 'readwrite'); const store = tx.objectStore('aliases');
            const get = store.get([uid, projectKey, employeeId]);
            get.onsuccess = () => store.put({ uid, projectKey, employeeId, aliases: [...new Set([...(get.result?.aliases || []), alias])].slice(-50) });
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(Error('No se pudo guardar la coincidencia local.'));
        });
    }
    async removeAlias(uid, projectKey, employeeId, alias) {
        alias = normalizeVoiceName(alias).slice(0, 160);
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('aliases', 'readwrite'); const store = tx.objectStore('aliases');
            const get = store.get([uid, projectKey, employeeId]);
            get.onsuccess = () => {
                if (get.result) store.put({ ...get.result, aliases: get.result.aliases.filter(value => value !== alias) });
            };
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(Error('No se pudo eliminar la variante local.'));
        });
    }
    clearAliases(uid, projectKey, employeeId) { return this.operation('aliases', 'readwrite', store => store.delete([uid, projectKey, employeeId])); }
    async maintain(uid, policy, now = Date.now()) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite'); const records = tx.objectStore('recordings');
            const cursor = records.openCursor();
            cursor.onsuccess = () => {
                const row = cursor.result; if (!row) return;
                const r = row.value;
                const expiry = voiceAudioExpiry(r, r.uid === uid ? policy : { keep: true, days: 5 });
                if (r.audio && expiry <= now) {
                    if (r.completedLoanId) row.update({ uid: r.uid, projectKey: r.projectKey, requestId: r.requestId, createdAt: r.createdAt, registeredAt: r.registeredAt, completedLoanId: r.completedLoanId, selectedEmployeeId: r.selectedEmployeeId, audioDiscardedAt: now });
                    else row.delete();
                } else if (r.completedLoanId && r.audio && r.audioExpiresAt !== expiry) row.update({ ...r, audioExpiresAt: expiry });
                row.continue();
            };
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(Error('No se pudo limpiar el archivo local de voz.'));
        });
    }
    async clearAudio(uid, now = Date.now()) {
        const records = await this.operation('recordings', 'readonly', store => store.getAll());
        for (const r of records.filter(r => r.uid === uid && r.audio)) {
            if (r.completedLoanId) await this.put({ uid: r.uid, projectKey: r.projectKey, requestId: r.requestId, createdAt: r.createdAt, registeredAt: r.registeredAt, completedLoanId: r.completedLoanId, selectedEmployeeId: r.selectedEmployeeId, audioDiscardedAt: now });
            else await this.remove(r.uid, r.requestId);
        }
    }
    async storageStatus() { return voiceStorageStatus(await this.operation('recordings', 'readonly', store => store.getAll())); }
    close() { this.db?.close(); this.db = null; this.opening = null; }
}

export async function clearVoiceLocalData(indexedDB = globalThis.indexedDB) {
    // Stop pending recorder/result writes before clearing local MVP stores.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('sa:voice-wipe'));
    if (!indexedDB) return true;
    const store = new VoiceStore({ indexedDB });
    try {
        const db = await store.open();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['recordings', 'aliases'], 'readwrite');
            tx.objectStore('recordings').clear(); tx.objectStore('aliases').clear();
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(Error('No se pudo borrar el archivo local de voz.'));
        });
        return true;
    } finally { store.close(); }
}
