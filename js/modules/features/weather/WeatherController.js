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

function ensureWeatherState() {
    if (!state.weather) state.weather = {};
    if (typeof state.weather.panelOpen === 'undefined') state.weather.panelOpen = false;
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
    ensureWeatherState();
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
    } catch (err) {
        // Never let a weather error break the rest of the UI. Log and move on.
        if (window.debug) window.debug.log(`refreshWeather error: ${err.message}`);
    }
    if (changed || opts.force) {
        saveApplicationData();
        render();
    }
    return changed;
}

/**
 * Triggered by the reload button. Bypasses the cache and refreshes the UI
 * with loading feedback.
 */
export async function forceRefreshWeather() {
    ensureWeatherState();
    if (state.weather.isRefreshing) return;
    
    state.weather.isRefreshing = true;
    render();
    
    try {
        await refreshWeather({ force: true });
    } finally {
        state.weather.isRefreshing = false;
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
    // Kick a refresh at boot so the chip has fresh data on first render.
    // Fire-and-forget: don't block module initialization on network.
    refreshWeather();
}
