/**
 * 🧪 PettyCashExportTests
 *
 * Helper PURO que arma las hojas (arrays de arrays) para exportar a Excel un
 * periodo de caja chica: Resumen, Movimientos y Artículos. La generación del
 * .xlsx (SheetJS) y la descarga son IO de navegador → se prueban a mano.
 */

import { buildPeriodSheets } from '../modules/features/pettycash/PettyCashExport.js';

const proj = { id: 'p1', name: 'Torre A' };
const period = { id: 'per1', label: 'Quincena 1', status: 'cerrada', openingDate: '2026-06-01', closingDate: '2026-06-15', saldoFinal: 6500, efectivoContado: 6000, diferencia: -500 };
const movs = [
    { id: 'm2', type: 'gasto', date: '2026-06-05', amount: 3500, paidTo: 'Ferretería X', category: 'Materiales', ncf: 'B0100001', rncEmisor: '130111', total: 3500, hasReceipt: true, reviewPending: true, items: [{ descripcion: 'Cemento', cantidad: 10, precio: 3000 }, { descripcion: 'Clavos', cantidad: 2, precio: 500 }] },
    { id: 'm1', type: 'reposicion', date: '2026-06-01', amount: 10000 }
];

testRunner.addSuite("PettyCashExport — buildPeriodSheets", {

    "devuelve las 3 hojas"() {
        const s = buildPeriodSheets(proj, period, movs);
        testRunner.assert(Array.isArray(s.resumen), 'resumen');
        testRunner.assert(Array.isArray(s.movimientos), 'movimientos');
        testRunner.assert(Array.isArray(s.items), 'items');
    },

    "resumen incluye proyecto, periodo y totales"() {
        const flat = JSON.stringify(buildPeriodSheets(proj, period, movs).resumen);
        testRunner.assert(flat.includes('Torre A'), 'proyecto');
        testRunner.assert(flat.includes('Quincena 1'), 'periodo');
        testRunner.assert(flat.includes('10000') || flat.includes('10,000') === false, 'reposiciones'); // 10000 número
    },

    "movimientos: header + una fila por movimiento, ordenadas por fecha"() {
        const m = buildPeriodSheets(proj, period, movs).movimientos;
        testRunner.assertEquals(m.length, 3, 'header + 2 movimientos');
        testRunner.assertEquals(m[0][0], 'Fecha', 'header');
        // ordenadas asc: primera fila de datos es la reposición del 06-01
        testRunner.assertEquals(m[1][0], '2026-06-01');
        testRunner.assertEquals(m[2][0], '2026-06-05');
    },

    "monto va como número (no string)"() {
        const m = buildPeriodSheets(proj, period, movs).movimientos;
        const montoCol = m[0].indexOf('Monto');
        testRunner.assertEquals(typeof m[1][montoCol], 'number');
    },

    "items: header + una fila por artículo de cada movimiento"() {
        const it = buildPeriodSheets(proj, period, movs).items;
        testRunner.assertEquals(it[0][0], 'Fecha', 'header items');
        testRunner.assertEquals(it.length, 3, 'header + 2 artículos');
        testRunner.assert(JSON.stringify(it).includes('Cemento'), 'cemento');
    },

    "sin movimientos: movimientos solo header, items solo header"() {
        const s = buildPeriodSheets(proj, period, []);
        testRunner.assertEquals(s.movimientos.length, 1);
        testRunner.assertEquals(s.items.length, 1);
    },

    "tolera period/project nulos"() {
        const s = buildPeriodSheets(null, null, []);
        testRunner.assert(Array.isArray(s.resumen) && Array.isArray(s.movimientos));
    }

});

console.log('🧪 PettyCashExport tests cargados.');
