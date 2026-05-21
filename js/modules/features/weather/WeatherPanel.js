/**
 * 🌤️ WeatherPanel — floating panel shown when the chip is tapped.
 *
 * Layout:
 *   Header:   ⛈️ Tormenta · 28°C
 *   Subline:  💧 85% precip · 💨 15 km/h
 *   Days:     [Hoy] [Mié] [Jue] [Vie] [Sáb]
 *
 * Reads cached current + forecast. WeatherController is responsible for
 * triggering a refresh before opening so the data is fresh.
 */

import { state } from '../../core/AppState.js';
import { readCachedCurrent, readCachedForecast, readCachedHourly, getActiveLocation } from './WeatherService.js';
import { emojiFor, labelFor, formatTemp } from './WeatherTypes.js';
import { formatDateShort } from '../../utils/DateUtils.js';

function _shortDayLabel(dateKey, todayKey) {
    if (dateKey === todayKey) return 'Hoy';
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString('es-DO', { weekday: 'short' }).replace('.', '');
}

export function WeatherPanel() {
    if (!state.weather || !state.weather.panelOpen) return '';

    const current = readCachedCurrent(state);
    const forecast = readCachedForecast(state);
    const hourly = readCachedHourly(state);
    const loc = getActiveLocation(state);
    const today = new Date().toISOString().slice(0, 10);

    const currentEmoji = emojiFor(current.icon);
    const currentLabel = labelFor(current.icon);

    return `
        <div role="dialog" aria-modal="false" class="weather-panel"
             onclick="event.stopPropagation()"
             style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 8px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px 16px; width: max-content; min-width: 300px; max-width: min(420px, calc(100vw - 24px)); z-index: 1000; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">

            <!-- Header: icon + label + temp -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.6rem; line-height: 1;" aria-hidden="true">${currentEmoji}</span>
                    <div>
                        <div style="color: #f1f5f9; font-weight: 700; font-size: 0.95rem;">${currentLabel}</div>
                        <div style="color: #94a3b8; font-size: 0.7rem;">${loc.name}</div>
                    </div>
                </div>
                <div style="font-size: 1.4rem; font-weight: 900; color: #f1f5f9;">${formatTemp(current.temp)}</div>
            </div>

            <!-- Subline: precip + wind -->
            <div style="display: flex; gap: 14px; font-size: 0.75rem; color: #94a3b8; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #334155;">
                <span title="Probabilidad de precipitación">💧 ${current.precipChance ?? '—'}%</span>
                <span title="Viento">💨 ${current.windKph ?? '—'} km/h</span>
                ${current.feelsLike != null ? `<span title="Sensación térmica">🌡️ Sensación ${formatTemp(current.feelsLike)}</span>` : ''}
            </div>

            <!-- Hourly strip (24h ahead, 3h steps) -->
            ${hourly.length > 0 ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px;">Próximas 24 horas</div>
                    <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin;">
                        ${hourly.map((h, idx) => `
                            <div style="flex: 0 0 auto; min-width: 54px; text-align: center; padding: 6px 4px; background: #0f172a; border-radius: 6px; border: 1px solid ${idx === 0 ? '#06b6d4' : 'transparent'};">
                                <div style="font-size: 0.6rem; color: #94a3b8; font-weight: 700;">${idx === 0 ? 'Ahora' : h.hourLabel}</div>
                                <div style="font-size: 1.2rem; line-height: 1.2;" aria-hidden="true">${emojiFor(h.icon)}</div>
                                <div style="font-size: 0.7rem; color: #f1f5f9; font-weight: 700;">${formatTemp(h.temp)}</div>
                                <div style="font-size: 0.55rem; color: #64748b; line-height: 1.1;">💧${h.precipChance ?? '—'}%</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 6px;">Próximos días</div>
            ` : ''}

            <!-- Daily forecast strip -->
            ${forecast.length === 0 ? `
                <div style="text-align: center; color: #64748b; font-size: 0.8rem; padding: 8px;">Sin pronóstico disponible</div>
            ` : `
                <div style="display: grid; grid-template-columns: repeat(${Math.min(forecast.length, 5)}, 1fr); gap: 6px;">
                    ${forecast.slice(0, 5).map(day => `
                        <div style="text-align: center; padding: 8px 4px; background: #0f172a; border-radius: 8px; border: 1px solid ${day.date === today ? '#06b6d4' : 'transparent'};">
                            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.03em;">${_shortDayLabel(day.date, today)}</div>
                            <div style="font-size: 1.4rem; line-height: 1.2;" aria-hidden="true">${emojiFor(day.icon)}</div>
                            <div style="font-size: 0.7rem; color: #f1f5f9; font-weight: 700;">${formatTemp(day.tempMax)}</div>
                            <div style="font-size: 0.65rem; color: #64748b;">${formatTemp(day.tempMin)}</div>
                        </div>
                    `).join('')}
                </div>
            `}

            <!-- Footer: data source + close -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid #334155;">
                <span style="font-size: 0.65rem; color: #64748b;">Fuente: ${state.weather?.cache?.provider || 'mock'}</span>
                <button type="button" data-app-fn="closeWeatherPanel"
                        style="background: transparent; color: #94a3b8; border: none; cursor: pointer; font-size: 0.75rem; padding: 4px 8px;">
                    Cerrar
                </button>
            </div>
        </div>
    `;
}

/** Helper for AttendanceUI: a containing div with pos:relative so the panel
 *  anchors correctly under the chip. */
export function WeatherChipWithPanel(chipHTML) {
    if (!chipHTML) return '';
    return `<div class="weather-chip-host" style="position: relative; display: inline-block;">${chipHTML}${WeatherPanel()}</div>`;
}
