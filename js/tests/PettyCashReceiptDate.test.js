/**
 * DECISIÓN: la fecha de una factura es siempre la fecha de emisión (`fechaEmision`);
 * `date` solo sirve de respaldo cuando falta (reposiciones, gastos antiguos).
 * Antes el Excel y la tarjeta de la pantalla antigua usaban `date`, y el editor
 * tenía dos fechas que se podían separar sin avisar.
 */
import { receiptDate } from '../modules/features/pettycash/PettyCashDates.js';
import { buildPeriodSheets } from '../modules/features/pettycash/PettyCashExport.js';
import { readEditorDraft } from '../modules/features/pettycash/PettyCashEditorUi.js';
import { receiptEditorHTML } from '../modules/features/pettycash/PettyCashReceiptEditor.js';
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';

describe('receiptDate', () => {
    test('la fecha de emisión manda; si falta, la fecha del registro', () => {
        expect(receiptDate({ date: '2026-10-01', fechaEmision: '2026-10-05' })).toBe('2026-10-05');
        expect(receiptDate({ date: '2026-10-01', fechaEmision: null })).toBe('2026-10-01');
        expect(receiptDate({ date: '2026-10-01', fechaEmision: '' })).toBe('2026-10-01');
        expect(receiptDate({ type: 'reposicion', date: '2026-10-03' })).toBe('2026-10-03');
    });
    test('sin ninguna, texto vacío y sin romper con datos raros', () => {
        expect(receiptDate({})).toBe('');
        expect(receiptDate(null)).toBe('');
        expect(receiptDate(undefined)).toBe('');
    });
});

describe('Excel', () => {
    const project = { name: 'Caja Norte' };
    const period = { label: 'Octubre', openingDate: '2026-10-01', closingDate: '2026-10-31', status: 'abierta' };
    const movs = [
        { id: 'a', type: 'gasto', date: '2026-10-02', fechaEmision: '2026-10-20', paidTo: 'Ferretería', amount: 100, hasReceipt: true },
        { id: 'b', type: 'gasto', date: '2026-10-09', fechaEmision: '2026-10-10', paidTo: 'Colmado', amount: 50, hasReceipt: true },
        { id: 'c', type: 'reposicion', date: '2026-10-05', amount: 500, description: 'Fondo' },
        { id: 'd', type: 'gasto', date: '2026-10-15', paidTo: 'Sin emisión', amount: 10 }
    ];
    test('todas las hojas muestran la fecha de emisión (o la del registro si falta)', () => {
        const { beneficiarios, movimientos, items } = buildPeriodSheets(project, period, movs.map((m) => ({ ...m, items: m.id === 'a' ? [{ descripcion: 'Clavos', cantidad: 1, precio: 100 }] : undefined })));
        const dates = (sheet) => sheet.slice(1).map((row) => row[0]);
        expect(dates(beneficiarios)).toEqual(['05/10/2026', '10/10/2026', '15/10/2026', '20/10/2026']);
        expect(dates(movimientos)).toEqual(['05/10/2026', '10/10/2026', '15/10/2026', '20/10/2026']);
        expect(items[1][0]).toBe('20/10/2026');
    });
    test('el orden también sigue la fecha de emisión', () => {
        const { movimientos } = buildPeriodSheets(project, period, movs);
        expect(movimientos.slice(1).map((row) => row[2] || row[4])).toEqual(['Fondo', 'Colmado', 'Sin emisión', 'Ferretería']);
    });
});

describe('borrador del editor', () => {
    test('escribir la fecha de la factura actualiza las dos claves, para que ningún aviso use la vieja', () => {
        document.body.innerHTML = '<input id="pce-date" type="date" value="2026-10-12">';
        const draft = readEditorDraft(document);
        expect(draft.date).toBe('2026-10-12');
        expect(draft.fechaEmision).toBe('2026-10-12');
        document.body.innerHTML = '';
    });
});

