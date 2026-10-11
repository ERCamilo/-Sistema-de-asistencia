/**
 * La barra inferior ofrece "Foto de factura" solo cuando hay un periodo de
 * caja chica abierto y elegido: pcCameraBatchPhoto descarta la foto en
 * silencio si no lo hay.
 */
import { canCapturePettyCashReceipt } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';

const seed = (periods, selectedPeriodId) => {
    state.pettyCash = {
        projects: [], periods, movements: [], selectedProjectId: null, selectedPeriodId,
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};

describe('canCapturePettyCashReceipt', () => {
    afterEach(() => { state.pettyCash = null; });

    test('periodo abierto y elegido → se puede', () => {
        seed([{ id: 'p1', status: 'abierta' }], 'p1');
        expect(canCapturePettyCashReceipt()).toBe(true);
    });

    test('periodo cerrado → no', () => {
        seed([{ id: 'p1', status: 'cerrada' }], 'p1');
        expect(canCapturePettyCashReceipt()).toBe(false);
    });

    test('sin periodo elegido o elegido inexistente → no', () => {
        seed([{ id: 'p1', status: 'abierta' }], null);
        expect(canCapturePettyCashReceipt()).toBe(false);
        seed([{ id: 'p1', status: 'abierta' }], 'borrado');
        expect(canCapturePettyCashReceipt()).toBe(false);
    });
});
