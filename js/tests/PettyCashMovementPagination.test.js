import {
    DEFAULT_PETTY_CASH_PAGE_SIZE,
    paginatePettyCashMovements
} from '../modules/features/pettycash/PettyCashMovementPagination.js';

describe('Petty Cash movement pagination', () => {
    const movements = Array.from({ length: 120 }, (_, index) => ({ id: `m-${index}` }));

    test('muestra 50 registros por defecto sin alterar la fuente', () => {
        const result = paginatePettyCashMovements(movements);

        expect(result.items).toHaveLength(DEFAULT_PETTY_CASH_PAGE_SIZE);
        expect(result.hasMore).toBe(true);
        expect(result.total).toBe(120);
        expect(movements).toHaveLength(120);
    });

    test('respeta el límite incremental y normaliza valores inválidos', () => {
        expect(paginatePettyCashMovements(movements, 100).items).toHaveLength(100);
        expect(paginatePettyCashMovements(movements, -1).items).toHaveLength(50);
        expect(paginatePettyCashMovements(movements, 500).hasMore).toBe(false);
    });
});
