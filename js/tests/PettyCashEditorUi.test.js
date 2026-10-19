/**
 * Estado de pantalla del editor de factura: tamaño y zoom de la imagen,
 * secciones plegables, dato activo y lo escrito sin guardar.
 */
import { defaultEditorUi, editorUiAction, readEditorDraft, draftSignature } from '../modules/features/pettycash/PettyCashEditorUi.js';
import { receiptEditorHTML } from '../modules/features/pettycash/PettyCashReceiptEditor.js';

describe('editorUiAction', () => {
    test('estado inicial: total activo, imagen ampliada y tamaño medio, secciones en automático', () => {
        expect(defaultEditorUi()).toEqual({ field: 'total', zoom: true, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {} });
    });
    test('el tamaño da la vuelta: pequeña → media → grande → pequeña', () => {
        let ui = { ...defaultEditorUi(), size: 0 };
        const seen = [];
        for (let i = 0; i < 4; i++) { ui = editorUiAction(ui, 'size'); seen.push(ui.size); }
        expect(seen).toEqual([1, 2, 0, 1]);
    });
    test('el zoom, los artículos y la seguridad se alternan', () => {
        let ui = defaultEditorUi();
        expect(editorUiAction(ui, 'zoom').zoom).toBe(false);
        expect(editorUiAction(ui, 'items').itemsOpen).toBe(true);
        expect(editorUiAction(editorUiAction(ui, 'items'), 'items').itemsOpen).toBe(false);
        expect(editorUiAction(ui, 'security', null, { secOpen: false }).secOpen).toBe(true);
        expect(editorUiAction(ui, 'security', null, { secOpen: true }).secOpen).toBe(false);
    });
    test('«Más datos» invierte lo que se estaba viendo, aunque estuviera abierto en automático', () => {
        const ui = defaultEditorUi();
        expect(editorUiAction(ui, 'more', null, { more: true }).more).toBe(false);
        expect(editorUiAction(ui, 'more', null, { more: false }).more).toBe(true);
    });
    test('elegir un dato lo vuelve el activo sin tocar lo demás', () => {
        const ui = { ...defaultEditorUi(), zoom: false, size: 2 };
        expect(editorUiAction(ui, 'field', 'ncf')).toEqual({ ...ui, field: 'ncf' });
    });
    test('una acción desconocida no cambia nada y no muta el estado anterior', () => {
        const ui = defaultEditorUi();
        const frozen = Object.freeze({ ...ui, draft: Object.freeze({}) });
        expect(editorUiAction(frozen, 'nada')).toEqual(ui);
        expect(() => editorUiAction(frozen, 'size')).not.toThrow();
    });
});

describe('readEditorDraft', () => {
    const editor = { id: 'g1', type: 'gasto', hasReceipt: true, paidTo: 'Ferretería', rncEmisor: '130123454', ncf: 'B0100000123', date: '2026-10-12',
        category: 'Materiales', description: 'Cemento', subtotal: 4000, itbis: 720, total: 4720, amount: 4720, descuento: 0, propina: 0, exento: 0, itbisIncluido: false, notas: '' };
    afterEach(() => { document.body.innerHTML = ''; });

    test('lee cada campo del formulario con la clave del gasto y el tipo correcto', () => {
        document.body.innerHTML = receiptEditorHTML(editor, { source: null });
        document.getElementById('pce-total').value = '5000.50';
        document.getElementById('pce-propina').value = '';
        document.getElementById('pce-tienda').value = 'Otra ferretería';
        document.getElementById('pce-itbisincl').checked = true;
        const draft = readEditorDraft(document);
        expect(draft.total).toBe(5000.5);
        expect(draft.propina).toBeNull();
        expect(draft.paidTo).toBe('Otra ferretería');
        expect(draft.itbisIncluido).toBe(true);
        expect(draft.category).toBe('Materiales');
        expect(draft).not.toHaveProperty('hasReceipt');
    });
    test('un campo que no está en pantalla no entra en el borrador', () => {
        document.body.innerHTML = '<input id="pce-total" value="10">';
        expect(readEditorDraft(document)).toEqual({ total: 10 });
    });
});

