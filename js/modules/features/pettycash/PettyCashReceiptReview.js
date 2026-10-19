/**
 * Estado derivado de cada gasto para la pantalla de Caja chica.
 *
 * No se guarda: se calcula al pintar con las mismas revisiones que usa la
 * cámara (`PettyCashReceiptChecks`), así lista, editor y cámara dicen lo mismo.
 *
 *   respaldo → gasto sin comprobante (foto o PDF)
 *   otra     → crédito fiscal que no está a nombre de la empresa
 *   revisar  → hay avisos sin resolver, o el registro se creó solo y falta confirmarlo
 *   consumo  → factura de consumo o sin NCF: no da crédito fiscal
 *   leida    → datos y crédito fiscal en orden
 *
 * Probado en js/tests/PettyCashReceiptReview.test.js.
 */
import { checkReceipt, receiptNotes } from './PettyCashReceiptChecks.js';

export const RECEIPT_STATES = Object.freeze({
    leida:    Object.freeze({ label: 'Leída',        hint: 'Datos y crédito fiscal en orden', color: '#10b981' }),
    revisar:  Object.freeze({ label: 'Por revisar',  hint: 'Hay datos que confirmar',         color: '#f59e0b' }),
    consumo:  Object.freeze({ label: 'Consumo',      hint: 'Sin crédito fiscal',              color: '#6d7d99' }),
    otra:     Object.freeze({ label: 'Otra empresa', hint: 'No está a nombre de la empresa',  color: '#ef4444' }),
    respaldo: Object.freeze({ label: 'Sin respaldo', hint: 'Falta foto de la factura',        color: '#f59e0b' })
});

const ATTENTION = new Set(['revisar', 'respaldo', 'otra']);
const FILTER_KEYS = ['revisar', 'respaldo', 'consumo', 'otra', 'leida'];

/** ¿El estado pide que la persona haga algo? */
export function needsAttention(key) {
    return ATTENTION.has(key);
}

const hasNcf = (movement) => String(movement?.ncf ?? '').replace(/[\s-]/g, '') !== '';

/**
 * @param {object} movement gasto o reposición
 * @param {{period?:object, movements?:object[], today?:string, companyRnc?:string|null}} [context]
 * @returns {{key:string, issues:object[], notes:object[]}}
 */
export function movementReviewState(movement, context = {}) {
    if (!movement || movement.type !== 'gasto') return { key: 'reposicion', issues: [], notes: [] };
    if (!movement.hasReceipt && !movement.receiptStatus) return { key: 'respaldo', issues: [], notes: [] };

    const issues = checkReceipt(movement, context);
    const notes = receiptNotes(movement);
    if (!hasNcf(movement)) {
        notes.push({ code: 'no-ncf', field: 'ncf', message: 'Sin NCF: no genera crédito fiscal.' });
    }
    let key;
    if (issues.some((i) => i.code === 'client-rnc')) key = 'otra';
    else if (issues.length || movement.reviewPending) key = 'revisar';
    else if (notes.some((n) => n.code === 'consumer-invoice' || n.code === 'no-ncf')) key = 'consumo';
    else key = 'leida';
    return { key, issues, notes };
}

/** Cantidad por filtro: `todos` más cada estado. Las reposiciones solo suman en `todos`. */
export function reviewFilterCounts(items = []) {
    const counts = { todos: items.length };
    FILTER_KEYS.forEach((k) => { counts[k] = 0; });
    items.forEach((item) => { if (item.key in counts) counts[item.key] += 1; });
    return counts;
}

/**
 * Secciones de la lista. Con «primero en revisión» y sin filtro: POR REVISAR y
 * RESTO; en otro caso, una sola lista. Conserva el orden de entrada.
 */
export function groupReviewFirst(items = [], { first = true, filter = 'todos' } = {}) {
    if (!items.length) return [];
    if (filter !== 'todos') {
        const only = items.filter((item) => item.key === filter);
        return only.length ? [{ id: 'all', title: '', items: only }] : [];
    }
    if (!first) return [{ id: 'all', title: '', items }];
    const review = items.filter((item) => needsAttention(item.key));
    const rest = items.filter((item) => !needsAttention(item.key));
    const groups = [];
    if (review.length) groups.push({ id: 'review', title: 'POR REVISAR', items: review });
    if (rest.length) groups.push({ id: 'rest', title: 'RESTO', items: rest });
    return groups;
}
