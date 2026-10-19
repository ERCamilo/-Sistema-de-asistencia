/**
 * Pantalla nueva de Caja chica (HTML puro): saldo, acciones, filtros por estado,
 * interruptor «primero en revisión», tarjetas y columna del editor.
 */
import { screenHTML, balanceCardHTML, movementCardHTML } from '../modules/features/pettycash/PettyCashScreen.js';

const gasto = (over = {}) => ({
    id: 'g1', type: 'gasto', recordNumber: 7, paidTo: 'Ferretería El Maestro', category: 'Materiales', date: '2026-10-12',
    amount: 4720, hasReceipt: true, receiptStatus: 'uploaded', ...over
});
const item = (movement, key = 'leida', duplicate = null) => ({ movement, key, duplicate });
const model = (over = {}) => ({
    period: { label: 'Octubre', cerrada: false },
    summary: { saldo: 36162, reposiciones: 50000, gastos: 13838, reembolso: 0 },
    cameraMode: 'camera',
    items: [], counts: { todos: 0, revisar: 0, respaldo: 0, consumo: 0, otra: 0, leida: 0 },
    filter: 'todos', reviewFirst: true, selectedId: null, editing: false, editorHTML: '',
    slots: {}, hasMore: false, moreLabel: '',
    ...over
});
const render = (m) => { document.body.innerHTML = screenHTML(m); return document.body; };
afterEach(() => { document.body.innerHTML = ''; });

describe('balanceCardHTML', () => {
    test('saldo grande, fondo y gastado, y la barra de lo gastado', () => {
        document.body.innerHTML = balanceCardHTML({ saldo: 36162, reposiciones: 50000, gastos: 13838, reembolso: 0 });
        const card = document.querySelector('[data-pcn-balance]');
        expect(card.textContent).toContain('Saldo disponible');
        expect(card.textContent).toContain('36,162.00');
        expect(card.textContent).toContain('50,000.00');
        expect(card.textContent).toContain('13,838.00');
        expect(card.querySelector('[data-pcn-spent-bar]').style.width).toBe('28%');
    });
    test('saldo negativo en rojo y la barra nunca pasa del 100 %', () => {
        document.body.innerHTML = balanceCardHTML({ saldo: -500, reposiciones: 1000, gastos: 1500, reembolso: 500 });
        const card = document.querySelector('[data-pcn-balance]');
        expect(card.querySelector('[data-pcn-saldo]').dataset.negative).toBe('true');
        expect(card.querySelector('[data-pcn-spent-bar]').style.width).toBe('100%');
        expect(card.textContent).toContain('Por reembolsar');
    });
    test('sin reposiciones la barra queda vacía y no aparece «Por reembolsar»', () => {
        document.body.innerHTML = balanceCardHTML({ saldo: 0, reposiciones: 0, gastos: 0, reembolso: 0 });
        expect(document.querySelector('[data-pcn-spent-bar]').style.width).toBe('0%');
        expect(document.body.textContent).not.toContain('Por reembolsar');
    });
});

describe('acciones', () => {
    test('con la cámara nueva, el botón grande la abre', () => {
        render(model());
        const cta = document.querySelector('[data-pcn-cta]');
        expect(cta.textContent).toContain('Tomar foto de factura');
        expect(cta.dataset.appFn).toBe('pcOpenCamera');
    });
    test('con la cámara del sistema, es un selector de foto con el mismo manejador de siempre', () => {
        render(model({ cameraMode: 'native' }));
        const input = document.querySelector('[data-pcn-cta] input[type="file"]');
        expect(input.getAttribute('capture')).toBe('environment');
        expect(input.getAttribute('onchange')).toContain('pcCameraBatchPhoto');
    });
    test('gasto manual, reposición y archivos usan los manejadores existentes', () => {
        render(model());
        const fns = [...document.querySelectorAll('[data-pcn-actions] button')].map((b) => [b.dataset.appFn, b.dataset.arg || '']);
        expect(fns).toEqual(expect.arrayContaining([['pcOpenForm', 'gasto'], ['pcOpenForm', 'reposicion'], ['pcOpenReceiptSourcePicker', '']]));
    });
    test('periodo cerrado: sin acciones', () => {
        render(model({ period: { label: 'Septiembre', cerrada: true } }));
        expect(document.querySelector('[data-pcn-cta]')).toBeNull();
        expect(document.querySelector('[data-pcn-actions]')).toBeNull();
    });
});

