function normalizeSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function formattedDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function compactIdentifier(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '');
}

function movementSearchText(movement) {
    const recordNumber = Number(movement?.recordNumber);
    const amount = Number(movement?.amount);
    const date = movement?.fechaEmision || movement?.date || '';
    return normalizeSearchText([
        Number.isInteger(recordNumber) && recordNumber > 0
            ? `registro ${String(recordNumber).padStart(3, '0')} numero ${recordNumber}`
            : '',
        movement?.paidTo,
        movement?.description,
        movement?.ncf,
        compactIdentifier(movement?.ncf),
        movement?.rncEmisor,
        compactIdentifier(movement?.rncEmisor),
        movement?.category,
        movement?.type === 'reposicion' ? 'reposicion' : 'gasto',
        date,
        formattedDate(date),
        Number.isFinite(amount) ? amount.toFixed(2) : ''
    ].filter(Boolean).join(' '));
}

export function normalizePettyCashMovementSearch(value) {
    return normalizeSearchText(value).slice(0, 120);
}

export function filterPettyCashMovements(movements = [], query = '') {
    const terms = normalizePettyCashMovementSearch(query).split(' ').filter(Boolean);
    const list = Array.isArray(movements) ? movements : [];
    if (!terms.length) return list.slice();

    return list.filter((movement) => {
        const searchable = movementSearchText(movement);
        return terms.every((term) => searchable.includes(term));
    });
}
