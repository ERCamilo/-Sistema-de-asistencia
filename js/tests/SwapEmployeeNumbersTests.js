/**
 * 🧪 SwapEmployeeNumbersTests
 *
 * Soporte para la resolución inline de conflicto de número de empleado:
 * cuando editas a Pedro y le pones el número de Juan, una de las opciones
 * es "Intercambiar" → Pedro toma el número de Juan y Juan toma el de Pedro.
 *
 * swapEmployeeNumbers(idA, idB):
 *   - intercambia el campo `number` de ambos empleados,
 *   - marca updatedAt + _isDirty en ambos (para que se propaguen),
 *   - devuelve false si algún id no existe o son el mismo.
 */

import { swapEmployeeNumbers } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';

testRunner.addSuite("PersistenceService — swapEmployeeNumbers", {

    "intercambia los números de dos empleados"() {
        state.employees = [
            { id: 'a', number: '2', name: 'Juan' },
            { id: 'b', number: '5', name: 'Pedro' }
        ];
        const ok = swapEmployeeNumbers('b', 'a');
        testRunner.assertEquals(ok, true);
        testRunner.assertEquals(state.employees.find(e => e.id === 'b').number, '2',
            'Pedro toma el número de Juan');
        testRunner.assertEquals(state.employees.find(e => e.id === 'a').number, '5',
            'Juan toma el número de Pedro');
    },

    "marca _isDirty en ambos"() {
        state.employees = [
            { id: 'a', number: '2' },
            { id: 'b', number: '5' }
        ];
        swapEmployeeNumbers('a', 'b');
        testRunner.assert(state.employees.find(e => e.id === 'a')._isDirty);
        testRunner.assert(state.employees.find(e => e.id === 'b')._isDirty);
    },

    "devuelve false si algún id no existe"() {
        state.employees = [{ id: 'a', number: '2' }];
        testRunner.assertEquals(swapEmployeeNumbers('a', 'zzz'), false);
    },

    "devuelve false si son el mismo id"() {
        state.employees = [{ id: 'a', number: '2' }];
        testRunner.assertEquals(swapEmployeeNumbers('a', 'a'), false);
    }

});

console.log('🧪 SwapEmployeeNumbers tests cargados.');
