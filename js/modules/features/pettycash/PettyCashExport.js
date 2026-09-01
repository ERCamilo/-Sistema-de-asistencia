/**
 * PettyCashExport.js — arma las hojas (arrays de arrays) para exportar a Excel
 * un periodo de caja chica. Puro: NO toca XLSX ni el DOM (eso va en la UI).
 */

import { resumenPeriodo } from './PettyCashCalc.js';

const BENEFICIARIOS_HEADER = ['Fecha', 'Beneficiario/Comercio', 'Categoría', 'Monto'];
const MOV_HEADER = ['Fecha', 'Tipo', 'Tienda/Proveedor', 'Categoría', 'Descripción', 'NCF', 'RNC emisor', 'Cliente', 'RNC cliente', 'Subtotal', 'ITBIS', 'Total', 'Monto', 'Comprobante', 'Por revisar'];
const ITEMS_HEADER = ['Fecha', 'Tienda', 'Artículo', 'Cantidad', 'Precio'];

const numOrBlank = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

/**
 * Formatea una fecha ISO (YYYY-MM-DD) a formato día/mes/año (DD/MM/YYYY)
 * @param {string} value 
 * @returns {string}
 */
export function formatExportDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (!match) return text;
    return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * @param {object} project
 * @param {object} period
 * @param {Array} periodMovements  movimientos YA filtrados del periodo
 * @returns {{ resumen: any[][], beneficiarios: any[][], movimientos: any[][], items: any[][] }}
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
        ['Apertura', formatExportDate(period && period.openingDate)],
        ['Cierre', formatExportDate(period && period.closingDate)],
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

    const beneficiarios = [BENEFICIARIOS_HEADER.slice()];
    const movimientos = [MOV_HEADER.slice()];
    const items = [ITEMS_HEADER.slice()];

    for (const m of movs) {
        if (!m) continue;
        const isGasto = m.type === 'gasto';
        const formattedDate = formatExportDate(m.date);
        const beneficiary = isGasto ? (m.paidTo || '') : (m.paidTo || m.description || 'Reposición');
        const category = isGasto ? (m.category || '') : 'Reposición';

        // Hoja 2: Fecha, Beneficiario/Comercio, Categoría, Monto
        beneficiarios.push([
            formattedDate,
            beneficiary,
            category,
            Number(m.amount) || 0
        ]);

        // Hoja 3: Movimientos detallados
        movimientos.push([
            formattedDate,
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

        // Hoja 4: Desglose de ítems/artículos
        if (Array.isArray(m.items)) {
            for (const it of m.items) {
                if (!it) continue;
                items.push([formattedDate, m.paidTo || '', it.descripcion || '', numOrBlank(it.cantidad), numOrBlank(it.precio)]);
            }
        }
    }

    return { resumen, beneficiarios, movimientos, items };
}

export default { buildPeriodSheets, formatExportDate };
