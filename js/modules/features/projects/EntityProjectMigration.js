/**
 * 🏷️ EntityProjectMigration (F1.4/M2) — sello local one-time de `projectId`
 * sobre empleados, puestos y líderes (docs/fase-0/F0.4-plan-migracion.md §3 M2).
 *
 * Contrato:
 * - Flag OFF ⇒ { skipped:true } SIN tocar nada (guard primero; defensa en
 *   profundidad: ProjectsBoot ya corta antes bajo OFF).
 * - Backup-first (regla #9 del roadmap F0.4): intenta snapshot cloud con
 *   reason 'pre-migration' reusando EXACTAMENTE la API que usan RestoreUI y
 *   MaintenanceUI (globalThis.createFirebaseSnapshot), estilo read-only y SOLO
 *   si hay sesión Firebase (window.currentUser). Sin sesión/offline/fallo ⇒
 *   backup:'unavailable' + console.warn y PROCEDE igual.
 *   Justificación documentada: el sello es puramente ADITIVO (agrega la clave
 *   projectId; nunca borra ni transforma datos) y reversible por flag (F0.4
 *   §6: flag off ⇒ sellos inertes). El peor caso es un campo extra que el
 *   código legacy ignora — eso no justifica bloquear el arranque.
 * - Idempotente + resumible: marca de progreso en LS `migration.projectStamp.v1`
 *   = {v:1, done:{employees,positions,leaders}}. Stores marcados done se
 *   saltan en re-corridas; si un store quedó a medio escribir (marker sin
 *   setear), la re-corrida re-escanea y el check de ausencia hace que los ya
 *   estampados se salten sin doble trabajo.
 * - Batched: chunks de ~50 registros con yield entre chunks (no bloquear UI).
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { defaultProjectService } from './DefaultProject.js';

export const PROJECT_STAMP_MARKER_KEY = 'migration.projectStamp.v1';
export const PROJECT_STAMP_CHUNK_SIZE = 50;

// F0.4 §4: este slice M2 cubre empleados/puestos/líderes; asistencia y cierres
// de nómina llevan su propio sello en sus fases específicas.
const ENTITY_STORES = ['employees', 'positions', 'leaders'];

function freshMarker() {
    return { v: 1, done: { employees: false, positions: false, leaders: false } };
}

function readMarker() {
    try {
        const raw = localStorage.getItem(PROJECT_STAMP_MARKER_KEY);
        if (!raw) return freshMarker();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== 1 || typeof parsed.done !== 'object') return freshMarker();
        return { v: 1, done: { ...freshMarker().done, ...parsed.done } };
    } catch (_) {
        return freshMarker(); // marker corrupto ⇒ correr de nuevo (idempotente)
    }
}

function writeMarker(marker) {
    try {
        localStorage.setItem(PROJECT_STAMP_MARKER_KEY, JSON.stringify(marker));
    } catch (_) { /* sin persistencia: la re-corrida repite trabajo inofensivo */ }
}

// F0.4 §2: ausente/null ⇒ predeterminado. Sin id no hay keyPath posible.
function needsStamp(record) {
    return !!record && typeof record === 'object'
        && record.id != null
        && record.projectId == null;
}

const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Backup pre-migración (misma API que RestoreUI/MaintenanceUI, read-only):
 * devuelve 'ok' | 'unavailable'. NUNCA lanza: un backup fallido se registra
 * y la migración procede (ver justificación en el header del módulo).
 */
async function attemptPreMigrationBackup(snapshotFn) {
    const fn = snapshotFn ?? (typeof globalThis.createFirebaseSnapshot === 'function'
        ? globalThis.createFirebaseSnapshot : null);
    const hasSession = typeof window !== 'undefined' && !!window.currentUser;
    if (!fn || !hasSession) {
        console.warn('⚠️ M2: snapshot pre-migration unavailable (sin sesión/offline). Se procede: sello aditivo y reversible por flag.');
        return 'unavailable';
    }
    try {
        await fn('pre-migration');
        return 'ok';
    } catch (error) {
        console.warn('⚠️ M2: snapshot pre-migration falló; se procede (sello aditivo/reversible):', error?.message || error);
        return 'unavailable';
    }
}

/**
 * Sello local M2. Devuelve summary {stamped, scanned, perStore, backup};
 * con flag OFF devuelve {skipped:true} sin tocar nada.
 */
export async function migrateEntityProjectStamps({
    idb = indexedDBService,
    defaults = defaultProjectService,
    stores = ENTITY_STORES,
    chunkSize = PROJECT_STAMP_CHUNK_SIZE,
    snapshotFn = null
} = {}) {
    if (!isProjectsEnabled()) {
        return { skipped: true };
    }

    const defaultProject = await defaults.ensureDefaultProject();
    if (!defaultProject?.id) {
        console.warn('⚠️ M2: sin proyecto predeterminado resoluble; no se estampa nada en esta corrida.');
        return { skipped: false, stamped: 0, scanned: 0, perStore: {}, backup: 'unavailable' };
    }

    // Backup-first: NINGUNA escritura antes de este punto (F0.4 regla #9).
    const backup = await attemptPreMigrationBackup(snapshotFn);

    const defaultId = defaultProject.id;
    const perStore = {};
    let stamped = 0;
    let scanned = 0;
    const marker = readMarker();

    for (const storeName of stores) {
        if (marker.done[storeName]) continue; // resume idempotente por store

        const records = await idb.getAll(storeName);
        const pending = records.filter(needsStamp);
        for (let i = 0; i < pending.length; i += chunkSize) {
            const chunk = pending.slice(i, i + chunkSize)
                .map(record => ({ ...record, projectId: defaultId }));
            await idb.batchUpdate(storeName, chunk);
            await yieldToUi(); // ceder el event loop entre chunks
        }
        perStore[storeName] = { scanned: records.length, stamped: pending.length };
        scanned += records.length;
        stamped += pending.length;

        // Marca POR STORE, persistida al cerrar cada uno: una interrupción a
        // mitad de corrida deja los stores previos marcados y el actual sin
        // marcar ⇒ la re-corrida sólo completa lo faltante.
        marker.done[storeName] = true;
        writeMarker(marker);
    }

    return { skipped: false, stamped, scanned, perStore, backup };
}

export default migrateEntityProjectStamps;
