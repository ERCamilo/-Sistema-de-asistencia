export const MIRROR_CADENCE_MS = 5 * 60 * 1000;

export const MIRROR_CADENCE_PRESETS = {
    'instant': 0,
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    'manual': Infinity
};

export function getMirrorCadenceMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (value && MIRROR_CADENCE_PRESETS[value] !== undefined) return MIRROR_CADENCE_PRESETS[value];
    return MIRROR_CADENCE_MS;
}

/**
 * Trailing throttle for the full-state mirror. The first snapshot is emitted
 * immediately; later snapshots are coalesced until the cadence window ends.
 */
export function createMirrorCadence({
    emit,
    intervalMs = MIRROR_CADENCE_MS,
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
    onError = (error) => console.warn('Mirror cadence emission failed:', error)
} = {}) {
    if (typeof emit !== 'function') throw new TypeError('MirrorCadence requires an emit function');

    const getInterval = () => {
        const val = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
        return typeof val === 'number' ? val : MIRROR_CADENCE_MS;
    };

    let lastEmissionAt = null;
    let pendingSnapshot;
    let hasPending = false;
    let timer = null;

    const cancelTimer = () => {
        if (timer === null) return;
        cancel(timer);
        timer = null;
    };

    const emitPending = () => {
        if (!hasPending) return Promise.resolve(false);
        const snapshot = pendingSnapshot;
        pendingSnapshot = undefined;
        hasPending = false;
        lastEmissionAt = now();
        return Promise.resolve(emit(snapshot)).then(() => true);
    };

    const scheduleTrailing = () => {
        const interval = getInterval();
        if (!Number.isFinite(interval) || interval <= 0) return;
        if (timer !== null) return;
        const elapsed = Math.max(0, now() - lastEmissionAt);
        timer = schedule(() => {
            timer = null;
            emitPending().catch(onError);
        }, Math.max(0, interval - elapsed));
    };

    return {
        offer(snapshot, { force = false } = {}) {
            pendingSnapshot = snapshot;
            hasPending = true;
            const interval = getInterval();
            const isDue = lastEmissionAt === null || (Number.isFinite(interval) && (interval === 0 || now() - lastEmissionAt >= interval));
            if (force || isDue) {
                cancelTimer();
                return emitPending();
            }
            scheduleTrailing();
            return Promise.resolve(false);
        },

        flush(snapshot) {
            if (arguments.length > 0) {
                pendingSnapshot = snapshot;
                hasPending = true;
            }
            cancelTimer();
            return emitPending();
        },

        discard() {
            cancelTimer();
            pendingSnapshot = undefined;
            hasPending = false;
            lastEmissionAt = null;
        }
    };
}

export default createMirrorCadence;
