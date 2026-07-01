/**
 * 🩺 SyncErrorClassifier.js
 *
 * Clasifica un error de sincronización con la nube como TRANSITORIO (vale la
 * pena reintentar — red caída, timeout) o PERMANENTE (jamás se va a resolver
 * solo reintentando — permisos, argumento inválido, documento inexistente).
 *
 * Usado por MainSyncStore.flush() para decidir si una entrada de la bandeja
 * de pendientes se marca 'dead' de inmediato (permanente) o sigue 'pending'
 * hasta agotar MAX_FLUSH_ATTEMPTS (transitorio) — así un error que nunca va a
 * resolverse no gasta 5 ciclos de reintento bloqueando el resto de la cola.
 */

// Códigos de error de Firestore que NUNCA se resuelven reintentando.
export const PERMANENT_CODES = [
    'permission-denied',
    'invalid-argument',
    'failed-precondition',
    'not-found'
];

/**
 * @param {*} err - error capturado (puede ser null/undefined/sin `code`)
 * @returns {'permanent'|'transient'}
 */
export function classifySyncError(err) {
    const code = err?.code;
    return PERMANENT_CODES.includes(code) ? 'permanent' : 'transient';
}

/**
 * Decisión pura del próximo estado de una entrada del outbox tras un fallo.
 *
 * @param {{attempts?: number}} entry - entrada actual del outbox
 * @param {*} err - error del intento que acaba de fallar
 * @param {number} maxAttempts - MAX_FLUSH_ATTEMPTS
 * @returns {{status: 'pending'|'dead', attempts: number, lastError: string}}
 */
export function nextEntryState(entry, err, maxAttempts) {
    const attempts = (entry?.attempts || 0) + 1;
    const isPermanent = classifySyncError(err) === 'permanent';
    const status = (isPermanent || attempts >= maxAttempts) ? 'dead' : 'pending';
    const lastError = String(err?.message ?? err?.code ?? 'Error desconocido');
    return { status, attempts, lastError };
}
