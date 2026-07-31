/**
 * PettyCashStore.js — persistencia durable de caja chica (Fase capa-2: C1+L1).
 *
 * Reemplaza el caché en localStorage por **IndexedDB** (stores per-colección)
 * y añade una **outbox** (cola de escrituras pendientes) para que ningún
 * cambio hecho offline se pierda: cada save/delete se escribe local de
 * inmediato y se encola; `flush()` empuja a Firestore y va vaciando la cola
 * (al guardar, al iniciar sesión y al volver la conexión).
 *
 * No mantiene estado en memoria — eso vive en `state.pettyCash` (PettyCashUI).
 */

import { indexedDBService } from '../../services/IndexedDBService.js';
import { PettyCashRepository } from '../../services/PettyCashRepository.js';
import { auth } from '../../data/firebase.js';
import { saveOutcomeNotifier } from '../../services/SaveOutcomeNotifier.js';
import { APP_CONFIG } from '../../config/Config.js';
import { sendMovementMirror } from './PettyCashMovementMirror.js';
import { PettyCashPersistenceMetrics } from './PettyCashPersistenceMetrics.js';
import { createCrossTabLock } from '../../services/CrossTabLock.js';

const STORE = { projects: 'pettyCashProjects', periods: 'pettyCashPeriods', movements: 'pettyCashMovements' };
const REPO = { projects: PettyCashRepository.projects, periods: PettyCashRepository.periods, movements: PettyCashRepository.movements };
const OUTBOX = 'pettyCashOutbox';
const MIRROR_OUTBOX = 'pettyCashMirrorOutbox';
const LS_KEY = '_pettycash_local_v2'; // caché viejo (a migrar una sola vez)
const OUTBOX_LOCK = 'attendance-app-petty-cash-outbox';
const MIRROR_LOCK = 'attendance-app-petty-cash-mirror-outbox';
const _crossTabLock = createCrossTabLock({ leaseStore: indexedDBService });

// ☠️ M2: tras este número de intentos fallidos, la entrada pasa a 'dead' y
// deja de bloquear la cola (una entrada envenenada — rechazada por reglas,
// payload corrupto — frenaba TODOS los demás cambios pendientes, en silencio).
export const MAX_FLUSH_ATTEMPTS = 5;

let _flushing = false;
let _flushRequested = false;
let _flushingMirror = false;

function compactPendingEntries(entries) {
    const groups = new Map();
    entries.forEach((entry) => {
        const groupKey = `${entry.col || ''}\u0000${entry.id || ''}`;
        const current = groups.get(groupKey) || { entry, keys: [] };
        current.entry = entry;
        current.keys.push(entry.key);
        groups.set(groupKey, current);
    });
    return [...groups.values()];
}

async function deleteOutboxKeys(keys, except = null) {
    for (const key of keys) {
        if (key === except) continue;
        try { await indexedDBService.delete(OUTBOX, key); } catch { /* noop */ }
    }
}

