/**
 * 🧪 ReassignEmployeeNumberTests
 *
 * Bug histórico: cuando el usuario reasigna una ficha desde el wizard
 * manual (ej. ficha 501 → 500), si la 500 ya está ocupada por otro
 * empleado, reassignEmployeeNumber retornaba false silenciosamente con
 * solo un console.warn. La cascada de re-detección de applyManualGroup
 * no podía generar un nuevo grupo manual porque el cambio nunca pasó.
 *
 * Fix: opt `allowCollision`. Cuando es true, la reasignación se aplica
 * incluso si el número ya está en uso, creando un conflicto temporal
 * que el siguiente paso del wizard resuelve.
 */

import { state } from '../modules/core/AppState.js';
import { reassignEmployeeNumber } from '../modules/services/PersistenceService.js';

function resetState(employees) {
    state.employees.splice(0, state.employees.length, ...employees);
    if (state.attendance) {
        Object.keys(state.attendance).forEach(k => delete state.attendance[k]);
    }
}

testRunner.addSuite("reassignEmployeeNumber — comportamiento sin colisión", {

    "asigna número libre y retorna true"() {
        resetState([{ id: 'EMP-A', name: 'Ana', number: '100' }]);
        const r = reassignEmployeeNumber('EMP-A', '200');
        testRunner.assertEquals(r, true);
        testRunner.assertEquals(state.employees[0].number, '200');
    },

    "actualiza updatedAt al reasignar"() {
        resetState([{ id: 'EMP-A', name: 'Ana', number: '100', updatedAt: 1 }]);
        reassignEmployeeNumber('EMP-A', '200');
        testRunner.assert(state.employees[0].updatedAt > 1,
            'updatedAt debe refrescarse para que la nube reciba el cambio');
    },

    "retorna false si el empleado no existe"() {
        resetState([{ id: 'EMP-A', name: 'Ana', number: '100' }]);
        const r = reassignEmployeeNumber('EMP-NO-EXISTE', '999');
        testRunner.assertEquals(r, false);
    }

});

testRunner.addSuite("reassignEmployeeNumber — colisión (bug ficha 500/501)", {

    "sin allowCollision: retorna false y NO cambia el número (comportamiento actual)"() {
        resetState([
            { id: 'EMP-A', name: 'Hector', number: '500' },
            { id: 'EMP-B', name: 'Jean haiti', number: '501' }
        ]);
        const r = reassignEmployeeNumber('EMP-B', '500');
        testRunner.assertEquals(r, false,
            'Debe rechazar la colisión por defecto');
        const empB = state.employees.find(e => e.id === 'EMP-B');
        testRunner.assertEquals(empB.number, '501',
            'El número original se preserva si no permitimos colisión');
    },

    "con allowCollision:true: aplica la reasignación y deja DOS empleados con el mismo número"() {
        // Este es el comportamiento nuevo: el wizard puede crear un
        // conflicto temporal que la cascada de re-análisis detectará y
        // ofrecerá resolver en el siguiente paso.
        resetState([
            { id: 'EMP-A', name: 'Hector', number: '500' },
            { id: 'EMP-B', name: 'Jean haiti', number: '501' }
        ]);
        const r = reassignEmployeeNumber('EMP-B', '500', { allowCollision: true });
        testRunner.assertEquals(r, true,
            'Con allowCollision debe aplicar la reasignación');
        const withNumber500 = state.employees.filter(e => e.number === '500');
        testRunner.assertEquals(withNumber500.length, 2,
            'Quedan dos empleados con número 500 — conflicto temporal');
    },

    "con allowCollision: el conflicto temporal se mantiene hasta que el wizard lo resuelva"() {
        // Simulación del caso real reportado: ficha 501 con 3 personas,
        // una debe ir a 500 donde ya hay otro Jean haiti.
        resetState([
            { id: 'JEAN-500', name: 'Jean haiti', number: '500' },
            { id: 'HECTOR-501', name: 'Hector', number: '501' },
            { id: 'HECTOR2-501', name: 'Héctor', number: '501' },
            { id: 'JEAN-501', name: 'Jean haiti', number: '501' }
        ]);
        // El wizard absorbe Héctor en Hector y reasigna Jean haiti (de 501) a 500.
        const ok = reassignEmployeeNumber('JEAN-501', '500', { allowCollision: true });
        testRunner.assertEquals(ok, true);
        const at500 = state.employees.filter(e => e.number === '500');
        testRunner.assertEquals(at500.length, 2,
            'Ambos Jean haiti quedan en 500 → próximo paso del wizard los unifica');
    }

});

console.log('🧪 reassignEmployeeNumber tests cargados.');
