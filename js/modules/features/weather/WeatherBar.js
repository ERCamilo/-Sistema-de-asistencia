/**
 * 🌤️ WeatherBar — inline weather strip that replaces the old color-legend.
 *
 * Two layouts driven by state.weatherExpanded:
 *
 *   COLLAPSED  ▶  vista rápida del pronóstico
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  🌤️ Hoy 28°   ☀️ 30  🌧️ 27  ⛅ 26  ☀️ 31  ▼              │
 *   └────────────────────────────────────────────────────────────┘
 *
 *   EXPANDED   ▼  detalle de hoy + próximas horas
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  🌤️ Tormenta · 28°                                       ▲ │
 *   │  💧 85%  💨 15 km/h  🌡️ Sensación 31°                       │
 *   │  Próximas 24 horas                                          │
 *   │  [Ahora][03:00][06:00][09:00][12:00][15:00][18:00][21:00]   │
 *   │  Próximos días                                              │
 *   │  [Hoy][Jue][Vie][Sáb][Dom]                                  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Tap anywhere on the header → toggleWeatherExpanded. Reads cached data
 * exclusively — the controller pre-warms it at boot.
 */

import { state } from '../../core/AppState.js';
import {
    readCachedCurrent,
    readCachedForecast,
    readCachedHourly,
    getActiveLocation
} from './WeatherService.js';
import { emojiFor, labelFor, formatTemp } from './WeatherTypes.js';
import { getWindAlert, getPrecipAlert, getTempAlert, getAggregatedAlert, getWindGustAlert, getPressureAlert, getVisAlert, getUvAlert, ALERT_LEVEL } from './WeatherAlertRules.js';

/**
 * Spanish-locale weekday for a YYYY-MM-DD key. "Hoy" shortcut when the key
 * matches today. Strips the trailing dot that Intl tacks on for "abbreviated".
 */
function _shortDayLabel(dateKey, todayKey) {
    if (dateKey === todayKey) return 'Hoy';
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString('es-DO', { weekday: 'short' }).replace('.', '');
}

function _isHidden() {
    // Default OFF: the bar only renders when the admin opts in explicitly via
    // Ajustes. Any other value (undefined, false, null) keeps it hidden.
    return !(state.settings && state.settings.weatherEnabled === true);
}

export function WeatherBar() {
    if (_isHidden()) return '';

    const expanded = !!state.weatherExpanded;
    const current = readCachedCurrent(state);
    const forecast = readCachedForecast(state);
    const hourly = readCachedHourly(state);
    const loc = getActiveLocation(state);
    const today = new Date().toISOString().slice(0, 10);

    return `
        <div class="weather-bar" style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; margin-bottom: 16px; overflow: hidden;">
            ${expanded ? _expandedHeader(current, loc) : _collapsedHeader(current, forecast, today)}
            ${expanded ? _expandedBody(current, hourly, forecast, today) : ''}
        </div>
    `;
}

/**
 * Collapsed header is the entire bar surface — the next-5-days mini strip
 * lives here so the user has at-a-glance forecast without expanding.
 */
