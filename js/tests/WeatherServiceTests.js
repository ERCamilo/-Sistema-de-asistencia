/**
 * 🧪 WeatherServiceTests — adapter contract + cache + provider switching.
 *
 * Covers:
 *   - MockAdapter returns deterministic shaped data
 *   - WeatherService caches per data class (current / forecast / alerts)
 *   - Cache TTL respects each class
 *   - Provider switching swaps adapters cleanly + invalidates the cache
 *   - readCachedCurrent never throws on missing state
 */

import {
    fetchCurrent,
    fetchForecast,
    fetchHourly,
    fetchAlerts,
    readCachedCurrent,
    readCachedForecast,
    readCachedHourly,
    isCacheFresh,
    registerAdapter,
    setActiveProvider,
    getActiveLocation
} from '../modules/features/weather/WeatherService.js';
import { WEATHER_ICON, WEATHER_TTL, DEFAULT_LOCATION, emojiFor, formatTemp } from '../modules/features/weather/WeatherTypes.js';
import * as MockAdapterModule from '../modules/features/weather/adapters/MockAdapter.js';
import { updateWeatherApiKeyProvider } from '../modules/features/weather/WeatherSettings.js';
import { WeatherApiAdapter } from '../modules/features/weather/adapters/WeatherApiAdapter.js';

function buildState(overrides = {}) {
    return {
        settings: {},
        weather: null,
        ...overrides
    };
}

testRunner.addSuite("WeatherTypes — formatters", {

    "emojiFor returns the canonical emoji per icon"() {
        testRunner.assertEquals(emojiFor(WEATHER_ICON.SUNNY), '☀️', 'sunny → ☀️');
        testRunner.assertEquals(emojiFor(WEATHER_ICON.STORMY), '⛈️', 'stormy → ⛈️');
        testRunner.assertEquals(emojiFor(WEATHER_ICON.HURRICANE), '🌀', 'hurricane → 🌀');
    },

    "emojiFor falls back to unknown for typos / null"() {
        testRunner.assertEquals(emojiFor('not-real'), '❓', 'Bad key falls back');
        testRunner.assertEquals(emojiFor(null), '❓', 'null falls back');
        testRunner.assertEquals(emojiFor(undefined), '❓', 'undefined falls back');
    },

    "formatTemp rounds and appends ° (no decimals)"() {
        testRunner.assertEquals(formatTemp(28), '28°', 'Integer kept');
        testRunner.assertEquals(formatTemp(28.7), '29°', 'Rounds up');
        testRunner.assertEquals(formatTemp(28.2), '28°', 'Rounds down');
    },

    "formatTemp returns em-dash for null / NaN"() {
        testRunner.assertEquals(formatTemp(null), '—', 'null → —');
        testRunner.assertEquals(formatTemp(undefined), '—', 'undefined → —');
        testRunner.assertEquals(formatTemp(Number.NaN), '—', 'NaN → —');
    }
});

testRunner.addSuite("WeatherService — MockAdapter contract", {

    "getCurrent returns the normalized shape"() {
        const out = MockAdapterModule.getCurrent(18.47, -69.89, new Date('2026-05-20'));
        testRunner.assert(out.provider === 'mock', 'provider tagged');
        testRunner.assert(typeof out.icon === 'string', 'icon is string');
        testRunner.assert(typeof out.temp === 'number', 'temp is number');
        testRunner.assert(out.precipChance >= 0 && out.precipChance <= 100, 'precip in 0-100');
    },

    "getForecast returns exactly N entries starting today"() {
        const today = new Date('2026-05-20');
        const out = MockAdapterModule.getForecast(18.47, -69.89, 5, today);
        testRunner.assertEquals(out.length, 5, '5 entries');
        testRunner.assertEquals(out[0].date, '2026-05-20', 'first entry is today');
        testRunner.assertEquals(out[4].date, '2026-05-24', 'fifth entry is +4 days');
    },

    "Mock conditions are stable per date (deterministic for tests)"() {
        const today = new Date('2026-05-20');
        const a = MockAdapterModule.getCurrent(0, 0, today);
        const b = MockAdapterModule.getCurrent(0, 0, today);
        testRunner.assertEquals(a.icon, b.icon, 'Same date → same icon');
        testRunner.assertEquals(a.temp, b.temp, 'Same date → same temp');
    },

    "getAlerts returns an array (empty for mock)"() {
        const out = MockAdapterModule.getAlerts(0, 0);
        testRunner.assert(Array.isArray(out), 'Always an array');
        testRunner.assertEquals(out.length, 0, 'Mock never raises alerts');
    }
});

