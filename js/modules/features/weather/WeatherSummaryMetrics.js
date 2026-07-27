import { formatTemp, labelFor } from './WeatherTypes.js';

export const DEFAULT_WEATHER_SUMMARY_METRICS = Object.freeze([
    'rainChanceToday',
    'wind',
    'feelsLike'
]);

export const WEATHER_SUMMARY_METRIC_OPTIONS = Object.freeze([
    { id: 'rainChanceToday', label: 'Probabilidad de lluvia hoy' },
    { id: 'rainTotalToday', label: 'Milímetros de lluvia hoy' },
    { id: 'wind', label: 'Viento actual' },
    { id: 'feelsLike', label: 'Sensación térmica' },
    { id: 'humidity', label: 'Humedad actual' },
    { id: 'uv', label: 'Índice UV' },
    { id: 'todayRange', label: 'Máxima y mínima de hoy' },
    { id: 'tomorrow', label: 'Clima de mañana' },
    { id: 'rainTomorrow', label: 'Lluvia de mañana' }
]);

const VALID_METRIC_IDS = new Set(WEATHER_SUMMARY_METRIC_OPTIONS.map(option => option.id));

function _numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function _formatNumber(value, suffix = '') {
    const number = _numberOrNull(value);
    return number === null ? '—' : `${Math.round(number * 10) / 10}${suffix}`;
}

function _findForecastDay(forecast, dateKey) {
    return (Array.isArray(forecast) ? forecast : []).find(day => day?.date === dateKey) || null;
}

function _tomorrowKey(todayKey) {
    const date = new Date(`${todayKey}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
}

export function normalizeWeatherSummaryMetrics(metrics) {
    const normalized = [];
    for (const id of Array.isArray(metrics) ? metrics : []) {
        if (!VALID_METRIC_IDS.has(id) || normalized.includes(id)) continue;
        normalized.push(id);
        if (normalized.length === 3) break;
    }

    for (const fallback of DEFAULT_WEATHER_SUMMARY_METRICS) {
        if (normalized.length >= 3) break;
        if (!normalized.includes(fallback)) normalized.push(fallback);
    }

    return normalized;
}

export function updateWeatherSummaryMetric(metrics, slot, metricId) {
    const normalized = normalizeWeatherSummaryMetrics(metrics);
    const slotIndex = Number(slot);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= normalized.length) return normalized;
    if (!VALID_METRIC_IDS.has(metricId)) return normalized;

    const existingIndex = normalized.indexOf(metricId);
    if (existingIndex >= 0 && existingIndex !== slotIndex) {
        [normalized[slotIndex], normalized[existingIndex]] = [normalized[existingIndex], normalized[slotIndex]];
        return normalized;
    }

    normalized[slotIndex] = metricId;
    return normalized;
}

export function resolveWeatherSummaryMetric(metricId, { current = {}, forecast = [], todayKey } = {}) {
    const today = _findForecastDay(forecast, todayKey);
    const tomorrow = _findForecastDay(forecast, _tomorrowKey(todayKey));

    const definitions = {
        rainChanceToday: {
            label: 'Lluvia hoy',
            value: _formatNumber(today?.precipChance ?? current.precipChance, '%'),
            detail: 'probabilidad',
            icon: 'rain'
        },
        rainTotalToday: {
            label: 'Lluvia hoy',
            value: _formatNumber(today?.precipMm ?? current.precipMm, ' mm'),
            detail: 'acumulado',
            icon: 'rain-total'
        },
        wind: {
            label: 'Viento',
            value: _formatNumber(current.windKph, ' km/h'),
            detail: 'actual',
            icon: 'wind'
        },
        feelsLike: {
            label: 'Sensación',
            value: formatTemp(current.feelsLike ?? current.temp),
            detail: 'térmica',
            icon: 'temperature'
        },
        humidity: {
            label: 'Humedad',
            value: _formatNumber(current.humidity, '%'),
            detail: 'actual',
            icon: 'humidity'
        },
        uv: {
            label: 'Índice UV',
            value: _formatNumber(current.uv),
            detail: 'actual',
            icon: 'sun'
        },
        todayRange: {
            label: 'Hoy',
            value: today ? `${formatTemp(today.tempMax)} / ${formatTemp(today.tempMin)}` : '—',
            detail: 'máx. / mín.',
            icon: 'temperature'
        },
        tomorrow: {
            label: 'Mañana',
            value: tomorrow ? `${formatTemp(tomorrow.tempMax)} / ${formatTemp(tomorrow.tempMin)}` : '—',
            detail: tomorrow ? labelFor(tomorrow.icon) : 'sin pronóstico',
            icon: tomorrow?.icon || 'unknown'
        },
        rainTomorrow: {
            label: 'Lluvia mañana',
            value: tomorrow ? _formatNumber(tomorrow.precipChance, '%') : '—',
            detail: tomorrow ? `${_formatNumber(tomorrow.precipMm, ' mm')} acumulados` : 'sin pronóstico',
            icon: 'rain'
        }
    };

    return {
        id: metricId,
        ...(definitions[metricId] || definitions.rainChanceToday)
    };
}
