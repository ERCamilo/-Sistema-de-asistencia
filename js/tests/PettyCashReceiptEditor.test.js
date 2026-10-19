/**
 * Editor de factura de la pantalla nueva de Caja chica (HTML puro).
 * Conserva los ids pce-* que lee pcSaveMovementEdit y añade los de los datos
 * fiscales que antes no se podían editar.
 */
import { receiptEditorHTML, EDITOR_FIELD_IDS } from '../modules/features/pettycash/PettyCashReceiptEditor.js';

const COMPANY = '130456781';
const context = { companyRnc: COMPANY, today: '2026-10-19', period: { openingDate: '2026-10-01' }, movements: [] };
const gasto = (over = {}) => ({
    id: 'g1', type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded', recordNumber: 7,
    paidTo: 'Ferretería El Maestro', rncEmisor: '130123454', cliente: 'Constructora Torre Naco SRL', rncCliente: COMPANY,
    ncf: 'B0100000123', date: '2026-10-12', fechaEmision: '2026-10-12', category: 'Materiales', description: 'Cemento y varillas',
    subtotal: 4000, descuento: 0, itbis: 720, propina: 0, exento: 0, total: 4720, amount: 4720,
    items: [{ descripcion: 'Cemento gris', cantidad: 20, precio: 3000 }, { descripcion: 'Varilla 3/8', cantidad: 10, precio: 1000 }],
    ...over
});
const ui = (over = {}) => ({ field: 'total', zoom: true, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {}, ...over });
const render = (mov, opts = {}) => {
    document.body.innerHTML = receiptEditorHTML(mov, { cerrada: false, context, ui: ui(), source: null, showConfidence: false, ...opts });
    return document.body;
};
const val = (id) => document.getElementById(id)?.value;

afterEach(() => { document.body.innerHTML = ''; });

describe('ids del formulario', () => {
    test('conserva los pce-* que lee el guardado y añade los fiscales', () => {
        render(gasto());
        for (const id of EDITOR_FIELD_IDS) expect(document.getElementById(id)).not.toBeNull();
        for (const id of ['pce-amount', 'pce-date', 'pce-tienda', 'pce-rnc', 'pce-cliente', 'pce-rnccli', 'pce-ncf', 'pce-cat', 'pce-desc',
            'pce-receipt', 'pce-subtotal', 'pce-itbis', 'pce-total', 'pce-femision', 'pce-fvenc', 'pce-notas',
            'pce-descuento', 'pce-propina', 'pce-exento', 'pce-itbisincl']) {
            expect(EDITOR_FIELD_IDS).toContain(id);
        }
    });

    test('rellena cada campo con lo guardado', () => {
        render(gasto({ propina: 85, notas: 'Pagado en efectivo' }));
        expect(val('pce-tienda')).toBe('Ferretería El Maestro');
        expect(val('pce-rnc')).toBe('130123454');
        expect(val('pce-rnccli')).toBe(COMPANY);
        expect(val('pce-ncf')).toBe('B0100000123');
        expect(val('pce-date')).toBe('2026-10-12');
        expect(val('pce-subtotal')).toBe('4000');
        expect(val('pce-propina')).toBe('85');
        expect(val('pce-total')).toBe('4720');
        expect(val('pce-amount')).toBe('4720');
        expect(val('pce-cat')).toBe('Materiales');
        expect(val('pce-notas')).toBe('Pagado en efectivo');
        expect(document.getElementById('pce-receipt').checked).toBe(true);
    });

    test('escapa lo escrito por la persona o leído por el lector', () => {
        render(gasto({ paidTo: '"><img src=x onerror=alert(1)>', description: '<b>x</b>' }));
        expect(document.querySelector('img[onerror]')).toBeNull();
        expect(val('pce-tienda')).toBe('"><img src=x onerror=alert(1)>');
    });

    test('sin comprobante, el interruptor pce-receipt queda sin marcar', () => {
        render(gasto({ hasReceipt: false, receiptStatus: null }));
        expect(document.getElementById('pce-receipt').checked).toBe(false);
    });

    test('periodo cerrado: todo deshabilitado y sin botón de guardar', () => {
        render(gasto(), { cerrada: true });
        for (const id of EDITOR_FIELD_IDS.filter((x) => x !== 'pce-receipt')) expect(document.getElementById(id).disabled).toBe(true);
        expect(document.querySelector('[data-app-fn="pcSaveMovementEdit"]')).toBeNull();
        expect(document.querySelector('[data-app-fn="pcCancelMovementEdit"]').textContent).toContain('Cerrar');
    });
});