testRunner.addSuite("WeatherService — caching", {

    "isCacheFresh returns false on missing entry"() {
        testRunner.assertEquals(isCacheFresh(null, 1000), false, 'null → not fresh');
        testRunner.assertEquals(isCacheFresh({}, 1000), false, 'empty object → not fresh');
        testRunner.assertEquals(isCacheFresh({ data: {} }, 1000), false, 'no fetchedAt → not fresh');
    },

    "isCacheFresh respects the ttl window"() {
        const now = 1_000_000;
        const fresh = { data: {}, fetchedAt: now - 5_000 };
        const stale = { data: {}, fetchedAt: now - 60_000 };
        testRunner.assertEquals(isCacheFresh(fresh, 10_000, now), true, '5s inside 10s TTL');
        testRunner.assertEquals(isCacheFresh(stale, 10_000, now), false, '60s outside 10s TTL');
    },

    async "fetchCurrent populates the cache on first call"() {
        const state = buildState();
        const data = await fetchCurrent(state);
        testRunner.assert(state.weather, 'state.weather created');
        testRunner.assert(state.weather.cache?.current?.data === data, 'cache stored same reference');
        testRunner.assert(typeof state.weather.cache.current.fetchedAt === 'number', 'fetchedAt set');
    },

    async "fetchCurrent returns the cached value on the second call without refetching"() {
        const state = buildState();
        const first = await fetchCurrent(state);
        const firstFetchedAt = state.weather.cache.current.fetchedAt;

        // Wait a tick then call again. We expect SAME data + SAME fetchedAt because
        // the cache hit short-circuits the adapter.
        const second = await fetchCurrent(state);
        testRunner.assertEquals(second, first, 'Same cached reference returned');
        testRunner.assertEquals(state.weather.cache.current.fetchedAt, firstFetchedAt, 'fetchedAt unchanged');
    },

    async "fetchCurrent({force: true}) bypasses the cache"() {
        const state = buildState();
        await fetchCurrent(state);
        const firstFetchedAt = state.weather.cache.current.fetchedAt;
        // Force a tiny gap so a refetch produces a different fetchedAt.
        const before = Date.now();
        while (Date.now() === before) { /* spin one ms */ }
        await fetchCurrent(state, { force: true });
        testRunner.assert(state.weather.cache.current.fetchedAt > firstFetchedAt, 'fetchedAt advanced');
    },

    async "fetchForecast caches independently from fetchCurrent"() {
        const state = buildState();
        await fetchCurrent(state);
        testRunner.assertEquals(state.weather.cache.forecast, undefined, 'forecast not pre-populated');
        const forecast = await fetchForecast(state, 3);
        testRunner.assertEquals(forecast.length, 3, '3 entries returned');
        testRunner.assert(state.weather.cache.forecast?.data, 'forecast cache populated');
    },

    async "fetchHourly returns 24h at 3h steps by default (9 entries)"() {
        const state = buildState();
        const hourly = await fetchHourly(state);
        testRunner.assertEquals(hourly.length, 8, '24/3 = 8 entries (0, 3, 6, ..., 21h)');
        testRunner.assert(typeof hourly[0].hourLabel === 'string', 'hourLabel present');
        testRunner.assert(typeof hourly[0].temp === 'number', 'temp present');
        testRunner.assert(hourly[0].precipChance >= 0 && hourly[0].precipChance <= 100, 'precip bounded');
    },

    async "fetchHourly respects custom hours and step"() {
        const state = buildState();
        const hourly = await fetchHourly(state, 12, 6);
        testRunner.assertEquals(hourly.length, 2, '12/6 = 2 entries');
    },

    async "fetchHourly caches under its own key"() {
        const state = buildState();
        await fetchCurrent(state);
        testRunner.assertEquals(state.weather.cache.hourly, undefined, 'hourly not pre-populated');
        await fetchHourly(state);
        testRunner.assert(state.weather.cache.hourly?.data, 'hourly cache populated separately');
    },

    async "fetchHourly falls back when adapter lacks getHourly"() {
        const state = buildState();
        const slim = {
            providerName: 'slim',
            getCurrent: () => ({ icon: 'sunny', temp: 28, precipChance: 5, windKph: 8 }),
            getForecast: (lat, lon, days) => Array.from({length: days}, (_, i) => ({
                date: `2026-05-${21 + i}`, icon: 'sunny', tempMax: 32, tempMin: 24, precipChance: 10, windKph: 6
            })),
            getAlerts: () => []
            // intentionally no getHourly
        };
        registerAdapter('slim', slim);
        setActiveProvider(state, 'slim');
        const hourly = await fetchHourly(state, 24);
        testRunner.assert(hourly.length > 0, 'Synthetic hourly returned');
        testRunner.assert(typeof hourly[0].hourLabel === 'string', 'hourLabel still present');
    },

    "readCachedHourly returns [] on empty state"() {
        testRunner.assert(Array.isArray(readCachedHourly({})), 'Array returned');
        testRunner.assertEquals(readCachedHourly({}).length, 0, 'Empty when nothing cached');
    }
});

