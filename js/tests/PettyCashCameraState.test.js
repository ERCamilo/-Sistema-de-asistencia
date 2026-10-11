/**
 * Caja chica → cámara nueva: estado de cada foto a partir de la cola de
 * lectura y del gasto, y el botón "Cámara" según el interruptor de Tests.
 */
import { cameraItemsState, PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

const seed = (movements) => {
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements, selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};

describe('cameraItemsState', () => {
    afterEach(() => { state.pettyCash = null; });

    test('leyendo, leída (con datos) y por revisar (con motivo)', async () => {
        seed([
            { id: 'm1', periodId: 'p1', type: 'gasto', amount: 0 },
            { id: 'm2', periodId: 'p1', type: 'gasto', amount: 590, subtotal: 500, itbis: 90, total: 590, paidTo: 'Ferretería Sol', ncf: 'B0100000123', date: '2026-10-05', category: 'Materiales' },
            { id: 'm3', periodId: 'p1', type: 'gasto', amount: 700, subtotal: 500, itbis: 90, total: 700, date: '2026-10-05' }
        ]);
        const jobs = [
            { txId: 'm1', ocrStatus: 'processing', queueStatus: 'processing' },
            { txId: 'm2', ocrStatus: 'extracted', queueStatus: 'awaiting-review' },
            { txId: 'm3', ocrStatus: 'extracted', queueStatus: 'awaiting-review' }
        ];
        const map = await cameraItemsState(['m1', 'm2', 'm3'], { listJobs: async () => jobs });
        expect(map.get('m1').state).toBe('reading');
        expect(map.get('m2')).toMatchObject({ state: 'ok', data: { paidTo: 'Ferretería Sol', ncf: 'B0100000123', category: 'Materiales' } });
        expect(map.get('m2').data.total).toContain('590');
        expect(map.get('m3').state).toBe('review');
        expect(map.get('m3').issues[0].code).toBe('total-mismatch');
    });

    test('sin registro en la cola: con monto se trata como leída; sin gasto, leyendo', async () => {
        seed([{ id: 'm1', periodId: 'p1', type: 'gasto', amount: 250, date: '2026-10-02' }]);
        const map = await cameraItemsState(['m1', 'perdido'], { listJobs: async () => [] });
        expect(map.get('m1').state).toBe('ok');
        expect(map.get('perdido').state).toBe('reading');
    });
});

describe('botón Cámara en Caja chica', () => {
    afterEach(() => { state.pettyCash = null; state.settings = {}; });

    test('por defecto usa la cámara del sistema; con la prueba activa abre la cámara nueva', () => {
        seed([]);
        state.settings = {};
        document.body.innerHTML = PettyCashTab();
        expect(document.querySelector('input[capture="environment"][onchange*="pcCameraBatchPhoto"]')).not.toBeNull();
        expect(document.querySelector('[data-app-fn="pcOpenCamera"]')).toBeNull();

        state.settings = { newReceiptCamera: true };
        document.body.innerHTML = PettyCashTab();
        expect(document.querySelector('[data-app-fn="pcOpenCamera"]')).not.toBeNull();
    });
});

describe('Configuración → Tests: cámara de facturas nueva', () => {
    test('interruptor apagado por defecto y refleja lo guardado', () => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.getElementById('newReceiptCamera').checked).toBe(false);
        document.body.innerHTML = SettingsTestsTab({ state: { settings: { newReceiptCamera: true } } });
        expect(document.getElementById('newReceiptCamera').checked).toBe(true);
    });
});
