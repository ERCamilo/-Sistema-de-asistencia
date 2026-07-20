export const MIRROR_CADENCE_MS = 5 * 60 * 1000;

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
        if (timer !== null) return;
        const elapsed = Math.max(0, now() - lastEmissionAt);
        timer = schedule(() => {
            timer = null;
            emitPending().catch(onError);
        }, Math.max(0, intervalMs - elapsed));
    };

    return {
        offer(snapshot, { force = false } = {}) {
            pendingSnapshot = snapshot;
            hasPending = true;
            const isDue = lastEmissionAt === null || now() - lastEmissionAt >= intervalMs;
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
