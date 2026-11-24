/**
 * Datos de una factura para la vista rápida de la cámara: lo leído y dónde está cada dato en
 * la foto. Los recuadros alimentan los botones de acceso rápido (fecha, total, NCF), que
 * acercan la foto al dato para comprobarlo de un vistazo.
 *
 * Probado en js/tests/PettyCashCameraData.test.js.
 */
import { effectiveBox } from './PettyCashBoxMath.js';
import { receiptDate } from './PettyCashDates.js';

/** Botones de acceso rápido, en orden: [clave del dato y del recuadro, etiqueta]. */
export const QUICK_FIELDS = Object.freeze([['date', 'Fecha'], ['total', 'Total'], ['ncf', 'NCF']]);
/** Datos que, además, tienen recuadro en la foto. */
const BOX_KEYS = ['date', 'total', 'ncf', 'rncEmisor', 'itbis', 'paidTo'];

const defaultMoney = (n) => `RD$ ${(Number(n) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function cameraItemData(movement, { money = defaultMoney } = {}) {
    if (!movement) return {};
    const amount = (n) => (Number(n) ? money(n) : null);
    const boxes = {};
    for (const key of BOX_KEYS) {
        const found = effectiveBox(movement, key);
        if (found) boxes[key] = found.box;
    }
    return {
        paidTo: movement.paidTo || null,
        date: receiptDate(movement) || null,
        ncf: movement.ncf || null,
        rncEmisor: movement.rncEmisor || null,
        itbis: amount(movement.itbis),
        total: amount(movement.amount),
        category: movement.category || null,
        boxes
    };
}
