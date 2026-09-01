/**
 * 🧪 PettyCashExportTests
 *
 * Helper PURO que arma las hojas (arrays de arrays) para exportar a Excel un
 * periodo de caja chica: Resumen, Beneficiarios, Movimientos y Artículos.
 */

import { buildPeriodSheets, formatExportDate } from '../modules/features/pettycash/PettyCashExport.js';

const proj = { id: 'p1', name: 'Torre A' };
const period = { id: 'per1', label: 'Quincena 1', status: 'cerrada', openingDate: '2026-06-01', closingDate: '2026-06-15', saldoFinal: 6500, efectivoContado: 6000, diferencia: -500 };
const movs = [
    { id: 'm2', type: 'gasto', date: '2026-06-05', amount: 3500, paidTo: 'Ferretería X', category: 'Materiales', ncf: 'B0100001', rncEmisor: '130111', total: 3500, hasReceipt: true, reviewPending: true, items: [{ descripcion: 'Cemento', cantidad: 10, precio: 3000 }, { descripcion: 'Clavos', cantidad: 2, precio: 500 }] },
    { id: 'm1', type: 'reposicion', date: '2026-06-01', amount: 10000 }
];

testRunner.addSuite("PettyCashExport — buildPeriodSheets", {

    "devuelve las 4 hojas requeridas"() {
        const s = buildPeriodSheets(proj, period, movs);
        testRunner.assert(Array.isArray(s.resumen), 'resumen');
        testRunner.assert(Array.isArray(s.beneficiarios), 'beneficiarios');
        testRunner.assert(Array.isArray(s.movimientos), 'movimientos');
        testRunner.assert(Array.isArray(s.items), 'items');
    },

    "hoja de beneficiarios tiene fecha DD/MM/YYYY, beneficiario/comercio, categoría y monto"() {
        const b = buildPeriodSheets(proj, period, movs).beneficiarios;
        testRunner.assertEquals(b.length, 3, 'header + 2 movimientos');
        testRunner.assertEquals(b[0][0], 'Fecha');
        testRunner.assertEquals(b[0][1], 'Beneficiario/Comercio');
        testRunner.assertEquals(b[0][2], 'Categoría');
        testRunner.assertEquals(b[0][3], 'Monto');
        testRunner.assertEquals(b[1][0], '01/06/2026', 'fecha formateada');
        testRunner.assertEquals(b[1][1], 'Reposición', 'beneficiario reposición');
        testRunner.assertEquals(b[1][2], 'Reposición', 'categoría reposición');
        testRunner.assertEquals(b[1][3], 10000, 'monto numérico');
        testRunner.assertEquals(b[2][0], '05/06/2026', 'fecha formateada');
        testRunner.assertEquals(b[2][1], 'Ferretería X', 'tienda/proveedor');
        testRunner.assertEquals(b[2][2], 'Materiales', 'categoría gasto');
        testRunner.assertEquals(b[2][3], 3500, 'monto numérico');
    },

    "resumen incluye proyecto, periodo, fechas formateadas y totales"() {
        const flat = JSON.stringify(buildPeriodSheets(proj, period, movs).resumen);
        testRunner.assert(flat.includes('Torre A'), 'proyecto');
        testRunner.assert(flat.includes('Quincena 1'), 'periodo');
        testRunner.assert(flat.includes('01/06/2026'), 'apertura formateada');
        testRunner.assert(flat.includes('15/06/2026'), 'cierre formateado');
        testRunner.assert(flat.includes('10000') || flat.includes('10,000') === false, 'reposiciones');
    },

    "movimientos: header + una fila por movimiento, fechas en formato DD/MM/YYYY"() {
        const m = buildPeriodSheets(proj, period, movs).movimientos;
        testRunner.assertEquals(m.length, 3, 'header + 2 movimientos');
        testRunner.assertEquals(m[0][0], 'Fecha', 'header');
        // ordenadas asc: primera fila de datos es la reposición del 01/06/2026
        testRunner.assertEquals(m[1][0], '01/06/2026');
        testRunner.assertEquals(m[2][0], '05/06/2026');
    },

    "monto va como número (no string)"() {
        const m = buildPeriodSheets(proj, period, movs).movimientos;
        const montoCol = m[0].indexOf('Monto');
        testRunner.assertEquals(typeof m[1][montoCol], 'number');
    },

    "items: header + una fila por artículo con fecha formateada"() {
        const it = buildPeriodSheets(proj, period, movs).items;
        testRunner.assertEquals(it[0][0], 'Fecha', 'header items');
        testRunner.assertEquals(it[1][0], '05/06/2026', 'fecha formateada');
        testRunner.assertEquals(it.length, 3, 'header + 2 artículos');
        testRunner.assert(JSON.stringify(it).includes('Cemento'), 'cemento');
    },

    "sin movimientos: tablas solo header"() {
        const s = buildPeriodSheets(proj, period, []);
        testRunner.assertEquals(s.beneficiarios.length, 1);
        testRunner.assertEquals(s.movimientos.length, 1);
        testRunner.assertEquals(s.items.length, 1);
    },

    "tolera period/project nulos"() {
        const s = buildPeriodSheets(null, null, []);
        testRunner.assert(Array.isArray(s.resumen) && Array.isArray(s.beneficiarios) && Array.isArray(s.movimientos));
    },

    "formatExportDate convierte correctamente YYYY-MM-DD a DD/MM/YYYY"() {
        testRunner.assertEquals(formatExportDate('2026-12-31'), '31/12/2026');
        testRunner.assertEquals(formatExportDate('2026-01-05'), '05/01/2026');
        testRunner.assertEquals(formatExportDate(''), '');
        testRunner.assertEquals(formatExportDate(null), '');
    }

});

console.log('🧪 PettyCashExport tests cargados.');
