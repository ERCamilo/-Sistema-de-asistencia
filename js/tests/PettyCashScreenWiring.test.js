/**
 * Lista nueva dentro de Caja chica (PettyCashUI real, IndexedDB simulado):
 * solo con el interruptor «Pantalla nueva de Caja chica»; con él apagado queda
 * la pantalla de siempre.
 */
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';

const COMPANY = '130456781';
const factura = (id, over = {}) => ({
    id, projectId: 'c1', periodId: 'p1', recordNumber: Number(id.replace(/\D/g, '')) || 1, type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded',
    paidTo: `Comercio ${id}`, rncEmisor: '130123454', cliente: 'Torre Naco SRL', rncCliente: COMPANY, ncf: `B01${String(Number(id.replace(/\D/g, ''))).padStart(8, '0')}`,
    date: '2026-10-12', fechaEmision: '2026-10-12', category: 'Materiales', subtotal: 1000, itbis: 180, total: 1180, amount: 1180, updatedAt: 1, ...over
});
const movimientos = () => [
    factura('g1'),                                                                                   // leída
    factura('g2', { subtotal: 850, itbis: 153, propina: 85, total: 1098, amount: 1098, ncf: 'B0100000202' }), // total no cuadra → por revisar
    factura('g3', { hasReceipt: false, receiptStatus: null, ncf: '', rncEmisor: '', rncCliente: '', amount: 350 }), // sin respaldo
    factura('g4', { rncCliente: '130123454', ncf: 'B0100000404' }),                                  // otra empresa
    factura('g5', { ncf: 'B0200000505', rncCliente: '' }),                                           // consumo
    { id: 'r1', projectId: 'c1', periodId: 'p1', recordNumber: 9, type: 'reposicion', amount: 5000, date: '2026-10-02', description: 'Reposición octubre', updatedAt: 1 }
];
const seed = (movements = movimientos(), settings = { newPettyCashScreen: true }, period = {}) => {
    state.settings = settings;
    state.pettyCash = {
        projects: [{ id: 'c1', name: 'Caja Norte', companyRnc: COMPANY }],
        periods: [{ id: 'p1', projectId: 'c1', label: 'Octubre', status: 'abierta', openingDate: '2026-10-01', closingDate: '2026-10-31', ...period }],
        movements, selectedProjectId: 'c1', selectedPeriodId: 'p1',
        movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
};
const paint = () => { document.body.innerHTML = PettyCashTab(); };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const cards = () => [...document.querySelectorAll('[data-pcn-card]')].map((c) => c.dataset.pcnCard);

beforeAll(() => { registerPettyCashGlobals(); });
beforeEach(() => {
    window.render = jest.fn(paint);
    indexedDBService.getReceipt.mockResolvedValue(null);
    localStorage.clear();
});
afterEach(() => { state.pettyCash = null; state.settings = {}; document.body.innerHTML = ''; delete window.render; delete window.matchMedia; });

describe('detrás del interruptor', () => {
    test('apagado: la pantalla de siempre', () => {
        seed(movimientos(), {});
        paint();
        expect(document.querySelector('[data-pcn-screen]')).toBeNull();
        expect(document.querySelector('[data-petty-cash-history]')).not.toBeNull();
    });
    test('encendido: saldo, filtros y tarjetas; sin la tabla vieja de pendientes ni el historial viejo', () => {
        seed();
        paint();
        expect(document.querySelector('[data-pcn-screen]')).not.toBeNull();
        expect(document.querySelector('[data-pcn-balance]').textContent).toContain('Saldo disponible');
        expect(document.querySelector('[data-petty-cash-history]')).toBeNull();
        expect(document.querySelector('[data-petty-cash-review-queue]')).toBeNull();
        expect(cards().sort()).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'r1']);
    });
});

