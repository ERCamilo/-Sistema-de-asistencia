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
import { positionsChanged, Employee } from '../modules/features/employees/Employee.js';

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
    },

    // 🐛 Judgment Day Fase 2A Ronda 2 (teórico): con duplicados en el array
    // (corrupción previa), la comparación por longitud + "todos los nuevos
    // están en el set previo" daba false-negative: ['A','B'] vs ['A','A'] tiene
    // igual longitud y 'A' está en {A,B}, pero 'B' se cayó. Comparar por
    // conjuntos en ambos lados lo detecta.
    "detecta la caída de un puesto aunque el otro lado tenga duplicados"() {
        testRunner.assertEquals(positionsChanged(['A', 'B'], ['A', 'A'], {}, {}), true,
            "['A','B'] → ['A','A'] perdió el puesto B: debe detectarse como cambio");
    }

});

testRunner.addSuite("Employee — positionsUpdatedAt nunca queda undefined (Firestore lo rechaza)", {

    // 🐛 Judgment Day Fase 2A Ronda 2: setDoc real de Firestore rechaza campos
    // con valor undefined ("Unsupported field value: undefined"). EmployeeRepository
    // hace payload = {...employee} sin limpiar undefined, así que un empleado no
    // migrado con positionsUpdatedAt undefined rompía el write granular. Cada
    // campo del Employee tiene default defensivo; este también debe tenerlo.
    "un empleado sin positionsUpdatedAt lo deja en null, no undefined"() {
        const emp = new Employee({ id: 'e1', name: 'Ana' });
        testRunner.assertEquals(emp.positionsUpdatedAt, null,
            'sin dato, positionsUpdatedAt debe ser null (no undefined) — Firestore rechaza undefined');
    },

    "toJSON no emite positionsUpdatedAt undefined"() {
        const json = new Employee({ id: 'e1', name: 'Ana' }).toJSON();
        testRunner.assert(!('positionsUpdatedAt' in json) || json.positionsUpdatedAt === null,
            'toJSON no debe llevar positionsUpdatedAt undefined al payload');
    },

    "preserva un positionsUpdatedAt numérico real"() {
        const emp = new Employee({ id: 'e1', name: 'Ana', positionsUpdatedAt: 12345 });
        testRunner.assertEquals(emp.positionsUpdatedAt, 12345);
        testRunner.assertEquals(emp.toJSON().positionsUpdatedAt, 12345);
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
