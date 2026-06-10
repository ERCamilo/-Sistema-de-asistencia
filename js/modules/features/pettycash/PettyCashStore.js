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

const STORE = { projects: 'pettyCashProjects', periods: 'pettyCashPeriods', movements: 'pettyCashMovements' };
const REPO = { projects: PettyCashRepository.projects, periods: PettyCashRepository.periods, movements: PettyCashRepository.movements };
const OUTBOX = 'pettyCashOutbox';
const LS_KEY = '_pettycash_local_v2'; // caché viejo (a migrar una sola vez)

// ☠️ M2: tras este número de intentos fallidos, la entrada pasa a 'dead' y
// deja de bloquear la cola (una entrada envenenada — rechazada por reglas,
// payload corrupto — frenaba TODOS los demás cambios pendientes, en silencio).
export const MAX_FLUSH_ATTEMPTS = 5;

let _flushing = false;

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

    /** Guarda un item: local (durable) + encola para la nube + intenta flush. */
    async save(col, item) {
        if (!STORE[col] || !item || !item.id) return;
        try { await indexedDBService.update(STORE[col], item); } catch (e) { console.warn('pc save local:', e); }
        try { await indexedDBService.update(OUTBOX, { op: 'save', col, id: item.id, data: item, ts: Date.now(), status: 'pending' }); } catch (e) { console.warn('pc enqueue:', e); }
        this.flush();
    },

    /** Borra un item: local + encola delete + intenta flush. */
    async remove(col, id) {
        if (!STORE[col] || !id) return;
        try { await indexedDBService.delete(STORE[col], id); } catch (e) { console.warn('pc del local:', e); }
        try { await indexedDBService.update(OUTBOX, { op: 'delete', col, id, ts: Date.now(), status: 'pending' }); } catch (e) { console.warn('pc enqueue del:', e); }
        this.flush();
    },

    /** Aplica una lista que viene de la nube (LiveSync/loadAll): reemplaza el
     *  store local SIN encolar (no es un cambio nuestro). */
    async applyRemote(col, list) {
        if (!STORE[col]) return;
        try {
            await indexedDBService.clear(STORE[col]);
            if (Array.isArray(list) && list.length) await indexedDBService.batchUpdate(STORE[col], list);
        } catch (e) { console.warn('pc applyRemote:', e); }
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
        if (_flushing) return;
        if (!auth || !auth.currentUser) return; // sin sesión → reintentar luego
        _flushing = true;
        try {
            let pending = [];
            try { pending = (await indexedDBService.getAll(OUTBOX)) || []; } catch { pending = []; }
            pending = pending.filter(e => e && e.status === 'pending').sort((a, b) => (a.key || 0) - (b.key || 0));
            for (const entry of pending) {
                const repo = REPO[entry.col];
                if (!repo) { try { await indexedDBService.delete(OUTBOX, entry.key); } catch { /* noop */ } continue; }
                try {
                    if (entry.op === 'delete') {
                        await repo.deleteOne(entry.id);
                    } else if (entry.data) {
                        await repo.saveOne(entry.data);
                    }
                    await indexedDBService.delete(OUTBOX, entry.key);
                } catch (e) {
                    const attempts = (Number(entry.attempts) || 0) + 1;
                    const updated = { ...entry, attempts, lastError: String(e?.message || e) };
                    if (attempts >= MAX_FLUSH_ATTEMPTS) {
                        updated.status = 'dead';
                        console.error(`☠️ PettyCashStore.flush — entrada ${entry.key} marcada DEAD tras ${attempts} intentos (ya no bloquea la cola):`, e);
                        try { await indexedDBService.update(OUTBOX, updated); } catch { /* noop */ }
                        continue; // la cola sigue con la próxima entrada
                    }
                    console.warn(`⚠️ PettyCashStore.flush — entrada ${entry.key} falló (intento ${attempts}/${MAX_FLUSH_ATTEMPTS}), se reintentará:`, e);
                    try { await indexedDBService.update(OUTBOX, updated); } catch { /* noop */ }
                    break; // fallo transitorio: cortar y reintentar en el próximo flush
                }
            }
        } finally {
            _flushing = false;
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
    });
}

export default PettyCashStore;
