/**
 * ⚠️ WeatherAlertRules — classification and styling rules for weather threats.
 *
 * Defines threshold checks and color mappings for:
 *   - Wind Speed & Wind Gusts (km/h)
 *   - Precipitation Amount (mm)
 *   - Apparent Temperature / Feels Like (°C)
 *   - UV Index
 *   - Visibility (km)
 *   - Atmospheric Pressure (mb)
 *
 * Standard 5-tier levels:
 *   - Normal (White):           #f1f5f9
 *   - Warning Moderate (Yellow): #fbbf24
 *   - Warning High (Orange):    #f97316
 *   - Danger Extreme (Red):     #ef4444
 *   - Cold (Light Blue):        #38bdf8
 */

export const ALERT_LEVEL = Object.freeze({
    NORMAL: 'normal',
    WARNING_MODERATE: 'warning_moderate',
    WARNING_HIGH: 'warning_high',
    DANGER: 'danger',
    COLD: 'cold'
});

export const ALERT_COLOR = Object.freeze({
    normal: '#f1f5f9',
    warning_moderate: '#fbbf24', // Amarillo
    warning_high: '#f97316',    // Naranja
    danger: '#ef4444',          // Rojo
    cold: '#38bdf8'             // Azul claro
});

export function getWindAlert(windKph) {
    const kph = Number(windKph);
    if (!Number.isFinite(kph)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
    }
    if (kph >= 61) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Huracanado' };
    }
    if (kph >= 41) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Fuerte' };
    }
    if (kph >= 25) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Moderado' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
}

export function getWindGustAlert(gustKph) {
    const kph = Number(gustKph);
    if (!Number.isFinite(kph)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
    }
    if (kph >= 81) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Extremo' };
    }
    if (kph >= 61) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Fuerte' };
    }
    if (kph >= 40) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Moderado' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
}

export function getPrecipAlert(precipMm) {
    const mm = Number(precipMm);
    if (!Number.isFinite(mm)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
    }
    if (mm >= 50.0) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Torrencial' };
    }
    if (mm >= 30.0) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Fuerte' };
    }
    if (mm >= 15.0) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Moderada' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
}

export function getTempAlert(tempC) {
    const temp = Number(tempC);
    if (!Number.isFinite(temp)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
    }
    if (temp >= 42) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Peligroso' };
    }
    if (temp >= 39) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Calor Alto' };
    }
    if (temp >= 35) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Calor Moderado' };
    }
    if (temp <= 10) {
        return { level: ALERT_LEVEL.COLD, color: ALERT_COLOR.cold, label: 'Frío Extremo' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
}

export function getUvAlert(uvIndex) {
    const uv = Number(uvIndex);
    if (!Number.isFinite(uv)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Bajo' };
    }
    if (uv >= 8) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Muy Alto/Extremo' };
    }
    if (uv >= 6) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Alto' };
    }
    if (uv >= 3) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Moderado' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Bajo' };
}

export function getVisAlert(visKm) {
    const vis = Number(visKm);
    if (!Number.isFinite(vis)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Excelente' };
    }
    if (vis < 0.5) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Niebla Total' };
    }
    if (vis <= 2.0) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Niebla Densa' };
    }
    if (vis <= 9.9) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Baja Visibilidad' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Excelente' };
}

export function getPressureAlert(pressureMb) {
    const pr = Number(pressureMb);
    if (!Number.isFinite(pr)) {
        return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
    }
    if (pr < 985) {
        return { level: ALERT_LEVEL.DANGER, color: ALERT_COLOR.danger, label: 'Huracán/Ciclón' };
    }
    if (pr <= 999) {
        return { level: ALERT_LEVEL.WARNING_HIGH, color: ALERT_COLOR.warning_high, label: 'Ciclogénesis' };
    }
    if (pr <= 1007 || pr > 1025) {
        return { level: ALERT_LEVEL.WARNING_MODERATE, color: ALERT_COLOR.warning_moderate, label: 'Borrasca/Alta Presión' };
    }
    return { level: ALERT_LEVEL.NORMAL, color: ALERT_COLOR.normal, label: 'Normal' };
}

