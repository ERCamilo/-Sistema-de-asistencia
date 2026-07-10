/**
 * 🧪 EmployeeReportDataTests
 *
 * Armador PURO del reporte de días trabajados (desglose por posición →
 * empleados → valor por día), extraído de AnalyticsUI para poder testearlo.
 *
 * 🐛 Bug de campo (2026-07-10): el reporte agrupaba por las posiciones
 * ACTUALES del empleado y solo iteraba posiciones ACTIVAS. Consecuencia: los
 * días trabajados con una posición que el empleado YA NO TIENE (desasignada)
 * — o con una posición desactivada como archivo — desaparecían del Excel y
 * el empleado aparecía vacío/ausente esos días. El historial manda: un día
 * registrado aparece bajo su posición aunque la asignación actual o el
 * estado del catálogo hayan cambiado.
 */

import { buildEmployeeReportData } from '../modules/features/analytics/EmployeeReportData.js';
import { parseDate } from '../modules/utils/DateUtils.js';

function makeDays(...dateStrs) {
    return dateStrs.map(s => ({ date: parseDate(s), isHoliday: false }));
}

function baseArgs(overrides = {}) {
    return {
        employees: [{ id: 'e1', number: '001', name: 'Ana', active: true, positions: ['ayu'] }],
        positions: [
            { id: 'alba', name: 'Albañil', active: true },
            { id: 'ayu', name: 'Ayudante', active: true }
        ],
        attendance: {
            'e1-2026-07-01': { employeeId: 'e1', date: '2026-07-01', present: true, selectedPosition: 'alba', hoursWorked: 8 }
        },
        days: makeDays('2026-07-01'),
        startDate: '2026-07-01',
        endDate: '2026-07-01',
        regularHours: 8,
        holidayFactor: 1,
        ...overrides
    };
}

testRunner.addSuite("EmployeeReportData — el historial manda sobre la asignación actual", {

    "los días registrados con una posición DESASIGNADA aparecen bajo esa posición"() {
        // Ana trabajó como Albañil pero hoy solo tiene Ayudante.
        const res = buildEmployeeReportData(baseArgs());
        const alba = res.positions.find(g => g.position.id === 'alba');
        testRunner.assert(!!alba, 'el grupo Albañil debe existir en el reporte');
        const ana = alba.employees.find(e => e.id === 'e1');
        testRunner.assert(!!ana, 'Ana debe aparecer en el grupo aunque ya no tenga la posición');
        testRunner.assertEquals(ana.dayValues['2026-07-01'], 1, '8h / 8 regulares = 1 día — no vacío/ausente');
    },

    "una posición DESACTIVADA (archivo) con días en el rango sigue apareciendo"() {
        const args = baseArgs();
        args.positions = [
            { id: 'alba', name: 'Albañil', active: false }, // archivada
            { id: 'ayu', name: 'Ayudante', active: true }
        ];
        const res = buildEmployeeReportData(args);
        const alba = res.positions.find(g => g.position.id === 'alba');
        testRunner.assert(!!alba,
            'desactivar preserva el historial — el grupo debe seguir en el reporte');
        testRunner.assertEquals(alba.employees[0].dayValues['2026-07-01'], 1);
    },

    "una posición inactiva SIN días en el rango NO aparece (sin ruido)"() {
        const args = baseArgs();
        args.positions.push({ id: 'vieja', name: 'Sin Uso', active: false });
        const res = buildEmployeeReportData(args);
        testRunner.assert(!res.positions.some(g => g.position.id === 'vieja'),
            'el archivo sin actividad en el rango no debe ensuciar el reporte');
    },

    "el día multi-posición de una posición desasignada también aparece"() {
        const args = baseArgs({
            attendance: {
                'e1-2026-07-01': {
                    employeeId: 'e1', date: '2026-07-01', present: true, multiPosition: true,
                    positionHours: [
                        { positionId: 'alba', hours: 4, overtimeHours: 0 },
                        { positionId: 'ayu', hours: 4, overtimeHours: 0 }
                    ]
                }
            }
        });
        const res = buildEmployeeReportData(args);
        const alba = res.positions.find(g => g.position.id === 'alba');
        testRunner.assert(!!alba, 'grupo Albañil presente');
        testRunner.assertEquals(alba.employees[0].dayValues['2026-07-01'], 0.5, '4h de 8 = 0.5 día');
    },

    "comportamiento clásico preservado: el asignado actual aparece bajo su posición aunque no tenga días"() {
        const res = buildEmployeeReportData(baseArgs());
        const ayu = res.positions.find(g => g.position.id === 'ayu');
        testRunner.assert(!!ayu, 'el grupo de su posición actual existe');
        const ana = ayu.employees.find(e => e.id === 'e1');
        testRunner.assert(!!ana, 'Ana aparece por estar asignada');
        testRunner.assertEquals(ana.total, 0, 'sin días trabajados como Ayudante en el rango');
    },

    "el feriado multiplica el valor del día (comportamiento preservado)"() {
        const args = baseArgs({ days: [{ date: parseDate('2026-07-01'), isHoliday: true }], holidayFactor: 2 });
        const res = buildEmployeeReportData(args);
        const alba = res.positions.find(g => g.position.id === 'alba');
        testRunner.assertEquals(alba.employees[0].dayValues['2026-07-01'], 2, '1 día × factor 2');
    }

});

testRunner.addSuite("EmployeeReportData — cableado en AnalyticsUI", {

    // 🐛 Campo 2026-07-10: la hoja por líder del Excel numeraba a los
    // empleados por índice de orden (1, 2, 3...) en vez de por su número de
    // ficha, a diferencia de las hojas por posición que sí usan emp.number.
    "la hoja por líder del Excel numera por número de FICHA, no por orden"() {
        const fs = require('fs');
        const path = require('path');
        const SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/analytics/AnalyticsUI.js'), 'utf8');
        const idx = SRC.indexOf('HOJAS POR LÍDER');
        testRunner.assert(idx !== -1, 'debe existir la sección de hojas por líder');
        const block = SRC.slice(idx, idx + 2600);
        testRunner.assert(!/\$\{baseIndex\}/.test(block),
            'no debe numerar por índice de orden (baseIndex)');
        testRunner.assert(/idx:\s*`\$\{emp\.number\}/.test(block),
            'debe numerar por el número de empleado (ficha), como las hojas por posición');
    },

    "calculateEmployeeReportData delega en el builder puro (el fix llega al reporte/Excel real)"() {
        const fs = require('fs');
        const path = require('path');
        const SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/analytics/AnalyticsUI.js'), 'utf8');
        testRunner.assert(/from '\.\/EmployeeReportData\.js'/.test(SRC),
            'AnalyticsUI debe importar el builder puro');
        const idx = SRC.indexOf('function calculateEmployeeReportData');
        const block = SRC.slice(idx, idx + 1600);
        testRunner.assert(/return buildEmployeeReportData\(/.test(block),
            'calculateEmployeeReportData debe delegar (no duplicar la lógica con el bug viejo)');
        testRunner.assert(!/activePositions/.test(block),
            'el filtro viejo por posiciones activas no debe seguir en el wrapper');
    }

});

console.log('🧪 EmployeeReportData tests cargados.');
