const INCOMPLETE_RECEIPT_STATES = new Set([
    'queued',
    'retry-wait',
    'waiting-network',
    'waiting-session',
    'processing',
    'paused'
]);

const COMPLETED_RECEIPT_STATES = new Set([
    'awaiting-review',
    'confirmed'
]);

/**
 * Formats an ISO calendar date without converting time zones.
 * Persisted values remain YYYY-MM-DD; only the rendered label changes.
 */
export function formatPettyCashDate(value, fallback = '—') {
    const text = String(value || '').trim();
    if (!text) return fallback;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (!match) return text;
    return `${match[3]}-${match[2]}-${match[1]}`;
}

export function isReceiptJobIncomplete(job) {
    return INCOMPLETE_RECEIPT_STATES.has(job?.queueStatus);
}

export function isEmptyReceiptPlaceholder(movement) {
    if (!movement || movement.type !== 'gasto' || !movement.hasReceipt) return false;
    const hasUsefulText = [
        movement.paidTo,
        movement.description,
        movement.ncf,
        movement.rncEmisor
    ].some((value) => String(value || '').trim());
    return Number(movement.amount) === 0 && !hasUsefulText;
}

/**
 * Produces an honest progress label for the currently selected gallery batch.
 * A paused/offline item is pending, not falsely described as processing.
 */
export function summarizeReceiptBatch(batch, jobs = []) {
    const total = Math.max(0, Number(batch?.total) || 0);
    if (!total) return null;

    const queuedIds = Array.isArray(batch?.queuedIds) ? batch.queuedIds : [];
    const wanted = new Set(queuedIds);
    const relatedJobs = jobs.filter((job) => wanted.has(job?.txId));
    const completed = relatedJobs.filter((job) =>
        COMPLETED_RECEIPT_STATES.has(job?.queueStatus)
    ).length;
    const failedToSave = Math.max(0, Number(batch?.failedToSave) || 0);
    const remaining = Math.max(0, total - completed - failedToSave);
    const waiting = relatedJobs.some((job) =>
        ['waiting-network', 'waiting-session', 'paused', 'retry-wait'].includes(job?.queueStatus)
    );

    let label = `${completed}/${total} procesadas`;
    if (remaining > 0) {
        label += waiting
            ? ` · ${remaining} pendiente${remaining === 1 ? '' : 's'}`
            : ` · ${remaining} aún procesándose`;
    }
    if (failedToSave > 0) {
        label += ` · ${failedToSave} no se pudo${failedToSave === 1 ? '' : 'ieron'} guardar`;
    }

    return {
        label,
        completed,
        remaining,
        failedToSave,
        finished: remaining === 0
    };
}
