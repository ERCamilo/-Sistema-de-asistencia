/**
 * 🌤️ WeatherController — handlers for the chip + panel.
 *
 * Side-effects: mutates state.weather, refreshes the cache, persists via
 * saveApplicationData. Exposes window.toggleWeatherPanel /
 * window.closeWeatherPanel for the data-app-fn dispatcher.
 */

import { state } from '../../core/AppState.js';
import { render } from '../../core/RenderManager.js';
import { saveApplicationData } from '../../services/PersistenceService.js';
import { fetchCurrent, fetchForecast } from './WeatherService.js';

function ensureWeatherState() {
    if (!state.weather) state.weather = {};
    if (typeof state.weather.panelOpen === 'undefined') state.weather.panelOpen = false;
}

/**
 * One-shot refresh — read current + 5-day forecast through the service.
 * The service handles caching internally, so calling this on every tab
 * mount is fine: hits the API only when the cache is stale.
 *
 * @returns {boolean} true if anything changed (cache miss + new data)
 */
export function refreshWeather() {
    ensureWeatherState();
    let changed = false;
    try {
        const prevCurrent = state.weather.cache?.current?.fetchedAt;
        fetchCurrent(state);
        if (state.weather.cache?.current?.fetchedAt !== prevCurrent) changed = true;

        const prevForecast = state.weather.cache?.forecast?.fetchedAt;
        fetchForecast(state, 5);
        if (state.weather.cache?.forecast?.fetchedAt !== prevForecast) changed = true;
    } catch (err) {
        // Never let a weather error break the rest of the UI. Log and move on.
        if (window.debug) window.debug.log(`⚠️ refreshWeather error: ${err.message}`);
    }
    if (changed) saveApplicationData();
    return changed;
}

export function toggleWeatherPanel() {
    ensureWeatherState();
    state.weather.panelOpen = !state.weather.panelOpen;
    // Opening the panel triggers a freshness check — costs nothing if cached.
    if (state.weather.panelOpen) refreshWeather();
    render();
}

export function closeWeatherPanel() {
    ensureWeatherState();
    state.weather.panelOpen = false;
    render();
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

export function registerLegacyGlobals() {
    if (typeof window === 'undefined') return;
    window.toggleWeatherPanel = toggleWeatherPanel;
    window.closeWeatherPanel = closeWeatherPanel;
    window.refreshWeather = refreshWeather;
    _installOutsideClickHandler();
    // Kick a refresh at boot so the chip has fresh data on first render
    // (no-op when cache already fresh).
    refreshWeather();
}
