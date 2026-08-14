/**
 * Coordinates the single post-hydration weather startup path.
 *
 * Hydration failures intentionally propagate to the existing application
 * startup catch. Weather failures remain isolated after hydration so they do
 * not block the rest of application initialization.
 */

export async function hydrateApplicationAndInitializeWeather({
    loadApplicationData,
    initializeWeatherAfterHydration,
    onWeatherStartupError
}) {
    await loadApplicationData();

    try {
        // Deliberately fire-and-forget: WeatherStartup schedules its own work
        // after hydration and must not delay the remaining startup sequence.
        initializeWeatherAfterHydration();
    } catch (error) {
        onWeatherStartupError?.(error);
    }
}
