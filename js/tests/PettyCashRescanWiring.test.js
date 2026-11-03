/**
 * Reescanear desde el editor nuevo (PettyCashUI real, servicios simulados):
 * nunca manda la miniatura al lector, lo escrito antes no tapa lo que el lector
 * corrige y el botón dice qué está pasando.
 */
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { auth } from '../modules/data/firebase.js';
import { Modal } from '../modules/components/Modal.js';

jest.mock('../modules/features/pettycash/PettyCashReceiptOCR.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashReceiptOCR.js'),
    requestReceiptOcr: jest.fn()
}));
jest.mock('../modules/features/pettycash/PettyCashReceiptBackup.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashReceiptBackup.js'),
    lookupReceiptBackup: jest.fn()
}));
jest.mock('../modules/features/pettycash/PettyCashPhoto.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashPhoto.js'),
    prepareReceiptForOcr: jest.fn()
}));
import { requestReceiptOcr } from '../modules/features/pettycash/PettyCashReceiptOCR.js';
import { lookupReceiptBackup } from '../modules/features/pettycash/PettyCashReceiptBackup.js';
import { prepareReceiptForOcr } from '../modules/features/pettycash/PettyCashPhoto.js';

const PREVIEW = 'data:image/jpeg;base64,PREVIEW480';
const movement = () => ({
    id: 'g1', projectId: 'c1', periodId: 'p1', recordNumber: 3, type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded',
    paidTo: 'Comedor', rncEmisor: '131778102', ncf: 'B0100000876', date: '2026-10-11', fechaEmision: '2026-10-11',
    category: 'Comida', description: 'Almuerzo', subtotal: 850, itbis: 153, total: 1098, amount: 1098, updatedAt: 1
});
const seed = () => {
    state.settings = { newPettyCashScreen: true };
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements: [movement()], selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: 'g1'
    };
};
const paint = () => { document.body.innerHTML = PettyCashTab(); };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ocrReply = (patch = {}) => ({ ok: true, emisor: 'Comedor', ncf: 'B0100000876', fecha: '2026-10-11', subtotal: 850, itbis: 153, total: 1000, ...patch });

beforeAll(() => { registerPettyCashGlobals(); });
beforeEach(() => {
    window.render = jest.fn(paint);
    auth.currentUser = { getIdToken: async () => 'tok' };
    URL.createObjectURL = jest.fn(() => 'blob:recibo');
    URL.revokeObjectURL = jest.fn();
    indexedDBService.getReceipt.mockReset().mockResolvedValue({ previewDataUrl: PREVIEW, remotePath: 'u/g1.webp', localOriginalPrunedAt: 5 });
    indexedDBService.updateReceiptJob = jest.fn().mockResolvedValue(undefined);
    indexedDBService.listReceiptJobs = jest.fn().mockResolvedValue([]);
    requestReceiptOcr.mockReset().mockResolvedValue(ocrReply());
    lookupReceiptBackup.mockReset().mockResolvedValue({ signedUrl: 'https://cdn/x' });
    prepareReceiptForOcr.mockReset().mockResolvedValue({ fileDataUrl: 'data:image/jpeg;base64,FULLPREP', mimeType: 'image/jpeg', fileName: 'factura.jpg' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['grande'], { type: 'image/webp' }) });
    jest.spyOn(Modal, 'alert').mockImplementation(() => {});
});
afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; delete auth.currentUser; jest.restoreAllMocks(); });

describe('Reescanear', () => {
    test('con el original ya podado lo baja del respaldo y nunca manda la miniatura', async () => {
        seed(); paint();
        await window.pcRescanReceipt('g1');
        expect(lookupReceiptBackup).toHaveBeenCalled();
        expect(prepareReceiptForOcr).toHaveBeenCalledTimes(1);
        const sent = requestReceiptOcr.mock.calls[0][0];
        expect(sent.fileDataUrl).toBe('data:image/jpeg;base64,FULLPREP');
        expect(JSON.stringify(sent)).not.toContain('PREVIEW480');
        expect(sent.mimeType).toBe('image/jpeg');
    });

    test('sin original y sin respaldo avisa y no manda nada al lector', async () => {
        seed(); paint();
        lookupReceiptBackup.mockRejectedValue(new Error('sin red'));
        await window.pcRescanReceipt('g1');
        expect(requestReceiptOcr).not.toHaveBeenCalled();
        expect(Modal.alert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('foto original') }));
    });

    test('lo que el lector corrige gana sobre lo escrito antes, y se dice qué cambió', async () => {
        seed(); paint();
        document.getElementById('pce-total').value = '999';
        document.getElementById('pce-total').dispatchEvent(new Event('change', { bubbles: true }));
        await window.pcRescanReceipt('g1');
        expect(document.getElementById('pce-total').value).toBe('1000');
        const note = document.querySelector('[data-pcn-rescan]');
        expect(note.textContent).toContain('Total');
        expect(note.getAttribute('data-tone')).toBe('ok');
        expect(document.querySelector('[data-pcn-rescan-btn]').textContent).toBe('Reescanear');
    });

    test('mientras lee, el botón está ocupado y dice «Leyendo…»', async () => {
        seed(); paint();
        let finish;
        requestReceiptOcr.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const running = window.pcRescanReceipt('g1');
        await flush(); await flush();
        const btn = document.querySelector('[data-pcn-rescan-btn]');
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Leyendo…');
        expect(btn.getAttribute('aria-busy')).toBe('true');
        finish(ocrReply());
        await running;
        expect(document.querySelector('[data-pcn-rescan-btn]').disabled).toBe(false);
    });

    test('si falla, queda un mensaje dentro del editor', async () => {
        seed(); paint();
        requestReceiptOcr.mockRejectedValue(new Error('HTTP 500'));
        await window.pcRescanReceipt('g1');
        const note = document.querySelector('[data-pcn-rescan]');
        expect(note.getAttribute('data-tone')).toBe('error');
        expect(note.textContent).toContain('No se pudo leer');
    });
});

describe('foto reducida', () => {
    test('si solo hay miniatura, el visor lo dice y ofrece reintentar', async () => {
        seed();
        lookupReceiptBackup.mockRejectedValue(new Error('sin red'));
        window.pcOpenMovement('g1');
        await flush(); await flush();
        paint();
        expect(document.querySelector('[data-pcn-reduced]')).not.toBeNull();
        expect(document.querySelector('[data-app-fn="pcEditorReloadSource"]')).not.toBeNull();
    });
});
