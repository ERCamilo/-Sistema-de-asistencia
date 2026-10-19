/**
 * Editor de factura nuevo dentro de Caja chica (PettyCashUI real, IndexedDB simulado):
 * solo aparece con el interruptor «Pantalla nueva de Caja chica», conserva el
 * guardado de siempre y no reescribe lo que la persona no tocó.
 */
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';

const COMPANY = '130456781';
const mismatch = () => ({
    id: 'g1', projectId: 'c1', periodId: 'p1', recordNumber: 3, type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded',
    paidTo: 'Comedor Doña Lía', rncEmisor: '131778102', cliente: 'Torre Naco SRL', rncCliente: COMPANY, ncf: 'B0100000876',
    date: '2026-10-11', fechaEmision: '2026-10-11', category: 'Comida', description: 'Almuerzo',
    subtotal: 850, itbis: 153, propina: 85, descuento: null, exento: null, itbisIncluido: null, total: 1098, amount: 1098,
    items: [{ descripcion: 'Almuerzo', cantidad: 5, precio: 850 }], ocrBoxes: { total: [790, 520, 850, 920] }, updatedAt: 1
});
const seed = (movements = [mismatch()], settings = { newPettyCashScreen: true }) => {
    state.settings = settings;
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte', companyRnc: COMPANY }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements, selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};
const paint = () => { document.body.innerHTML = PettyCashTab(); };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => { registerPettyCashGlobals(); });
beforeEach(() => {
    window.render = jest.fn(paint);
    indexedDBService.getReceipt.mockResolvedValue(null);
    URL.createObjectURL = jest.fn(() => 'blob:recibo');
    URL.revokeObjectURL = jest.fn();
});
afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; });

describe('detrás del interruptor', () => {
    test('apagado: sigue el formulario de siempre', () => {
        seed([mismatch()], {});
        state.pettyCash.editMov = 'g1';
        paint();
        expect(document.getElementById('pce-amount')).not.toBeNull();
        expect(document.querySelector('[data-pcn-editor]')).toBeNull();
    });
    test('encendido: abre el editor nuevo con los mismos ids', () => {
        seed();
        state.pettyCash.editMov = 'g1';
        paint();
        expect(document.querySelector('[data-pcn-editor]')).not.toBeNull();
        expect(document.getElementById('pce-total').value).toBe('1098');
        expect(document.querySelector('[data-pcn-issue="total-mismatch"]')).not.toBeNull();
    });
    test('la seguridad de la lectura solo sale con su propio interruptor', () => {
        seed([{ ...mismatch(), ocrConfidence: { total: 0.6 } }]);
        state.pettyCash.editMov = 'g1';
        paint();
        expect(document.querySelector('[data-pcn-confidence]')).toBeNull();
        state.settings.pettyCashReadConfidence = true;
        paint();
        expect(document.querySelector('[data-pcn-confidence]')).not.toBeNull();
    });
});

describe('abrir un gasto', () => {
    test('reinicia el estado de pantalla y carga la foto guardada en el teléfono', async () => {
        seed();
        state.pettyCash._editorUi = { field: 'ncf', zoom: false, size: 2, more: true, itemsOpen: true, secOpen: true, draft: { total: 5 } };
        indexedDBService.getReceipt.mockResolvedValue({ originalBlob: new Blob(['x'], { type: 'image/jpeg' }), originalType: 'image/jpeg', previewDataUrl: 'data:image/jpeg;base64,AA' });
        window.pcOpenMovement('g1');
        expect(state.pettyCash._editorUi).toEqual({ field: 'total', zoom: true, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {} });
        expect(state.pettyCash._editSource).toBeUndefined();
        await flush();
        expect(state.pettyCash._editSource).toMatchObject({ url: 'blob:recibo', mime: 'image/jpeg' });
        expect(document.querySelector('[data-pcn-view] img').getAttribute('src')).toBe('blob:recibo');
    });
    test('sin la foto en este teléfono y sin red, queda como no disponible', async () => {
        seed();
        window.pcOpenMovement('g1');
        await flush();
        expect(state.pettyCash._editSource).toBeNull();
        expect(document.querySelector('[data-pcn-view]').textContent).toContain('no disponible');
    });
    test('apagado el interruptor, no carga nada extra', async () => {
        seed([mismatch()], {});
        indexedDBService.getReceipt.mockClear();
        window.pcOpenMovement('g1');
        await flush();
        expect(indexedDBService.getReceipt).not.toHaveBeenCalled();
    });
    test('cerrar libera la foto temporal', async () => {
        seed();
        indexedDBService.getReceipt.mockResolvedValue({ originalBlob: new Blob(['x'], { type: 'image/jpeg' }), originalType: 'image/jpeg' });
        window.pcOpenMovement('g1');
        await flush();
        window.pcCancelMovementEdit();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recibo');
        expect(state.pettyCash._editSource).toBeUndefined();
    });
});