describe('estado y avisos', () => {
    test('una factura en orden se ve Leída y sin tarjetas de aviso', () => {
        render(gasto());
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Leída');
        expect(document.querySelectorAll('[data-pcn-issue]')).toHaveLength(0);
    });

    test('el total que no cuadra muestra lo leído, lo calculado y las tres salidas', () => {
        render(gasto({ subtotal: 850, itbis: 153, propina: 85, total: 1098, amount: 1098 }));
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Por revisar');
        const card = document.querySelector('[data-pcn-issue="total-mismatch"]');
        expect(card.textContent).toContain('1,098.00');
        expect(card.textContent).toContain('1,088.00');
        const actions = [...card.querySelectorAll('button')].map((b) => [b.dataset.appFn, b.dataset.arg]);
        expect(actions).toEqual(expect.arrayContaining([
            ['pcEditorFix', 'total-mismatch|apply'],
            ['pcEditorFocus', 'pce-total'],
            ['pcEditorFix', 'total-mismatch|accept']
        ]));
    });

    test('otro RNC de cliente: Otra empresa, aviso en rojo y «Más datos» abierto', () => {
        render(gasto({ rncCliente: '130123454' }));
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Otra empresa');
        expect(document.querySelector('[data-pcn-issue="client-rnc"]').dataset.tone).toBe('red');
        expect(document.querySelector('[data-pcn-more]').hidden).toBe(false);
    });

    test('«Más datos» está cerrado por defecto pero sus campos siguen en el formulario', () => {
        render(gasto());
        expect(document.querySelector('[data-pcn-more]').hidden).toBe(true);
        expect(document.getElementById('pce-rnccli')).not.toBeNull();
        render(gasto(), { ui: ui({ more: true }) });
        expect(document.querySelector('[data-pcn-more]').hidden).toBe(false);
    });

    test('las notas explican sin marcar: consumo, sin NCF, propina legal', () => {
        render(gasto({ ncf: 'B0200004411', rncCliente: '', subtotal: 1500, itbis: 270, total: 1770, amount: 1770 }));
        expect(document.querySelector('[data-pcn-status]').textContent).toContain('Consumo');
        expect(document.querySelector('[data-pcn-notes]').textContent).toContain('no da crédito fiscal');
        render(gasto({ ncf: '', rncCliente: '' }));
        expect(document.querySelector('[data-pcn-notes]').textContent).toContain('Sin NCF');
    });

    test('lo escrito sin guardar (draft) cuenta para los avisos', () => {
        render(gasto(), { ui: ui({ draft: { total: '5000' } }) });
        expect(document.querySelector('[data-pcn-issue="total-mismatch"]')).not.toBeNull();
        expect(val('pce-total')).toBe('5000');
    });

    test('el monto de caja distinto del total se marca', () => {
        render(gasto({ amount: 4000 }));
        expect(document.querySelector('[data-pcn-amount-diff]')).not.toBeNull();
        render(gasto());
        expect(document.querySelector('[data-pcn-amount-diff]')).toBeNull();
    });

    test('una reposición no muestra los datos de la factura', () => {
        render({ id: 'r1', type: 'reposicion', amount: 5000, date: '2026-10-05', description: 'Reposición' });
        expect(document.getElementById('pce-amount')).not.toBeNull();
        expect(document.getElementById('pce-ncf')).toBeNull();
        expect(document.querySelector('[data-pcn-view]')).toBeNull();
    });
});