describe('filtros e interruptor', () => {
    const counts = { todos: 6, revisar: 1, respaldo: 1, consumo: 1, otra: 1, leida: 2 };
    test('un chip por estado con su cantidad; el activo queda marcado', () => {
        render(model({ counts, filter: 'revisar' }));
        const chips = [...document.querySelectorAll('[data-pcn-filter]')];
        expect(chips.map((c) => c.dataset.arg)).toEqual(['todos', 'revisar', 'respaldo', 'consumo', 'otra', 'leida']);
        expect(chips[0].textContent).toContain('Todos');
        expect(chips[0].textContent).toContain('6');
        expect(chips[5].textContent).toContain('Leída');
        expect(chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.arg)).toEqual(['revisar']);
        expect(chips[0].dataset.appFn).toBe('pcFilterState');
    });
    test('el interruptor «Mostrar primero los registros en revisión» refleja su estado', () => {
        render(model({ reviewFirst: true }));
        const sw = document.querySelector('[data-pcn-review-first]');
        expect(sw.getAttribute('role')).toBe('switch');
        expect(sw.getAttribute('aria-checked')).toBe('true');
        expect(sw.dataset.appFn).toBe('pcToggleReviewFirst');
        expect(sw.textContent).toContain('Mostrar primero los registros en revisión');
        render(model({ reviewFirst: false }));
        expect(document.querySelector('[data-pcn-review-first]').getAttribute('aria-checked')).toBe('false');
    });
});

describe('lista', () => {
    const items = [
        item(gasto({ id: 'a' }), 'leida'),
        item(gasto({ id: 'b', paidTo: 'Comedor Doña Lía' }), 'revisar'),
        item({ id: 'r1', type: 'reposicion', recordNumber: 2, amount: 5000, date: '2026-10-05', description: 'Reposición octubre' }, 'reposicion')
    ];
    test('con «primero en revisión», dos secciones con su conteo', () => {
        render(model({ items, counts: { todos: 3, revisar: 1, respaldo: 0, consumo: 0, otra: 0, leida: 1 } }));
        const heads = [...document.querySelectorAll('[data-pcn-section]')];
        expect(heads.map((h) => h.dataset.pcnSection)).toEqual(['review', 'rest']);
        expect(heads[0].textContent).toContain('POR REVISAR');
        expect(heads[0].textContent).toContain('1');
        expect(heads[1].textContent).toContain('RESTO');
        expect([...document.querySelectorAll('[data-pcn-card]')].map((c) => c.dataset.pcnCard)).toEqual(['b', 'a', 'r1']);
    });
    test('apagado el interruptor, una sola lista sin títulos y en el orden recibido', () => {
        render(model({ items, reviewFirst: false }));
        expect(document.querySelectorAll('[data-pcn-section]')).toHaveLength(0);
        expect([...document.querySelectorAll('[data-pcn-card]')].map((c) => c.dataset.pcnCard)).toEqual(['a', 'b', 'r1']);
    });
    test('un filtro sin resultados lo dice', () => {
        render(model({ items: [], filter: 'otra' }));
        expect(document.querySelector('[data-pcn-empty]').textContent).toContain('No hay registros');
    });
    test('sin movimientos aún', () => {
        render(model({ items: [], filter: 'todos' }));
        expect(document.querySelector('[data-pcn-empty]').textContent).toContain('Sin movimientos');
    });
    test('«Mostrar más» solo cuando hay más', () => {
        render(model({ items, hasMore: true, moreLabel: 'Mostrar 50 más · 50 de 120' }));
        const more = document.querySelector('[data-app-fn="pcLoadMoreMovements"]');
        expect(more.textContent).toContain('50 de 120');
        render(model({ items }));
        expect(document.querySelector('[data-app-fn="pcLoadMoreMovements"]')).toBeNull();
    });
    test('los bloques existentes (formularios, búsqueda…) entran por ranuras', () => {
        render(model({ slots: { before: '<i id="s-before"></i>', search: '<i id="s-search"></i>', after: '<i id="s-after"></i>' } }));
        for (const id of ['s-before', 's-search', 's-after']) expect(document.getElementById(id)).not.toBeNull();
    });
});

