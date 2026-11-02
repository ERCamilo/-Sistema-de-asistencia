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

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * ¿Un gasto tiene dos fechas distintas? Pasa en registros antiguos: la persona pudo corregir
 * `date` mientras `fechaEmision` conservaba la lectura original (o al revés). No se decide por
 * ella: el editor muestra las dos y guarda la que elija. `swapped` avisa cuando una es la otra
 * con día y mes invertidos, el error más común del lector.
 * @returns {{emission:string, record:string, swapped:boolean}|null}
 */
export function datesConflict(movement) {
    const emission = String(movement?.fechaEmision || '');
    const record = String(movement?.date || '');
    const a = ISO.exec(emission);
    const b = ISO.exec(record);
    if (!a || !b || emission === record) return null;
    const swapped = a[1] === b[1] && a[2] === b[3] && a[3] === b[2] && a[2] !== a[3];
    return { emission, record, swapped };
}
