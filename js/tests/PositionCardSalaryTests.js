/**
 * PositionCardSalaryTests — muestra el equivalente "= $X/día" en la tarjeta de puesto.
 *
 * La app guarda SIEMPRE el salario por hora; la tarjeta agrega el equivalente por día
 * (hora × settings.regularHoursPerDay) como ayuda visual. PositionCard es una función
 * pura de (pos + state), así que se testea directo.
 */

import { stateManager } from '../modules/core/AppState.js';
import { PositionCard } from '../modules/features/employees/PositionsList.js';

function setup(hoursPerDay = 8) {
    const raw = stateManager.getState();
    raw.employees = [];
    raw.leaders = [];
    raw.settings.regularHoursPerDay = hoursPerDay;
}

const pos = (over = {}) => ({ id: 'p1', name: 'Obrero', color: '#3b82f6', active: true, workingDays: [], ...over });

testRunner.addSuite("PositionCard — equivalente por día en la tarjeta (feature salario)", {

    "muestra '= $X/día' junto a la tarifa por hora (hora × horas/día)"() {
        setup(8);
        const html = PositionCard(pos({ hourlyRate: 100 }));
        testRunner.assert(html.includes('Tarifa: $100/hr'), "debe seguir mostrando la tarifa por hora");
        testRunner.assert(html.includes('= $800/día'), "debe mostrar el equivalente por día (100 × 8 = 800)");
    },

    "respeta el regularHoursPerDay configurado"() {
        setup(10);
        const html = PositionCard(pos({ hourlyRate: 50 }));
        testRunner.assert(html.includes('= $500/día'), "50/hr × 10h = 500/día");
    },

    "NO muestra '/día' si la tarifa no es un número válido > 0"() {
        setup(8);
        const html0 = PositionCard(pos({ hourlyRate: 0 }));
        const htmlU = PositionCard(pos({ id: 'p2', hourlyRate: undefined }));
        testRunner.assert(!html0.includes('/día'), "tarifa 0 NO debe mostrar /día (evita '$0/día')");
        testRunner.assert(!htmlU.includes('/día'), "tarifa inválida NO debe mostrar /día");
    }
});

console.log('PositionCardSalary tests cargados.');
