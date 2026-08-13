/**
 * WeatherController — handlers for the chip + panel.
 *
 * Side-effects: mutates state.weather, refreshes the cache, persists via
 * saveApplicationData. Exposes window.toggleWeatherPanel /
 * window.closeWeatherPanel for the data-app-fn dispatcher.
 */

import { state, stateManager } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { fetchCurrent, fetchForecast, fetchHourly } from './WeatherService.js';
import {
    normalizeWeatherSummaryMetrics,
    updateWeatherSummaryMetric
} from './WeatherSummaryMetrics.js';
import { getWeatherRuntimeState, updateWeatherRuntimeState } from './WeatherRuntime.js';

function ensureWeatherState(currentState = state) {
    if (!currentState.weather) currentState.weather = {};
    if (typeof currentState.weather.panelOpen === 'undefined') currentState.weather.panelOpen = false;
    return currentState.weather;
}

function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function setWeatherLoadState(loadState, errorMessage = '') {
    updateWeatherRuntimeState(state, { loadState, errorMessage });
}

/**
 * One-shot refresh — read current + 5-day forecast through the service.
 * The service handles caching internally, so calling this on every tab
 * mount is fine: hits the API only when the cache is stale.
 *
 * Async because the service layer now supports real HTTP adapters.
 * UI stays responsive: components read cache synchronously, and we
 * trigger a re-render after the fetch completes with fresh data.
 *
 * @returns {boolean} true if anything changed (cache miss + new data)
 */
export async function refreshWeather(opts = {}) {
    if (!isOnline()) {
        setWeatherLoadState('offline');
        render();
        return false;
    }

    ensureWeatherState();
    setWeatherLoadState('loading');
    render();
    let changed = false;
    try {
        const prevCurrent = state.weather.cache?.current?.fetchedAt;
        await fetchCurrent(state, { force: !!opts.force });
        if (state.weather.cache?.current?.fetchedAt !== prevCurrent) changed = true;

        const prevForecast = state.weather.cache?.forecast?.fetchedAt;
        await fetchForecast(state, 5, { force: !!opts.force });
        if (state.weather.cache?.forecast?.fetchedAt !== prevForecast) changed = true;

        const prevHourly = state.weather.cache?.hourly?.fetchedAt;
        await fetchHourly(state, 24, 3, { force: !!opts.force });
        if (state.weather.cache?.hourly?.fetchedAt !== prevHourly) changed = true;

        setWeatherLoadState('ready');
    } catch (err) {
        // Never let a weather error break the rest of the UI. Preserve the
        // cached snapshot and provide an accessible, actionable status instead.
        setWeatherLoadState('error', 'No se pudo actualizar el clima. Intenta nuevamente cuando tengas conexión.');
        if (window.debug) window.debug.log(`refreshWeather error: ${err.message}`);
    }
    if (changed || opts.force) saveApplicationData();
    // Always project the terminal ready/error state. A cache hit changes no
    // timestamps, but the viewer must still leave aria-busy="true".
    render();
    return changed;
}

/**
 * Starts the initial refresh only after persisted settings are available.
 * It deliberately uses the saved WeatherService location and never requests
 * browser geolocation. Scheduling through a microtask keeps first paint free
 * of network work and the runtime flag prevents a later initializer from
 * duplicating the same refresh.
 */
export function scheduleInitialWeatherRefresh({
    currentState = state,
    refresh = refreshWeather,
    online = isOnline()
} = {}) {
    if (currentState?.settings?.weatherEnabled !== true) return false;

    const runtime = getWeatherRuntimeState(currentState);
    if (!online) {
        updateWeatherRuntimeState(currentState, { loadState: 'offline', errorMessage: '' });
        if (currentState === state) render();
        return false;
    }
    if (runtime.initialRefreshScheduled) return false;

    updateWeatherRuntimeState(currentState, {
        initialRefreshScheduled: true,
        loadState: 'loading',
        errorMessage: ''
    });
    Promise.resolve().then(() => refresh());
    return true;
}

