/**
 * 🧪 DOMDiffTests
 *
 * Bug (sync de asistencia entre dispositivos): la tarjeta del empleado se
 * deformaba (todo + checkmark alineados a la izquierda) cuando llegaba una
 * asistencia remota. Causa: updateEmployeeRow usaba DOMDiff.apply(rowEl, html)
 * pasando como target el PROPIO elemento de la fila y como source un string
 * cuyo root ES esa misma fila. Pero apply() con string parchea los HIJOS del
 * target contra el template → terminaba anidando una .employee-row dentro de
 * sí misma y borrando la columna del checkmark, colapsando el flex.
 *
 * Contrato:
 *   - DOMDiff.apply(container, html)  → semántica CONTENEDOR: parchea los
 *     hijos del container (lo usa RenderManager: render() y renderZone()).
 *   - DOMDiff.patchSelf(el, html)     → semántica ELEMENTO: parchea el propio
 *     elemento contra el root del HTML (para updateEmployeeRow/Week/Totals).
 */

import { DOMDiff } from '../modules/utils/DOMDiff.js';

testRunner.addSuite("DOMDiff — patchSelf (nivel elemento)", {

    "parchea el elemento en sí, sin anidarlo ni perder hijos"() {
        const target = document.createElement('div');
        target.id = 'emp-row-1';
        target.className = 'employee-row';
        target.innerHTML = '<div class="employee-info">A</div><div class="check">v</div>';
        document.body.appendChild(target);

        const newHTML = '<div id="emp-row-1" class="employee-row is-detail-selected">' +
            '<div class="employee-info">B</div><div class="check">x</div></div>';
        DOMDiff.patchSelf(target, newHTML);

        // 🛡️ NO debe anidar una .employee-row dentro de la fila.
        testRunner.assert(!target.querySelector('.employee-row'),
            'No debe anidar .employee-row dentro de sí misma');
        // Conserva las 2 columnas (info + checkmark) → el flex no se rompe.
        testRunner.assertEquals(target.children.length, 2,
            'Debe conservar info + checkmark, no borrar la columna del checkmark');
        testRunner.assert(target.classList.contains('is-detail-selected'),
            'Debe actualizar la clase del propio elemento');
        testRunner.assertEquals(target.querySelector('.employee-info').textContent, 'B');
        testRunner.assertEquals(target.querySelector('.check').textContent, 'x');

        document.body.removeChild(target);
    },

    "preserva la identidad del nodo target (misma referencia)"() {
        const target = document.createElement('div');
        target.id = 'r1';
        target.className = 'employee-row';
        target.innerHTML = '<span>1</span>';
        document.body.appendChild(target);

        DOMDiff.patchSelf(target, '<div id="r1" class="employee-row"><span>2</span></div>');

        testRunner.assert(document.getElementById('r1') === target,
            'El nodo debe seguir siendo el mismo (parcheo in-place)');
        testRunner.assertEquals(target.querySelector('span').textContent, '2');

        document.body.removeChild(target);
    }

});

testRunner.addSuite("DOMDiff — apply (nivel contenedor) — regresión RenderManager", {

    "apply reemplaza los HIJOS del contenedor"() {
        const container = document.createElement('div');
        container.id = 'root-test';
        container.innerHTML = '<div class="old"></div>';
        document.body.appendChild(container);

        DOMDiff.apply(container, '<div class="a"></div><div class="b"></div>');

        testRunner.assertEquals(container.children.length, 2,
            'apply debe poblar los hijos del contenedor (semántica RenderManager)');
        testRunner.assert(container.querySelector('.a') && container.querySelector('.b'));
        testRunner.assert(!container.querySelector('.old'), 'El hijo viejo debe reemplazarse');

        document.body.removeChild(container);
    }

});

console.log('🧪 DOMDiff tests cargados.');
