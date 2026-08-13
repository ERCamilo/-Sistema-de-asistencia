/**
 * Applies the weather API-key setting and keeps the active provider aligned
 * with it for the current session. Provider switching stays delegated to the
 * canonical WeatherService operation, which owns cache invalidation.
 */

import { setActiveProvider } from './WeatherService.js';

export function updateWeatherApiKeyProvider({
    currentState,
    weatherApiKey = '',
    setProvider = setActiveProvider
}) {
    if (!currentState.settings) currentState.settings = {};

    const previousApiKey = currentState.settings.weatherApiKey || '';
    currentState.settings.weatherApiKey = weatherApiKey;

    if (weatherApiKey && weatherApiKey !== previousApiKey) {
        setProvider(currentState, 'weatherapi');
        return true;
    }
    if (!weatherApiKey && previousApiKey) {
        setProvider(currentState, 'mock');
        return true;
    }
    return false;
}
