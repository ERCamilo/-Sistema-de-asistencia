/**
 * 🎭 MockAdapter — deterministic fake weather data.
 *
 * Used while we evaluate the feature without committing to a real provider.
 * Every WeatherService method has a Mock counterpart that returns shaped data
 * matching the normalized contract in WeatherTypes.js, so the UI can be
 * built and tested before any real API key exists.
 *
 * Determinism: the same date always returns the same conditions, so tests
 * and screenshots don't flap. A small rotation of conditions across the
 * forecast keeps the UI honest about handling every icon variant.
 */

import { WEATHER_ICON } from '../WeatherTypes.js';

// A 7-element rotation chosen to cycle through every UI state at least once
// inside a single week — useful both as a demo and as test fixture data.
const _ROTATION = [
    { icon: WEATHER_ICON.SUNNY,         tempMax: 32, tempMin: 24, precip: 5,  wind: 8 },
    { icon: WEATHER_ICON.PARTLY_CLOUDY, tempMax: 30, tempMin: 23, precip: 15, wind: 10 },
    { icon: WEATHER_ICON.CLOUDY,        tempMax: 29, tempMin: 22, precip: 30, wind: 12 },
    { icon: WEATHER_ICON.RAINY,         tempMax: 27, tempMin: 21, precip: 70, wind: 14 },
    { icon: WEATHER_ICON.STORMY,        tempMax: 25, tempMin: 20, precip: 90, wind: 22 },
    { icon: WEATHER_ICON.SUNNY,         tempMax: 33, tempMin: 25, precip: 0,  wind: 6 },
    { icon: WEATHER_ICON.HOT,           tempMax: 36, tempMin: 27, precip: 5,  wind: 9 }
];

function _conditionForDate(dateKey) {
    // Hash on yyyy-mm-dd → index into the rotation. Stable per day, varies
    // across the week so the demo UI shows different icons.
    const stamp = String(dateKey || '').replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < stamp.length; i++) sum += stamp.charCodeAt(i);
    return _ROTATION[sum % _ROTATION.length];
}

function _dateKey(d) {
    return d.toISOString().slice(0, 10);
}

/**
 * Current weather at the given coordinates. Coordinates are accepted but
 * ignored — the mock provider is location-agnostic so tests are stable.
 */
export function getCurrent(_lat, _lon, today = new Date()) {
    const c = _conditionForDate(_dateKey(today));
    return {
        provider: 'mock',
        fetchedAt: Date.now(),
        location: { lat: _lat, lon: _lon },
        icon: c.icon,
        temp: Math.round((c.tempMax + c.tempMin) / 2),
        feelsLike: Math.round((c.tempMax + c.tempMin) / 2) + (c.icon === WEATHER_ICON.HOT ? 3 : 1),
        precipChance: c.precip,
        windKph: c.wind,
        humidity: 65
    };
}

/**
 * N-day forecast starting today. Each entry is one normalized day card.
 * @param {number} days number of days (incl. today). Default 5.
 */
export function getForecast(_lat, _lon, days = 5, startDate = new Date()) {
    const out = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const key = _dateKey(d);
        const c = _conditionForDate(key);
        out.push({
            date: key,
            icon: c.icon,
            tempMax: c.tempMax,
            tempMin: c.tempMin,
            precipChance: c.precip,
            windKph: c.wind
        });
    }
    return out;
}

/**
 * Active weather alerts (hurricanes, severe storms, etc.). The mock never
 * raises an alert — that exercise is for the real adapters.
 */
export function getAlerts(_lat, _lon) {
    return [];
}

export const MockAdapter = { getCurrent, getForecast, getAlerts, providerName: 'mock' };