/**
 * Aggregated alert state for the collapsed main header bar.
 * Scans current vitals for warnings/dangers.
 *
 * @returns {{ active: boolean, label: string, color: string, level: string }}
 */
export function getAggregatedAlert(current) {
    if (!current) {
        return { active: false, label: '', color: ALERT_COLOR.normal, level: ALERT_LEVEL.NORMAL };
    }

    const checks = [
        { type: 'wind', key: 'windKph', res: getWindAlert(current.windKph), text: (v) => `💨 Viento (${v} km/h)` },
        { type: 'gust', key: 'windGustKph', res: getWindGustAlert(current.windGustKph), text: (v) => `💨 Ráfagas (${v} km/h)` },
        { type: 'rain', key: 'precipMm', res: getPrecipAlert(current.precipMm), text: (v) => `🧊 Lluvia (${v} mm)` },
        { type: 'temp', key: 'feelsLike', res: getTempAlert(current.feelsLike !== null ? current.feelsLike : current.temp), text: (v) => `🌡️ Temp (Sensación ${v}°)` },
        { type: 'uv', key: 'uv', res: getUvAlert(current.uv), text: (v) => `☀️ Índice UV (${v})` },
        { type: 'vis', key: 'visKm', res: getVisAlert(current.visKm), text: (v) => `🌫️ Visibilidad (${v} km)` },
        { type: 'pressure', key: 'pressureMb', res: getPressureAlert(current.pressureMb), text: (v) => `📉 Presión (${v} mb)` }
    ];

    // 1. Prioritize Danger (Red)
    let dangerCheck = checks.find(c => c.res.level === ALERT_LEVEL.DANGER);
    if (dangerCheck) {
        const val = dangerCheck.type === 'temp' ? (current.feelsLike !== null ? current.feelsLike : current.temp) : (current[dangerCheck.key] ?? 0);
        return { active: true, label: `${dangerCheck.text(val)}: Peligro`, color: ALERT_COLOR.danger, level: ALERT_LEVEL.DANGER };
    }

    // 2. Prioritize Warning High (Orange)
    let highCheck = checks.find(c => c.res.level === ALERT_LEVEL.WARNING_HIGH);
    if (highCheck) {
        const val = highCheck.type === 'temp' ? (current.feelsLike !== null ? current.feelsLike : current.temp) : (current[highCheck.key] ?? 0);
        return { active: true, label: `${highCheck.text(val)}: Riesgo Alto`, color: ALERT_COLOR.warning_high, level: ALERT_LEVEL.WARNING_HIGH };
    }

    // 3. Prioritize Warning Moderate (Yellow)
    let modCheck = checks.find(c => c.res.level === ALERT_LEVEL.WARNING_MODERATE);
    if (modCheck) {
        const val = modCheck.type === 'temp' ? (current.feelsLike !== null ? current.feelsLike : current.temp) : (current[modCheck.key] ?? 0);
        return { active: true, label: `${modCheck.text(val)}: Moderado`, color: ALERT_COLOR.warning_moderate, level: ALERT_LEVEL.WARNING_MODERATE };
    }

    // 4. Prioritize Cold (Light Blue)
    let coldCheck = checks.find(c => c.res.level === ALERT_LEVEL.COLD);
    if (coldCheck) {
        const val = current.feelsLike !== null ? current.feelsLike : current.temp;
        return { active: true, label: `❄️ Frío Extremo (${val}°)`, color: ALERT_COLOR.cold, level: ALERT_LEVEL.COLD };
    }

    return { active: false, label: '', color: ALERT_COLOR.normal, level: ALERT_LEVEL.NORMAL };
}
