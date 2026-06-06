/**
 * WeatherService — unified entry point for weather data.
 *
 * The UI never imports adapters directly. It calls these helpers, which:
 *  1. Read the active provider from state (settings.weatherProvider or 'mock')
 *  2. Check the in-state cache first (TTL per data class)
 *  3. Delegate to the matching adapter when cache is stale/empty
 *  4. Persist the response back into state.weather.cache
 *
 * Provider switching is purely a state change — no UI code touches APIs.
 *
 * All fetch* methods are async to support real HTTP adapters alongside the
 * synchronous MockAdapter. The mock path resolves instantly (no tick delay).
 *
 * Cache shape lives on state.weather.cache:
 *   {
 *     current:  { data, fetchedAt }   // { icon, temp, precipChance, windKph, ... }
 *     forecast: { data, fetchedAt }   // [ { date, icon, tempMax, tempMin, ... } ]
 *     alerts:   { data, fetchedAt }   // [ { severity, title, ... } ]
 *     provider: 'mock' | 'weatherapi' | 'google'
 *   }
 */

import { WEATHER_TTL, DEFAULT_LOCATION, WEATHER_ICON } from './WeatherTypes.js';
import { MockAdapter } from './adapters/MockAdapter.js';

// Registry. New adapters register themselves here at module load.
const _ADAPTERS = new Map();
_ADAPTERS.set('mock', MockAdapter);

/**
 * Allow alternate providers (WeatherAPI, Google) to register themselves
 * without forcing this file to import them. Migration becomes one line:
 *   registerAdapter('weatherapi', WeatherApiAdapter);
 *   setActiveProvider('weatherapi');
 */
export function registerAdapter(name, adapter) {
    if (!name || !adapter || typeof adapter.getCurrent !== 'function') {
        throw new Error(`registerAdapter: invalid adapter for "${name}"`);
    }
    _ADAPTERS.set(name, adapter);
}

export function getRegisteredProviders() {
    return Array.from(_ADAPTERS.keys());
}

/**
 * Pure cache check — no side effects. Exported for testing.
 * @returns {boolean} true if cached data is fresh enough to skip a fetch
 */
export function isCacheFresh(cacheEntry, ttlMs, now = Date.now()) {
    if (!cacheEntry || !cacheEntry.data || !cacheEntry.fetchedAt) return false;
    return (now - cacheEntry.fetchedAt) < ttlMs;
}

/**
 * Read the active provider's adapter (falls back to mock).
 */
function _activeAdapter(state) {
    const name = state?.weather?.provider
        || state?.settings?.weatherProvider
        || 'mock';
    return _ADAPTERS.get(name) || MockAdapter;
}

/**
 * Build the opts object passed to adapter methods.
 * Includes apiKey when available so real adapters can authenticate.
 */
function _adapterOpts(state) {
    const opts = {};
    const key = state?.settings?.weatherApiKey;
    if (key) opts.apiKey = key;
    return opts;
}

/**
 * Read the configured location, falling back to DEFAULT_LOCATION. Centralized
 * so every fetch goes through the same coordinate source.
 */
export function getActiveLocation(state) {
    const loc = state?.settings?.weatherLocation;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
        return { lat: loc.lat, lon: loc.lon, name: loc.name || DEFAULT_LOCATION.name };
    }
    return { ...DEFAULT_LOCATION };
}

function _ensureCacheShape(state) {
    if (!state.weather) state.weather = {};
    if (!state.weather.cache) state.weather.cache = {};
    return state.weather.cache;
}

/**
 * Fetch current weather. Returns cached data if fresh; otherwise hits the
 * adapter and persists the result.
 *
 * Async to support real HTTP adapters. MockAdapter returns synchronously
 * but wrapping in async is harmless (resolves in the same microtask).
 *
 * @param {{force?: boolean}} opts pass force:true to bypass the cache
 */
export async function fetchCurrent(state, opts = {}) {
    const cache = _ensureCacheShape(state);
    if (!opts.force && isCacheFresh(cache.current, WEATHER_TTL.CURRENT_MS)) {
        return cache.current.data;
    }
    const adapter = _activeAdapter(state);
    const loc = getActiveLocation(state);
    const data = await adapter.getCurrent(loc.lat, loc.lon, _adapterOpts(state));
    cache.current = { data, fetchedAt: Date.now() };
    cache.provider = adapter.providerName || 'unknown';
    return data;
}

