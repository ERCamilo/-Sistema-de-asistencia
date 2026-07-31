export const DEFAULT_PETTY_CASH_PAGE_SIZE = 50;

export function normalizePettyCashMovementLimit(
    requestedLimit,
    pageSize = DEFAULT_PETTY_CASH_PAGE_SIZE
) {
    const normalizedPageSize = Math.max(1, Math.trunc(Number(pageSize) || DEFAULT_PETTY_CASH_PAGE_SIZE));
    const numericLimit = Math.trunc(Number(requestedLimit));
    if (!Number.isFinite(numericLimit) || numericLimit < 1) return normalizedPageSize;
    return Math.max(normalizedPageSize, numericLimit);
}

export function paginatePettyCashMovements(
    movements,
    requestedLimit = DEFAULT_PETTY_CASH_PAGE_SIZE
) {
    const source = Array.isArray(movements) ? movements : [];
    const limit = normalizePettyCashMovementLimit(requestedLimit);
    return {
        items: source.slice(0, limit),
        visible: Math.min(source.length, limit),
        total: source.length,
        hasMore: source.length > limit,
        nextLimit: limit + DEFAULT_PETTY_CASH_PAGE_SIZE
    };
}
