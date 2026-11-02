/**
 * Fecha de un gasto o reposición.
 *
 * DECISIÓN: la fecha de una factura es SIEMPRE la fecha de emisión (`fechaEmision`).
 * `date` queda como respaldo cuando falta: reposiciones y gastos antiguos. Lista,
 * orden, búsqueda, duplicados, avisos de periodo y Excel usan esta misma función.
 * Probado en js/tests/PettyCashReceiptDate.test.js.
 */
export function receiptDate(movement) {
    return String(movement?.fechaEmision || movement?.date || '');
}
