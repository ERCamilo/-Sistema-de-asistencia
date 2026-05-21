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
    fetchAlerts,
    readCachedCurrent,
    readCachedForecast,
    isCacheFresh,
    registerAdapter,
    setActiveProvider,
    getActiveLocation
} from '../modules/features/weather/WeatherService.js';
import { WEATHER_ICON, WEATHER_TTL, DEFAULT_LOCATION, emojiFor, formatTemp } from '../modules/features/weather/WeatherTypes.js';
import * as MockAdapterModule from '../modules/features/weather/adapters/MockAdapter.js';

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

    "fetchCurrent populates the cache on first call"() {
        const state = buildState();
        const data = fetchCurrent(state);
        testRunner.assert(state.weather, 'state.weather created');
        testRunner.assert(state.weather.cache?.current?.data === data, 'cache stored same reference');
        testRunner.assert(typeof state.weather.cache.current.fetchedAt === 'number', 'fetchedAt set');
    },

    "fetchCurrent returns the cached value on the second call without refetching"() {
        const state = buildState();
        const first = fetchCurrent(state);
        const firstFetchedAt = state.weather.cache.current.fetchedAt;

        // Wait a tick then call again. We expect SAME data + SAME fetchedAt because
        // the cache hit short-circuits the adapter.
        const second = fetchCurrent(state);
        testRunner.assertEquals(second, first, 'Same cached reference returned');
        testRunner.assertEquals(state.weather.cache.current.fetchedAt, firstFetchedAt, 'fetchedAt unchanged');
    },

    "fetchCurrent({force: true}) bypasses the cache"() {
        const state = buildState();
        fetchCurrent(state);
        const firstFetchedAt = state.weather.cache.current.fetchedAt;
        // Force a tiny gap so a refetch produces a different fetchedAt.
        const before = Date.now();
        while (Date.now() === before) { /* spin one ms */ }
        fetchCurrent(state, { force: true });
        testRunner.assert(state.weather.cache.current.fetchedAt > firstFetchedAt, 'fetchedAt advanced');
    },

    "fetchForecast caches independently from fetchCurrent"() {
        const state = buildState();
        fetchCurrent(state);
        testRunner.assertEquals(state.weather.cache.forecast, undefined, 'forecast not pre-populated');
        const forecast = fetchForecast(state, 3);
        testRunner.assertEquals(forecast.length, 3, '3 entries returned');
        testRunner.assert(state.weather.cache.forecast?.data, 'forecast cache populated');
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

    "setActiveProvider switches + clears the cache"() {
        const state = buildState();
        fetchCurrent(state);
        testRunner.assert(state.weather.cache.current.data, 'cache populated first');

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

        // Next fetch should come from the new adapter.
        const data = fetchCurrent(state);
        testRunner.assertEquals(data.temp, 99, 'fake adapter served');
    },

    "setActiveProvider throws for unknown names"() {
        let threw = false;
        try { setActiveProvider(buildState(), 'martian'); }
        catch (e) { threw = true; }
        testRunner.assert(threw, 'unknown provider should throw');
    }
});

console.log('🧪 Weather service tests cargados.');
