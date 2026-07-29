import {
    filterPettyCashMovements,
    normalizePettyCashMovementSearch
} from '../modules/features/pettycash/PettyCashMovementSearch.js';
import { PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';

const movements = [
    {
        id: 'm1',
        projectId: 'p1',
        periodId: 'per1',
        recordNumber: 14,
        type: 'gasto',
        amount: 1250.5,
        date: '2026-07-20',
        fechaEmision: '2026-07-18',
        paidTo: 'Ferretería Peña',
        description: 'Compra de cemento',
        ncf: 'B01-0000042',
        rncEmisor: '1-01-12345-6',
        category: 'Materiales'
    },
    {
        id: 'm2',
        projectId: 'p1',
        periodId: 'per1',
        recordNumber: 15,
        type: 'reposicion',
        amount: 5000,
        date: '2026-07-19',
        description: 'Fondo semanal'
    }
];

describe('PettyCashMovementSearch', () => {
    test.each([
        ['#014', ['m1']],
        ['ferreteria pena', ['m1']],
        ['B01 0000042', ['m1']],
        ['101123456', ['m1']],
        ['18-07-2026', ['m1']],
        ['1250.50', ['m1']],
        ['materiales cemento', ['m1']],
        ['reposicion semanal', ['m2']]
    ])('encuentra "%s" en los campos esperados', (query, expected) => {
        expect(filterPettyCashMovements(movements, query).map((item) => item.id))
            .toEqual(expected);
    });

    test('normaliza acentos, mayúsculas y espacios', () => {
        expect(normalizePettyCashMovementSearch('  FERRETERÍA   Peña  '))
            .toBe('ferreteria pena');
    });

    test('requiere que todos los términos coincidan y no muta la lista', () => {
        const snapshot = movements.slice();
        expect(filterPettyCashMovements(movements, 'ferreteria semanal')).toEqual([]);
        expect(movements).toEqual(snapshot);
    });
});

describe('Caja Chica — búsqueda de movimientos', () => {
    afterEach(() => {
        state.pettyCash = null;
    });

    test('renderiza solamente las coincidencias y muestra el contador', () => {
        state.pettyCash = {
            projects: [{ id: 'p1', name: 'Obra' }],
            periods: [{
                id: 'per1',
                projectId: 'p1',
                label: 'Julio',
                status: 'abierta',
                openingDate: '2026-07-01'
            }],
            movements,
            selectedProjectId: 'p1',
            selectedPeriodId: 'per1',
            movementSortBy: 'recordNumber',
            movementSortDirection: 'desc',
            movementSearchQuery: 'Ceménto',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };

        const html = PettyCashTab();

        expect(html).toContain('Buscar por número, proveedor, NCF, fecha o monto');
        expect(html).toContain('value="Ceménto"');
        expect(html).toContain('1 de 2 registros');
        expect(html).toContain('Ferretería Peña');
        expect(html).not.toContain('Fondo semanal');
    });
});