function _collapsedHeader(current, forecast, today) {
    const todayEmoji = emojiFor(current.icon);
    const todayTemp = formatTemp(current.temp);
    const previewDays = (forecast || []).slice(0, 5);
    const alert = getAggregatedAlert(current);

    return `
        <div role="button" tabindex="0"
             data-att-action="toggle-weather"
             aria-expanded="false"
             aria-label="Ver detalle del clima"
             style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; flex-wrap: nowrap; overflow-x: auto; ${alert.active ? `background: rgba(248, 113, 113, 0.08); border-left: 4px solid ${alert.color};` : ''}">
            <!-- Today summary / Alert -->
            ${alert.active ? `
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    <span style="font-size: 1.1rem; line-height: 1;" aria-hidden="true">⚠️</span>
                    <span style="font-size: 0.8rem; color: ${alert.color}; font-weight: 800; text-transform: uppercase; white-space: nowrap;">${alert.label}</span>
                </div>
            ` : `
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    <span style="font-size: 1.2rem; line-height: 1;" aria-hidden="true">${todayEmoji}</span>
                    <span style="font-size: 0.85rem; color: #f1f5f9; font-weight: 800;">Hoy ${todayTemp}</span>
                </div>
            `}
            <!-- Vertical divider -->
            <div style="width: 1px; height: 24px; background: #334155; flex-shrink: 0;"></div>
            <!-- Next-days strip -->
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                ${previewDays.slice(1).map(d => `
                    <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;" title="${_shortDayLabel(d.date, today)} · ${labelFor(d.icon)}">
                        <span style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">${_shortDayLabel(d.date, today)}</span>
                        <span style="font-size: 1rem; line-height: 1;" aria-hidden="true">${emojiFor(d.icon)}</span>
                        <span style="font-size: 0.75rem; color: #f1f5f9; font-weight: 700;">${formatTemp(d.tempMax)}</span>
                    </div>
                `).join('')}
                ${previewDays.length === 0 ? `
                    <span style="color: #64748b; font-size: 0.78rem;">Sin pronóstico disponible</span>
                ` : ''}
            </div>
            <!-- Toggle indicator -->
            <div style="color: #64748b; font-size: 1.1rem; flex-shrink: 0;">▶</div>
        </div>
    `;
}

function _expandedHeader(current, loc) {
    const emoji = emojiFor(current.icon);
    const label = labelFor(current.icon);
    return `
        <div role="button" tabindex="0"
             data-att-action="toggle-weather"
             aria-expanded="true"
             aria-label="Cerrar detalle del clima"
             style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid #334155;">
            <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                <span style="font-size: 1.8rem; line-height: 1;" aria-hidden="true">${emoji}</span>
                <div style="min-width: 0;">
                    <div style="color: #f1f5f9; font-weight: 800; font-size: 1rem; line-height: 1.2;">${label}</div>
                    <div style="color: #94a3b8; font-size: 0.72rem;">${loc.name}</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                <div style="font-size: 1.4rem; font-weight: 900; color: #f1f5f9;">${formatTemp(current.temp)}</div>
                <div style="color: #64748b; font-size: 1.1rem;">▼</div>
            </div>
        </div>
    `;
}

