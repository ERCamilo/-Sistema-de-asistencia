/**
 * 🧪 WeatherUITests — chip rendering + controller open/close flow.
 *
 * Confirms:
 *   - WeatherChip renders an emoji + temperature when cache is populated
 *   - WeatherChip falls back gracefully when nothing is cached
 *   - toggleWeatherPanel opens / closes state.weather.panelOpen
 *   - WeatherPanel only renders when panelOpen is true
 *   - settings.weatherEnabled === false hides the chip entirely
 */

import { state } from '../modules/core/AppState.js';
import { WeatherChip } from '../modules/features/weather/WeatherChip.js';
import { WeatherPanel } from '../modules/features/weather/WeatherPanel.js';
import { WeatherBar } from '../modules/features/weather/WeatherBar.js';
import {
    toggleWeatherPanel,
    closeWeatherPanel,
    toggleWeatherExpanded,
    toggleWeatherMetricEditor,
    toggleWeatherForecastExpanded,
    setWeatherSummaryMetric,
    refreshWeather
} from '../modules/features/weather/WeatherController.js';
import { fetchCurrent } from '../modules/features/weather/WeatherService.js';
import {
    DEFAULT_WEATHER_SUMMARY_METRICS,
    normalizeWeatherSummaryMetrics,
    resolveWeatherSummaryMetric,
    updateWeatherSummaryMetric
} from '../modules/features/weather/WeatherSummaryMetrics.js';

function resetWeatherState() {
    state.weather = null;
    state.weatherExpanded = false;
    state.weatherForecastExpanded = false;
    state.weatherMetricEditorOpen = false;
    if (state.settings) {
        delete state.settings.weatherProvider;
        delete state.settings.weatherLocation;
        delete state.settings.weatherSummaryMetrics;
    }
    // Force weather visible for tests that need to render UI. Individual
    // tests can flip this off to exercise the kill-switch.
    state.settings = state.settings || {};
    state.settings.weatherEnabled = true;
}

testRunner.addSuite("WeatherChip — render", {

    "shows unknown placeholder before any fetch"() {
        resetWeatherState();
        const html = WeatherChip();
        testRunner.assert(html.includes('❓'), 'unknown emoji rendered');
        testRunner.assert(html.includes('—'), 'em-dash for missing temp');
        testRunner.assert(html.includes('data-app-fn="toggleWeatherPanel"'), 'wired to toggle handler');
    },

    async "shows real emoji + temperature once cache is populated"() {
        resetWeatherState();
        await fetchCurrent(state);
        const cached = state.weather.cache.current.data;
        const html = WeatherChip();
        testRunner.assert(html.length > 0, 'Chip rendered');
        testRunner.assert(html.includes('°'), 'Some temperature shown');
        testRunner.assert(html.includes('toggleWeatherPanel'), 'Click still wired');
        // Don't lock the test to a specific icon — Mock conditions vary by date
        // and we just need confidence that *something* was projected.
        testRunner.assert(typeof cached.icon === 'string', 'icon present in cache');
    },

    "settings.weatherEnabled=false hides the chip entirely"() {
        resetWeatherState();
        state.settings.weatherEnabled = false;
        const html = WeatherChip();
        testRunner.assertEquals(html, '', 'Chip not rendered when disabled');
    },

    "weatherEnabled undefined (default) keeps the chip hidden"() {
        resetWeatherState();
        delete state.settings.weatherEnabled;
        const html = WeatherChip();
        testRunner.assertEquals(html, '', 'Chip hidden by default — must be opted in');
    }
});