describe('artículos', () => {
    test('lista cantidad, descripción y precio, y dice si la suma cuadra con el subtotal', () => {
        render(gasto(), { ui: ui({ itemsOpen: true }) });
        const section = document.querySelector('[data-pcn-items]');
        expect(section.textContent).toContain('Cemento gris');
        expect(section.textContent).toContain('20×');
        expect(section.querySelector('[data-pcn-items-status]').textContent).toContain('cuadra con el subtotal');
        expect(section.querySelector('[data-pcn-items-status]').dataset.ok).toBe('true');
        render(gasto({ subtotal: 5000 }), { ui: ui({ itemsOpen: true }) });
        expect(document.querySelector('[data-pcn-items-status]').dataset.ok).toBe('false');
    });
    test('sin artículos no aparece la sección', () => {
        render(gasto({ items: [] }));
        expect(document.querySelector('[data-pcn-items]')).toBeNull();
    });
});

describe('imagen de la factura', () => {
    const source = { url: 'blob:abc', mime: 'image/jpeg' };
    const boxes = { total: [790, 520, 850, 920], date: [236, 80, 290, 700] };

    test('con la foto, dibuja el recuadro del dato activo con las coordenadas del lector', () => {
        render(gasto({ ocrBoxes: boxes }), { source });
        expect(document.querySelector('[data-pcn-view] img').getAttribute('src')).toBe('blob:abc');
        const box = document.querySelector('[data-pcn-box]');
        expect(box.getAttribute('style')).toContain('left:52%');
        expect(box.getAttribute('style')).toContain('top:79%');
        expect(box.getAttribute('style')).toContain('width:40%');
        expect(box.getAttribute('style')).toContain('height:6%');
    });

    test('solo hay chip para los datos que traen recuadro', () => {
        render(gasto({ ocrBoxes: boxes }), { source });
        const chips = [...document.querySelectorAll('[data-pcn-chip]')].map((c) => c.dataset.arg);
        expect(chips).toEqual(['date', 'total']);
        expect(document.querySelector('[data-pcn-chip][aria-pressed="true"]').dataset.arg).toBe('total');
    });

    test('sin recuadros no dibuja nada y avisa en los datos sin recuadro', () => {
        render(gasto(), { source, ui: ui({ field: 'cliente' }) });
        expect(document.querySelector('[data-pcn-box]')).toBeNull();
        expect(document.querySelector('[data-pcn-nobox]')).not.toBeNull();
    });

    test('el tamaño de la ventana y el zoom salen de la interfaz', () => {
        render(gasto({ ocrBoxes: boxes }), { source, ui: ui({ size: 2, zoom: false }) });
        const win = document.querySelector('[data-pcn-win]');
        expect(win.dataset.size).toBe('2');
        expect(win.dataset.zoom).toBe('false');
        expect(document.querySelector('[data-app-fn="pcEditorZoom"]').textContent).toContain('Ampliar');
        expect(document.querySelector('[data-app-fn="pcEditorSize"]').textContent).toContain('grande');
    });

    test('PDF: muestra la vista previa y aclara que no hay recuadros', () => {
        render(gasto({ ocrBoxes: boxes }), { source: { url: 'blob:pdf', mime: 'application/pdf', preview: 'data:image/png;base64,AAA' } });
        expect(document.querySelector('[data-pcn-view] img').getAttribute('src')).toBe('data:image/png;base64,AAA');
        expect(document.querySelector('[data-pcn-box]')).toBeNull();
        expect(document.querySelector('[data-pcn-view]').textContent).toContain('PDF');
    });

    test('mientras carga y si falla lo dice', () => {
        render(gasto(), { source: undefined });
        expect(document.querySelector('[data-pcn-view]').textContent).toContain('Cargando');
        render(gasto(), { source: null });
        expect(document.querySelector('[data-pcn-view]').textContent).toContain('no disponible');
    });

    test('sin comprobante ofrece tomar o subir la foto', () => {
        render(gasto({ hasReceipt: false, receiptStatus: null }));
        expect(document.querySelector('[data-pcn-view]').textContent).toContain('no tiene foto');
        expect(document.querySelectorAll('[data-pcn-view] input[type="file"]').length).toBe(2);
    });

    test('con foto ofrece reescanear y cambiar la foto con los mismos manejadores de siempre', () => {
        render(gasto({ ocrBoxes: boxes }), { source });
        expect(document.querySelector('[data-app-fn="pcRescanReceipt"][data-arg="g1"]')).not.toBeNull();
        expect(document.querySelector('[data-pcn-view] input[type="file"][onchange*="pcPhotoEdit"]')).not.toBeNull();
    });
});

