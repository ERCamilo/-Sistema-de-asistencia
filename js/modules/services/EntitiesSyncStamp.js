/**
 * 🏷️ EntitiesSyncStamp.js (Fase 2, U4)
 *
 * Marca de agua persistente (localStorage) de la ÚLTIMA subida de entidades
 * confirmada — la escribe PersistenceService cuando una entrada 'entities'
 * del outbox se sube con éxito. Alimenta el badge "pendiente de subir" del
 * ledger de préstamos: un préstamo con updatedAt POSTERIOR a la última
 * subida confirmada tiene cambios que todavía no llegaron a la nube.
 *
 * Se estampa con el `ts` de la ENTRADA del outbox subida (momento del
 * enqueue = momento de la foto del snapshot), NO con Date.now() del flush:
 * lo actualizado después del enqueue no estaba en esa foto y debe seguir
 * contando como pendiente. La marca solo AVANZA (un flush tardío de una
 * entrada vieja no retrocede badges ya confirmados).
 *
 * localStorage y no memoria: el badge debe sobrevivir a un F5 — el outbox
 * (IndexedDB) también sobrevive, así que "pendiente" sigue siendo verdad
 * hasta que el drenado confirme.
 */

const STORAGE_KEY = 'attendance-entities-sync-ok';

/** @returns {number} timestamp de la última subida confirmada, o 0 si nunca. */
export function getLastEntitiesSyncOk() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (_) {
        return 0;
    }
}

/** Registra una subida confirmada. Solo avanza; no-op con valores no finitos. */
export function recordEntitiesSyncOk(ts) {
    if (!Number.isFinite(ts)) return;
    if (ts <= getLastEntitiesSyncOk()) return;
    try {
        localStorage.setItem(STORAGE_KEY, String(ts));
    } catch (_) {
        // localStorage lleno/no disponible: perder la marca es aceptable
        // (el badge queda conservador — muestra "pendiente" de más, nunca
        // esconde un pendiente real).
    }
}

/**
 * ¿Un registro con este updatedAt tiene cambios sin confirmar en la nube?
 * @param {*} updatedAt
 * @returns {boolean}
 */
export function isPendingUpload(updatedAt) {
    if (!Number.isFinite(updatedAt)) return false;
    return updatedAt > getLastEntitiesSyncOk();
}

/** Utilidad de test: borra la marca. */
export function clearEntitiesSyncStamp() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
}

export default { getLastEntitiesSyncOk, recordEntitiesSyncOk, isPendingUpload, clearEntitiesSyncStamp };