describe('estados y orden', () => {
    test('cada gasto muestra su estado derivado y los filtros cuentan bien', () => {
        seed(); paint();
        const state = (id) => document.querySelector(`[data-pcn-card="${id}"] [data-pcn-state]`)?.dataset.pcnState;
        expect(['g1', 'g2', 'g3', 'g4', 'g5'].map(state)).toEqual(['leida', 'revisar', 'respaldo', 'otra', 'consumo']);
        expect(document.querySelector('[data-pcn-card="r1"] [data-pcn-state]')).toBeNull();
        const count = (k) => document.querySelector(`[data-pcn-filter][data-arg="${k}"] b`).textContent;
        expect(['todos', 'revisar', 'respaldo', 'consumo', 'otra', 'leida'].map(count)).toEqual(['6', '1', '1', '1', '1', '1']);
    });
    test('por defecto lo que pide atención va primero (POR REVISAR) y el resto después', () => {
        seed(); paint();
        const order = cards();
        expect(order.slice(0, 3).sort()).toEqual(['g2', 'g3', 'g4']);
        expect(order.slice(3).sort()).toEqual(['g1', 'g5', 'r1']);
        expect(document.querySelector('[data-pcn-section="review"]').textContent).toContain('3');
    });
    test('pcToggleReviewFirst apaga el orden especial, lo recuerda y repinta', () => {
        seed(); paint();
        window.pcToggleReviewFirst();
        expect(state.pettyCash.reviewFirst).toBe(false);
        expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /petty/i.test(k)))).reviewFirst).toBe(false);
        expect(document.querySelectorAll('[data-pcn-section]')).toHaveLength(0);
        expect(cards()).toEqual(['r1', 'g5', 'g4', 'g3', 'g2', 'g1']);   // orden del historial: registro descendente
        window.pcToggleReviewFirst();
        expect(state.pettyCash.reviewFirst).toBe(true);
    });
    test('pcFilterState deja solo los de ese estado; un estado desconocido se ignora', () => {
        seed(); paint();
        window.pcFilterState('otra');
        expect(cards()).toEqual(['g4']);
        window.pcFilterState('inventado');
        expect(state.pettyCash.screenFilter).toBe('otra');
        window.pcFilterState('todos');
        expect(cards()).toHaveLength(6);
    });
    test('la búsqueda se combina con el filtro y los conteos reflejan lo buscado', () => {
        seed(); state.pettyCash.movementSearchQuery = 'g2'; paint();
        expect(cards()).toEqual(['g2']);
        expect(document.querySelector('[data-pcn-filter][data-arg="todos"] b').textContent).toBe('1');
    });
});

describe('periodo cerrado y formularios', () => {
    test('cerrado: sin acciones ni borrar', () => {
        seed(movimientos(), { newPettyCashScreen: true }, { status: 'cerrada' });
        paint();
        expect(document.querySelector('[data-pcn-cta]')).toBeNull();
        expect(document.querySelector('[data-app-fn="pcDeleteMovement"]')).toBeNull();
    });
    test('el formulario de gasto manual sigue apareciendo al abrirlo', () => {
        seed(); paint();
        window.pcOpenForm('gasto');
        expect(document.getElementById('pc-amount')).not.toBeNull();
    });
    test('la cámara nueva o la del sistema según el interruptor de Tests', () => {
        seed(); paint();
        expect(document.querySelector('[data-pcn-cta] input[capture]')).not.toBeNull();
        state.settings.newReceiptCamera = true; paint();
        expect(document.querySelector('[data-pcn-cta]').dataset.appFn).toBe('pcOpenCamera');
    });
});