export async function fetchForecast(state, days = 5, opts = {}) {
    const cache = _ensureCacheShape(state);
    if (!opts.force && isCacheFresh(cache.forecast, WEATHER_TTL.FORECAST_MS)) {
        // Truncate to the requested number of days, in case cached entry has more.
        return (cache.forecast.data || []).slice(0, days);
    }
    const adapter = _activeAdapter(state);
    const loc = getActiveLocation(state);
    const data = await adapter.getForecast(loc.lat, loc.lon, days, _adapterOpts(state));
    cache.forecast = { data, fetchedAt: Date.now() };
    cache.provider = adapter.providerName || 'unknown';
    return data;
}

/**
 * Hourly forecast for the next `hours` hours, in `stepHours` steps.
 * Cached under the same TTL as the daily forecast (intra-day data goes
 * stale at the same rate). Adapters that lack a getHourly method get a
 * derived stub from the daily forecast so the UI degrades gracefully.
 */
export async function fetchHourly(state, hours = 24, stepHours = 3, opts = {}) {
    const cache = _ensureCacheShape(state);
    if (!opts.force && isCacheFresh(cache.hourly, WEATHER_TTL.FORECAST_MS)) {
        return cache.hourly.data || [];
    }
    const adapter = _activeAdapter(state);
    const loc = getActiveLocation(state);
    const adapterOpts = _adapterOpts(state);
    let data;
    if (typeof adapter.getHourly === 'function') {
        data = await adapter.getHourly(loc.lat, loc.lon, hours, stepHours, adapterOpts);
    } else {
        // Fallback: synthesize a single entry per day from the daily forecast
        // so the panel always has *something* to render.
        const daily = await adapter.getForecast(loc.lat, loc.lon, Math.ceil(hours / 24), adapterOpts);
        data = daily.map(d => ({
            isoHour: `${d.date}T12:00:00.000Z`,
            hourLabel: '12:00',
            icon: d.icon,
            temp: Math.round((d.tempMax + d.tempMin) / 2),
            precipChance: d.precipChance,
            windKph: d.windKph
        }));
    }
    cache.hourly = { data, fetchedAt: Date.now() };
    cache.provider = adapter.providerName || 'unknown';
    return data;
}

export function readCachedHourly(state) {
    return state?.weather?.cache?.hourly?.data || [];
}

export async function fetchAlerts(state, opts = {}) {
    const cache = _ensureCacheShape(state);
    if (!opts.force && isCacheFresh(cache.alerts, WEATHER_TTL.ALERTS_MS)) {
        return cache.alerts.data || [];
    }
    const adapter = _activeAdapter(state);
    const loc = getActiveLocation(state);
    const data = await adapter.getAlerts(loc.lat, loc.lon, _adapterOpts(state));
    cache.alerts = { data, fetchedAt: Date.now() };
    return data;
}

/**
 * Read the "best-effort" current snapshot for the chip — never throws,
 * never hits the network, just returns whatever's cached. UI uses this
 * to render the initial chip without blocking on a fetch.
 */
export function readCachedCurrent(state) {
    const cache = state?.weather?.cache;
    if (cache?.current?.data) return cache.current.data;
    return { icon: WEATHER_ICON.UNKNOWN, temp: null, precipChance: null, windKph: null };
}

export function readCachedForecast(state) {
    return state?.weather?.cache?.forecast?.data || [];
}

/**
 * Flip the active provider. Convenience wrapper around setting state
 * directly. Keeps the rest of the app off of the implementation detail.
 */
export function setActiveProvider(state, name) {
    if (!_ADAPTERS.has(name)) {
        throw new Error(`Unknown weather provider: ${name}`);
    }
    if (!state.settings) state.settings = {};
    state.settings.weatherProvider = name;
    // Invalidate cache when provider changes so we don't show stale
    // data with the new provider's branding/units mismatch.
    if (state.weather?.cache) {
        state.weather.cache.current = null;
        state.weather.cache.forecast = null;
        state.weather.cache.alerts = null;
        state.weather.cache.provider = name;
    }
}