export const PettyCashStore = {

    /** Carga las 3 colecciones desde IndexedDB. */
    async loadLocal() {
        try {
            const [projects, periods, movements] = await Promise.all([
                indexedDBService.getAll(STORE.projects),
                indexedDBService.getAll(STORE.periods),
                indexedDBService.getAll(STORE.movements)
            ]);
            return { projects: projects || [], periods: periods || [], movements: movements || [] };
        } catch (e) {
            console.warn('⚠️ PettyCashStore.loadLocal:', e);
            return { projects: [], periods: [], movements: [] };
        }
    },

    /**
     * Persiste un borrador exclusivamente en IndexedDB.
     *
     * Se usa mientras una factura está en OCR/revisión: todavía no es un
     * movimiento contable confirmado y por eso no debe consumir escrituras de
     * Firebase ni publicarse en el espejo de Supabase.
     */
    async saveLocal(col, item, opts = {}) {
        if (!STORE[col] || !item || !item.id) return false;
        const source = opts.source || 'unspecified';
        PettyCashPersistenceMetrics.record({
            operation: 'save', collection: col, stage: 'requested', source
        });
        const startedAt = Date.now();
        try {
            await indexedDBService.update(STORE[col], item);
            PettyCashPersistenceMetrics.record({
                operation: 'save', collection: col, stage: 'local-success', source,
                durationMs: Date.now() - startedAt
            });
            return true;
        } catch (e) {
            PettyCashPersistenceMetrics.record({
                operation: 'save', collection: col, stage: 'local-failure', source,
                status: 'error', durationMs: Date.now() - startedAt
            });
            console.warn('pc save local-only:', e);
            return false;
        }
    },

    /**
     * Guarda un item: local (durable) + encola para la nube + intenta flush.
     * opts.announce (string opcional): anuncia el resultado REAL vía el toast
     * honesto — local OK al instante; el color final (verde nube / amarillo
     * solo-local) lo decide el flush al drenar la outbox.
     */
    async save(col, item, opts = {}) {
        if (!STORE[col] || !item || !item.id) return;
        const source = opts.source || 'unspecified';
        PettyCashPersistenceMetrics.record({
            operation: 'save', collection: col, stage: 'requested', source
        });
        let localOk = true;
        const localStartedAt = Date.now();
        try {
            await indexedDBService.update(STORE[col], item);
            PettyCashPersistenceMetrics.record({
                operation: 'save', collection: col, stage: 'local-success', source,
                durationMs: Date.now() - localStartedAt
            });
        } catch (e) {
            localOk = false;
            PettyCashPersistenceMetrics.record({
                operation: 'save', collection: col, stage: 'local-failure', source,
                status: 'error', durationMs: Date.now() - localStartedAt
            });
            console.warn('pc save local:', e);
        }
        try {
            await indexedDBService.update(OUTBOX, {
                op: 'save', col, id: item.id, data: item, source,
                ts: Date.now(), status: 'pending'
            });
            PettyCashPersistenceMetrics.record({
                operation: 'queue', collection: 'outbox', stage: 'queue-success', source
            });
        } catch (e) {
            PettyCashPersistenceMetrics.record({
                operation: 'queue', collection: 'outbox', stage: 'queue-failure', source,
                status: 'error'
            });
            console.warn('pc enqueue:', e);
        }
        if (col === 'movements') {
            await this.enqueueMovementMirror('save', item).catch((e) => console.warn('pc mirror enqueue:', e));
        }
        if (opts.announce) {
            saveOutcomeNotifier.recordLocalResult({
                localOk,
                cloudExpected: !!(auth && auth.currentUser),
                label: opts.announce
            });
        }
        this.flush();
        this.flushMirror();
    },

    /** Borra un item: local + encola delete + intenta flush.
     *  opts.announce: igual que en save(). */
    async remove(col, id, opts = {}) {
        if (!STORE[col] || !id) return;
        const source = opts.source || 'unspecified';
        PettyCashPersistenceMetrics.record({
            operation: 'delete', collection: col, stage: 'requested', source
        });
        let removedSnapshot = null;
        if (col === 'movements') {
            try { removedSnapshot = await indexedDBService.get(STORE[col], id); } catch { /* noop */ }
        }
        let localOk = true;
        const localStartedAt = Date.now();
        try {
            await indexedDBService.delete(STORE[col], id);
            PettyCashPersistenceMetrics.record({
                operation: 'delete', collection: col, stage: 'local-success', source,
                durationMs: Date.now() - localStartedAt
            });
        } catch (e) {
            localOk = false;
            PettyCashPersistenceMetrics.record({
                operation: 'delete', collection: col, stage: 'local-failure', source,
                status: 'error', durationMs: Date.now() - localStartedAt
            });
            console.warn('pc del local:', e);
        }
        try {
            await indexedDBService.update(OUTBOX, {
                op: 'delete', col, id, source, ts: Date.now(), status: 'pending'
            });
            PettyCashPersistenceMetrics.record({
                operation: 'queue', collection: 'outbox', stage: 'queue-success', source
            });
        } catch (e) {
            PettyCashPersistenceMetrics.record({
                operation: 'queue', collection: 'outbox', stage: 'queue-failure', source,
                status: 'error'
            });
            console.warn('pc enqueue del:', e);
        }
        if (col === 'movements') {
            await this.enqueueMovementMirror('delete', removedSnapshot || { id }).catch((e) => console.warn('pc mirror delete enqueue:', e));
        }
        if (opts.announce) {
            saveOutcomeNotifier.recordLocalResult({
                localOk,
                cloudExpected: !!(auth && auth.currentUser),
                label: opts.announce
            });
        }
        this.flush();
        this.flushMirror();
    },

    /** Compacta por id la última operación que falta reflejar en Supabase. */
    async enqueueMovementMirror(op, movement) {
        if (!movement?.id) return;
        const now = Date.now();
        await indexedDBService.update(MIRROR_OUTBOX, {
            id: movement.id,
            op: op === 'delete' ? 'delete' : 'save',
            data: { ...movement },
            ownerUid: auth?.currentUser?.uid || null,
            ts: now,
            status: 'pending',
            attempts: 0,
            lastError: null
        });
    },

    /**
     * Drena el espejo de Supabase sin bloquear ni alterar la cola principal de
     * Firebase. Una edición posterior con el mismo id reemplaza la anterior.
     */
    async flushMirror() {
        if (_flushingMirror) return;
        const user = auth?.currentUser;
        const url = APP_CONFIG?.PETTY_CASH_MIRROR_URL;
        if (!user || typeof user.getIdToken !== 'function' || !url) return;
        _flushingMirror = true;
        try {
            await _crossTabLock.run(MIRROR_LOCK, async () => {
                if (auth?.currentUser?.uid !== user.uid) return;
                const idToken = await user.getIdToken();
                let pending = [];
                try { pending = (await indexedDBService.getAll(MIRROR_OUTBOX)) || []; } catch { pending = []; }
                pending = pending
                    .filter((entry) => entry?.status === 'pending')
                    .sort((left, right) => (Number(left.ts) || 0) - (Number(right.ts) || 0));

                for (const entry of pending) {
                    if (entry.ownerUid && entry.ownerUid !== user.uid) continue;
                    try {
                        await sendMovementMirror({ url, entry, idToken });
                        // No borrar una edición más nueva que haya reemplazado esta
                        // entrada mientras la petición estaba en vuelo.
                        const current = await indexedDBService.get(MIRROR_OUTBOX, entry.id).catch(() => null);
                        if (current && current.ts === entry.ts && current.op === entry.op) {
                            await indexedDBService.delete(MIRROR_OUTBOX, entry.id);
                        }
                    } catch (error) {
                        const attempts = (Number(entry.attempts) || 0) + 1;
                        const updated = {
                            ...entry,
                            attempts,
                            lastError: String(error?.message || error),
                            status: attempts >= MAX_FLUSH_ATTEMPTS ? 'dead' : 'pending'
                        };
                        await indexedDBService.update(MIRROR_OUTBOX, updated).catch(() => null);
                        if (updated.status === 'dead') {
                            console.error(`☠️ Espejo de Caja Chica: ${entry.id} agotó sus reintentos.`, error);
                            continue;
                        }
                        console.warn(`⚠️ Espejo de Caja Chica: ${entry.id} se reintentará.`, error);
                        break;
                    }
                }
            });
        } catch (error) {
            console.warn('⚠️ No se pudo iniciar el espejo de Caja Chica:', error);
        } finally {
            _flushingMirror = false;
        }
    },

    /**
     * Aplica un snapshot remoto sin pisar trabajo local todavía no confirmado.
     *
     * Las entradas finales del outbox prevalecen sobre el snapshot; un delete
     * pendiente tampoco puede resucitar. Los borradores OCR marcados
     * `localDraft` se conservan aunque, por diseño, aún no existan en Firebase.
     */
    async applyRemote(col, list, scope = {}) {
        if (!STORE[col]) return [];
        const remote = Array.isArray(list) ? list.filter((item) => item?.id) : [];
        let local = [];
        let queued = [];
        try {
            [local, queued] = await Promise.all([
                indexedDBService.getAll(STORE[col]),
                indexedDBService.getAll(OUTBOX)
            ]);
        } catch {
            local = [];
            queued = [];
        }

        const localById = new Map((local || []).filter((item) => item?.id).map(
            (item) => [String(item.id), item]
        ));
        const scopedPeriodIds = col === 'movements' && Array.isArray(scope.periodIds)
            ? new Set(scope.periodIds.map((id) => String(id || '').trim()).filter(Boolean))
            : null;
        const retainedLocal = scopedPeriodIds
            ? (local || []).filter((item) => !scopedPeriodIds.has(String(item?.periodId || '')))
            : [];
        const merged = new Map([
            ...retainedLocal.map((item) => [String(item.id), item]),
            ...remote.map((item) => [String(item.id), item])
        ]);

        if (col === 'projects') {
            localById.forEach((localProject, id) => {
                const remoteProject = merged.get(id);
                if (!remoteProject) return;
                const localCounter = Number(localProject.nextRecordNumber) || 0;
                const remoteCounter = Number(remoteProject.nextRecordNumber) || 0;
                if (localCounter > remoteCounter) {
                    merged.set(id, { ...remoteProject, nextRecordNumber: localCounter });
                }
            });
        }

        if (col === 'movements') {
            localById.forEach((item, id) => {
                if (item.localDraft === true) merged.set(id, item);
            });
        }

        const latestQueued = new Map();
        (queued || [])
            .filter((entry) => entry?.col === col && ['pending', 'dead'].includes(entry.status))
            .sort((left, right) => (left.key || 0) - (right.key || 0))
            .forEach((entry) => latestQueued.set(String(entry.id), entry));
        latestQueued.forEach((entry, id) => {
            if (entry.op === 'delete') {
                merged.delete(id);
                return;
            }
            const localItem = entry.data || localById.get(id);
            if (localItem) merged.set(id, localItem);
        });

        const mergedList = [...merged.values()];
        try {
            await indexedDBService.clear(STORE[col]);
            if (mergedList.length) await indexedDBService.batchUpdate(STORE[col], mergedList);
        } catch (e) { console.warn('pc applyRemote:', e); }
        return mergedList;
    },

    /**
     * Vacía la outbox hacia Firestore. No-op sin sesión (deja pendiente).
     *
     * ☠️ M2 (Auditoría): cada fallo incrementa entry.attempts y registra
     * entry.lastError. Tras MAX_FLUSH_ATTEMPTS la entrada pasa a 'dead' y el
     * drenado CONTINÚA con la siguiente (antes una entrada envenenada
     * bloqueaba la cola completa para siempre). Un fallo "joven" (transitorio,
     * p. ej. sin red) sigue cortando el ciclo para no martillar.
     */
    async flush() {
        if (_flushing) {
            _flushRequested = true;
            return;
        }
        if (!auth || !auth.currentUser) return; // sin sesión → reintentar luego
        const expectedUid = auth.currentUser.uid;
        _flushing = true;
        try {
            await _crossTabLock.run(OUTBOX_LOCK, async () => {
                if (!auth?.currentUser || auth.currentUser.uid !== expectedUid) return;
                do {
                    _flushRequested = false;
                    let pending = [];
                    try { pending = (await indexedDBService.getAll(OUTBOX)) || []; } catch { pending = []; }
                    pending = pending
                        .filter(e => e && e.status === 'pending')
                        .sort((a, b) => (a.key || 0) - (b.key || 0));
                    const compacted = compactPendingEntries(pending);
                    let transientFailure = false;

                    for (const group of compacted) {
                        const entry = group.entry;
                        const superseded = group.keys.length - 1;
                        if (superseded > 0) {
                            PettyCashPersistenceMetrics.record({
                                operation: 'queue',
                                collection: 'outbox',
                                stage: 'compacted',
                                source: entry.source,
                                count: superseded
                            });
                        }
                        const repo = REPO[entry.col];
                        if (!repo) {
                            await deleteOutboxKeys(group.keys);
                            continue;
                        }
                        try {
                            if (entry.op === 'delete') {
                                await repo.deleteOne(entry.id, { source: entry.source });
                            } else if (entry.data) {
                                await repo.saveOne(entry.data, { source: entry.source });
                            }
                            await deleteOutboxKeys(group.keys);
                            // 💬 Toast honesto: si hay un guardado anunciado esperando,
                            // confirmar que la nube ya lo tiene (el notifier ignora el
                            // reporte si no hay nada pendiente).
                            saveOutcomeNotifier.recordCloudResult(true);
                        } catch (e) {
                            // Las operaciones anteriores del mismo documento ya están
                            // representadas por la última. Quitarlas evita que vuelvan
                            // a generar escrituras cuando se reintente.
                            await deleteOutboxKeys(group.keys, entry.key);
                            saveOutcomeNotifier.recordCloudResult(false);
                            const attempts = (Number(entry.attempts) || 0) + 1;
                            const updated = { ...entry, attempts, lastError: String(e?.message || e) };
                            if (attempts >= MAX_FLUSH_ATTEMPTS) {
                                updated.status = 'dead';
                                PettyCashPersistenceMetrics.record({
                                    operation: 'flush', collection: 'outbox', stage: 'dead',
                                    source: entry.source, status: 'error'
                                });
                                console.error(`☠️ PettyCashStore.flush — entrada ${entry.key} marcada DEAD tras ${attempts} intentos (ya no bloquea la cola):`, e);
                                try { await indexedDBService.update(OUTBOX, updated); } catch { /* noop */ }
                                continue; // la cola sigue con la próxima entrada
                            }
                            PettyCashPersistenceMetrics.record({
                                operation: 'flush', collection: 'outbox', stage: 'retry',
                                source: entry.source, status: 'error'
                            });
                            console.warn(`⚠️ PettyCashStore.flush — entrada ${entry.key} falló (intento ${attempts}/${MAX_FLUSH_ATTEMPTS}), se reintentará:`, e);
                            try { await indexedDBService.update(OUTBOX, updated); } catch { /* noop */ }
                            transientFailure = true;
                            break; // fallo transitorio: cortar y reintentar en el próximo flush
                        }
                    }
                    if (transientFailure) break;
                } while (_flushRequested);
            });
        } finally {
            _flushing = false;
            // Una petición puede llegar entre la última comprobación del bucle
            // y este finally. Programarla evita dejar la entrada dormida hasta
            // otro evento de red/guardado.
            if (_flushRequested) {
                _flushRequested = false;
                queueMicrotask(() => this.flush());
            }
        }
    },

    /** ¿Cuántas escrituras quedan pendientes? (para UI/diagnóstico) */
    async pendingCount() {
        try {
            const all = (await indexedDBService.getAll(OUTBOX)) || [];
            return all.filter(e => e && e.status === 'pending').length;
        } catch { return 0; }
    },

    /** ¿Cuántas entradas quedaron muertas (descartadas tras N intentos)? */
    async deadCount() {
        try {
            const all = (await indexedDBService.getAll(OUTBOX)) || [];
            return all.filter(e => e && e.status === 'dead').length;
        } catch { return 0; }
    },

    /**
     * Revive las entradas 'dead' (attempts en cero, status 'pending') para
     * reintentarlas — p. ej. después de corregir reglas de Firestore.
     * @returns {Promise<number>} cuántas revivió
     */
    async requeueDeadEntries() {
        let revived = 0;
        try {
            const all = (await indexedDBService.getAll(OUTBOX)) || [];
            for (const entry of all) {
                if (!entry || entry.status !== 'dead') continue;
                try {
                    await indexedDBService.update(OUTBOX, { ...entry, status: 'pending', attempts: 0, lastError: null });
                    revived++;
                } catch { /* noop */ }
            }
        } catch { /* noop */ }
        if (revived > 0) this.flush();
        return revived;
    },

    /** Migración única: si hay datos viejos en localStorage y el IDB está vacío,
     *  los mueve a los stores nuevos y borra la clave vieja. */
    async migrateFromLocalStorage() {
        let raw;
        try { raw = localStorage.getItem(LS_KEY); } catch { return; }
        if (!raw) return;
        try {
            const d = JSON.parse(raw) || {};
            const existing = await indexedDBService.getAll(STORE.movements).catch(() => []);
            if (existing && existing.length) { try { localStorage.removeItem(LS_KEY); } catch { /* noop */ } return; }
            if (Array.isArray(d.projects) && d.projects.length) await indexedDBService.batchUpdate(STORE.projects, d.projects);
            if (Array.isArray(d.periods) && d.periods.length) await indexedDBService.batchUpdate(STORE.periods, d.periods);
            if (Array.isArray(d.movements) && d.movements.length) await indexedDBService.batchUpdate(STORE.movements, d.movements);
            try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
            console.log('✅ Caja chica migrada de localStorage a IndexedDB');
        } catch (e) {
            console.warn('⚠️ PettyCashStore.migrateFromLocalStorage:', e);
        }
    }
};

// 🌐 M2: drenar la outbox al volver la conexión. El docstring siempre
// prometió "al volver la conexión", pero nadie escuchaba el evento — los
// cambios hechos offline esperaban hasta el próximo save o login.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => {
        try { PettyCashStore.flush(); } catch { /* noop */ }
        try { PettyCashStore.flushMirror(); } catch { /* noop */ }
    });
}

export default PettyCashStore;