describe('abrir un registro', () => {
    test('el editor va en la columna lateral y la tarjeta queda seleccionada', async () => {
        seed(); paint();
        window.pcOpenMovement('g2'); await flush();
        expect(document.querySelector('[data-pcn-side] [data-pcn-editor]')).not.toBeNull();
        expect(document.querySelector('[data-pcn-card="g2"]').dataset.selected).toBe('true');
        expect(document.getElementById('pce-total').value).toBe('1098');
    });
    test('el editor ofrece ir al siguiente registro por revisar (sin repetir ni salirse de la cola)', async () => {
        seed(); paint();
        window.pcOpenMovement('g2'); await flush();
        const label = document.querySelector('[data-pcn-queue]').textContent;
        expect(label).toMatch(/\d de 3/);
        const queue = ['g2', 'g3', 'g4'].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));   // orden de la lista: registro descendente
        const at = queue.indexOf('g2');
        window.pcEditorQueue(1); await flush();
        expect(state.pettyCash.editMov).toBe(queue[(at + 1) % 3]);
        window.pcEditorQueue(-1); await flush();
        expect(state.pettyCash.editMov).toBe('g2');
    });
    test('un registro que no pide atención muestra «– de N» y salta al primero/último', async () => {
        seed(); paint();
        window.pcOpenMovement('g1'); await flush();
        expect(document.querySelector('[data-pcn-queue]').textContent).toContain('– de 3');
        window.pcEditorQueue(1); await flush();
        expect(['g2', 'g3', 'g4']).toContain(state.pettyCash.editMov);
    });
    test('al guardar en pantalla ancha pasa solo al siguiente por revisar; en teléfono se cierra', async () => {
        seed(); paint();
        window.matchMedia = jest.fn(() => ({ matches: true }));
        window.pcOpenMovement('g2'); await flush();
        await window.pcSaveMovementEdit();
        expect(['g3', 'g4']).toContain(state.pettyCash.editMov);
        state.pettyCash.editMov = null;
        window.matchMedia = jest.fn(() => ({ matches: false }));
        window.pcOpenMovement('g3'); await flush();
        await window.pcSaveMovementEdit();
        expect(state.pettyCash.editMov).toBeNull();
    });
});

describe('barra superior compacta', () => {
    const twoPeriods = () => {
        seed();
        state.pettyCash.periods.push({ id: 'p0', projectId: 'c1', label: 'Septiembre', status: 'cerrada', openingDate: '2026-09-01', closingDate: '2026-09-30' });
    };
    test('una sola barra: caja, periodo y acciones pequeñas, sin las tarjetas grandes de periodo', () => {
        twoPeriods(); paint();
        const bar = document.querySelector('[data-pcn-topbar]');
        expect(bar).not.toBeNull();
        expect(bar.querySelector('select[onchange*="pcSelectProject"]')).not.toBeNull();
        expect(bar.querySelector('select[data-pcn-period]').options).toHaveLength(2);
        expect(bar.querySelector('select[data-pcn-period]').value).toBe('p1');
        for (const fn of ['pcEditProject', 'pcEditProjectFiscal', 'pcDeleteProject', 'pcNewProject', 'pcNewPeriod']) {
            expect(bar.querySelector(`[data-app-fn="${fn}"]`)).not.toBeNull();
        }
        expect(document.querySelector('button[data-app-fn="pcSelectPeriod"]')).toBeNull();
        expect(document.body.textContent.split('Saldo total del proyecto')).toHaveLength(2);   // una sola vez (dentro de la tarjeta), no una fila grande aparte
    });
    test('elegir otro periodo en la lista usa el manejador de siempre', () => {
        twoPeriods(); paint();
        expect(document.querySelector('select[data-pcn-period]').getAttribute('onchange')).toContain('pcSelectPeriod(this.value)');
    });
    test('con más de un periodo, el saldo total del proyecto va dentro de la tarjeta de saldo', () => {
        twoPeriods(); paint();
        expect(document.querySelector('[data-pcn-balance] [data-pcn-project-total]')).not.toBeNull();
        seed(); paint();
        expect(document.querySelector('[data-pcn-project-total]')).toBeNull();
    });
    test('sin interruptor, la barra de siempre', () => {
        seed(movimientos(), {}); paint();
        expect(document.querySelector('[data-pcn-topbar]')).toBeNull();
        expect(document.querySelector('[data-app-fn="pcNewPeriod"]')).not.toBeNull();
    });
});
