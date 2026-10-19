/** Descargar y compartir desde el editor nuevo (PettyCashUI real, módulo de archivos simulado). */
import { registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { downloadReceipt, shareReceipt } from '../modules/features/pettycash/PettyCashReceiptShare.js';

jest.mock('../modules/features/pettycash/PettyCashReceiptShare.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashReceiptShare.js'),
    downloadReceipt: jest.fn(),
    shareReceipt: jest.fn()
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeAll(() => { registerPettyCashGlobals(); });
beforeEach(async () => {
    window.render = jest.fn();
    window.showNotification = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:recibo');
    URL.revokeObjectURL = jest.fn();
    indexedDBService.getReceipt.mockResolvedValue({ originalBlob: new Blob(['x'], { type: 'image/jpeg' }), originalType: 'image/jpeg' });
    state.settings = { newPettyCashScreen: true };
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01' }],
        movements: [{ id: 'g1', projectId: 'c1', periodId: 'p1', recordNumber: 3, type: 'gasto', hasReceipt: true, receiptStatus: 'local', ncf: 'B0100000123', amount: 10, date: '2026-10-05' }],
        selectedProjectId: 'c1', selectedPeriodId: 'p1', receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
    downloadReceipt.mockReset(); shareReceipt.mockReset();
    window.pcOpenMovement('g1'); await flush();
});
afterEach(() => { state.pettyCash = null; state.settings = {}; delete window.render; delete window.showNotification; });

test('descargar usa la foto cargada y el nombre con el NCF, y avisa el resultado', async () => {
    downloadReceipt.mockResolvedValue({ status: 'downloaded', name: 'factura-B0100000123.jpg' });
    await window.pcEditorDownload();
    expect(downloadReceipt).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:recibo', mime: 'image/jpeg', name: 'factura-B0100000123.jpg' }));
    expect(window.showNotification).toHaveBeenCalledWith(expect.stringContaining('descargada'), 'success');
});

test('compartir: compartida no avisa error; cerrada no avisa nada; descargada explica por qué', async () => {
    shareReceipt.mockResolvedValue({ status: 'shared' });
    await window.pcEditorShare();
    expect(window.showNotification).not.toHaveBeenCalledWith(expect.anything(), 'error');
    window.showNotification.mockClear();
    shareReceipt.mockResolvedValue({ status: 'cancelled' });
    await window.pcEditorShare();
    expect(window.showNotification).not.toHaveBeenCalled();
    shareReceipt.mockResolvedValue({ status: 'downloaded', name: 'f.jpg' });
    await window.pcEditorShare();
    expect(window.showNotification).toHaveBeenCalledWith(expect.stringContaining('no permite compartir'), 'info');
});

test('un error se muestra como error; sin foto cargada no hace nada', async () => {
    downloadReceipt.mockResolvedValue({ status: 'error', message: 'No se pudo leer la foto.' });
    await window.pcEditorDownload();
    expect(window.showNotification).toHaveBeenCalledWith('No se pudo leer la foto.', 'error');
    downloadReceipt.mockClear();
    state.pettyCash._editSource = null;
    await window.pcEditorDownload();
    expect(downloadReceipt).not.toHaveBeenCalled();
});
