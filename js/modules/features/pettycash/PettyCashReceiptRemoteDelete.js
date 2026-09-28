/**
 * M3 — borrado remoto de comprobantes, durable y reintentable.
 *
 * Al eliminar un movimiento el comprobante local se borra en el acto, pero el
 * respaldo en Supabase es evidencia financiera: se pide un borrado LÓGICO y
 * condicionado a la versión que este dispositivo subió (ver
 * supabase/functions/petty-cash-receipt/receipt-actions.js). La petición vive
 * en `pettyCashMirrorOutbox` (misma cola por usuario que el espejo, con su
 * bloqueo entre pestañas y la puerta de restauración desconectada) con
 * `kind: 'receipt-delete'`, así no hace falta otro store de IndexedDB.
 *
 * - Idempotente: repetir la petición o recibir «ya borrado»/«no existe» cierra
 *   la entrada.
 * - Un comprobante nuevo con el mismo txId cancela el borrado pendiente, y el
 *   servidor rechaza (409) borrar una versión distinta de la pedida.
 * - Sin la función actualizada (INVALID_ACTION) la entrada espera sin gastar
 *   intentos: es un estado de despliegue, no un error del dato.
 */
import { deleteReceiptBackup } from './PettyCashReceiptBackup.js';

export const RECEIPT_DELETE_KIND = 'receipt-delete';
export const RECEIPT_DELETE_STORE = 'pettyCashMirrorOutbox';
export const RECEIPT_DELETE_MAX_ATTEMPTS = 20;
const MOVEMENTS_STORE = 'pettyCashMovements';
const BACKEND_WAIT_MS = 6 * 60 * 60 * 1000;

export function receiptDeleteEntryId(txId) {
    return `${RECEIPT_DELETE_KIND}:${txId}`;
}

export function isReceiptDeleteEntry(entry) {
    return entry?.kind === RECEIPT_DELETE_KIND;
}

function backoffMs(attempts) {
    return Math.min(BACKEND_WAIT_MS, 30_000 * (2 ** Math.min(attempts, 10)));
}

// Hay algo en la nube (o puede haberlo) solo si la subida terminó o estaba en
// curso cuando se borró el movimiento.
function remoteMayExist(receipt) {
    return !!receipt && (
        receipt.uploadStatus === 'uploaded' ||
        receipt.uploadStatus === 'uploading' ||
        receipt.uploadStatus === 'retry-wait' ||
        !!receipt.remoteVersion ||
        !!receipt.remotePath
    );
}

/** Encola (o reemplaza) el borrado remoto del comprobante `txId`. */
export async function enqueueReceiptRemoteDelete({ db, txId, receipt, ownerUid = null, now = Date.now() }) {
    if (!txId || !remoteMayExist(receipt)) return null;
    const entry = {
        id: receiptDeleteEntryId(txId),
        kind: RECEIPT_DELETE_KIND,
        txId: String(txId),
        // Versión exacta que subió este dispositivo; si no se conoce (subida en
        // curso o registro anterior a M3) se consulta antes de borrar.
        ifUploadedAt: receipt.remoteVersion || null,
        ownerUid,
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextRetryAt: 0,
        ts: now
    };
    await db.update(RECEIPT_DELETE_STORE, entry);
    return entry;
}

/** Un comprobante nuevo para el mismo movimiento anula el borrado pendiente. */
export async function cancelReceiptRemoteDelete({ db, txId }) {
    if (!txId) return false;
    const current = await db.get(RECEIPT_DELETE_STORE, receiptDeleteEntryId(txId)).catch(() => null);
    if (!isReceiptDeleteEntry(current)) return false;
    await db.delete(RECEIPT_DELETE_STORE, current.id);
    return true;
}

export async function listReceiptRemoteDeletes(db) {
    const all = (await db.getAll(RECEIPT_DELETE_STORE).catch(() => [])) || [];
    return all.filter(isReceiptDeleteEntry);
}