describe('draftSignature', () => {
    test('cambia solo cuando cambia el conjunto de avisos, no el valor escrito', () => {
        expect(draftSignature([{ code: 'b' }, { code: 'a' }])).toBe(draftSignature([{ code: 'a' }, { code: 'b' }]));
        expect(draftSignature([{ code: 'a' }])).not.toBe(draftSignature([]));
    });
});

describe('centerEditorBox', () => {
    const { centerEditorBox } = require('../modules/features/pettycash/PettyCashEditorUi.js');
    const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
    afterEach(() => { document.body.innerHTML = ''; });

    test('con la imagen ampliada, lleva el recuadro al centro de la ventana', () => {
        document.body.innerHTML = '<div data-pcn-win data-zoom="true"><div data-pcn-box></div></div>';
        const win = document.querySelector('[data-pcn-win]');
        const box = document.querySelector('[data-pcn-box]');
        win.getBoundingClientRect = () => rect(0, 100, 300, 280);
        box.getBoundingClientRect = () => rect(400, 700, 100, 40);
        win.scrollLeft = 0; win.scrollTop = 0;
        expect(centerEditorBox(document)).toBe(true);
        expect(win.scrollLeft).toBe(300);   // centro del recuadro 450 − centro de la ventana 150
        expect(win.scrollTop).toBe(480);    // centro del recuadro 720 − centro de la ventana 240
    });
    test('sin zoom o sin recuadro no mueve nada', () => {
        document.body.innerHTML = '<div data-pcn-win data-zoom="false"><div data-pcn-box></div></div>';
        expect(centerEditorBox(document)).toBe(false);
        document.body.innerHTML = '<div data-pcn-win data-zoom="true"></div>';
        expect(centerEditorBox(document)).toBe(false);
    });
});

describe('fitEditorScreen', () => {
    const { fitEditorScreen } = require('../modules/features/pettycash/PettyCashEditorUi.js');
    const setup = (editing = 'true') => {
        document.body.innerHTML = `<div data-pcn-screen data-editing="${editing}"></div>`;
        const el = document.querySelector('[data-pcn-screen]');
        el.getBoundingClientRect = () => ({ top: 300 });
        return el;
    };
    afterEach(() => { document.body.innerHTML = ''; });

    test('en pantalla ancha y editando, la pantalla ocupa lo que queda de la ventana (lista y detalle se desplazan por separado)', () => {
        const el = setup();
        expect(fitEditorScreen({ doc: document, win: { innerHeight: 900, scrollY: 0, matchMedia: () => ({ matches: true }) } })).toBe(true);
        expect(el.style.height).toBe('588px');   // 900 − 300 − 12
    });
    test('tiene en cuenta cuánto se ha desplazado la página', () => {
        const el = setup();
        el.getBoundingClientRect = () => ({ top: 100 });   // ya se desplazó 200 px
        fitEditorScreen({ doc: document, win: { innerHeight: 900, scrollY: 200, matchMedia: () => ({ matches: true }) } });
        expect(el.style.height).toBe('588px');
    });
    test('nunca queda más baja de 420 px', () => {
        const el = setup();
        fitEditorScreen({ doc: document, win: { innerHeight: 500, scrollY: 0, matchMedia: () => ({ matches: true }) } });
        expect(el.style.height).toBe('420px');
    });
    test('en teléfono (hoja inferior) o sin editar, quita la altura fija', () => {
        const el = setup();
        el.style.height = '500px';
        expect(fitEditorScreen({ doc: document, win: { innerHeight: 900, scrollY: 0, matchMedia: () => ({ matches: false }) } })).toBe(false);
        expect(el.style.height).toBe('');
        const el2 = setup('false');
        el2.style.height = '500px';
        fitEditorScreen({ doc: document, win: { innerHeight: 900, scrollY: 0, matchMedia: () => ({ matches: true }) } });
        expect(el2.style.height).toBe('');
    });
});
