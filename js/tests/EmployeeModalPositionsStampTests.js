/**
 * 🧪 EmployeeModalPositionsStampTests (Judgment Day Fase 2A)
 *
 * El LWW fino de puestos (positionsUpdatedAt) sólo funciona si ese timestamp
 * sube ÚNICAMENTE cuando cambian los puestos. Pero EmployeeModal re-asigna
 * emp.positions en CADA guardado (aunque sólo cambie el teléfono), así que la
 * estampa debe ser CONDICIONAL: sólo si los puestos/salarios difieren de los
 * previos. Sin esto, editar un campo ajeno movería positionsUpdatedAt y
 * pisaría los puestos del otro dispositivo — justo el bug que este fix corrige.
 *
 * Verifica el helper puro `positionsChanged` (comportamiento) y el cableado en
 * EmployeeModal (contract).
 */

import fs from 'fs';
import path from 'path';
import { positionsChanged } from '../modules/features/employees/Employee.js';

const MODAL_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/modals/EmployeeModal.js'), 'utf8');

testRunner.addSuite("positionsChanged — detecta cambios reales de puestos/salarios", {

    "mismos puestos y salarios → false (editar el teléfono no cuenta como cambio de puestos)"() {
        testRunner.assertEquals(positionsChanged(['a', 'b'], ['a', 'b'], { a: 1, b: 2 }, { a: 1, b: 2 }), false);
    },

    "mismo set, distinto orden → false"() {
        testRunner.assertEquals(positionsChanged(['a', 'b'], ['b', 'a'], { a: 1 }, { a: 1 }), false);
    },

    "agregar un puesto → true"() {
        testRunner.assertEquals(positionsChanged(['a'], ['a', 'b'], { a: 1 }, { a: 1, b: 2 }), true);
    },

    "quitar un puesto → true"() {
        testRunner.assertEquals(positionsChanged(['a', 'b'], ['a'], { a: 1 }, { a: 1 }), true);
    },

    "cambiar el salario de un puesto → true"() {
        testRunner.assertEquals(positionsChanged(['a'], ['a'], { a: 1 }, { a: 5 }), true);
    },

    "agregar una clave de salario → true"() {
        testRunner.assertEquals(positionsChanged(['a'], ['a'], { a: 1 }, { a: 1, b: 2 }), true);
    },

    "defensivo: null/undefined se tratan como vacío"() {
        testRunner.assertEquals(positionsChanged(null, [], undefined, {}), false);
        testRunner.assertEquals(positionsChanged(null, ['a'], {}, { a: 1 }), true);
    }

});

testRunner.addSuite("EmployeeModal — estampa positionsUpdatedAt sólo si los puestos cambian", {

    "applyFields usa positionsChanged para estampar positionsUpdatedAt condicionalmente"() {
        testRunner.assert(/positionsChanged/.test(MODAL_SRC),
            'debe usar el helper positionsChanged (no estampar en cada guardado)');
        testRunner.assert(/positionsUpdatedAt/.test(MODAL_SRC),
            'debe estampar positionsUpdatedAt cuando los puestos cambian');
    }

});

console.log('🧪 EmployeeModalPositionsStamp tests cargados.');
