/**
 * WeatherApiAdapter — adapter para WeatherAPI.com (free tier).
 *
 * Implementa el mismo contrato que MockAdapter:
 *   getCurrent(lat, lon, opts)  -> { icon, temp, feelsLike, precipChance, windKph, humidity }
 *   getForecast(lat, lon, days, opts) -> [{ date, icon, tempMax, tempMin, precipChance, windKph }]
 *   getHourly(lat, lon, hours, stepHours, opts) -> [{ isoHour, hourLabel, icon, temp, precipChance, windKph }]
 *   getAlerts(lat, lon, opts)   -> []
 *
 * Diferencia clave: todos los metodos son async (retornan Promise).
 * WeatherService detecta si el retorno es thenable y lo maneja.
 *
 * Free tier de WeatherAPI.com:
 *   - 1M calls/mes, sin tarjeta
 *   - forecast maximo 3 dias (incluye hourly)
 *   - sin endpoint de alertas
 *
 * La API key se pasa via opts.apiKey por el WeatherService.
 */

import { WEATHER_ICON } from '../WeatherTypes.js';

const BASE_URL = 'https://api.weatherapi.com/v1';

/**
 * Mapeo de condition codes de WeatherAPI a iconos normalizados.
 * WeatherAPI usa un campo `condition.code` numerico.
 * Ref: https://www.weatherapi.com/docs/weather_conditions.json
 */
const CODE_TO_ICON = {
    // Sunny / Clear
    1000: WEATHER_ICON.SUNNY,
    // Partly cloudy
    1003: WEATHER_ICON.PARTLY_CLOUDY,
    // Cloudy / Overcast
    1006: WEATHER_ICON.CLOUDY,
    1009: WEATHER_ICON.CLOUDY,
    // Mist / Fog
    1030: WEATHER_ICON.CLOUDY,
    1135: WEATHER_ICON.CLOUDY,
    1147: WEATHER_ICON.CLOUDY,
    // Drizzle / Light rain
    1063: WEATHER_ICON.RAINY,
    1150: WEATHER_ICON.RAINY,
    1153: WEATHER_ICON.RAINY,
    1168: WEATHER_ICON.RAINY,
    1171: WEATHER_ICON.RAINY,
    1180: WEATHER_ICON.RAINY,
    1183: WEATHER_ICON.RAINY,
    1186: WEATHER_ICON.RAINY,
    1189: WEATHER_ICON.RAINY,
    1192: WEATHER_ICON.RAINY,
    1195: WEATHER_ICON.RAINY,
    1198: WEATHER_ICON.RAINY,
    1201: WEATHER_ICON.RAINY,
    1240: WEATHER_ICON.RAINY,
    1243: WEATHER_ICON.RAINY,
    1246: WEATHER_ICON.RAINY,
    // Thunderstorm
    1087: WEATHER_ICON.STORMY,
    1273: WEATHER_ICON.STORMY,
    1276: WEATHER_ICON.STORMY,
    1279: WEATHER_ICON.STORMY,
    1282: WEATHER_ICON.STORMY,
    // Snow / Sleet / Ice (poco comun en RD, pero completo)
    1066: WEATHER_ICON.CLOUDY,
    1069: WEATHER_ICON.RAINY,
    1072: WEATHER_ICON.RAINY,
    1114: WEATHER_ICON.WINDY,
    1117: WEATHER_ICON.WINDY,
    1204: WEATHER_ICON.RAINY,
    1207: WEATHER_ICON.RAINY,
    1210: WEATHER_ICON.CLOUDY,
    1213: WEATHER_ICON.CLOUDY,
    1216: WEATHER_ICON.CLOUDY,
    1219: WEATHER_ICON.CLOUDY,
    1222: WEATHER_ICON.CLOUDY,
    1225: WEATHER_ICON.CLOUDY,
    1237: WEATHER_ICON.RAINY,
    1249: WEATHER_ICON.RAINY,
    1252: WEATHER_ICON.RAINY,
    1255: WEATHER_ICON.CLOUDY,
    1258: WEATHER_ICON.CLOUDY,
    1261: WEATHER_ICON.RAINY,
    1264: WEATHER_ICON.RAINY
};

