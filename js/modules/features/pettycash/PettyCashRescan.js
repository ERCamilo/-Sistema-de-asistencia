/**
 * Qué cambió al volver a leer una factura. Probado en js/tests/PettyCashRescan.test.js.
 */
const LABELS = Object.freeze({
    total: 'Total', subtotal: 'Subtotal', itbis: 'ITBIS', ncf: 'NCF', rncEmisor: 'RNC', paidTo: 'Comercio',
    date: 'Fecha', fechaEmision: 'Fecha', cliente: 'Cliente', rncCliente: 'RNC del cliente',
    descuento: 'Descuento', propina: 'Propina', exento: 'Exento', itbisIncluido: 'ITBIS incluido',
    category: 'Categoría', description: 'Descripción', amount: 'Monto de caja'
});

const same = (a, b) => {
    const empty = (v) => v === null || v === undefined || v === '';
    if (empty(a) && empty(b)) return true;
    if (empty(a) || empty(b)) return false;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na === nb;
    return String(a) === String(b);
};

/**
 * @returns {{tone:'ok'|'warn', keys:string[], text:string}}
 */
export function rescanSummary(before = {}, after = {}, got = true) {
    if (!got) {
        return { tone: 'warn', keys: [], text: 'No se encontraron datos en la foto. Prueba con una foto más nítida o escríbelos a mano.' };
    }
    const keys = Object.keys(LABELS).filter((key) => !same(before[key], after[key]));
    if (!keys.length) return { tone: 'ok', keys, text: 'Se leyó de nuevo y los datos son los mismos.' };
    const labels = [...new Set(keys.map((key) => LABELS[key]))];
    return { tone: 'ok', keys, text: `Se leyó de nuevo. Cambiaron: ${labels.join(', ')}.` };
}
