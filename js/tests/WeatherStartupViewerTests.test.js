import fs from 'node:fs';
import path from 'node:path';
import { scheduleInitialWeatherRefresh } from '../modules/features/weather/WeatherController.js';
import { getWeatherRuntimeState } from '../modules/features/weather/WeatherRuntime.js';
import { getWeatherViewerLayout, WeatherBar } from '../modules/features/weather/WeatherBar.js';
import { initializeWeatherAfterHydration } from '../modules/features/weather/WeatherStartup.js';
import { state } from '../modules/core/AppState.js';
import { hydrateApplicationAndInitializeWeather } from '../modules/core/StartupOrchestrator.js';

const weatherStyles = fs.readFileSync(
    path.resolve(__dirname, '../../css/attendance_ui.css'),
    'utf8'
);
describe('Weather startup refresh', () => {
    test('hydrates application data before invoking the production weather initializer', async () => {
        const events = [];
        const loadApplicationData = jest.fn(async () => { events.push('loaded'); });
        const initializeWeather = jest.fn(() => { events.push('weather'); });

        await hydrateApplicationAndInitializeWeather({
            loadApplicationData,
            initializeWeatherAfterHydration: initializeWeather
        });

        expect(events).toEqual(['loaded', 'weather']);
        expect(loadApplicationData).toHaveBeenCalledTimes(1);
        expect(initializeWeather).toHaveBeenCalledTimes(1);
    });

    test('preserves app startup failure semantics by skipping weather when hydration fails', async () => {
        const loadFailure = new Error('load failed');
        const loadApplicationData = jest.fn(() => Promise.reject(loadFailure));
        const initializeWeather = jest.fn();

        await expect(hydrateApplicationAndInitializeWeather({
            loadApplicationData,
            initializeWeatherAfterHydration: initializeWeather
        })).rejects.toBe(loadFailure);
        expect(initializeWeather).not.toHaveBeenCalled();
    });

    test('does not await weather initialization after hydration', async () => {
        let resolveWeather;
        const weatherPromise = new Promise(resolve => { resolveWeather = resolve; });
        const initializeWeather = jest.fn(() => weatherPromise);

        await expect(hydrateApplicationAndInitializeWeather({
            loadApplicationData: jest.fn(() => Promise.resolve()),
            initializeWeatherAfterHydration: initializeWeather
        })).resolves.toBeUndefined();
        expect(initializeWeather).toHaveBeenCalledTimes(1);

        resolveWeather();
        await weatherPromise;
    });

    test('runs the post-hydration production startup path once without awaiting network work', () => {
        const savedState = { settings: { weatherEnabled: true, weatherApiKey: 'saved-key' } };
        const setProvider = jest.fn();
        const schedule = jest.fn(() => true);

        const started = initializeWeatherAfterHydration({ currentState: savedState, setProvider, schedule });

        expect(started).toBe(true);
        expect(setProvider).toHaveBeenCalledWith(savedState, 'weatherapi');
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(schedule).toHaveBeenCalledWith({ currentState: savedState });
    });

    test('starts once on the next microtask only when the saved feature is enabled and online', async () => {
        const savedState = { settings: { weatherEnabled: true } };
        const refresh = jest.fn(() => Promise.resolve(false));

        expect(scheduleInitialWeatherRefresh({ currentState: savedState, refresh, online: true })).toBe(true);
        expect(refresh).not.toHaveBeenCalled();

        await Promise.resolve();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(scheduleInitialWeatherRefresh({ currentState: savedState, refresh, online: true })).toBe(false);
        expect(savedState.weather).toBeUndefined();
        expect(getWeatherRuntimeState(savedState).initialRefreshScheduled).toBe(true);
        expect(JSON.stringify(savedState)).not.toMatch(/initialRefreshScheduled|loadState|errorMessage|isRefreshing/);
    });

    test('removes legacy persisted runtime fields even when weather is disabled', () => {
        const legacySavedState = {
            settings: { weatherEnabled: false },
            weather: {
                cache: { current: { data: { temp: 28 } } },
                provider: 'mock',
                loadState: 'error',
                errorMessage: 'Legacy network error',
                isRefreshing: true,
                initialRefreshScheduled: true
            }
        };

        expect(initializeWeatherAfterHydration({ currentState: legacySavedState })).toBe(false);
        expect(legacySavedState.weather).toEqual({
            cache: { current: { data: { temp: 28 } } },
            provider: 'mock'
        });
        expect(JSON.stringify(legacySavedState)).not.toMatch(/loadState|errorMessage|isRefreshing|initialRefreshScheduled/);
    });

    test('does not fetch while disabled or offline, and exposes offline state without geolocation', () => {
        const disabled = { settings: { weatherEnabled: false } };
        const offline = { settings: { weatherEnabled: true } };
        const refresh = jest.fn();

        expect(scheduleInitialWeatherRefresh({ currentState: disabled, refresh, online: true })).toBe(false);
        expect(scheduleInitialWeatherRefresh({ currentState: offline, refresh, online: false })).toBe(false);
        expect(refresh).not.toHaveBeenCalled();
        expect(offline.weather).toBeUndefined();
        expect(getWeatherRuntimeState(offline).loadState).toBe('offline');
        expect(initializeWeatherAfterHydration({
            currentState: disabled,
            setProvider: jest.fn(),
            schedule: refresh
        })).toBe(false);
    });

});

