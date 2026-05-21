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
    refreshWeather
} from '../modules/features/weather/WeatherController.js';
import { fetchCurrent } from '../modules/features/weather/WeatherService.js';

function resetWeatherState() {
    state.weather = null;
    state.weatherExpanded = false;
    if (state.settings) {
        delete state.settings.weatherProvider;
        delete state.settings.weatherLocation;
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

    "shows real emoji + temperature once cache is populated"() {
        resetWeatherState();
        fetchCurrent(state);
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

    "toggleWeatherPanel opens, refreshes cache, and updates state"() {
        resetWeatherState();
        toggleWeatherPanel();
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

    "refreshWeather is a no-op when cache is fresh"() {
        resetWeatherState();
        refreshWeather();
        const firstFetchedAt = state.weather.cache.current.fetchedAt;
        // Immediately calling refreshWeather again must hit the cache (no change).
        refreshWeather();
        testRunner.assertEquals(state.weather.cache.current.fetchedAt, firstFetchedAt, 'fetchedAt unchanged');
    }
});

testRunner.addSuite("WeatherPanel — render", {

    "renders nothing when state.weather.panelOpen is falsy"() {
        resetWeatherState();
        const html = WeatherPanel();
        testRunner.assertEquals(html, '', 'Empty when closed');
    },

    "renders the full panel when panelOpen is true"() {
        resetWeatherState();
        toggleWeatherPanel(); // opens + populates cache
        const html = WeatherPanel();
        testRunner.assert(html.includes('role="dialog"'), 'Dialog rendered');
        testRunner.assert(html.includes('Cerrar'), 'Close button rendered');
        testRunner.assert(html.includes('°'), 'Temperature displayed');
        // 5-day forecast strip uses "Hoy" as the first label
        testRunner.assert(html.includes('Hoy'), 'Today label shown');
    },

    "panel surfaces the active location name"() {
        resetWeatherState();
        state.settings = state.settings || {};
        state.settings.weatherLocation = { lat: 18.5, lon: -68.4, name: 'Punta Cana' };
        toggleWeatherPanel();
        const html = WeatherPanel();
        testRunner.assert(html.includes('Punta Cana'), 'Custom location name displayed');
    },

    "panel renders the hourly strip with 'Ahora' marker"() {
        resetWeatherState();
        toggleWeatherPanel(); // triggers refreshWeather → populates hourly cache
        const html = WeatherPanel();
        testRunner.assert(html.includes('Próximas 24 horas'), 'Hourly section header present');
        testRunner.assert(html.includes('Ahora'), 'First hour labeled "Ahora"');
        // Should contain at least one HH:00 time label too
        testRunner.assert(/\d{2}:00/.test(html), 'At least one HH:00 label rendered');
    }
});

testRunner.addSuite("WeatherBar — collapsed / expanded", {

    "collapsed bar shows today's temp + 4-day preview by default"() {
        resetWeatherState();
        refreshWeather(); // populate cache without expanding
        const html = WeatherBar();
        testRunner.assert(html.includes('Hoy'), 'Today summary shown');
        testRunner.assert(html.includes('toggle-weather'), 'Toggle action wired');
        // Collapsed view should NOT contain the expanded-only labels.
        testRunner.assert(!html.includes('Próximas 24 horas'), 'Hourly section hidden when collapsed');
        testRunner.assert(!html.includes('Próximos días'), 'Daily section header hidden when collapsed');
        // The preview row uses HH labels like ☀️ + temp, so we expect at least one ° symbol.
        testRunner.assert(html.includes('°'), 'Some temperature displayed');
    },

    "expanded bar shows current detail + hourly + daily"() {
        resetWeatherState();
        toggleWeatherExpanded(); // populate cache + expand
        const html = WeatherBar();
        testRunner.assert(state.weatherExpanded === true, 'state flag set');
        testRunner.assert(html.includes('Próximas 24 horas'), 'Hourly section shown');
        testRunner.assert(html.includes('Próximos días'), 'Daily section shown');
        testRunner.assert(html.includes('Ahora'), 'Now marker shown in hourly strip');
        testRunner.assert(html.includes('Fuente:'), 'Provider footer shown');
    },

    "toggleWeatherExpanded twice returns to collapsed"() {
        resetWeatherState();
        toggleWeatherExpanded();
        toggleWeatherExpanded();
        testRunner.assertEquals(state.weatherExpanded, false, 'Collapsed again');
        const html = WeatherBar();
        testRunner.assert(!html.includes('Próximas 24 horas'), 'Detail no longer rendered');
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

    "expanded bar surfaces the configured location name"() {
        resetWeatherState();
        state.settings = state.settings || {};
        state.settings.weatherLocation = { lat: 18.5, lon: -68.4, name: 'Punta Cana' };
        toggleWeatherExpanded();
        const html = WeatherBar();
        testRunner.assert(html.includes('Punta Cana'), 'Custom location displayed');
    }
});

console.log('🧪 Weather UI tests cargados.');