function _expandedBody(current, hourly, forecast, today) {
    const windAlert = getWindAlert(current.windKph);
    const precipAlert = getPrecipAlert(current.precipMm);
    const tempAlert = getTempAlert(current.feelsLike !== null ? current.feelsLike : current.temp);
    const uvAlert = getUvAlert(current.uv);

    // Parámetros dinámicos (solo se muestran si hay alertas)
    const gustAlert = getWindGustAlert(current.windGustKph);
    const pressAlert = getPressureAlert(current.pressureMb);
    const visAlert = getVisAlert(current.visKm);

    const showGust = gustAlert.level !== ALERT_LEVEL.NORMAL;
    const showPress = pressAlert.level !== ALERT_LEVEL.NORMAL;
    const showVis = visAlert.level !== ALERT_LEVEL.NORMAL;

    return `
        <div style="padding: 12px 14px;">
            <!-- Vitals row -->
            <div style="display: flex; gap: 14px; font-size: 0.78rem; color: #94a3b8; margin-bottom: 14px; flex-wrap: wrap;">
                <span title="Probabilidad de precipitación">💧 Probabilidad: <strong style="color: #f1f5f9;">${current.precipChance ?? '—'}%</strong></span>
                <span title="Cantidad de lluvia acumulada">🧊 Lluvia: <strong style="color: ${precipAlert.color};">${current.precipMm ?? '0'} mm</strong></span>
                <span title="Velocidad del viento">💨 Viento: <strong style="color: ${windAlert.color};">${current.windKph ?? '—'} km/h</strong></span>
                ${current.feelsLike != null ? `<span title="Sensación térmica">🌡️ Sensación: <strong style="color: ${tempAlert.color};">${formatTemp(current.feelsLike)}</strong></span>` : ''}
                ${current.humidity != null ? `<span title="Humedad">💦 Humedad: <strong style="color: #f1f5f9;">${current.humidity}%</strong></span>` : ''}
                <span title="Índice UV">☀️ Índice UV: <strong style="color: ${uvAlert.color};">${current.uv ?? '—'} (${uvAlert.label})</strong></span>
                
                <!-- Campos dinámicos de alerta -->
                ${showGust ? `<span title="Rachas de viento">💨 Ráfagas: <strong style="color: ${gustAlert.color};">${current.windGustKph} km/h</strong></span>` : ''}
                ${showVis ? `<span title="Visibilidad">🌫️ Visibilidad: <strong style="color: ${visAlert.color};">${current.visKm} km</strong></span>` : ''}
                ${showPress ? `<span title="Presión atmosférica">📉 Presión: <strong style="color: ${pressAlert.color};">${current.pressureMb} mb</strong></span>` : ''}
            </div>

            <!-- Hourly strip (24h ahead) -->
            ${hourly.length > 0 ? `
                <div style="margin-bottom: 14px;">
                    <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px;">Próximas 24 horas</div>
                    <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin;">
                        ${hourly.map((h, idx) => `
                            <div style="flex: 0 0 auto; min-width: 58px; text-align: center; padding: 8px 4px; background: #0f172a; border-radius: 8px; border: 1px solid ${idx === 0 ? '#06b6d4' : 'transparent'};">
                                <div style="font-size: 0.6rem; color: #94a3b8; font-weight: 700;">${idx === 0 ? 'Ahora' : h.hourLabel}</div>
                                <div style="font-size: 1.25rem; line-height: 1.2;" aria-hidden="true">${emojiFor(h.icon)}</div>
                                <div style="font-size: 0.78rem; color: #f1f5f9; font-weight: 700;">${formatTemp(h.temp)}</div>
                                <div style="font-size: 0.6rem; color: #64748b; line-height: 1.1;">💧${h.precipChance ?? '—'}%</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Daily forecast strip -->
            ${forecast.length > 0 ? `
                <div>
                    <div style="font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px;">Próximos días</div>
                    <div style="display: grid; grid-template-columns: repeat(${Math.min(forecast.length, 5)}, 1fr); gap: 6px;">
                        ${forecast.slice(0, 5).map(day => `
                            <div style="text-align: center; padding: 8px 4px; background: #0f172a; border-radius: 8px; border: 1px solid ${day.date === today ? '#06b6d4' : 'transparent'};">
                                <div style="font-size: 0.6rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">${_shortDayLabel(day.date, today)}</div>
                                <div style="font-size: 1.4rem; line-height: 1.2;" aria-hidden="true">${emojiFor(day.icon)}</div>
                                <div style="font-size: 0.72rem; color: #f1f5f9; font-weight: 700;">${formatTemp(day.tempMax)}</div>
                                <div style="font-size: 0.62rem; color: #64748b;">${formatTemp(day.tempMin)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- Footer: provider tag + refresh button -->
            <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                <button type="button" data-app-fn="forceRefreshWeather"
                        ${state.weather?.isRefreshing ? 'disabled' : ''}
                        style="background: transparent; color: #06b6d4; border: 1px solid #334155; border-radius: 4px; padding: 4px 8px; font-size: 0.65rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    ${state.weather?.isRefreshing ? 'Actualizando...' : '🔄 Actualizar clima'}
                </button>
                <span style="font-size: 0.6rem; color: #64748b;">Fuente: ${state.weather?.cache?.provider || 'mock'}</span>
            </div>
        </div>
    `;
}