testRunner.addSuite("WeatherService — readCachedCurrent + readCachedForecast", {

    "readCachedCurrent on empty state returns the unknown placeholder"() {
        const out = readCachedCurrent({});
        testRunner.assertEquals(out.icon, WEATHER_ICON.UNKNOWN, 'Falls back to unknown');
        testRunner.assertEquals(out.temp, null, 'temp null when nothing cached');
    },

    "readCachedForecast on empty state returns []"() {
        const out = readCachedForecast({});
        testRunner.assert(Array.isArray(out), 'Empty array returned');
        testRunner.assertEquals(out.length, 0, 'Length 0');
    }
});

testRunner.addSuite("WeatherService — location + provider switching", {

    "getActiveLocation defaults to Santo Domingo"() {
        const loc = getActiveLocation(buildState());
        testRunner.assertEquals(loc.lat, DEFAULT_LOCATION.lat, 'lat matches default');
        testRunner.assertEquals(loc.lon, DEFAULT_LOCATION.lon, 'lon matches default');
    },

    "getActiveLocation respects settings.weatherLocation"() {
        const state = buildState({ settings: { weatherLocation: { lat: 18.5, lon: -68.4, name: 'Punta Cana' } } });
        const loc = getActiveLocation(state);
        testRunner.assertEquals(loc.lat, 18.5, 'custom lat');
        testRunner.assertEquals(loc.name, 'Punta Cana', 'custom name');
    },

    "registerAdapter rejects malformed adapters"() {
        let threw = false;
        try { registerAdapter('bad', { /* no getCurrent */ }); }
        catch (e) { threw = true; }
        testRunner.assert(threw, 'Should reject adapter without getCurrent');
    },

    async "setActiveProvider switches + clears the cache"() {
        const state = buildState();
        await fetchCurrent(state);
        await fetchHourly(state);
        testRunner.assert(state.weather.cache.current.data, 'cache populated first');
        testRunner.assert(state.weather.cache.hourly.data, 'hourly cache populated first');

        // Register a sibling adapter so setActiveProvider has somewhere to go.
        const fake = {
            providerName: 'fake',
            getCurrent: () => ({ icon: WEATHER_ICON.SUNNY, temp: 99, precipChance: 0, windKph: 0 }),
            getForecast: () => [],
            getAlerts: () => []
        };
        registerAdapter('fake', fake);
        setActiveProvider(state, 'fake');
        testRunner.assertEquals(state.settings.weatherProvider, 'fake', 'provider flipped');
        testRunner.assertEquals(state.weather.cache.current, null, 'cache invalidated');
        testRunner.assertEquals(state.weather.cache.hourly, null, 'hourly cache invalidated');

        // Next fetch should come from the new adapter.
        const data = await fetchCurrent(state);
        testRunner.assertEquals(data.temp, 99, 'fake adapter served');
    },

    "settings API-key changes switch the current-session provider and invalidate every forecast cache"() {
        const state = buildState({
            settings: { weatherApiKey: '', weatherProvider: 'mock' },
            weather: {
                cache: {
                    current: { data: { temp: 25 }, fetchedAt: Date.now() },
                    forecast: { data: [{ date: '2026-08-13' }], fetchedAt: Date.now() },
                    hourly: { data: [{ hourLabel: '12:00' }], fetchedAt: Date.now() }
                }
            }
        });
        registerAdapter('weatherapi', WeatherApiAdapter);

        testRunner.assert(updateWeatherApiKeyProvider({ currentState: state, weatherApiKey: 'new-key' }), 'Adding a key switches provider immediately');
        testRunner.assertEquals(state.settings.weatherApiKey, 'new-key', 'New key is stored in the current session');
        testRunner.assertEquals(state.settings.weatherProvider, 'weatherapi', 'Real provider becomes active');
        testRunner.assertEquals(state.weather.cache.current, null, 'Current cache invalidated');
        testRunner.assertEquals(state.weather.cache.forecast, null, 'Forecast cache invalidated');
        testRunner.assertEquals(state.weather.cache.hourly, null, 'Hourly cache invalidated');

        state.weather.cache.current = { data: { temp: 28 }, fetchedAt: Date.now() };
        state.weather.cache.forecast = { data: [{ date: '2026-08-14' }], fetchedAt: Date.now() };
        state.weather.cache.hourly = { data: [{ hourLabel: '15:00' }], fetchedAt: Date.now() };

        testRunner.assert(updateWeatherApiKeyProvider({ currentState: state, weatherApiKey: '' }), 'Removing a key switches provider immediately');
        testRunner.assertEquals(state.settings.weatherProvider, 'mock', 'Mock provider becomes active');
        testRunner.assertEquals(state.weather.cache.current, null, 'Current cache invalidated after removal');
        testRunner.assertEquals(state.weather.cache.forecast, null, 'Forecast cache invalidated after removal');
        testRunner.assertEquals(state.weather.cache.hourly, null, 'Hourly cache invalidated after removal');
    },

    "setActiveProvider throws for unknown names"() {
        let threw = false;
        try { setActiveProvider(buildState(), 'martian'); }
        catch (e) { threw = true; }
        testRunner.assert(threw, 'unknown provider should throw');
    }
});

console.log('🧪 Weather service tests cargados.');
