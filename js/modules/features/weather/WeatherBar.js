/**
 * WeatherBar — operational weather summary for the attendance screen.
 *
 * The collapsed state answers the immediate question: what matters for
 * today's work? The expanded state adds the next hours, forecast and a
 * small editor for the three configurable summary metrics.
 */

import { state } from '../../core/AppState.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import {
    readCachedCurrent,
    readCachedForecast,
    readCachedHourly,
    getActiveLocation
} from './WeatherService.js';
import { formatTemp, labelFor } from './WeatherTypes.js';
import { getAggregatedAlert } from './WeatherAlertRules.js';
import {
    normalizeWeatherSummaryMetrics,
    resolveWeatherSummaryMetric,
    WEATHER_SUMMARY_METRIC_OPTIONS
} from './WeatherSummaryMetrics.js';

function _shortDayLabel(dateKey, todayKey) {
    if (dateKey === todayKey) return 'Hoy';
    const date = new Date(`${dateKey}T00:00:00`);
    return date.toLocaleDateString('es-DO', { weekday: 'short' }).replace('.', '');
}

function _lastWeatherSyncAt(cache) {
    const timestamps = [
        cache?.current?.fetchedAt,
        cache?.forecast?.fetchedAt,
        cache?.hourly?.fetchedAt
    ].filter(timestamp => Number.isFinite(timestamp) && timestamp > 0);
    return timestamps.length ? Math.max(...timestamps) : null;
}

function _formatRelativeSync(fetchedAt, now = Date.now()) {
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return 'Sin sincronizar';
    const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000);
    if (minutes < 1) return 'Actualizado hace un momento';
    if (minutes < 60) return `Actualizado hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Actualizado hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Actualizado hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function _isHidden() {
    return !(state.settings && state.settings.weatherEnabled === true);
}

function _iconSvg(name, className = '') {
    const common = `class="weather-line-icon ${className}" viewBox="0 0 24 24" aria-hidden="true"`;
    const icons = {
        rain: `<svg ${common}><path d="M7 18a4.5 4.5 0 0 1-.7-8.94A6 6 0 0 1 17.7 8a4 4 0 0 1-.7 7.94H7Z"/><path d="m8 19-1 2m5-2-1 2m5-2-1 2"/></svg>`,
        cloudy: `<svg ${common}><path d="M7 18a4.5 4.5 0 0 1-.7-8.94A6 6 0 0 1 17.7 8a4 4 0 0 1-.7 7.94H7Z"/></svg>`,
        sun: `<svg ${common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>`,
        stormy: `<svg ${common}><path d="M7 16a4.5 4.5 0 0 1-.7-8.94A6 6 0 0 1 17.7 6a4 4 0 0 1-.7 7.94h-3"/><path d="m12 13-3 5h3l-2 4 5-6h-3l2-3"/></svg>`,
        wind: `<svg ${common}><path d="M3 8h10a2 2 0 1 0-2-2M3 12h15a2 2 0 1 1-2 2M3 16h8"/></svg>`,
        temperature: `<svg ${common}><path d="M10 14.76V5a2 2 0 1 1 4 0v9.76a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/></svg>`,
        humidity: `<svg ${common}><path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z"/></svg>`,
        'rain-total': `<svg ${common}><path d="M12 3s5 5.4 5 9.5a5 5 0 0 1-10 0C7 8.4 12 3 12 3Z"/><path d="M5 20h14"/></svg>`,
        add: `<svg ${common}><path d="M12 5v14M5 12h14"/></svg>`,
        subtract: `<svg ${common}><path d="M5 12h14"/></svg>`,
        refresh: `<svg ${common}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.5-2L20 8M4 16l2.4 2a7 7 0 0 0 11.5-2"/></svg>`,
        sliders: `<svg ${common}><path d="M4 6h10M18 6h2M4 12h2m4 0h10M4 18h7m4 0h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>`
    };
    return icons[name] || icons.cloudy;
}

function _conditionIcon(icon, className = '') {
    if (icon === 'sunny' || icon === 'hot') return _iconSvg('sun', className);
    if (icon === 'rainy') return _iconSvg('rain', className);
    if (icon === 'stormy' || icon === 'hurricane') return _iconSvg('stormy', className);
    return _iconSvg('cloudy', className);
}