testRunner.addSuite("WeatherController — open/close flow", {

    async "toggleWeatherPanel opens, refreshes cache, and updates state"() {
        resetWeatherState();
        toggleWeatherPanel();
        await refreshWeather();
        testRunner.assertEquals(state.weather.panelOpen, true, 'panel opened');
        testRunner.assert(state.weather.cache?.current?.data, 'cache populated by refresh on open');
    },

    "toggleWeatherPanel twice closes again"() {
        resetWeatherState();
        toggleWeatherPanel();
        toggleWeatherPanel();
        testRunner.assertEquals(state.weather.panelOpen, false, 'second toggle closes');
    },

    "closeWeatherPanel is idempotent"() {
        resetWeatherState();
        // Closing when nothing is open should not throw or pollute state.
        closeWeatherPanel();
        closeWeatherPanel();
        testRunner.assertEquals(state.weather.panelOpen, false, 'still closed');
    },

    async "refreshWeather is a no-op when cache is fresh"() {
        resetWeatherState();
        await refreshWeather();
        const firstFetchedAt = state.weather.cache.current.fetchedAt;
        // Immediately calling refreshWeather again must hit the cache (no change).
        await refreshWeather();
        testRunner.assertEquals(state.weather.cache.current.fetchedAt, firstFetchedAt, 'fetchedAt unchanged');
    },

    async "forceRefreshWeather bypasses cache and updates fetchedAt"() {
        resetWeatherState();
        await refreshWeather();
        const firstFetchedAt = state.weather.cache.current.fetchedAt;
        
        // Bounded delay to guarantee clock ticks for timestamp difference check
        await new Promise(resolve => setTimeout(resolve, 5));
        
        const forceRefreshModule = await import('../modules/features/weather/WeatherController.js');
        await forceRefreshModule.forceRefreshWeather();
        
        testRunner.assert(state.weather.cache.current.fetchedAt > firstFetchedAt, 'fetchedAt updated indicating cache bypass');
        testRunner.assertEquals(state.weather.isRefreshing, false, 'isRefreshing state is reset to false');
    }
});

testRunner.addSuite("WeatherPanel — render", {

    "renders nothing when state.weather.panelOpen is falsy"() {
        resetWeatherState();
        const html = WeatherPanel();
        testRunner.assertEquals(html, '', 'Empty when closed');
    },

    async "renders the full panel when panelOpen is true"() {
        resetWeatherState();
        toggleWeatherPanel(); // opens
        await refreshWeather(); // populates cache
        const html = WeatherPanel();
        testRunner.assert(html.includes('role="dialog"'), 'Dialog rendered');
        testRunner.assert(html.includes('Cerrar'), 'Close button rendered');
        testRunner.assert(html.includes('data-app-fn="forceRefreshWeather"'), 'Refresh button rendered with dispatcher action');
        testRunner.assert(html.includes('Actualizar'), 'Refresh button label rendered');
        testRunner.assert(html.includes('°'), 'Temperature displayed');
        // 5-day forecast strip uses "Hoy" as the first label
        testRunner.assert(html.includes('Hoy'), 'Today label');
    },

    async "panel surfaces the active location name"() {
        resetWeatherState();
        state.settings = state.settings || {};
        state.settings.weatherLocation = { lat: 18.5, lon: -68.4, name: 'Punta Cana' };
        toggleWeatherPanel();
        await refreshWeather();
        const html = WeatherPanel();
        testRunner.assert(html.includes('Punta Cana'), 'Custom location name displayed');
    },

    async "panel renders the hourly strip with 'Ahora' marker"() {
        resetWeatherState();
        toggleWeatherPanel(); // triggers refreshWeather
        await refreshWeather(); // populates hourly cache
        const html = WeatherPanel();
        testRunner.assert(html.includes('Próximas 24 horas'), 'Hourly section header present');
        testRunner.assert(html.includes('Ahora'), 'First hour labeled "Ahora"');
        // Should contain at least one HH:00 time label too
        testRunner.assert(/\d{2}:00/.test(html), 'At least one HH:00 label rendered');
    }
});

