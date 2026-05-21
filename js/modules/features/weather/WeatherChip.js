/**
 * 🌤️ WeatherChip — small pill rendered next to the date navpill.
 *
 * Shape:  [⛈️ 28°]   tappable, opens WeatherPanel
 *         [🌐 ---]   offline / no cached data
 *
 * The chip never blocks rendering on a fetch — it reads from
 * readCachedCurrent and accepts that "unknown" is a valid render state.
 * A WeatherController.refresh() call kicks off the actual fetch on view
 * mount, which then re-renders the chip with real numbers.
 */

import { state } from '../../core/AppState.js';
import { readCachedCurrent } from './WeatherService.js';
import { emojiFor, formatTemp } from './WeatherTypes.js';

export function WeatherChip() {
    // Optional kill-switch: settings.weatherEnabled === false hides the chip.
    if (state.settings && state.settings.weatherEnabled === false) return '';

    const snapshot = readCachedCurrent(state);
    const emoji = emojiFor(snapshot.icon);
    const temp = formatTemp(snapshot.temp);

    return `
        <button type="button"
                class="weather-chip"
                data-app-fn="toggleWeatherPanel"
                aria-label="Ver pronóstico del clima"
                title="Pronóstico del clima"
                style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; height: 28px; background: rgba(15,23,42,0.6); border: 1px solid #334155; border-radius: 14px; color: #f1f5f9; font-size: 0.78rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
            <span aria-hidden="true">${emoji}</span>
            <span>${temp}</span>
        </button>
    `;
}
