/**
 * InvalidateAllStatsTests — Fase 4 Paso 3 (helper de coherencia mayorista).
 *
 * invalidateAllStats() limpia TODO statsCache.mtd de una. Es el primitivo de
 * coherencia para cargas/reemplazos masivos (backup restore, import, reset total),
 * donde la forma por empleado (invalidateEmployeeStats) no alcanza.
 */

import { stateManager, invalidateAllStats } from '../modules/core/AppState.js';

testRunner.addSuite("invalidateAllStats — limpieza mayorista de stats (Fase 4 Paso 3)", {

    "borra todas las entradas de statsCache.mtd"() {
        const raw = stateManager.getState();
        raw.statsCache.mtd = { empA: { days: 10 }, empB: { days: 5 }, 'emp-con-guion': { days: 1 } };
        invalidateAllStats();
        testRunner.assertEquals(Object.keys(raw.statsCache.mtd).length, 0, "no debe quedar ninguna stat cacheada");
    },

    "es idempotente sobre un caché ya vacío"() {
        const raw = stateManager.getState();
        raw.statsCache.mtd = {};
        invalidateAllStats();
        testRunner.assertEquals(Object.keys(raw.statsCache.mtd).length, 0, "vacío sigue vacío, sin romper");
    }
});

console.log('InvalidateAllStats tests cargados.');