/**
 * Triggered by the reload button. Bypasses the cache and refreshes the UI
 * with loading feedback.
 */
export async function forceRefreshWeather() {
    ensureWeatherState();
    const runtime = getWeatherRuntimeState(state);
    if (runtime.isRefreshing) return;
    
    updateWeatherRuntimeState(state, { isRefreshing: true });
    render();
    
    try {
        await refreshWeather({ force: true });
    } finally {
        updateWeatherRuntimeState(state, { isRefreshing: false });
        render();
    }
}

export function toggleWeatherPanel() {
    ensureWeatherState();
    stateManager.batchSetState(() => {
        state.weather.panelOpen = !state.weather.panelOpen;
    });
    // Opening the panel triggers a freshness check — fire-and-forget.
    // The initial render happens immediately with cached data; when the
    // fetch completes, refreshWeather() calls render() again with fresh data.
    if (state.weather.panelOpen) refreshWeather();
}

/**
 * Toggle the inline expanded view in WeatherBar (replaces the legacy
 * color-legend bar). Distinct from panelOpen, which is for the floating
 * chip-panel still available for other surfaces.
 */
export function toggleWeatherExpanded() {
    stateManager.batchSetState(() => {
        state.weatherExpanded = !state.weatherExpanded;
    });
    // Fire-and-forget: render immediately, update when fetch resolves.
    if (state.weatherExpanded) refreshWeather();
}

export function toggleWeatherForecastExpanded() {
    stateManager.setState({
        weatherForecastExpanded: !state.weatherForecastExpanded
    });
}

export function toggleWeatherMetricEditor() {
    stateManager.setState({
        weatherMetricEditorOpen: !state.weatherMetricEditorOpen
    });
}

export function setWeatherSummaryMetric(slot, metricId) {
    const currentMetrics = normalizeWeatherSummaryMetrics(state.settings?.weatherSummaryMetrics);
    const nextMetrics = updateWeatherSummaryMetric(currentMetrics, slot, metricId);
    stateManager.setState({
        settings: {
            ...state.settings,
            weatherSummaryMetrics: nextMetrics,
            updatedAt: Date.now()
        }
    });
    saveApplicationData();
}

export function closeWeatherPanel() {
    ensureWeatherState();
    stateManager.batchSetState(() => {
        state.weather.panelOpen = false;
    });
}

/**
 * Close on outside-click. Installed once on document at boot. Uses the
 * `.weather-chip-host` class as the anchor — anything inside it (the chip
 * or the panel) counts as "inside". Mirrors the pattern of the date-picker
 * outside-click handler.
 */
function _installOutsideClickHandler() {
    if (typeof document === 'undefined') return;
    if (document._weatherOutsideHandlerInstalled) return;
    document._weatherOutsideHandlerInstalled = true;
    document.addEventListener('click', (e) => {
        if (!state.weather?.panelOpen) return;
        if (!document.body.contains(e.target)) return;
        if (e.target.closest('.weather-chip-host')) return;
        state.weather.panelOpen = false;
        render();
    });
}

function _installMetricChangeHandler() {
    if (typeof document === 'undefined') return;
    if (document._weatherMetricChangeHandlerInstalled) return;
    document._weatherMetricChangeHandlerInstalled = true;
    document.addEventListener('change', (event) => {
        const select = event.target.closest('[data-weather-metric-slot]');
        if (!select) return;
        setWeatherSummaryMetric(select.dataset.weatherMetricSlot, select.value);
    });
}

export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.toggleWeatherPanel = toggleWeatherPanel;
    window.closeWeatherPanel = closeWeatherPanel;
    window.toggleWeatherExpanded = toggleWeatherExpanded;
    window.toggleWeatherForecastExpanded = toggleWeatherForecastExpanded;
    window.toggleWeatherMetricEditor = toggleWeatherMetricEditor;
    window.setWeatherSummaryMetric = setWeatherSummaryMetric;
    window.refreshWeather = refreshWeather;
    window.forceRefreshWeather = forceRefreshWeather;
    _installOutsideClickHandler();
    _installMetricChangeHandler();
}