describe('editor nuevo: una sola fecha', () => {
    const mov = (over = {}) => ({ id: 'g1', type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded', paidTo: 'X', rncEmisor: '131778102', ncf: 'B0100000876',
        date: '2026-10-01', fechaEmision: '2026-10-05', category: 'Comida', total: 10, amount: 10, subtotal: 10, itbis: 0, ...over });
    afterEach(() => { document.body.innerHTML = ''; });

    test('hay un solo campo de fecha, «Fecha de la factura», y no el de emisión escondido', () => {
        document.body.innerHTML = receiptEditorHTML(mov(), { source: null });
        expect(document.getElementById('pce-femision')).toBeNull();
        expect(document.querySelector('label[for="pce-date"]').textContent).toContain('Fecha de la factura');
        expect(document.getElementById('pce-fvenc')).not.toBeNull();
    });
    test('muestra la fecha de emisión aunque la del registro sea otra (datos antiguos)', () => {
        document.body.innerHTML = receiptEditorHTML(mov(), { source: null });
        expect(document.getElementById('pce-date').value).toBe('2026-10-05');
    });
    test('sin fecha de emisión muestra la del registro', () => {
        document.body.innerHTML = receiptEditorHTML(mov({ fechaEmision: null }), { source: null });
        expect(document.getElementById('pce-date').value).toBe('2026-10-01');
    });
});

// ── guardar ─────────────────────────────────────────────────────────────────
const seed = (movements, settings = { newPettyCashScreen: true }) => {
    state.settings = settings;
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte' }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31' }],
        movements, selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};
const gasto = (over = {}) => ({ id: 'g1', projectId: 'c1', periodId: 'p1', recordNumber: 3, type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded',
    paidTo: 'Comedor', rncEmisor: '131778102', ncf: 'B0100000876', date: '2026-10-01', fechaEmision: '2026-10-05', category: 'Comida',
    description: 'Almuerzo', subtotal: 850, itbis: 153, total: 1003, amount: 1003, updatedAt: 1, ...over });
const paint = () => { document.body.innerHTML = PettyCashTab(); };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('guardar con una sola fecha', () => {
    beforeAll(() => { registerPettyCashGlobals(); });
    beforeEach(() => {
        window.render = jest.fn(paint);
        indexedDBService.getReceipt.mockResolvedValue(null);
        URL.createObjectURL = jest.fn(() => 'blob:r'); URL.revokeObjectURL = jest.fn();
    });
    afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; });

    test('editor nuevo: la fecha escrita queda en date y en fechaEmision', async () => {
        seed([gasto()]);
        window.pcOpenMovement('g1'); await flush();
        document.getElementById('pce-date').value = '2026-10-20';
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0]).toMatchObject({ date: '2026-10-20', fechaEmision: '2026-10-20' });
    });
    test('editor nuevo: sin tocar la fecha, un gasto con dos fechas distintas queda con la de emisión en las dos', async () => {
        seed([gasto()]);
        window.pcOpenMovement('g1'); await flush();
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0]).toMatchObject({ date: '2026-10-05', fechaEmision: '2026-10-05' });
    });
    test('editor antiguo: «Fecha de la factura» guarda las dos y ya no hay campo aparte de emisión', async () => {
        seed([gasto()], {});
        window.pcOpenMovement('g1'); await flush();
        expect(document.getElementById('pce-femision')).toBeNull();
        expect(document.querySelector('label[for="pce-date"], #pce-date')).not.toBeNull();
        expect(document.getElementById('pce-date').value).toBe('2026-10-05');
        document.getElementById('pce-date').value = '2026-10-22';
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.movements[0]).toMatchObject({ date: '2026-10-22', fechaEmision: '2026-10-22' });
    });
    test('una reposición solo usa su fecha', async () => {
        seed([{ id: 'r1', projectId: 'c1', periodId: 'p1', recordNumber: 1, type: 'reposicion', date: '2026-10-03', amount: 500, description: 'Fondo', updatedAt: 1 }], {});
        window.pcOpenMovement('r1'); await flush();
        document.getElementById('pce-date').value = '2026-10-04';
        await window.pcSaveMovementEdit();
        const mov = state.pettyCash.movements[0];
        expect(mov.date).toBe('2026-10-04');
        expect(mov.fechaEmision).toBeUndefined();
    });
});

describe('lista de la pantalla antigua', () => {
    beforeAll(() => { registerPettyCashGlobals(); });
    afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; });
    test('la tarjeta muestra la fecha de emisión', () => {
        seed([gasto({ date: '2026-10-02', fechaEmision: '2026-10-17' })], {});
        window.render = jest.fn(paint);
        paint();
        expect(document.body.textContent).toContain('17-10-2026');
        expect(document.body.textContent).not.toContain('02-10-2026');
    });
});