describe('acciones del editor', () => {
    beforeEach(async () => { seed(); window.pcOpenMovement('g1'); await flush(); window.render.mockClear(); });

    test('tamaño, zoom, dato activo y secciones cambian y repintan', () => {
        window.pcEditorSize(); expect(state.pettyCash._editorUi.size).toBe(2);
        window.pcEditorZoom(); expect(state.pettyCash._editorUi.zoom).toBe(false);
        window.pcEditorField('date'); expect(state.pettyCash._editorUi.field).toBe('date');
        window.pcEditorItems(); expect(state.pettyCash._editorUi.itemsOpen).toBe(true);
        window.pcEditorMore(); expect(state.pettyCash._editorUi.more).toBe(true);
        expect(window.render).toHaveBeenCalledTimes(5);
        expect(document.querySelector('[data-pcn-more]').hidden).toBe(false);
    });

    test('lo escrito se conserva al repintar', () => {
        document.getElementById('pce-tienda').value = 'Comedor Lía II';
        window.pcEditorSize();
        expect(state.pettyCash._editorUi.draft.paidTo).toBe('Comedor Lía II');
        expect(document.getElementById('pce-tienda').value).toBe('Comedor Lía II');
    });

    test('«Usar el calculado» corrige total y monto, guarda y quita el aviso', async () => {
        document.getElementById('pce-total').value = '1098';
        await window.pcEditorFix('total-mismatch|apply');
        const mov = state.pettyCash.movements[0];
        expect(mov.total).toBe(1088);
        expect(mov.amount).toBe(1088);
        expect(state.pettyCash._editorUi.draft).not.toHaveProperty('total');
        expect(document.querySelector('[data-pcn-issue="total-mismatch"]')).toBeNull();
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Leída');
    });

    test('«Dar por bueno» guarda el aviso aceptado y el estado deja de ser Por revisar', async () => {
        await window.pcEditorFix('total-mismatch|accept');
        expect(state.pettyCash.movements[0].reviewAccepted).toEqual(['total-mismatch']);
        expect(document.querySelector('[data-pcn-issue]')).toBeNull();
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Leída');
    });

    test('un aviso que ya no existe no rompe nada', async () => {
        await expect(window.pcEditorFix('no-existe|apply')).resolves.toBeUndefined();
        await expect(window.pcEditorFix('total-mismatch|zzz')).resolves.toBeUndefined();
    });

    test('«Escribir…» abre «Más datos» si el campo está plegado y le da el foco', () => {
        window.pcEditorFocus('pce-rnccli');
        expect(state.pettyCash._editorUi.more).toBe(true);
        expect(document.querySelector('[data-pcn-more]').hidden).toBe(false);
    });

    test('al cambiar un valor solo se repinta si cambia el conjunto de avisos', () => {
        document.getElementById('pce-tienda').value = 'Otro nombre';
        window.pcEditorTouch();
        expect(window.render).not.toHaveBeenCalled();
        document.getElementById('pce-total').value = '1088';
        window.pcEditorTouch();
        expect(window.render).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-pcn-issue="total-mismatch"]')).toBeNull();
    });

    test('al enfocar un dato con recuadro, ese pasa a ser el activo', () => {
        state.pettyCash.movements[0].ocrBoxes.date = [236, 80, 290, 700];
        window.pcEditorFocusIn({ target: { id: 'pce-date' } });
        expect(state.pettyCash._editorUi.field).toBe('date');
        window.render.mockClear();
        window.pcEditorFocusIn({ target: { id: 'pce-tienda' } });
        expect(window.render).not.toHaveBeenCalled();
    });
});

describe('guardar desde el editor nuevo', () => {
    beforeEach(async () => { seed(); window.pcOpenMovement('g1'); await flush(); });

    test('guarda lo escrito, incluidos los datos fiscales nuevos, y no toca lo demás', async () => {
        document.getElementById('pce-descuento').value = '50';
        document.getElementById('pce-propina').value = '85';
        document.getElementById('pce-exento').value = '10';
        document.getElementById('pce-itbisincl').checked = true;
        document.getElementById('pce-total').value = '1088';
        document.getElementById('pce-amount').value = '1088';
        await window.pcSaveMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov).toMatchObject({ descuento: 50, propina: 85, exento: 10, itbisIncluido: true, total: 1088, amount: 1088, hasReceipt: true, reviewPending: false });
        expect(mov.items).toEqual([{ descripcion: 'Almuerzo', cantidad: 5, precio: 850 }]);
        expect(mov.ocrBoxes).toEqual({ total: [790, 520, 850, 920] });
        expect(mov.recordNumber).toBe(3);
        expect(state.pettyCash.editMov).toBeNull();
    });

    test('lo que la lectura dejó en blanco o sin saber no se convierte en otro valor', async () => {
        await window.pcSaveMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov.descuento).toBeNull();
        expect(mov.exento).toBeNull();
        expect(mov.itbisIncluido).toBeNull();   // «no se sabe» no pasa a «no incluido»
    });

    test('desmarcar «ITBIS incluido» lo guarda como false solo si antes era true', async () => {
        state.pettyCash.movements[0].itbisIncluido = true;
        window.pcOpenMovement('g1'); await flush();
        document.getElementById('pce-itbisincl').checked = false;
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0].itbisIncluido).toBe(false);
    });
});
