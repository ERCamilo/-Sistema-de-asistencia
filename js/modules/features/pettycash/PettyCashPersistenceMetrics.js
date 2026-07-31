/**
 * Local, privacy-safe operation counters for Petty Cash persistence.
 *
 * The diagnostic deliberately stores aggregate counters only. Document ids,
 * receipt data, merchant names and amounts are never retained or exported.
 */

const STORAGE_KEY = 'pettyCashPersistenceMetrics:v1';
const RETENTION_DAYS = 7;

const ALLOWED = {
    operation: new Set(['read', 'save', 'delete', 'subscribe', 'queue', 'flush', 'mirror']),
    collection: new Set(['projects', 'periods', 'movements', 'outbox', 'mirror']),
    stage: new Set([
        'requested',
        'local-success',
        'local-failure',
        'queue-success',
        'queue-failure',
        'cloud-attempt',
        'cloud-success',
        'cloud-failure',
        'snapshot',
        'compacted',
        'retry',
        'dead',
        'skipped'
    ]),
    source: new Set([
        'unspecified',
        'manual',
        'receipt-queue',
        'receipt-ocr',
        'receipt-confirm',
        'receipt-backup',
        'live-sync',
        'startup',
        'online',
        'retry',
        'migration',
        'identity-normalization'
    ]),
    status: new Set(['ok', 'error', 'offline', 'skipped'])
};

function dimension(group, value, fallback = 'other') {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED[group].has(normalized) ? normalized : fallback;
}

function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function emptyState() {
    return { version: 1, updatedAt: 0, days: {} };
}

function normalizeState(value) {
    if (!value || value.version !== 1 || !value.days || typeof value.days !== 'object') {
        return emptyState();
    }
    return {
        version: 1,
        updatedAt: Number(value.updatedAt) || 0,
        days: { ...value.days }
    };
}

function withTotals(metricsState) {
    let operations = 0;
    let durationMs = 0;
    let maxDurationMs = 0;
    Object.values(metricsState.days).forEach((day) => {
        Object.values(day?.counters || {}).forEach((count) => {
            operations += Number(count) || 0;
        });
        durationMs += Number(day?.durationMs) || 0;
        maxDurationMs = Math.max(maxDurationMs, Number(day?.maxDurationMs) || 0);
    });
    return {
        ...metricsState,
        totals: { operations, durationMs, maxDurationMs }
    };
}

function defaultStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

export function createPettyCashPersistenceMetrics({
    storage = defaultStorage(),
    now = () => Date.now()
} = {}) {
    function read() {
        if (!storage) return emptyState();
        try {
            return normalizeState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'));
        } catch {
            return emptyState();
        }
    }

    function prune(metricsState, timestamp) {
        const cutoff = new Date(timestamp);
        cutoff.setUTCHours(0, 0, 0, 0);
        cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
        const cutoffKey = dayKey(cutoff.getTime());
        Object.keys(metricsState.days).forEach((key) => {
            if (key < cutoffKey) delete metricsState.days[key];
        });
        return metricsState;
    }

    function persist(metricsState) {
        if (!storage) return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(metricsState));
        } catch {
            // Metrics must never interrupt persistence.
        }
    }

    return {
        record(event = {}) {
            const timestamp = Number(now()) || Date.now();
            const metricsState = prune(read(), timestamp);
            const key = [
                dimension('operation', event.operation),
                dimension('collection', event.collection),
                dimension('stage', event.stage),
                event.source ? dimension('source', event.source) : 'unspecified',
                event.status ? dimension('status', event.status) : 'ok'
            ].join('|');
            const date = dayKey(timestamp);
            const count = Math.max(1, Math.floor(Number(event.count) || 1));
            const durationMs = Math.max(0, Math.round(Number(event.durationMs) || 0));
            const day = metricsState.days[date] || { counters: {}, durationMs: 0, maxDurationMs: 0 };
            day.counters[key] = (Number(day.counters[key]) || 0) + count;
            day.durationMs = (Number(day.durationMs) || 0) + durationMs;
            day.maxDurationMs = Math.max(Number(day.maxDurationMs) || 0, durationMs);
            metricsState.days[date] = day;
            metricsState.updatedAt = timestamp;
            persist(metricsState);
        },

        snapshot() {
            const timestamp = Number(now()) || Date.now();
            return withTotals(prune(read(), timestamp));
        },

        exportJson() {
            return JSON.stringify(this.snapshot(), null, 2);
        },

        reset() {
            try { storage?.removeItem(STORAGE_KEY); } catch { /* noop */ }
        }
    };
}

export const PettyCashPersistenceMetrics = createPettyCashPersistenceMetrics();

if (typeof window !== 'undefined') {
    window.getPettyCashPersistenceMetrics = () => PettyCashPersistenceMetrics.snapshot();
    window.exportPettyCashPersistenceMetrics = () => PettyCashPersistenceMetrics.exportJson();
    window.resetPettyCashPersistenceMetrics = () => PettyCashPersistenceMetrics.reset();
}

export default PettyCashPersistenceMetrics;