function _mapIcon(conditionCode, tempC) {
    // Hot override: si la temp supera 35C y el cielo esta despejado/parcial
    if (tempC >= 35 && (conditionCode === 1000 || conditionCode === 1003)) {
        return WEATHER_ICON.HOT;
    }
    return CODE_TO_ICON[conditionCode] || WEATHER_ICON.UNKNOWN;
}

/**
 * Construye la URL con query params. Usa `lang=es` para obtener
 * descripciones en espanol (no las usamos directamente, pero ayuda al debug).
 */
function _buildUrl(endpoint, apiKey, params = {}) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('lang', 'es');
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
    }
    return url.toString();
}

async function _fetchJSON(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(8000) // 8s timeout
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`WeatherAPI ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json();
}

// ─── Public API ───────────────────────────────────────────────

export async function getCurrent(lat, lon, opts = {}) {
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('WeatherApiAdapter: falta apiKey');

    const url = _buildUrl('current.json', apiKey, { q: `${lat},${lon}` });
    const json = await _fetchJSON(url);
    const c = json.current;

    return {
        provider: 'weatherapi',
        fetchedAt: Date.now(),
        location: { lat, lon },
        icon: _mapIcon(c.condition.code, c.temp_c),
        temp: Math.round(c.temp_c),
        feelsLike: Math.round(c.feelslike_c),
        precipChance: c.cloud ?? null, // current.json no trae precip chance directamente
        precipMm: c.precip_mm || 0,
        windKph: Math.round(c.wind_kph),
        humidity: c.humidity,
        uv: c.uv ?? 0,
        windGustKph: Math.round(c.gust_kph) || 0,
        pressureMb: Math.round(c.pressure_mb) || 1013,
        visKm: Math.round(c.vis_km) || 10
    };
}

export async function getForecast(lat, lon, days = 3, opts = {}) {
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('WeatherApiAdapter: falta apiKey');

    // Free tier maximo 3 dias
    const safeDays = Math.min(days, 3);
    const url = _buildUrl('forecast.json', apiKey, {
        q: `${lat},${lon}`,
        days: safeDays,
        alerts: 'no'
    });
    const json = await _fetchJSON(url);

    return (json.forecast?.forecastday || []).map(day => ({
        date: day.date,
        icon: _mapIcon(day.day.condition.code, day.day.maxtemp_c),
        tempMax: Math.round(day.day.maxtemp_c),
        tempMin: Math.round(day.day.mintemp_c),
        precipChance: day.day.daily_chance_of_rain ?? 0,
        precipMm: day.day.totalprecip_mm || 0,
        windKph: Math.round(day.day.maxwind_kph)
    }));
}

export async function getHourly(lat, lon, hours = 24, stepHours = 3, opts = {}) {
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('WeatherApiAdapter: falta apiKey');

    // El forecast.json de WeatherAPI incluye datos horarios por dia
    const days = Math.min(Math.ceil(hours / 24), 3);
    const url = _buildUrl('forecast.json', apiKey, {
        q: `${lat},${lon}`,
        days,
        alerts: 'no'
    });
    const json = await _fetchJSON(url);

    const now = new Date();
    const cutoff = new Date(now.getTime() + hours * 3600_000);
    const out = [];

    for (const day of (json.forecast?.forecastday || [])) {
        for (const h of (day.hour || [])) {
            const t = new Date(h.time_epoch * 1000);
            if (t < now) continue;
            if (t > cutoff) break;

            // Filtrar por step: solo incluir horas alineadas al step
            const hourOfDay = t.getHours();
            if (stepHours > 1 && hourOfDay % stepHours !== 0 && out.length > 0) continue;

            out.push({
                isoHour: t.toISOString(),
                hourLabel: `${String(t.getHours()).padStart(2, '0')}:00`,
                icon: _mapIcon(h.condition.code, h.temp_c),
                temp: Math.round(h.temp_c),
                precipChance: h.chance_of_rain ?? 0,
                precipMm: h.precip_mm || 0,
                windKph: Math.round(h.wind_kph)
            });
        }
    }

    return out;
}

/**
 * WeatherAPI free tier no tiene endpoint de alertas.
 * Retorna array vacio para cumplir el contrato.
 */
export async function getAlerts(_lat, _lon, _opts = {}) {
    return [];
}

export const WeatherApiAdapter = {
    getCurrent,
    getForecast,
    getHourly,
    getAlerts,
    providerName: 'weatherapi'
};
