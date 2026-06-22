/**
 * 🧪 SalaryConversionTests — Conversión pura hora <-> día para la carga de salario.
 */

import {
    SALARY_MODE,
    dailyToHourly,
    hourlyToDaily,
    toStoredHourly,
    fromStoredHourly,
} from '../modules/features/payroll/SalaryConversion.js';

function near(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

testRunner.addSuite("SalaryConversion — hora <-> día", {

    "dailyToHourly divide por las horas/día"() {
        testRunner.assertEquals(dailyToHourly(1000, 8), 125, "1000/día @8h = 125/h");
        testRunner.assertEquals(dailyToHourly(700, 7), 100, "700/día @7h = 100/h");
    },

    "hourlyToDaily multiplica por las horas/día"() {
        testRunner.assertEquals(hourlyToDaily(125, 8), 1000, "125/h @8h = 1000/día");
    },

    "round-trip exacto aunque las horas no dividan en redondo"() {
        const h = dailyToHourly(100, 3);            // 33.333…
        testRunner.assert(near(hourlyToDaily(h, 3), 100), "100 -> hora -> día debe volver a 100");
        const h2 = dailyToHourly(1000, 7);
        testRunner.assert(near(hourlyToDaily(h2, 7), 1000), "1000 @7h debe round-trippear");
    },

    "horas/día inválidas caen a 8 (no divide por cero)"() {
        testRunner.assertEquals(dailyToHourly(100, 0), 12.5, "0h -> fallback 8 -> 12.5");
        testRunner.assertEquals(dailyToHourly(100, -3), 12.5, "negativo -> fallback 8");
        testRunner.assertEquals(dailyToHourly(100, undefined), 12.5, "undefined -> fallback 8");
    },

    "entrada no numérica devuelve 0"() {
        testRunner.assertEquals(dailyToHourly('', 8), 0, "'' -> 0");
        testRunner.assertEquals(dailyToHourly(NaN, 8), 0, "NaN -> 0");
    },

    "toStoredHourly: 'daily' convierte, 'hourly'/default es passthrough"() {
        testRunner.assertEquals(toStoredHourly(1000, SALARY_MODE.DAILY, 8), 125, "daily -> 125");
        testRunner.assertEquals(toStoredHourly(125, SALARY_MODE.HOURLY, 8), 125, "hourly -> 125");
        testRunner.assertEquals(toStoredHourly(125, undefined, 8), 125, "sin modo -> hourly passthrough");
        testRunner.assertEquals(toStoredHourly('abc', SALARY_MODE.HOURLY, 8), 0, "basura -> 0");
    },

    "fromStoredHourly: reabre en el modo cargado"() {
        testRunner.assertEquals(fromStoredHourly(125, SALARY_MODE.DAILY, 8), 1000, "guardado 125, modo daily -> muestra 1000");
        testRunner.assertEquals(fromStoredHourly(125, SALARY_MODE.HOURLY, 8), 125, "guardado 125, modo hourly -> muestra 125");
    },

    "to/from son inversas en modo daily"() {
        const stored = toStoredHourly(1000, SALARY_MODE.DAILY, 8);
        testRunner.assertEquals(fromStoredHourly(stored, SALARY_MODE.DAILY, 8), 1000, "ida y vuelta vuelve a 1000");
    }
});

console.log('🧪 SalaryConversion tests cargados.');
