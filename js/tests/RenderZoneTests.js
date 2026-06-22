/**
 * RenderZoneTests — Fase 4 Paso 5 pieza 3 (render por zonas, Enfoque A).
 *
 * El render zonal estaba ROTO por DOS razones que esta suite fija:
 *   1. La zona 'day-stats' nunca se registra → renderManager.zones está vacío →
 *      renderZone() devuelve false (no-op). El inline generator que pasa el call site
 *      (app.js: renderZone('day-stats', () => StatsGrid())) se IGNORA (renderZone busca
 *      el generador en el Map, no en el 2do arg).
 *   2. Aun registrándola, renderZone usa DOMDiff.apply (semántica de CONTENEDOR:
 *      parchea los HIJOS). Pero StatsGrid() devuelve el WRAPPER <div id="day-stats">,
 *      así que apply() ANIDA un segundo #day-stats adentro del primero. El arreglo
 *      (Incremento 1) es usar DOMDiff.patchSelf cuando la raíz generada ES la zona.
 *
 * Test 1 bloquea el no-op de hoy. Test 2 es el CONTRATO objetivo (rojo hasta el
 * Incremento 1): con la zona registrada, parchea #day-stats en el lugar, sin anidar.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderManager, renderZone } from '../modules/core/RenderManager.js';
import { StatsGrid } from '../modules/ui/AttendanceUI.js';
import { stateManager } from '../modules/core/AppState.js';

const APP_SRC = readFileSync(join(process.cwd(), 'js/app.js'), 'utf8');

function setupState() {
    const raw = stateManager.getState();
    raw.employees = [{ id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' }];
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.selectedDate = new Date(2026, 5, 17);
    raw.settings.regularHoursPerDay = 8;
    raw.employeeFilter = ''; // sin filtro → StatsGrid no entra al bloque que usa icons
}

function mountHost() {
    document.body.innerHTML = '<div id="host"><div id="day-stats"></div></div>';
}

function resetZone() {
    renderManager.zones.delete('day-stats');
    renderManager.renderCount = 0;
}

testRunner.addSuite("RenderManager — Zona day-stats (Fase 4 Paso 5 pieza 3)", {

    "HOY (no-op): renderZone('day-stats') sin zona registrada devuelve false"() {
        setupState();
        mountHost();
        resetZone(); // asegurar que NO está registrada
        const result = renderZone('day-stats', () => StatsGrid());
        testRunner.assertEquals(
            result, false,
            "sin zona registrada renderZone debe devolver false (el inline generator del call site se ignora)"
        );
    },

    "OBJETIVO: con la zona registrada, renderZone parchea #day-stats EN EL LUGAR (sin anidar)"() {
        setupState();
        mountHost();
        resetZone();
        renderManager.registerZone('day-stats', () => StatsGrid());
        try {
            const before = document.getElementById('day-stats');
            const result = renderZone('day-stats');

            testRunner.assertEquals(result, true, "con la zona registrada renderZone debe devolver true");
            testRunner.assertEquals(
                document.querySelectorAll('#day-stats').length, 1,
                "debe haber EXACTAMENTE un #day-stats (apply anidaría un duplicado adentro)"
            );
            testRunner.assert(
                document.getElementById('day-stats') === before,
                "#day-stats debe ser el MISMO nodo (parcheado en el lugar, no reemplazado)"
            );
            testRunner.assert(
                document.getElementById('day-stats').querySelector('.stats-row') !== null,
                "el contenido fresco de StatsGrid (.stats-row) debe quedar dentro de #day-stats"
            );
        } finally {
            resetZone();
        }
    },

    // Incremento 2: el cableado en app.js (no testeable conductualmente → contrato-de-fuente).
    "CONTRATO (app.js boot): registra la zona day-stats con StatsGrid"() {
        testRunner.assert(
            /renderManager\.registerZone\(\s*['"]day-stats['"]\s*,\s*\(\)\s*=>\s*StatsGrid\(\)\s*\)/.test(APP_SRC),
            "app.js debe registrar la zona day-stats en el boot con () => StatsGrid()"
        );
    },

    "CONTRATO (call site): toggleAttendance llama renderZone('day-stats') usando el registro"() {
        testRunner.assert(
            /renderZone\(\s*['"]day-stats['"]\s*\)/.test(APP_SRC),
            "el call site debe llamar renderZone('day-stats') (sin inline generator: usa el registrado)"
        );
    }
});

console.log('RenderZone tests cargados.');
