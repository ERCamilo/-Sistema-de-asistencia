import { prepareReceiptForOcr } from './PettyCashPhoto.js';
import {
    normalizeReceiptOcr,
    applyReceiptOcrToMovement,
    requestReceiptOcr,
    receiptRetryState
} from './PettyCashReceiptOCR.js';

const AUTO_QUEUE_STATES = new Set([
    'queued',
    'retry-wait',
    'waiting-network',
    'waiting-session',
    'processing'
]);
const MANUAL_QUEUE_STATES = new Set([...AUTO_QUEUE_STATES, 'paused']);

function isOnlineByDefault() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}
export function createReceiptQueueProcessor({
    receiptStore,
    getMovement,
    saveMovement,
    getIdToken,
    getOcrUrl,
    allowedCategories = [],
    isOnline = isOnlineByDefault,
    now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
    onProgress = () => {}
}) {
    let running = false;
    let retryTimer = null;

    const notify = async () => {
        try { await onProgress(); } catch (_) { /* UI opcional */ }
    };

    const clearScheduledRetry = () => {
        if (retryTimer !== null) clearTimer(retryTimer);
        retryTimer = null;
    };

    const scheduleNextRetry = async () => {
        clearScheduledRetry();
        const jobs = await receiptStore.listReceiptJobs().catch(() => []);
        const currentTime = now();
        const next = jobs
            .filter((job) => job.queueStatus === 'retry-wait' && Number(job.nextRetryAt) > currentTime)
            .map((job) => Number(job.nextRetryAt))
            .sort((a, b) => a - b)[0];
        if (!next) return;
        retryTimer = setTimer(() => {
            retryTimer = null;
            processQueue().catch(() => null);
        }, Math.max(0, next - currentTime));
    };

    const processQueue = async ({ force = false, txIds = null } = {}) => {
        if (running) return { running: true, processed: 0, failed: 0, skipped: 0 };
        running = true;
        clearScheduledRetry();
        const result = { running: false, processed: 0, failed: 0, skipped: 0 };
        try {
            const wantedIds = Array.isArray(txIds) && txIds.length ? new Set(txIds) : null;
            const jobs = await receiptStore.listReceiptJobs();
            const currentTime = now();
            const allowedStates = force ? MANUAL_QUEUE_STATES : AUTO_QUEUE_STATES;
            const eligible = jobs.filter((job) => {
                if (!allowedStates.has(job.queueStatus)) return false;
                if (wantedIds && !wantedIds.has(job.txId)) return false;
                if (!force && job.queueStatus === 'retry-wait' && Number(job.nextRetryAt) > currentTime) return false;
                return job.ocrStatus !== 'extracted' && job.ocrStatus !== 'needs-review';
            });
            if (!eligible.length) return result;

            if (!isOnline()) {
                for (const job of eligible) {
                    await receiptStore.updateReceiptJob(job.txId, {
                        queueStatus: 'waiting-network',
                        lastError: 'Sin conexión'
                    });
                }
                await notify();
                return result;
            }

            let idToken;
            try {
                idToken = await getIdToken();
                if (!idToken) throw new Error('Sesión no disponible');
            } catch (error) {
                for (const job of eligible) {
                    await receiptStore.updateReceiptJob(job.txId, {
                        queueStatus: 'waiting-session',
                        lastError: error.message || 'Sesión no disponible'
                    });
                }
                await notify();
                return result;
            }

            for (const job of eligible) {
                const movement = getMovement(job.txId);
                if (!movement || !job.originalBlob) {
                    result.skipped++;
                    continue;
                }
                await receiptStore.updateReceiptJob(job.txId, {
                    queueStatus: 'processing',
                    ocrStatus: 'processing',
                    lastError: null
                });
                await notify();

                try {
                    const prepared = await prepareReceiptForOcr(job.originalBlob);
                    const raw = await requestReceiptOcr({
                        url: getOcrUrl(),
                        idToken,
                        fileDataUrl: prepared.fileDataUrl,
                        mimeType: job.originalType || prepared.mimeType,
                        fileName: job.originalName || prepared.fileName
                    });
                    const normalized = normalizeReceiptOcr(raw, allowedCategories);
                    applyReceiptOcrToMovement(movement, normalized);
                    movement.reviewPending = true;
                    movement.updatedAt = now();
                    await saveMovement(movement);
                    await receiptStore.updateReceiptJob(job.txId, {
                        queueStatus: 'awaiting-review',
                        ocrStatus: normalized.got ? 'extracted' : 'needs-review',
                        attempts: 0,
                        nextRetryAt: null,
                        lastError: null,
                        ocrCompletedAt: now()
                    });
                    result.processed++;
                } catch (error) {
                    const retry = receiptRetryState(job.attempts, {
                        online: isOnline(),
                        now: now()
                    });
                    await receiptStore.updateReceiptJob(job.txId, {
                        ...retry,
                        ocrStatus: 'failed',
                        lastError: error.message || 'Error de OCR'
                    });
                    result.failed++;
                }
                await notify();
            }
            return result;
        } finally {
            running = false;
            await scheduleNextRetry();
        }
    };

    return {
        process: processQueue,
        scheduleNextRetry,
        cancelScheduledRetry: clearScheduledRetry,
        isRunning: () => running
    };
}