function _metricIcon(metric) {
    if (['sunny', 'partly-cloudy', 'cloudy', 'rainy', 'stormy', 'windy', 'hot', 'hurricane'].includes(metric.icon)) {
        return _conditionIcon(metric.icon);
    }
    return _iconSvg(metric.icon);
}

function _weatherNotice(current, hourly) {
    const alert = getAggregatedAlert(current);
    const peak = (Array.isArray(hourly) ? hourly : []).reduce((best, item) => {
        const chance = Number(item?.precipChance);
        return Number.isFinite(chance) && chance > Number(best?.precipChance ?? -1) ? item : best;
    }, null);

    if (peak && Number(peak.precipChance) >= 60) {
        return {
            level: Number(peak.precipChance) >= 85 ? 'danger' : 'warning',
            label: `Mayor probabilidad de lluvia a las ${peak.hourLabel} (${peak.precipChance}%)`
        };
    }
    if (alert.active) {
        return {
            level: alert.level === 'danger' ? 'danger' : 'warning',
            label: alert.label.replace(/^[^\p{L}\p{N}]+/u, '')
        };
    }
    return { level: 'favorable', label: 'Sin alertas importantes para la jornada' };
}

function _renderMetric(metric) {
    return `
        <div class="weather-metric-card" data-weather-metric="${metric.id}">
            <span class="weather-metric-icon">${_metricIcon(metric)}</span>
            <span class="weather-metric-copy">
                <span class="weather-metric-label">${escapeHTML(metric.label)}</span>
                <strong>${escapeHTML(metric.value)}</strong>
                <small>${escapeHTML(metric.detail)}</small>
            </span>
        </div>`;
}

function _renderSummary(current, forecast, todayKey, notice, expanded) {
    const metricIds = normalizeWeatherSummaryMetrics(state.settings?.weatherSummaryMetrics);
    const metrics = metricIds.map(id => resolveWeatherSummaryMetric(id, {
        current,
        forecast,
        todayKey
    }));

    return `
        <div class="weather-summary">
            <button type="button"
                    class="weather-summary-current"
                    data-att-action="toggle-weather"
                    aria-expanded="${expanded}"
                    aria-label="${expanded ? 'Ocultar detalle del clima' : 'Ver detalle del clima'}">
                <span class="weather-current-icon">${_conditionIcon(current.icon, 'is-current')}</span>
                <span class="weather-current-copy">
                    <span class="weather-current-title">Clima para la jornada</span>
                    <span class="weather-current-condition">${escapeHTML(labelFor(current.icon))} · ${escapeHTML(formatTemp(current.temp))}</span>
                </span>
            </button>

            <div class="weather-summary-metrics">
                ${metrics.map(_renderMetric).join('')}
            </div>

            <button type="button"
                    class="weather-expand-button"
                    data-att-action="toggle-weather"
                    aria-label="${expanded ? 'Contraer clima' : 'Desplegar clima'}">
                ${_iconSvg(expanded ? 'subtract' : 'add')}
            </button>
        </div>
        <div class="weather-notice weather-notice--${notice.level}">
            <span class="weather-notice-dot" aria-hidden="true"></span>
            <span>${escapeHTML(notice.label)}</span>
        </div>`;
}

function _renderHourly(hourly) {
    if (!Array.isArray(hourly) || hourly.length === 0) {
        return '<div class="weather-empty">Aún no hay pronóstico por hora.</div>';
    }
    return `
        <div class="weather-hour-grid">
            ${hourly.slice(0, 4).map((hour, index) => `
                <div class="weather-hour-card ${index === 0 ? 'is-now' : ''}">
                    <span class="weather-hour-label">${index === 0 ? 'Ahora' : escapeHTML(hour.hourLabel)}</span>
                    <span class="weather-hour-condition">${_conditionIcon(hour.icon)}</span>
                    <strong>${escapeHTML(formatTemp(hour.temp))}</strong>
                    <small>${_iconSvg('humidity')} ${Number.isFinite(Number(hour.precipChance)) ? `${hour.precipChance}%` : '—'}</small>
                </div>
            `).join('')}
        </div>`;
}