testRunner.addSuite("WeatherBar — operational collapsed / expanded", {

    async "collapsed bar shows current condition, three configurable widgets and work notice"() {
        resetWeatherState();
        await refreshWeather(); // populate cache without expanding
        
        // Forzar datos normales para evitar que la rotación por fecha dispare alertas
        state.weather.cache.current.data.precipMm = 0;
        state.weather.cache.current.data.windKph = 10;
        state.weather.cache.current.data.feelsLike = 25;
        state.weather.cache.current.data.temp = 25;
        state.weather.cache.current.data.uv = 1;
        state.weather.cache.current.data.windGustKph = 15;
        state.weather.cache.current.data.pressureMb = 1013;
        state.weather.cache.current.data.visKm = 10;

        const html = WeatherBar();
        testRunner.assert(html.includes('Clima para la jornada'), 'Operational summary shown');
        testRunner.assert(html.includes('toggle-weather'), 'Toggle action wired');
        testRunner.assertEquals((html.match(/data-weather-metric=/g) || []).length, 3, 'Exactly three summary widgets shown');
        testRunner.assert(html.includes('weather-notice'), 'Workday notice shown without expanding');
        // Collapsed view should NOT contain the expanded-only labels.
        testRunner.assert(!html.includes('Próximas horas'), 'Hourly section hidden when collapsed');
        testRunner.assert(!html.includes('Próximos días'), 'Daily section header hidden when collapsed');
        testRunner.assert(html.includes('°'), 'Some temperature displayed');
    },

    async "main weather illustration exposes only the animations for its condition"() {
        resetWeatherState();
        await refreshWeather();
        state.weather.cache.current.data.icon = 'stormy';

        let html = WeatherBar();
        testRunner.assert(html.includes('weather-current-hero'), 'Hero illustration occupies the current-weather corner');
        testRunner.assert(html.includes('weather-hero-svg--stormy'), 'Storm scene is selected');
        testRunner.assert(html.includes('weather-hero-rain'), 'Storm scene includes animated rain');
        testRunner.assert(html.includes('weather-hero-lightning'), 'Storm scene includes animated lightning');
        testRunner.assert(!html.includes('weather-hero-sun-rays'), 'Storm scene does not include sunny animation');

        state.weather.cache.current.data.icon = 'sunny';
        html = WeatherBar();
        testRunner.assert(html.includes('weather-hero-svg--sunny'), 'Sunny scene is selected');
        testRunner.assert(html.includes('weather-hero-sun-rays'), 'Sunny scene includes animated rays');
        testRunner.assert(!html.includes('weather-hero-rain'), 'Sunny scene does not include rain animation');
    },

    async "expanded bar shows current detail + hourly + daily"() {
        resetWeatherState();
        toggleWeatherExpanded(); // populate cache + expand
        await refreshWeather();
        const html = WeatherBar();
        testRunner.assert(state.weatherExpanded === true, 'state flag set');
        testRunner.assert(html.includes('Próximas horas'), 'Hourly section shown');
        testRunner.assert(html.includes('Próximos días'), 'Daily section shown');
        testRunner.assert(html.includes('Ahora'), 'Now marker shown in hourly strip');
        testRunner.assert(html.includes('data-app-fn="forceRefreshWeather"'), 'Refresh button rendered in bar');
        testRunner.assert(html.includes('Personalizar resumen'), 'Metric customization entry point shown');
        testRunner.assert(html.includes('Actualizado hace'), 'Sync age shown in expanded footer');
    },

    async "toggleWeatherExpanded twice returns to collapsed"() {
        resetWeatherState();
        toggleWeatherExpanded();
        toggleWeatherExpanded();
        await refreshWeather();
        const html = WeatherBar();
        testRunner.assertEquals(state.weatherExpanded, false, 'Collapsed again');
        testRunner.assert(!html.includes('Próximas horas'), 'Detail no longer rendered');
    },

    "settings.weatherEnabled=false hides the entire bar"() {
        resetWeatherState();
        state.settings.weatherEnabled = false;
        const html = WeatherBar();
        testRunner.assertEquals(html, '', 'Bar renders empty when disabled');
    },

    "weatherEnabled undefined (default) keeps the bar hidden"() {
        resetWeatherState();
        delete state.settings.weatherEnabled;
        const html = WeatherBar();
        testRunner.assertEquals(html, '', 'Default-off: requires opt-in from Ajustes');
    },

    async "expanded bar surfaces the configured location name"() {
        resetWeatherState();
        state.settings = state.settings || {};
        state.settings.weatherLocation = { lat: 18.5, lon: -68.4, name: 'Punta Cana' };
        toggleWeatherExpanded();
        await refreshWeather();
        const html = WeatherBar();
        testRunner.assert(html.includes('Punta Cana'), 'Custom location displayed');
    },

    async "metric editor changes a slot and persists the selection in settings"() {
        resetWeatherState();
        toggleWeatherExpanded();
        toggleWeatherMetricEditor();
        await refreshWeather();

        let html = WeatherBar();
        testRunner.assert(html.includes('data-weather-metric-slot="0"'), 'Editor shows the first configurable slot');

        setWeatherSummaryMetric(0, 'rainTotalToday');
        html = WeatherBar();
        testRunner.assertEquals(state.settings.weatherSummaryMetrics[0], 'rainTotalToday', 'Selected metric stored in settings');
        testRunner.assert(html.includes('data-weather-metric="rainTotalToday"'), 'Summary re-renders the selected metric');
    },

    async "daily forecast stays collapsed until explicitly requested"() {
        resetWeatherState();
        toggleWeatherExpanded();
        await refreshWeather();

        let html = WeatherBar();
        testRunner.assert(!html.includes('weather-day-grid'), 'Daily cards hidden initially');

        toggleWeatherForecastExpanded();
        html = WeatherBar();
        testRunner.assert(html.includes('weather-day-grid'), 'Daily cards shown after expanding the section');
    }
});

