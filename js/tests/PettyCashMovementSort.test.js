import {
    normalizePettyCashMovementSort,
    sortPettyCashMovements
} from '../modules/features/pettycash/PettyCashMovementSort.js';
import { PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';

const movements = [
    { id: 'm2', recordNumber: 2, amount: 500, date: '2026-07-02' },
    { id: 'm10', recordNumber: 10, amount: 100, date: '2026-07-01', fechaEmision: '2026-06-30' },
    { id: 'm7', recordNumber: 7, amount: 900, date: '' }
];

describe('PettyCashMovementSort', () => {
    test('el orden predeterminado usa el número real descendente', () => {
        expect(sortPettyCashMovements(movements).map((item) => item.id))
            .toEqual(['m10', 'm7', 'm2']);
    });

    test('permite invertir el orden de registro', () => {
        expect(sortPettyCashMovements(movements, {
            field: 'recordNumber',
            direction: 'asc'
        }).map((item) => item.id)).toEqual(['m2', 'm7', 'm10']);
    });

    test('fecha de factura prioriza fechaEmision y deja fechas vacías al final', () => {
        expect(sortPettyCashMovements(movements, {
            field: 'invoiceDate',
            direction: 'desc'
        }).map((item) => item.id)).toEqual(['m2', 'm10', 'm7']);

        expect(sortPettyCashMovements(movements, {
            field: 'invoiceDate',
            direction: 'asc'
        }).map((item) => item.id)).toEqual(['m10', 'm2', 'm7']);
    });

    test('ordena por monto sin mutar la lista original', () => {
        const source = movements.slice();
        expect(sortPettyCashMovements(movements, {
            field: 'amount',
            direction: 'desc'
        }).map((item) => item.amount)).toEqual([900, 500, 100]);
        expect(movements).toEqual(source);
    });

    test('normaliza valores desconocidos al orden seguro', () => {
        expect(normalizePettyCashMovementSort({
            field: 'proveedor',
            direction: 'sideways'
        })).toEqual({ field: 'recordNumber', direction: 'desc' });
    });
});

describe('Caja Chica — controles de orden', () => {
    afterEach(() => {
        state.pettyCash = null;
    });

    test('renderiza los tres criterios y aplica el elegido a las tarjetas', () => {
        state.pettyCash = {
            projects: [{ id: 'p1', name: 'Obra' }],
            periods: [{
                id: 'per1',
                projectId: 'p1',
                label: 'Julio',
                status: 'abierta',
                openingDate: '2026-07-01'
            }],
            movements: [
                {
                    id: 'm1',
                    projectId: 'p1',
                    periodId: 'per1',
                    recordNumber: 1,
                    type: 'gasto',
                    amount: 900,
                    date: '2026-07-01',
                    paidTo: 'Monto alto'
                },
                {
                    id: 'm2',
                    projectId: 'p1',
                    periodId: 'per1',
                    recordNumber: 2,
                    type: 'gasto',
                    amount: 100,
                    date: '2026-07-02',
                    paidTo: 'Monto bajo'
                }
            ],
            selectedProjectId: 'p1',
            selectedPeriodId: 'per1',
            movementSortBy: 'amount',
            movementSortDirection: 'asc',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };

        const html = PettyCashTab();

        expect(html).toContain('Número de registro');
        expect(html).toContain('Fecha de factura');
        expect(html).toContain('Menor primero');
        expect(html.indexOf('Monto bajo')).toBeLessThan(html.indexOf('Monto alto'));
    });
});