function _renderForecast(forecast, todayKey) {
    if (!Array.isArray(forecast) || forecast.length === 0) {
        return '<div class="weather-empty">Aún no hay pronóstico diario.</div>';
    }
    return `
        <div class="weather-day-grid">
            ${forecast.slice(0, 5).map(day => `
                <div class="weather-day-card ${day.date === todayKey ? 'is-today' : ''}">
                    <span>${escapeHTML(_shortDayLabel(day.date, todayKey))}</span>
                    ${_conditionIcon(day.icon)}
                    <strong>${escapeHTML(formatTemp(day.tempMax))} / ${escapeHTML(formatTemp(day.tempMin))}</strong>
                    <small>${_iconSvg('humidity')} ${Number.isFinite(Number(day.precipChance)) ? `${day.precipChance}%` : '—'}</small>
                </div>
            `).join('')}
        </div>`;
}

function _renderMetricEditor(selectedMetrics) {
    if (!state.weatherMetricEditorOpen) return '';
    return `
        <div class="weather-metric-editor" aria-label="Personalizar widgets del clima">
            <div class="weather-metric-editor-heading">
                <div>
                    <strong>Widgets del resumen</strong>
                    <small>Elegí qué información aparece en cada tarjeta.</small>
                </div>
                <button type="button" data-app-fn="toggleWeatherMetricEditor" aria-label="Cerrar personalización">×</button>
            </div>
            <div class="weather-metric-editor-grid">
                ${selectedMetrics.map((selectedId, slot) => `
                    <label>
                        <span>Tarjeta ${slot + 1}</span>
                        <select data-weather-metric-slot="${slot}">
                            ${WEATHER_SUMMARY_METRIC_OPTIONS.map(option => `
                                <option value="${option.id}" ${option.id === selectedId ? 'selected' : ''}>
                                    ${escapeHTML(option.label)}
                                </option>
                            `).join('')}
                        </select>
                    </label>
                `).join('')}
            </div>
        </div>`;
}

function _renderExpandedBody(current, hourly, forecast, todayKey, syncLabel) {
    const selectedMetrics = normalizeWeatherSummaryMetrics(state.settings?.weatherSummaryMetrics);
    const forecastExpanded = !!state.weatherForecastExpanded;

    return `
        <div class="weather-expanded-body">
            <section class="weather-section">
                <div class="weather-section-title">Próximas horas</div>
                ${_renderHourly(hourly)}
            </section>

            <section class="weather-section weather-forecast-section">
                <button type="button"
                        class="weather-section-toggle"
                        data-app-fn="toggleWeatherForecastExpanded"
                        aria-expanded="${forecastExpanded}">
                    <span>Próximos días</span>
                    ${_iconSvg(forecastExpanded ? 'subtract' : 'add')}
                </button>
                ${forecastExpanded ? _renderForecast(forecast, todayKey) : ''}
            </section>

            <div class="weather-footer">
                <span class="weather-sync-label">${escapeHTML(syncLabel)}</span>
                <div class="weather-footer-actions">
                    <button type="button"
                            class="weather-customize-button ${state.weatherMetricEditorOpen ? 'is-active' : ''}"
                            data-app-fn="toggleWeatherMetricEditor">
                        ${_iconSvg('sliders')} Personalizar resumen
                    </button>
                    <button type="button"
                            class="weather-refresh-button"
                            data-app-fn="forceRefreshWeather"
                            ${state.weather?.isRefreshing ? 'disabled' : ''}
                            aria-label="Actualizar clima">
                        ${_iconSvg('refresh')}
                    </button>
                </div>
            </div>

            ${_renderMetricEditor(selectedMetrics)}
        </div>`;
}

export function WeatherBar() {
    if (_isHidden()) return '';

    const expanded = !!state.weatherExpanded;
    const current = readCachedCurrent(state);
    const forecast = readCachedForecast(state);
    const hourly = readCachedHourly(state);
    const todayKey = new Date().toISOString().slice(0, 10);
    const location = getActiveLocation(state);
    const notice = _weatherNotice(current, hourly);
    const syncLabel = _formatRelativeSync(_lastWeatherSyncAt(state.weather?.cache));

    return `
        <section class="weather-bar weather-bar--${expanded ? 'expanded' : 'collapsed'}"
                 aria-label="Clima para ${escapeHTML(location.name)}">
            ${_renderSummary(current, forecast, todayKey, notice, expanded)}
            ${expanded ? _renderExpandedBody(current, hourly, forecast, todayKey, syncLabel) : ''}
        </section>`;
}
