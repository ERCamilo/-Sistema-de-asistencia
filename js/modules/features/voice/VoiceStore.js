import { voiceAudioExpiry, voiceStorageStatus, VOICE_AUDIO_BUDGET, VOICE_DAY } from './VoiceRetention.js';
import { normalizeVoiceName } from './VoiceCore.js';
import { voiceCanProcess, voiceKeepPending, voiceRequestDescriptor, VOICE_PROCESSING_LEASE_MS } from './VoicePending.js';

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
    async put(record) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings','readwrite'), store = tx.objectStore('recordings'); let failure, key;
            const get = store.get([record.uid,record.requestId]);
            get.onsuccess = () => {
                try {
                    const current = get.result;
                    if (current && current.projectKey !== record.projectKey) throw Error('Esta grabación pertenece a otra obra.');
                    if (current?.completedLoanId && current.completedLoanId !== record.completedLoanId) throw Error('Esta grabación ya registró un préstamo.');
                    if (current?.completedCashId && current.completedCashId !== record.completedCashId) throw Error('Esta grabación ya registró un gasto.');
                    if (current?.completedLoanId && current.audioDiscardedAt && record.audio) throw Error('El audio ya fue eliminado. Graba una instrucción nueva.');
                    // Editors cannot overwrite a worker's lease/state with an old
                    // snapshot, or erase the signature of an attempted request.
                    const next = { ...record };
                    if (current && (current.requestSignature || current.processingState)) for (const field of ['processingState','processingRequested','processingLease','requestSignature','requestEndpoint','autoResume','retryAt','error']) {
                        if (Object.hasOwn(current, field)) next[field] = current[field]; else delete next[field];
                    }
                    if (current?.pendingResult && next.dirty && !next.pendingResult) next.pendingResult = current.pendingResult;
                    if (current?.requestSignature && current.result && next.dirty && JSON.stringify(current.result) !== JSON.stringify(next.result)) next.pendingResult ||= current.result;
                    const write = () => { const put = store.put(current?.completedLoanId && current.audioDiscardedAt ? current : next); put.onsuccess = () => { key = put.result; }; };
                    if ((next.audio?.size || 0) > (current?.audio?.size || 0)) {
                        const all = store.getAll();
                        all.onsuccess = () => {
                            const total = all.result.filter(row => row.uid !== next.uid || row.requestId !== next.requestId).reduce((sum,row)=>sum+(row.audio?.size || 0),0)+(next.audio?.size || 0);
                            if (total > VOICE_AUDIO_BUDGET) { failure = Error('El archivo de voz alcanzó 50 MiB. Elimina audios antes de guardar otra grabación.'); tx.abort(); }
                            else write();
                        };
                    } else write();
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = () => resolve(key);
            tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo conservar el audio o borrador local. Revisa el espacio disponible.'));
        });
    }
    get(uid, requestId) { return this.operation('recordings', 'readonly', store => store.get([uid, requestId])); }
    // Read-modify-write in one IndexedDB transaction: shared by tabs and workers.
    async updateRecording(uid, projectKey, requestId, update, { guard = () => {} } = {}) {
        const db = await this.open(); guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings','readwrite'), store = tx.objectStore('recordings'); let result = null, failure;
            const request = store.get([uid, requestId]);
            request.onsuccess = () => {
                try {
                    guard(); const current = request.result;
                    if (!current || current.projectKey !== projectKey) return;
                    result = update(current);
                    if (result) store.put(result);
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo actualizar el envío local.'));
        });
    }
    claimProcessing(record, signature, owner, policy, options = {}) {
        return this.updateRecording(record.uid, record.projectKey, record.requestId, current => {
            const now = Date.now();
            if (!voiceCanProcess(current, policy, now)) throw Error('El audio venció, fue eliminado o ya tiene una operación confirmada.');
            if (current.retryAt > now) throw Error('Espera antes de reintentar esta grabación.');
            if (current.processingLease?.until > now) throw Error('Esta grabación ya se está procesando en otra ventana.');
            if (voiceRequestDescriptor(current) !== voiceRequestDescriptor(record)) throw Error('Cambió el audio o su contexto. Graba una instrucción nueva para obtener otro requestId.');
            if (current.requestSignature && current.requestSignature !== signature) throw Error('Cambió el audio o su contexto. Graba una instrucción nueva para obtener otro requestId.');
            return { ...current, processingRequested: true, requestEndpoint: record.requestEndpoint, requestSignature: signature, processingState: 'processing', autoResume: false,
                processingLease: { owner, until: now + VOICE_PROCESSING_LEASE_MS }, error: null, retryAt: null };
        }, options);
    }
    finishProcessing(record, owner, update, options = {}) {
        return this.updateRecording(record.uid, record.projectKey, record.requestId, current => {
            if (current.processingLease?.owner !== owner || !current.audio || current.completedLoanId || current.completedCashId || current.cashDraft?.pendingMovement) return null;
            const next = update(current); delete next.processingLease; return next;
        }, options);
    }
    remove(uid, requestId) { return this.operation('recordings', 'readwrite', store => store.delete([uid, requestId])); }
    async list(uid, projectKey) {
        const records = await this.operation('recordings', 'readonly', store => store.getAll());
        return records.filter(x => x.uid === uid && x.projectKey === projectKey).sort((a, b) => b.createdAt - a.createdAt);
    }
    async aliases(uid, projectKey) {
        const aliases = await this.operation('aliases', 'readonly', store => store.getAll());
        return aliases.filter(x => x.uid === uid && x.projectKey === projectKey);
    }
    async saveAlias(uid, projectKey, employeeId, alias, { guard = () => {} } = {}) {
        alias = normalizeVoiceName(alias).slice(0, 160); if (!alias) return;
        const db = await this.open();
        guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('aliases', 'readwrite'); const store = tx.objectStore('aliases');
            let failure;
            const get = store.get([uid, projectKey, employeeId]);
            get.onsuccess = () => {
                try {
                    guard(); const aliases = get.result?.aliases || [];
                    if (!aliases.includes(alias) && aliases.length >= 50) throw Error('Este empleado ya tiene 50 variantes. Edita o elimina una primero.');
                    store.put({ uid, projectKey, employeeId, aliases: [...new Set([...aliases, alias])] });
                }
                catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo guardar la coincidencia local.'));
        });
    }
    async removeAlias(uid, projectKey, employeeId, alias, { guard = () => {} } = {}) {
        alias = normalizeVoiceName(alias).slice(0, 160);
        const db = await this.open();
        guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('aliases', 'readwrite'); const store = tx.objectStore('aliases');
            let failure;
            const get = store.get([uid, projectKey, employeeId]);
            get.onsuccess = () => {
                try { guard(); if (get.result) store.put({ ...get.result, aliases: get.result.aliases.filter(value => value !== alias) }); }
                catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo eliminar la variante local.'));
        });
    }
    // A single transaction preserves concurrent variants and never drops an old
    // association before its replacement is durable. null means add a variant.
    async editAlias(uid, projectKey, employeeId, previous, value, { guard = () => {} } = {}) {
        const alias = normalizeVoiceName(value).slice(0, 160);
        const old = previous == null ? null : normalizeVoiceName(previous).slice(0, 160);
        if (!alias) throw Error('Escribe cómo le llaman al empleado.');
        const db = await this.open(); guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('aliases', 'readwrite'), store = tx.objectStore('aliases'); let failure;
            const request = store.get([uid, projectKey, employeeId]);
            request.onsuccess = () => {
                try {
                    guard();
                    const aliases = request.result?.aliases || [];
                    if (old != null && !aliases.includes(old)) throw Error('La pronunciación cambió en otra ventana. Actualiza la lista.');
                    if (alias !== old && aliases.includes(alias)) throw Error('Esta pronunciación ya está guardada.');
                    if (old == null && aliases.length >= 50) throw Error('Este empleado ya tiene 50 variantes. Edita o elimina una primero.');
                    store.put({ uid, projectKey, employeeId, aliases: old == null ? [...aliases, alias] : aliases.map(item => item === old ? alias : item) });
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = resolve;
            tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo guardar la pronunciación.'));
        });
    }
    // Delete only the reviewed files, keeping completed operation markers.
    async discardRecordingAudio(uid, projectKey, requestIds, { guard = () => {}, now = Date.now() } = {}) {
        const wanted = new Set(requestIds);
        if (!wanted.size) return [];
        const db = await this.open(); guard();
        const discarded = await new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite'), store = tx.objectStore('recordings'); let failure;
            const request = store.getAll(); const ids = [];
            request.onsuccess = () => {
                try {
                    guard();
                    const rows = request.result.filter(row => row.uid === uid && row.projectKey === projectKey && wanted.has(row.requestId));
                    if (rows.length !== wanted.size) throw Error('Cambió la lista de audios. Actualízala antes de borrar.');
                    for (const row of rows) {
                        guard(); if (!row.audio) continue;
                        if (row.completedLoanId) store.put({ uid, projectKey, requestId: row.requestId, createdAt: row.createdAt, registeredAt: row.registeredAt, completedLoanId: row.completedLoanId, selectedEmployeeId: row.selectedEmployeeId, audioDiscardedAt: now, audioDiscardReason: 'manual' });
                        else store.delete([uid, row.requestId]);
                        ids.push(row.requestId);
                    }
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = () => resolve(ids);
            tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo eliminar el audio.'));
        });
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sa:voice-audio-discarded', { detail: { uid, projectKey, requestIds: discarded } }));
        return discarded;
    }
    clearAliases(uid, projectKey, employeeId) { return this.operation('aliases', 'readwrite', store => store.delete([uid, projectKey, employeeId])); }
    async maintain(uid, policy, now = Date.now(), { guard = () => {} } = {}) {
        const db = await this.open();
        guard();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite'); const records = tx.objectStore('recordings');
            let failure;
            const cursor = records.openCursor();
            cursor.onsuccess = () => {
                try {
                    guard();
                    const row = cursor.result; if (!row) return;
                    const r = row.value;
                    const expiry = voiceAudioExpiry(r, r.uid === uid ? policy : { keep: true, days: 5 });
                    if (r.audio && expiry <= now) {
                        if (r.completedLoanId) row.update({ uid: r.uid, projectKey: r.projectKey, requestId: r.requestId, createdAt: r.createdAt, registeredAt: r.registeredAt, completedLoanId: r.completedLoanId, selectedEmployeeId: r.selectedEmployeeId, audioDiscardedAt: now });
                        else if (voiceKeepPending(r)) row.update({ uid: r.uid, projectKey: r.projectKey, requestId: r.requestId, createdAt: r.createdAt, audioDiscardedAt: now, audioDiscardReason: 'expired', processingState: 'expired' });
                        else row.delete();
                    } else if (r.processingState === 'expired' && r.audioDiscardedAt + 7*VOICE_DAY <= now) row.delete();
                    else if (r.completedLoanId && r.audio && r.audioExpiresAt !== expiry) row.update({ ...r, audioExpiresAt: expiry });
                    row.continue();
                } catch (error) { failure = error; tx.abort(); }
            };
            tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(failure || Error('No se pudo limpiar el archivo local de voz.'));
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
