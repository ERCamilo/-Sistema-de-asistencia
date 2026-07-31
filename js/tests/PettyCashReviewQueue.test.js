import { PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';

function occurrences(source, text) {
    return source.split(text).length - 1;
}

describe('Caja Chica — registros pendientes de revisión', () => {
    beforeEach(() => {
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
                    id: 'review-1',
                    projectId: 'p1',
                    periodId: 'per1',
                    recordNumber: 2,
                    type: 'gasto',
                    amount: 850,
                    date: '2026-07-30',
                    paidTo: 'Factura por revisar',
                    ncf: 'B010000002',
                    reviewPending: true
                },
                {
                    id: 'confirmed-1',
                    projectId: 'p1',
                    periodId: 'per1',
                    recordNumber: 1,
                    type: 'gasto',
                    amount: 500,
                    date: '2026-07-29',
                    paidTo: 'Movimiento confirmado'
                }
            ],
            selectedProjectId: 'p1',
            selectedPeriodId: 'per1',
            movementSortBy: 'recordNumber',
            movementSortDirection: 'desc',
            movementSearchQuery: 'confirmado',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };
    });

    afterEach(() => {
        state.pettyCash = null;
    });

    test('muestra una tabla superior independiente del buscador del historial', () => {
        const html = PettyCashTab();

        expect(html).toContain('Pendientes de revisión');
        expect(html).toContain('Historial del período');
        expect(html.indexOf('Pendientes de revisión'))
            .toBeLessThan(html.indexOf('Historial del período'));
        expect(html).toContain('<table');
        expect(html).toContain('Factura por revisar');
        expect(html).toContain('Movimiento confirmado');
        expect(occurrences(html, 'Factura por revisar')).toBe(1);
    });

    test('saca el pendiente del historial normal y conserva sus acciones', () => {
        const html = PettyCashTab();
        const reviewStart = html.indexOf('data-petty-cash-review-queue');
        const historyStart = html.indexOf('data-petty-cash-history');
        const reviewSection = html.slice(reviewStart, historyStart);
        const historySection = html.slice(historyStart);

        expect(reviewSection).toContain('data-app-fn="pcOpenMovement"');
        expect(reviewSection).toContain('data-app-fn="pcDeleteMovement"');
        expect(reviewSection).toContain('Revisar');
        expect(historySection).not.toContain('Factura por revisar');
        expect(historySection).toContain('Movimiento confirmado');
    });
});
