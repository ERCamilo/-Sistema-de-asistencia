/**
 * 🌤️ Weather feature — public exports.
 *
 * Phase 1 MVP per propuestas_clima_notas.md:
 *   - Adapter pattern (MockAdapter today, WeatherAPI/Google later)
 *   - In-state cache with per-class TTL (current 30m, forecast 6h)
 *   - WeatherChip in the attendance navpill + floating WeatherPanel
 *   - Outside-click closes the panel
 *
 * Notas del día, vista desktop, alertas, multi-sitio and weather history
 * are queued for later phases.
 */

export * from './WeatherTypes.js';
export {
    fetchCurrent,
    fetchForecast,
    fetchHourly,
    fetchAlerts,
    readCachedCurrent,
    readCachedForecast,
    readCachedHourly,
    getActiveLocation,
    isCacheFresh,
    registerAdapter,
    getRegisteredProviders,
    setActiveProvider
} from './WeatherService.js';
export { WeatherChip } from './WeatherChip.js';
export { WeatherPanel, WeatherChipWithPanel } from './WeatherPanel.js';
export { WeatherBar } from './WeatherBar.js';
export {
    refreshWeather,
    toggleWeatherPanel,
    closeWeatherPanel,
    toggleWeatherExpanded,
    forceRefreshWeather,
    registerLegacyGlobals
} from './WeatherController.js';
