export const PETTY_CASH_SORT_FIELDS = Object.freeze([
    'recordNumber',
    'invoiceDate',
    'amount'
]);

export function normalizePettyCashMovementSort(sort = {}) {
    const field = PETTY_CASH_SORT_FIELDS.includes(sort.field)
        ? sort.field
        : 'recordNumber';
    const direction = sort.direction === 'asc' ? 'asc' : 'desc';
    return { field, direction };
}

function invoiceDateValue(movement) {
    const value = String(movement?.fechaEmision || movement?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function fieldValue(movement, field) {
    if (field === 'invoiceDate') return invoiceDateValue(movement);
    return Number(movement?.[field]) || 0;
}

function compareMovements(left, right, sort) {
    const direction = sort.direction === 'asc' ? 1 : -1;

    const leftValue = fieldValue(left, sort.field);
    const rightValue = fieldValue(right, sort.field);

    // Una factura sin fecha válida siempre queda al final; cambiar la
    // dirección no debe hacer que datos incompletos encabecen la lista.
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue !== rightValue) return (leftValue - rightValue) * direction;

    const recordDiff = (Number(left?.recordNumber) || 0) -
        (Number(right?.recordNumber) || 0);
    if (recordDiff !== 0) return recordDiff * direction;
    return String(left?.id || '').localeCompare(String(right?.id || '')) * direction;
}

export function sortPettyCashMovements(movements = [], requestedSort = {}, options = {}) {
    const sort = normalizePettyCashMovementSort(requestedSort);
    const list = (movements || []).slice();
    const activeBatchIds = new Set(options.activeBatchIds || []);
    if (!activeBatchIds.size) return list.sort((left, right) => compareMovements(left, right, sort));

    const stable = list
        .filter((movement) => !activeBatchIds.has(movement?.id))
        .sort((left, right) => compareMovements(left, right, sort));
    const activeBatch = list
        .filter((movement) => activeBatchIds.has(movement?.id))
        .sort((left, right) =>
            (Number(left?.recordNumber) || 0) - (Number(right?.recordNumber) || 0)
        );
    return [...stable, ...activeBatch];
}
