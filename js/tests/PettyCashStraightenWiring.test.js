/**
 * Enderezar a mano dentro del editor real (PettyCashUI, servicios simulados): la foto
 * enderezada y sus recuadros quedan EN ESPERA y solo se guardan al confirmar el gasto; cancelar
 * no toca nada; volver a leer la factura trae recuadros nuevos que ganan; y el visor, la descarga
 * y el compartir usan la foto grande, no la miniatura.
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
jest.mock('../modules/features/pettycash/PettyCashPhoto.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashPhoto.js'),
    prepareReceiptForOcr: jest.fn(),
    createReceiptPreview: jest.fn()
}));
jest.mock('../modules/features/pettycash/PettyCashReceiptShare.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashReceiptShare.js'),
    downloadReceipt: jest.fn(),
    shareReceipt: jest.fn()
}));
import { requestReceiptOcr } from '../modules/features/pettycash/PettyCashReceiptOCR.js';
import { prepareReceiptForOcr, createReceiptPreview } from '../modules/features/pettycash/PettyCashPhoto.js';
import { downloadReceipt, shareReceipt } from '../modules/features/pettycash/PettyCashReceiptShare.js';

const OLD_BOXES = { total: [700, 200, 800, 600], fecha: [50, 100, 120, 300] };
const movement = () => ({
    id: 'g1', projectId: 'c1', periodId: 'p1', recordNumber: 3, type: 'gasto', hasReceipt: true, receiptStatus: 'local',
    paidTo: 'Comedor', rncEmisor: '131778102', ncf: 'B0100000876', date: '2026-10-11', fechaEmision: '2026-10-11',
    category: 'Comida', description: 'Almuerzo', subtotal: 850, itbis: 153, total: 1098, amount: 1098, updatedAt: 1,
    ocrBoxes: { ...OLD_BOXES }, manualBoxes: { ncf: [800, 100, 900, 500] }
});
const STAGED_BOXES = { ocrBoxes: { total: [400, 200, 600, 600] }, manualBoxes: { ncf: [600, 100, 800, 500] } };
const seed = (over = {}) => {
    state.settings = { newPettyCashScreen: true };
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements: [movement()], selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: 'g1', ...over
    };
};
const stagedCapture = () => ({
    originalBlob: new Blob(['recta'], { type: 'image/webp' }), originalName: 'factura-recta.webp', originalType: 'image/webp',
    originalSize: 5, originalLastModified: 1, receiptKind: 'image', pageCount: 1,
    previewDataUrl: 'data:image/jpeg;base64,PV480', processingDataUrl: 'data:image/jpeg;base64,PROC', processingMimeType: 'image/jpeg'
});
const stage = (d = state.pettyCash) => {
    d._editPhotoCapture = stagedCapture();
    d._editPhoto = d._editPhotoCapture.previewDataUrl;
    d._editSource = { url: 'blob:recta', mime: 'image/webp', preview: d._editPhoto, objectUrl: true, staged: true };
    d._editBoxes = JSON.parse(JSON.stringify(STAGED_BOXES));
    d._editorUi = { field: 'total', view: null, viewKey: null, split: null, more: null, itemsOpen: false, secOpen: null, draft: {} };
};
const paint = () => { document.body.innerHTML = PettyCashTab(); };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const original = () => new Blob(['original'], { type: 'image/jpeg' });

beforeAll(() => { registerPettyCashGlobals(); });
beforeEach(() => {
    window.render = jest.fn(paint);
    window.showNotification = jest.fn();
    auth.currentUser = { getIdToken: async () => 'tok' };
    URL.createObjectURL = jest.fn(() => 'blob:original');
    URL.revokeObjectURL = jest.fn();
    indexedDBService.getReceipt.mockReset().mockResolvedValue({ originalBlob: original(), originalType: 'image/jpeg', previewDataUrl: 'data:image/jpeg;base64,PV' });
    indexedDBService.saveReceiptOriginal = jest.fn().mockResolvedValue({});
    indexedDBService.updateReceiptJob = jest.fn().mockResolvedValue(undefined);
    indexedDBService.listReceiptJobs = jest.fn().mockResolvedValue([]);
    requestReceiptOcr.mockReset().mockResolvedValue({ ok: true, emisor: 'Comedor', ncf: 'B0100000876', fecha: '2026-10-11', subtotal: 850, itbis: 153, total: 1098, boxes: { total: [100, 100, 150, 400] } });
    prepareReceiptForOcr.mockReset().mockResolvedValue({ fileDataUrl: 'data:image/jpeg;base64,FULL', mimeType: 'image/jpeg', fileName: 'factura.jpg' });
    createReceiptPreview.mockReset().mockResolvedValue({ previewDataUrl: 'data:image/jpeg;base64,NEWPV', processingDataUrl: 'data:image/jpeg;base64,NEWPROC', pageCount: 1 });
    downloadReceipt.mockReset().mockResolvedValue({ status: 'downloaded', name: 'x.webp' });
    shareReceipt.mockReset().mockResolvedValue({ status: 'shared' });
    jest.spyOn(Modal, 'alert').mockImplementation(() => {});
});
afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; delete window.showNotification; delete auth.currentUser; jest.restoreAllMocks(); });

describe('lo que se ve con la foto enderezada en espera', () => {
    test('el visor usa la foto grande enderezada (no la miniatura) y muestra sus recuadros, sin tocar el gasto', async () => {
        seed(); stage(); paint();
        expect(document.querySelector('[data-pcn-view] img').getAttribute('src')).toBe('blob:recta');
        expect(document.querySelector('[data-pcn-box]').getAttribute('style')).toContain('top:40%');
        expect(document.querySelector('[data-pcn-staged]')).not.toBeNull();
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);
        expect(state.pettyCash.movements[0].manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
    });
    test('descargar y compartir usan la foto enderezada grande', async () => {
        seed(); stage(); paint();
        await window.pcEditorDownload();
        expect(downloadReceipt).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:recta', mime: 'image/webp' }));
        await window.pcEditorShare();
        expect(shareReceipt).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:recta' }));
    });
    test('una carga de la foto original que termina tarde no pisa la enderezada', async () => {
        seed();
        window.pcOpenMovement('g1');
        stage();
        await flush();
        expect(state.pettyCash._editSource.staged).toBe(true);
        expect(state.pettyCash._editSource.url).toBe('blob:recta');
    });
    test('marcar un dato con la foto enderezada guarda la marca en espera, no en el gasto', async () => {
        seed(); stage(); paint();
        await window.pcEditorBoxCommit('cliente', [300, 50, 350, 600]);
        expect(state.pettyCash._editBoxes.manualBoxes.cliente).toEqual([300, 50, 350, 600]);
        expect(state.pettyCash._editBoxes.manualBoxes.ncf).toEqual([600, 100, 800, 500]);
        expect(state.pettyCash.movements[0].manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
        await window.pcEditorBoxClear('cliente');
        expect(state.pettyCash._editBoxes.manualBoxes.cliente).toBeUndefined();
    });
});

describe('guardar y cancelar', () => {
    test('al confirmar se guarda la foto enderezada como la nueva y los recuadros pasan al gasto', async () => {
        seed(); stage(); paint();
        await window.pcSaveMovementEdit();
        expect(indexedDBService.saveReceiptOriginal).toHaveBeenCalledTimes(1);
        const [txId, blob, preview, meta] = indexedDBService.saveReceiptOriginal.mock.calls[0];
        expect(txId).toBe('g1');
        expect(blob.type).toBe('image/webp');
        expect(preview).toBe('data:image/jpeg;base64,PV480');
        expect(meta).toMatchObject({ queueStatus: 'confirmed', originalName: 'factura-recta.webp' });
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toEqual({ total: [400, 200, 600, 600] });
        expect(mov.manualBoxes).toEqual({ ncf: [600, 100, 800, 500] });
        expect(state.pettyCash._editBoxes).toBeFalsy();
        expect(state.pettyCash._editPhotoCapture).toBeFalsy();
        expect(state.pettyCash.editMov).toBeNull();
    });
    test('si la foto no se puede guardar en el teléfono, los recuadros viejos se quedan (siguen siendo los de la foto vigente)', async () => {
        seed(); stage(); paint();
        indexedDBService.saveReceiptOriginal.mockRejectedValue(new Error('sin espacio'));
        await window.pcSaveMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toEqual(OLD_BOXES);
        expect(mov.manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
    });
    test('cancelar descarta la foto, los recuadros y la fuente en espera, y no toca nada guardado', async () => {
        seed(); stage(); paint();
        window.pcCancelMovementEdit();
        expect(indexedDBService.saveReceiptOriginal).not.toHaveBeenCalled();
        expect(state.pettyCash._editBoxes).toBeFalsy();
        expect(state.pettyCash._editPhotoCapture).toBeFalsy();
        expect(state.pettyCash._editSource).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recta');
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toEqual(OLD_BOXES);
        expect(mov.manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
    });
    test('abrir otro gasto no arrastra lo que había en espera', async () => {
        seed(); stage();
        window.pcOpenMovement('g1');
        expect(state.pettyCash._editBoxes).toBeFalsy();
        expect(state.pettyCash._editPhotoCapture).toBeFalsy();
        await flush();
        expect(state.pettyCash._editSource.staged).toBeUndefined();
    });
    test('enderezar un gasto y pasar al siguiente no deja esa foto en el otro (ni al confirmar)', async () => {
        const other = { ...movement(), id: 'g2', recordNumber: 4, ocrBoxes: {}, manualBoxes: undefined };
        seed({ movements: [movement(), other] });
        stage();
        window.pcOpenMovement('g2');
        await flush();
        expect(state.pettyCash._editPhotoCapture).toBeFalsy();
        await window.pcSaveMovementEdit();
        expect(indexedDBService.saveReceiptOriginal).not.toHaveBeenCalled();
        expect(state.pettyCash.movements[1].ocrBoxes).toEqual({});
    });
    test('si por cualquier vía quedó en espera la foto de otro gasto, al confirmar no se usa', async () => {
        const other = { ...movement(), id: 'g2', recordNumber: 4 };
        seed({ movements: [movement(), other], editMov: 'g2' });
        stage();
        state.pettyCash._editPhotoFor = 'g1';
        paint();
        await window.pcSaveMovementEdit();
        expect(indexedDBService.saveReceiptOriginal).not.toHaveBeenCalled();
        expect(state.pettyCash.movements[1].ocrBoxes).toEqual(OLD_BOXES);
    });
    test('guardar sin foto enderezada no cambia los recuadros (como antes)', async () => {
        seed(); window.pcOpenMovement('g1'); await flush(); paint();
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);
        expect(indexedDBService.saveReceiptOriginal).not.toHaveBeenCalled();
    });
});

describe('volver a leer la factura enderezada', () => {
    test('lee la foto enderezada; los recuadros nuevos del lector ganan y siguen en espera junto con la foto', async () => {
        seed(); stage(); paint();
        await window.pcRescanReceipt('g1');
        expect(requestReceiptOcr.mock.calls[0][0].fileDataUrl).toBe('data:image/jpeg;base64,PROC');
        expect(state.pettyCash._editBoxes.ocrBoxes).toEqual({ total: [100, 100, 150, 400] });
        expect(state.pettyCash._editBoxes.manualBoxes).toEqual({ ncf: [600, 100, 800, 500] });
        // la foto guardada sigue siendo la vieja: sus recuadros no se tocan hasta confirmar
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);
        expect(state.pettyCash.movements[0].manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
    });
    test('enderezar, volver a leer y guardar: los recuadros nuevos del lector son los que quedan', async () => {
        seed(); stage(); paint();
        await window.pcRescanReceipt('g1');
        await window.pcSaveMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toEqual({ total: [100, 100, 150, 400] });
        expect(mov.manualBoxes).toEqual({ ncf: [600, 100, 800, 500] });
        expect(indexedDBService.saveReceiptOriginal).toHaveBeenCalledTimes(1);
    });
    test('enderezar, volver a leer y cancelar: la foto y los recuadros guardados no cambian', async () => {
        seed(); stage(); paint();
        await window.pcRescanReceipt('g1');
        window.pcCancelMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov.ocrBoxes).toEqual(OLD_BOXES);
        expect(mov.manualBoxes).toEqual({ ncf: [800, 100, 900, 500] });
        expect(indexedDBService.saveReceiptOriginal).not.toHaveBeenCalled();
    });
    test('si el lector no devuelve recuadros, se conservan los de la foto enderezada (no los viejos)', async () => {
        seed(); stage(); paint();
        requestReceiptOcr.mockResolvedValue({ ok: true, emisor: 'Comedor', ncf: 'B0100000876', fecha: '2026-10-11', subtotal: 850, itbis: 153, total: 1098 });
        await window.pcRescanReceipt('g1');
        expect(state.pettyCash._editBoxes).toEqual(STAGED_BOXES);
    });
    test('si la lectura falla, la foto y los recuadros siguen en espera', async () => {
        seed(); stage(); paint();
        requestReceiptOcr.mockRejectedValue(new Error('sin red'));
        await window.pcRescanReceipt('g1');
        expect(state.pettyCash._editBoxes).toEqual(STAGED_BOXES);
        expect(state.pettyCash._editPhotoCapture).toBeTruthy();
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);
    });
    test('sin foto enderezada, volver a leer funciona como siempre (los recuadros nuevos van al gasto)', async () => {
        seed(); window.pcOpenMovement('g1'); await flush(); paint();
        await window.pcRescanReceipt('g1');
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual({ total: [100, 100, 150, 400] });
    });
});

describe('botones del editor', () => {
    test('«Volver a la original» descarta lo enderezado y recarga la foto guardada', async () => {
        seed(); stage(); paint();
        window.pcEditorUndoStraighten();
        expect(state.pettyCash._editBoxes).toBeFalsy();
        expect(state.pettyCash._editPhotoCapture).toBeFalsy();
        expect(state.pettyCash._editPhoto).toBeFalsy();
        await flush();
        expect(state.pettyCash._editSource.url).toBe('blob:original');
        expect(state.pettyCash._editSource.staged).toBeUndefined();
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);
    });
    test('«Enderezar» con solo la miniatura avisa que hace falta el original', async () => {
        seed();
        state.pettyCash._editSource = { url: 'data:image/jpeg;base64,PV', mime: 'image/jpeg', reduced: true };
        paint();
        await window.pcEditorStraighten();
        expect(window.showNotification).toHaveBeenCalledWith(expect.stringMatching(/original/i), 'info');
    });
    test('elegir otro archivo reemplaza lo enderezado y quita los recuadros de la foto vieja (no son de esta)', async () => {
        seed(); stage(); paint();
        const input = { files: [new File(['otra'], 'otra.jpg', { type: 'image/jpeg' })] };
        await window.pcPhotoEdit(input);
        expect(state.pettyCash._editBoxes).toEqual({ ocrBoxes: {}, manualBoxes: {} });
        expect(state.pettyCash._editPhotoCapture.originalName).toBe('otra.jpg');
        expect(state.pettyCash._editPhotoFor).toBe('g1');
        expect(state.pettyCash._editSource?.staged).toBeFalsy();
        expect(document.querySelector('[data-pcn-box]')).toBeNull();                 // no se dibujan recuadros viejos sobre otra foto
        expect(state.pettyCash.movements[0].ocrBoxes).toEqual(OLD_BOXES);            // hasta confirmar, el gasto no cambia
    });
    test('elegir otra foto (sin haber enderezado) tampoco deja los recuadros de la foto vieja, y al confirmar se limpian', async () => {
        seed(); window.pcOpenMovement('g1'); await flush(); paint();
        await window.pcPhotoEdit({ files: [new File(['otra'], 'otra.jpg', { type: 'image/jpeg' })] });
        expect(document.querySelector('[data-pcn-box]')).toBeNull();
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0].ocrBoxes).toBeUndefined();
        expect(state.pettyCash.movements[0].manualBoxes).toBeUndefined();
    });
    test('después de elegir otra foto, «Enderezar» parte de esa foto y no dice que se está cargando', async () => {
        seed(); stage(); paint();
        await window.pcPhotoEdit({ files: [new File(['otra'], 'otra.jpg', { type: 'image/jpeg' })] });
        window.showNotification.mockClear();
        await window.pcEditorStraighten();
        expect(window.showNotification).not.toHaveBeenCalledWith(expect.stringMatching(/cargando/i), expect.any(String));
    });
});