describe('Weather viewer narrow-screen contract', () => {
    test('uses the same pure layout model in production rendering', () => {
        expect(getWeatherViewerLayout(480)).toBe('narrow');
        expect(getWeatherViewerLayout(481)).toBe('standard');
        expect(getWeatherViewerLayout()).toBe('standard');
        expect(getWeatherViewerLayout(null)).toBe('standard');
    });

    test('renders the actual expanded viewer with narrow controls at 327px', () => {
        const previous = {
            settings: state.settings,
            weather: state.weather,
            weatherExpanded: state.weatherExpanded,
            weatherForecastExpanded: state.weatherForecastExpanded,
            weatherMetricEditorOpen: state.weatherMetricEditorOpen,
            innerWidth: window.innerWidth
        };
        const host = document.createElement('div');

        try {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 327 });
            state.settings = { ...state.settings, weatherEnabled: true };
            state.weather = {
                provider: 'mock',
                cache: {
                    current: { data: { icon: 'sunny', temp: 28, precipChance: 10, windKph: 12 } },
                    forecast: { data: [] },
                    hourly: { data: [] }
                }
            };
            state.weatherExpanded = true;
            state.weatherForecastExpanded = false;
            state.weatherMetricEditorOpen = false;
            host.innerHTML = WeatherBar();
            document.body.append(host);

            expect(host.querySelector('.weather-bar--narrow')).not.toBeNull();
            expect(host.querySelector('[data-app-fn="forceRefreshWeather"]')?.getAttribute('aria-label')).toBe('Actualizar clima');
            expect(host.querySelector('[data-app-fn="toggleWeatherForecastExpanded"]')?.textContent).toContain('Próximos días');
            expect(host.querySelector('[data-app-fn="toggleWeatherMetricEditor"]')?.textContent).toContain('Personalizar resumen');
        } finally {
            host.remove();
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous.innerWidth });
            state.settings = previous.settings;
            state.weather = previous.weather;
            state.weatherExpanded = previous.weatherExpanded;
            state.weatherForecastExpanded = previous.weatherForecastExpanded;
            state.weatherMetricEditorOpen = previous.weatherMetricEditorOpen;
        }
    });

    test('reflows the operational viewer without horizontal scrolling or clipped metric labels', () => {
        expect(weatherStyles).toMatch(/\.weather-summary\s*\{[\s\S]*?grid-template-columns:\s*minmax\(180px,\s*1\.15fr\)\s+minmax\(0,\s*1\.8fr\)\s+44px/);
        expect(weatherStyles).not.toMatch(/\.weather-summary\s*\{[\s\S]*?grid-template-columns:\s*minmax\(240px,[^)]+\)\s+minmax\(360px,/);
        expect(weatherStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.weather-bar\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow-x:\s*hidden/);
        expect(weatherStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.weather-summary-metrics\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
        expect(weatherStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.weather-metric-copy\s+small\s*\{[\s\S]*?display:\s*block[\s\S]*?white-space:\s*normal/);
        expect(weatherStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.weather-footer-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        expect(weatherStyles).toMatch(/\.weather-bar--narrow\s*\{/);
    });
});