testRunner.addSuite("Weather summary metrics — configurable slots", {

    "normalizes missing, duplicated and invalid metric identifiers"() {
        testRunner.assertEquals(
            JSON.stringify(normalizeWeatherSummaryMetrics(['rainTotalToday', 'rainTotalToday', 'invalid'])),
            JSON.stringify(['rainTotalToday', 'rainChanceToday', 'wind']),
            'Debe completar tres métricas válidas sin duplicados'
        );
        testRunner.assertEquals(
            JSON.stringify(normalizeWeatherSummaryMetrics()),
            JSON.stringify(DEFAULT_WEATHER_SUMMARY_METRICS),
            'Debe conservar una configuración predeterminada estable'
        );
        testRunner.assertEquals(
            JSON.stringify(normalizeWeatherSummaryMetrics(['rainTotalToday', 'wind', 'tomorrow'])),
            JSON.stringify(['rainTotalToday', 'wind', 'tomorrow']),
            'Debe conservar exactamente tres métricas válidas no predeterminadas'
        );
    },

    "swaps slots when the selected metric is already visible"() {
        const updated = updateWeatherSummaryMetric(['rainChanceToday', 'wind', 'feelsLike'], 0, 'wind');
        testRunner.assertEquals(
            JSON.stringify(updated),
            JSON.stringify(['wind', 'rainChanceToday', 'feelsLike']),
            'Debe intercambiar métricas en lugar de duplicarlas'
        );
    },

    "resolves daily rain totals and tomorrow forecast from forecast data"() {
        const context = {
            todayKey: '2026-07-26',
            current: { precipMm: 0.5, precipChance: 20, temp: 27 },
            forecast: [
                { date: '2026-07-26', icon: 'rainy', tempMax: 30, tempMin: 23, precipChance: 70, precipMm: 8.4 },
                { date: '2026-07-27', icon: 'partly-cloudy', tempMax: 31, tempMin: 24, precipChance: 35, precipMm: 2.1 }
            ]
        };

        const rain = resolveWeatherSummaryMetric('rainTotalToday', context);
        const tomorrow = resolveWeatherSummaryMetric('tomorrow', context);

        testRunner.assertEquals(rain.value, '8.4 mm', 'Debe usar el acumulado diario, no solo la lluvia actual');
        testRunner.assertEquals(tomorrow.value, '31° / 24°', 'Debe mostrar máxima y mínima de mañana');
        testRunner.assertEquals(tomorrow.detail, 'Parc. nublado', 'Debe describir la condición de mañana');
    }
});

console.log('🧪 Weather UI tests cargados.');
