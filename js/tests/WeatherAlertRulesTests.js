import {
    getWindAlert,
    getWindGustAlert,
    getPrecipAlert,
    getTempAlert,
    getUvAlert,
    getVisAlert,
    getPressureAlert,
    getAggregatedAlert,
    ALERT_LEVEL,
    ALERT_COLOR
} from '../modules/features/weather/WeatherAlertRules.js';

testRunner.addSuite("WeatherAlertRules — classification and coloring", {

    "getWindAlert returns correct alert levels and colors"() {
        // Normal
        let res = getWindAlert(15);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate
        res = getWindAlert(30);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High
        res = getWindAlert(45);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getWindAlert(65);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getWindGustAlert returns correct alert levels and colors"() {
        // Normal
        let res = getWindGustAlert(20);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate
        res = getWindGustAlert(50);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High
        res = getWindGustAlert(70);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getWindGustAlert(90);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getPrecipAlert returns correct alert levels and colors"() {
        // Normal/light
        let res = getPrecipAlert(1.5);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning/moderate
        res = getPrecipAlert(5.0);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning/high
        res = getPrecipAlert(15.0);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger/torrencial
        res = getPrecipAlert(30.0);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getTempAlert returns correct alert levels and colors"() {
        // Normal
        let res = getTempAlert(25);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate
        res = getTempAlert(37);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High
        res = getTempAlert(40);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getTempAlert(43);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);

        // Cold
        res = getTempAlert(5);
        testRunner.assertEquals(res.level, ALERT_LEVEL.COLD);
        testRunner.assertEquals(res.color, ALERT_COLOR.cold);
    },

    "getUvAlert returns correct alert levels and colors"() {
        // Normal (Bajo)
        let res = getUvAlert(1);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate
        res = getUvAlert(4);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High
        res = getUvAlert(7);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getUvAlert(10);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getVisAlert returns correct alert levels and colors"() {
        // Normal (Excelente)
        let res = getVisAlert(12);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate
        res = getVisAlert(5);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High
        res = getVisAlert(1);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getVisAlert(0.2);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getPressureAlert returns correct alert levels and colors"() {
        // Normal
        let res = getPressureAlert(1013);
        testRunner.assertEquals(res.level, ALERT_LEVEL.NORMAL);
        testRunner.assertEquals(res.color, ALERT_COLOR.normal);

        // Warning Moderate (Borrasca)
        res = getPressureAlert(1005);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_moderate);

        // Warning High (Ciclogénesis)
        res = getPressureAlert(990);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assertEquals(res.color, ALERT_COLOR.warning_high);

        // Danger
        res = getPressureAlert(980);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assertEquals(res.color, ALERT_COLOR.danger);
    },

    "getAggregatedAlert aggregates threats by priority (danger > warning_high > warning_moderate > cold)"() {
        // Normal
        let current = { temp: 25, feelsLike: 26, windKph: 15, precipMm: 0.5, uv: 1, windGustKph: 20, pressureMb: 1013, visKm: 10 };
        let res = getAggregatedAlert(current);
        testRunner.assertEquals(res.active, false);

        // Warning wind (moderate)
        current = { temp: 25, feelsLike: 26, windKph: 30, precipMm: 0.5, uv: 1, windGustKph: 20, pressureMb: 1013, visKm: 10 };
        res = getAggregatedAlert(current);
        testRunner.assertEquals(res.active, true);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_MODERATE);
        testRunner.assert(res.label.includes('Viento') && res.label.includes('Moderado'));

        // Warning precip (high) overriding warning wind (moderate)
        current = { temp: 25, feelsLike: 26, windKph: 30, precipMm: 12.0, uv: 1, windGustKph: 20, pressureMb: 1013, visKm: 10 };
        res = getAggregatedAlert(current);
        testRunner.assertEquals(res.active, true);
        testRunner.assertEquals(res.level, ALERT_LEVEL.WARNING_HIGH);
        testRunner.assert(res.label.includes('Lluvia') && res.label.includes('Riesgo Alto'));

        // Danger rain overriding warning precip (high)
        current = { temp: 25, feelsLike: 26, windKph: 30, precipMm: 30.0, uv: 1, windGustKph: 20, pressureMb: 1013, visKm: 10 };
        res = getAggregatedAlert(current);
        testRunner.assertEquals(res.active, true);
        testRunner.assertEquals(res.level, ALERT_LEVEL.DANGER);
        testRunner.assert(res.label.includes('Lluvia') && res.label.includes('Peligro'));

        // Cold alert
        current = { temp: 5, feelsLike: 5, windKph: 15, precipMm: 0, uv: 1, windGustKph: 20, pressureMb: 1013, visKm: 10 };
        res = getAggregatedAlert(current);
        testRunner.assertEquals(res.active, true);
        testRunner.assertEquals(res.level, ALERT_LEVEL.COLD);
        testRunner.assert(res.label.includes('Frío Extremo'));
    }
});

console.log('🧪 Weather alert rules tests cargados.');
