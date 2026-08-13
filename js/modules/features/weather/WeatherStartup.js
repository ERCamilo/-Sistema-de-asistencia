/**
 * Post-hydration weather startup.
 *
 * This boundary deliberately consumes persisted settings only. Location is
 * resolved later by WeatherService from settings.weatherLocation; it never
 * requests browser geolocation during application startup.
 */

import { state } from '../../core/AppState.js';
import { setActiveProvider } from './WeatherService.js';
import { scheduleInitialWeatherRefresh } from './WeatherController.js';

const LEGACY_RUNTIME_KEYS = [
    'loadState',
    'errorMessage',
    'isRefreshing',
    'initialRefreshScheduled'
];

function removeLegacyRuntimeState(currentState) {
    const weather = currentState?.weather;
    if (!weather || typeof weather !== 'object') return;

    LEGACY_RUNTIME_KEYS.forEach(key => {
        delete weather[key];
    });
}

export function initializeWeatherAfterHydration({
    currentState = state,
    setProvider = setActiveProvider,
    schedule = scheduleInitialWeatherRefresh
} = {}) {
    // Older snapshots stored transient UI state under weather. Clean it before
    // the enabled guard so disabled users also migrate on their next save.
    removeLegacyRuntimeState(currentState);
    if (currentState?.settings?.weatherEnabled !== true) return false;

    const provider = currentState.settings.weatherApiKey ? 'weatherapi' : 'mock';
    if (currentState.settings.weatherProvider !== provider) {
        setProvider(currentState, provider);
    }

    return schedule({ currentState });
}
