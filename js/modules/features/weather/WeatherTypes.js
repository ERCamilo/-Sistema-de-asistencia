/**
 * 🌤️ WeatherTypes — Normalized icon set + label dictionary.
 *
 * Every adapter (Mock, WeatherAPI.com, Google Weather, …) must return data
 * in this normalized shape so the UI never has to know which provider is
 * active. Mapping raw provider strings → WEATHER_ICON is the adapter's job.
 *
 *   sunny         ☀️  cielo despejado
 *   partly-cloudy 🌤️  parcialmente nublado
 *   cloudy        ⛅  nublado / cubierto
 *   rainy         🌧️  lluvia o lloviznas
 *   stormy        ⛈️  tormenta eléctrica
 *   windy         💨  vientos fuertes
 *   hot           🔥  calor extremo (>35°C)
 *   hurricane     🌀  tormenta tropical / huracán
 *   unknown       ❓  sin datos / error API
 */

export const WEATHER_ICON = Object.freeze({
    SUNNY: 'sunny',
    PARTLY_CLOUDY: 'partly-cloudy',
    CLOUDY: 'cloudy',
    RAINY: 'rainy',
    STORMY: 'stormy',
    WINDY: 'windy',
    HOT: 'hot',
    HURRICANE: 'hurricane',
    UNKNOWN: 'unknown'
});

export const WEATHER_EMOJI = Object.freeze({
    sunny: '☀️',
    'partly-cloudy': '🌤️',
    cloudy: '⛅',
    rainy: '🌧️',
    stormy: '⛈️',
    windy: '💨',
    hot: '🔥',
    hurricane: '🌀',
    unknown: '❓'
});

export const WEATHER_LABEL_ES = Object.freeze({
    sunny: 'Soleado',
    'partly-cloudy': 'Parc. nublado',
    cloudy: 'Nublado',
    rainy: 'Lluvia',
    stormy: 'Tormenta',
    windy: 'Vientos fuertes',
    hot: 'Calor extremo',
    hurricane: 'Tormenta tropical',
    unknown: 'Sin datos'
});

/**
 * Cache TTLs in milliseconds. Match the values from propuestas_clima_notas.md.
 */
export const WEATHER_TTL = Object.freeze({
    CURRENT_MS: 30 * 60 * 1000,    // 30 minutes
    FORECAST_MS: 6 * 60 * 60 * 1000, // 6 hours
    ALERTS_MS: 15 * 60 * 1000      // 15 minutes
});

/**
 * Default location used when none has been configured by the admin.
 * Santo Domingo, RD (where most users operate). Override in Ajustes.
 */
export const DEFAULT_LOCATION = Object.freeze({
    lat: 18.47,
    lon: -69.89,
    name: 'Santo Domingo, RD'
});

/**
 * Returns the canonical icon emoji for any value. Falls back to "unknown"
 * if the icon key isn't recognized, so a typo never crashes the UI.
 */
export function emojiFor(icon) {
    return WEATHER_EMOJI[icon] || WEATHER_EMOJI.unknown;
}

export function labelFor(icon) {
    return WEATHER_LABEL_ES[icon] || WEATHER_LABEL_ES.unknown;
}

/**
 * Pretty temperature: rounds to integer + °C. Returns '—' for null/NaN so
 * the chip never shows "NaN°C" when an adapter is misbehaving.
 */
export function formatTemp(value) {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n)}°`;
}
