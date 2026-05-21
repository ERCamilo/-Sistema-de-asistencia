/**
 * 🛡️ SWVersion — query the active Service Worker for its CACHE_VERSION.
 *
 * The SW handler in sw.js responds to a `'GET_VERSION'` message with
 * `{ version: CACHE_VERSION }` over a MessagePort. This helper wraps the
 * postMessage dance into a Promise, and also exposes a fire-and-forget
 * `monitorSWVersion(state, render)` that writes the result back to
 * `state.swVersion` and triggers a render so any UI bound to it updates.
 *
 * Safe in non-SW environments: returns null instead of throwing when there
 * is no controller (e.g. unit tests, file:// protocol, hard-reload race).
 */

/**
 * One-shot query. Resolves with the version string or null if the SW is
 * unreachable / doesn't reply within `timeoutMs`. Never rejects — keeps
 * caller code free of try/catch boilerplate for what is purely a cosmetic
 * lookup.
 */
export function querySWVersion(timeoutMs = 2000) {
    return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
            return resolve(null);
        }
        const controller = navigator.serviceWorker.controller;
        if (!controller) return resolve(null);

        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), timeoutMs);
        channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event?.data?.version || null);
        };
        try {
            controller.postMessage('GET_VERSION', [channel.port2]);
        } catch {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

/**
 * Start watching the active SW and write its version into state. Re-queries
 * whenever a new SW activates (i.e. after a deploy / cache bump) so the
 * displayed value never goes stale.
 *
 * @param {object} state    AppState proxy or any object with assignable props
 * @param {function} render optional re-render trigger
 */
export function monitorSWVersion(state, render) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const update = async () => {
        const v = await querySWVersion();
        if (v && state) {
            state.swVersion = v;
            if (typeof render === 'function') render();
        }
    };

    // First lookup once the controller is ready (or now if it already is).
    if (navigator.serviceWorker.controller) {
        update();
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // New SW just took over — fetch its version, which will differ.
        update();
    });
}