describe('respaldo', () => {
    test('muestra Respaldado o Por subir según el estado de la nube', () => {
        render(gasto());
        expect(document.querySelector('[data-pcn-backup]').textContent).toContain('Respaldado');
        render(gasto({ receiptStatus: 'pending-upload' }));
        expect(document.querySelector('[data-pcn-backup]').textContent).toContain('Por subir');
    });
});

describe('seguridad de la lectura (apagada por defecto)', () => {
    test('con la opción apagada no hay panel', () => {
        render(gasto({ ocrConfidence: { total: 0.6 } }));
        expect(document.querySelector('[data-pcn-confidence]')).toBeNull();
    });
    test('encendida y sin dato: dice que el lector aún no lo informa', () => {
        render(gasto(), { showConfidence: true, ui: ui({ secOpen: true }) });
        expect(document.querySelector('[data-pcn-confidence]').textContent).toContain('Aún no disponible');
    });
    test('encendida y con dato: promedio, barra por campo y punto ámbar en los dudosos', () => {
        render(gasto({ ocrConfidence: { total: 0.62, ncf: 0.97, subtotal: 0.9 } }), { showConfidence: true });
        const panel = document.querySelector('[data-pcn-confidence]');
        expect(panel.textContent).toContain('83 %');
        expect(panel.querySelectorAll('[data-pcn-conf-row]')).toHaveLength(3);
        expect(document.querySelector('label[for="pce-total"] [data-pcn-low]')).not.toBeNull();
        expect(document.querySelector('label[for="pce-ncf"] [data-pcn-low]')).toBeNull();
    });
});

describe('enganches del formulario', () => {
    test('los cambios y el foco llegan al controlador para refrescar avisos y recuadro', () => {
        render(gasto());
        const body = document.querySelector('.pcn-body');
        expect(body.getAttribute('onchange')).toContain('pcEditorTouch');
        expect(body.getAttribute('onfocusin')).toContain('pcEditorFocusIn');
    });
});

describe('editorViewState', () => {
    test('«Más datos» se abre solo con aviso de cliente; Seguridad solo con dato y opción', () => {
        const { editorViewState } = require('../modules/features/pettycash/PettyCashReceiptEditor.js');
        expect(editorViewState(gasto(), { context, ui: ui() })).toMatchObject({ more: false, secOpen: false });
        expect(editorViewState(gasto({ rncCliente: '130123454' }), { context, ui: ui() }).more).toBe(true);
        expect(editorViewState(gasto({ ocrConfidence: { total: 0.9 } }), { context, ui: ui(), showConfidence: true }).secOpen).toBe(true);
        expect(editorViewState(gasto({ ocrConfidence: { total: 0.9 } }), { context, ui: ui(), showConfidence: false }).secOpen).toBe(false);
        expect(editorViewState(gasto(), { context, ui: ui({ more: false }) }).more).toBe(false);
    });
});