describe('movementCardHTML', () => {
    const card = (it, opts = {}) => { document.body.innerHTML = movementCardHTML(it, { cerrada: false, selected: false, ...opts }); return document.querySelector('[data-pcn-card]'); };
    test('comercio, fecha dd-mm-aaaa, categoría, monto y estado', () => {
        const c = card(item(gasto(), 'leida'));
        expect(c.dataset.appFn).toBe('pcOpenMovement');
        expect(c.dataset.arg).toBe('g1');
        expect(c.textContent).toContain('Ferretería El Maestro');
        expect(c.textContent).toContain('12-10-2026');
        expect(c.textContent).toContain('Materiales');
        expect(c.textContent).toContain('− RD$ 4,720.00');
        expect(c.querySelector('[data-pcn-state]').textContent).toContain('Leída');
    });
    test('sin subir a la nube: aviso en ámbar', () => {
        expect(card(item(gasto({ receiptStatus: 'pending-upload' }))).textContent).toContain('Sin subir');
        expect(card(item(gasto())).textContent).not.toContain('Sin subir');
    });
    test('la reposición suma y no lleva estado', () => {
        const c = card(item({ id: 'r1', type: 'reposicion', recordNumber: 2, amount: 5000, date: '2026-10-05' }, 'reposicion'));
        expect(c.textContent).toContain('+ RD$ 5,000.00');
        expect(c.textContent).toContain('Reposición');
        expect(c.querySelector('[data-pcn-state]')).toBeNull();
    });
    test('seleccionada, con posible duplicado y con borrar', () => {
        const dup = { referenceId: 'g9', referenceNumber: 4, referencePeriodLabel: 'Septiembre', confidence: 'exact', reason: 'Mismo NCF' };
        const c = card(item(gasto(), 'revisar', dup), { selected: true });
        expect(c.dataset.selected).toBe('true');
        const chip = c.querySelector('[data-app-fn="pcOpenDuplicateReference"]');
        expect(chip.dataset.arg).toBe('g9');
        expect(chip.textContent).toContain('Coincide con');
        expect(c.querySelector('[data-app-fn="pcDeleteMovement"]').dataset.arg).toBe('g1');
    });
    test('periodo cerrado: sin borrar', () => {
        expect(card(item(gasto()), { cerrada: true }).querySelector('[data-app-fn="pcDeleteMovement"]')).toBeNull();
    });
    test('escapa el nombre del comercio', () => {
        const c = card(item(gasto({ paidTo: '<img src=x onerror=1>' })));
        expect(c.querySelector('img')).toBeNull();
    });
});

describe('columna del editor', () => {
    test('editando: el editor va en su columna, con fondo para cerrar en teléfono', () => {
        render(model({ editing: true, editorHTML: '<div id="ed"></div>' }));
        expect(document.querySelector('[data-pcn-screen]').dataset.editing).toBe('true');
        expect(document.querySelector('[data-pcn-side] #ed')).not.toBeNull();
        expect(document.querySelector('[data-pcn-backdrop]').dataset.appFn).toBe('pcCancelMovementEdit');
    });
    test('sin editar no hay columna ni fondo', () => {
        render(model());
        expect(document.querySelector('[data-pcn-screen]').dataset.editing).toBe('false');
        expect(document.querySelector('[data-pcn-side]')).toBeNull();
        expect(document.querySelector('[data-pcn-backdrop]')).toBeNull();
    });
    test('la tarjeta abierta se marca como seleccionada', () => {
        render(model({ items: [item(gasto({ id: 'a' })), item(gasto({ id: 'b' }))], selectedId: 'b', editing: true, editorHTML: '' }));
        expect(document.querySelector('[data-pcn-card="b"]').dataset.selected).toBe('true');
        expect(document.querySelector('[data-pcn-card="a"]').dataset.selected).toBe('false');
    });
});

describe('saldo total del proyecto', () => {
    test('se muestra en la tarjeta de saldo cuando se recibe (hay más de un periodo)', () => {
        document.body.innerHTML = balanceCardHTML({ saldo: 100, reposiciones: 200, gastos: 100, reembolso: 0, projectTotal: -4504.14 });
        const line = document.querySelector('[data-pcn-project-total]');
        expect(line.textContent).toContain('Saldo total del proyecto');
        expect(line.textContent).toContain('4,504.14');
        expect(line.dataset.negative).toBe('true');
    });
    test('sin el dato, no aparece', () => {
        document.body.innerHTML = balanceCardHTML({ saldo: 100, reposiciones: 200, gastos: 100, reembolso: 0 });
        expect(document.querySelector('[data-pcn-project-total]')).toBeNull();
    });
});
