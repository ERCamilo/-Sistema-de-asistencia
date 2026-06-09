/**
 * PettyCashExport.js — arma las hojas (arrays de arrays) para exportar a Excel
 * un periodo de caja chica. Puro: NO toca XLSX ni el DOM (eso va en la UI).
 */

import { resumenPeriodo } from './PettyCashCalc.js';

const MOV_HEADER = ['Fecha', 'Tipo', 'Tienda/Proveedor', 'Categoría', 'Descripción', 'NCF', 'RNC emisor', 'Cliente', 'RNC cliente', 'Subtotal', 'ITBIS', 'Total', 'Monto', 'Comprobante', 'Por revisar'];
const ITEMS_HEADER = ['Fecha', 'Tienda', 'Artículo', 'Cantidad', 'Precio'];

const numOrBlank = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

/**
 * @param {object} project
 * @param {object} period
 * @param {Array} periodMovements  movimientos YA filtrados del periodo
 * @returns {{ resumen: any[][], movimientos: any[][], items: any[][] }}
 */
export function buildPeriodSheets(project, period, periodMovements) {
    const movs = (Array.isArray(periodMovements) ? periodMovements.slice() : [])
        .sort((a, b) => String(a && a.date || '').localeCompare(String(b && b.date || '')));
    const r = resumenPeriodo(movs);

    const resumen = [
        ['Caja Chica — Resumen del periodo'],
        [],
        ['Proyecto', (project && project.name) || ''],
        ['Periodo', (period && period.label) || ''],
        ['Apertura', (period && period.openingDate) || ''],
        ['Cierre', (period && period.closingDate) || ''],
        ['Estado', (period && period.status) || ''],
        [],
        ['Reposiciones', r.reposiciones],
        ['Gastos', r.gastos],
        ['Saldo', r.saldo]
    ];
    if (r.reembolso > 0) resumen.push(['Por reembolsar', r.reembolso]);
    if (period && period.status === 'cerrada' && period.efectivoContado !== undefined && period.efectivoContado !== null) {
        resumen.push([], ['Efectivo contado', Number(period.efectivoContado)], ['Diferencia', Number(period.diferencia || 0)]);
    }

    const movimientos = [MOV_HEADER.slice()];
    const items = [ITEMS_HEADER.slice()];
    for (const m of movs) {
        if (!m) continue;
        const isGasto = m.type === 'gasto';
        movimientos.push([
            m.date || '',
            isGasto ? 'Gasto' : 'Reposición',
            m.paidTo || '',
            isGasto ? (m.category || '') : '',
            m.description || '',
            m.ncf || '',
            m.rncEmisor || '',
            m.cliente || '',
            m.rncCliente || '',
            numOrBlank(m.subtotal),
            numOrBlank(m.itbis),
            numOrBlank(m.total),
            Number(m.amount) || 0,
            isGasto ? (m.hasReceipt ? 'Sí' : 'No') : '',
            m.reviewPending ? 'Sí' : 'No'
        ]);
        if (Array.isArray(m.items)) {
            for (const it of m.items) {
                if (!it) continue;
                items.push([m.date || '', m.paidTo || '', it.descripcion || '', numOrBlank(it.cantidad), numOrBlank(it.precio)]);
            }
        }
    }

    return { resumen, movimientos, items };
}

export default { buildPeriodSheets };