// Solo cierra la entrada si nadie la reemplazó mientras la petición volaba.
async function removeIfUnchanged(db, entry) {
    const current = await db.get(RECEIPT_DELETE_STORE, entry.id).catch(() => null);
    if (current && current.ts === entry.ts) await db.delete(RECEIPT_DELETE_STORE, entry.id);
}

async function resolveVersion({ entry, lookup }) {
    if (entry.ifUploadedAt) return entry.ifUploadedAt;
    try {
        const remote = await lookup(entry.txId);
        return remote?.receipt?.uploaded_at || null;
    } catch (error) {
        // Nada que borrar: no existe o ya está borrado.
        if (error?.code === 'RECEIPT_NOT_FOUND' || error?.code === 'RECEIPT_DELETED') return '';
        throw error;
    }
}

/**
 * Drena las peticiones de `uid`. `remove(entry, version)` llama a la función
 * (deleteReceiptBackup por defecto). Devuelve un resumen para diagnóstico.
 */
export async function drainReceiptRemoteDeletes({
    db,
    uid,
    remove,
    lookup,
    now = () => Date.now()
}) {
    const summary = { done: 0, retry: 0, dead: 0, waiting: 0, outcomes: [] };
    if (!uid) return summary;
    const entries = (await listReceiptRemoteDeletes(db))
        // Solo la cuenta dueña: una petición sin dueño conocido nunca se envía
        // con la sesión de otra persona.
        .filter(entry => entry.status === 'pending' && entry.ownerUid === uid)
        .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    for (const entry of entries) {
        if (Number(entry.nextRetryAt) > now()) { summary.waiting++; continue; }
        // Nunca se borra el comprobante de un movimiento que existe en este
        // dispositivo (restaurado de un respaldo, recreado o aún sin retirar).
        // Si el movimiento se guardó después de la petición, esta caducó.
        const live = await db.get(MOVEMENTS_STORE, entry.txId).catch(() => null);
        if (live) {
            if (Number(live.updatedAt) > Number(entry.ts)) {
                await removeIfUnchanged(db, entry);
                summary.outcomes.push([entry.txId, 'movement-restored']);
            } else {
                summary.waiting++;
            }
            continue;
        }
        try {
            const version = await resolveVersion({ entry, lookup });
            const result = version === ''
                ? { done: true, outcome: 'absent' }
                : await remove(entry, version);
            await removeIfUnchanged(db, entry);
            summary.done++;
            summary.outcomes.push([entry.txId, result.outcome]);
        } catch (error) {
            const current = await db.get(RECEIPT_DELETE_STORE, entry.id).catch(() => null);
            if (!current || current.ts !== entry.ts) continue;   // reemplazada o cancelada
            if (error?.code === 'INVALID_ACTION') {
                await db.update(RECEIPT_DELETE_STORE, {
                    ...current, lastError: 'La función de comprobantes aún no admite borrar (pendiente de despliegue).',
                    nextRetryAt: now() + BACKEND_WAIT_MS
                });
                summary.waiting++;
                continue;
            }
            const attempts = (Number(current.attempts) || 0) + 1;
            const dead = error?.retryable === false || attempts >= RECEIPT_DELETE_MAX_ATTEMPTS;
            await db.update(RECEIPT_DELETE_STORE, {
                ...current,
                attempts,
                lastError: String(error?.message || error),
                status: dead ? 'dead' : 'pending',
                nextRetryAt: dead ? 0 : now() + backoffMs(attempts)
            });
            if (dead) summary.dead++; else summary.retry++;
        }
    }
    return summary;
}

/** Cableado por defecto contra la función vía n8n. */
export function receiptDeleteTransport({ url, idToken, fetchImpl = globalThis.fetch, lookupReceipt }) {
    return {
        remove: (entry, version) => deleteReceiptBackup({ url, idToken, txId: entry.txId, ifUploadedAt: version, fetchImpl }),
        lookup: txId => lookupReceipt({ url, idToken, txId, fetchImpl })
    };
}
