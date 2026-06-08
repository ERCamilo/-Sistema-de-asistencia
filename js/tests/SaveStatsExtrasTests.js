/**
 * 🧪 SaveStatsExtrasTests
 *
 * Helper puro que calcula métricas extra para el log de "Save Stats":
 *   - loans: total de préstamos en todos los empleados.
 *   - pettyCash: { projects, periods, movements } (soporta la forma anidada
 *     del prototipo y la futura forma plana).
 */

import { computeSaveStatsExtras } from '../modules/services/SaveStatsExtras.js';

testRunner.addSuite("SaveStatsExtras — préstamos", {

    "suma los préstamos de todos los empleados"() {
        const state = { employees: [
            { id: 'e1', loans: [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }] },
            { id: 'e2', loans: [{ id: 'L4' }, { id: 'L5' }] }
        ]};
        testRunner.assertEquals(computeSaveStatsExtras(state).loans, 5);
    },

    "empleados sin loans / loans nulo cuentan 0"() {
        const state = { employees: [{ id: 'e1' }, { id: 'e2', loans: null }, { id: 'e3', loans: [{ id: 'L1' }] }] };
        testRunner.assertEquals(computeSaveStatsExtras(state).loans, 1);
    },

    "sin empleados → 0"() {
        testRunner.assertEquals(computeSaveStatsExtras({}).loans, 0);
        testRunner.assertEquals(computeSaveStatsExtras(null).loans, 0);
    }

});

testRunner.addSuite("SaveStatsExtras — caja chica", {

    "forma anidada (prototipo): cuenta proyectos, periodos y movimientos"() {
        const state = { pettyCash: { projects: [
            { id: 'p1', periods: [
                { id: 'per1', movimientos: [{ id: 'm1' }, { id: 'm2' }] },
                { id: 'per2', movimientos: [{ id: 'm3' }] }
            ]},
            { id: 'p2', periods: [
                { id: 'per3', movimientos: [{ id: 'm4' }] }
            ]}
        ]}};
        const r = computeSaveStatsExtras(state).pettyCash;
        testRunner.assertEquals(r.projects, 2);
        testRunner.assertEquals(r.periods, 3);
        testRunner.assertEquals(r.movements, 4);
    },

    "forma plana (futura): cuenta de los arreglos directos"() {
        const state = { pettyCash: {
            projects: [{ id: 'p1' }, { id: 'p2' }],
            periods: [{ id: 'per1' }, { id: 'per2' }, { id: 'per3' }],
            movements: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }]
        }};
        const r = computeSaveStatsExtras(state).pettyCash;
        testRunner.assertEquals(r.projects, 2);
        testRunner.assertEquals(r.periods, 3);
        testRunner.assertEquals(r.movements, 5);
    },

    "sin caja chica → ceros"() {
        const r = computeSaveStatsExtras({}).pettyCash;
        testRunner.assertEquals(r.projects, 0);
        testRunner.assertEquals(r.periods, 0);
        testRunner.assertEquals(r.movements, 0);
    }

});

console.log('🧪 SaveStatsExtras tests cargados.');
