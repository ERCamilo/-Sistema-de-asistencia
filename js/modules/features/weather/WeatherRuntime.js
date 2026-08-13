/**
 * Runtime-only weather UI state.
 *
 * Weather cache and provider selection belong in AppState because they survive
 * a reload. Fetch progress, errors and in-flight guards do not: keeping them
 * in a WeakMap prevents persistence from serializing stale operational state.
 */

const runtimeByState = new WeakMap();

function createRuntimeState() {
    return {
        loadState: 'idle',
        errorMessage: '',
        isRefreshing: false,
        initialRefreshScheduled: false
    };
}

export function getWeatherRuntimeState(currentState) {
    if (!currentState || (typeof currentState !== 'object' && typeof currentState !== 'function')) {
        throw new TypeError('Weather runtime state requires an object-backed application state');
    }

    let runtime = runtimeByState.get(currentState);
    if (!runtime) {
        runtime = createRuntimeState();
        runtimeByState.set(currentState, runtime);
    }
    return runtime;
}

export function updateWeatherRuntimeState(currentState, updates) {
    return Object.assign(getWeatherRuntimeState(currentState), updates);
}
