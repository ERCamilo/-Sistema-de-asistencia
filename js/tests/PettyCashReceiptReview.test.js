/**
 * Estado derivado de cada gasto para la pantalla nueva de Caja chica:
 * Leída, Por revisar, Consumo, Otra empresa o Sin respaldo, y el orden
 * «registros en revisión primero».
 */
import {
    RECEIPT_STATES,
    needsAttention,
    movementReviewState,
    reviewFilterCounts,
    groupReviewFirst
} from '../modules/features/pettycash/PettyCashReceiptReview.js';

const COMPANY = '130456781';
const ctx = { companyRnc: COMPANY, today: '2026-10-19', period: { openingDate: '2026-10-01' }, movements: [] };
const base = (over = {}) => ({
    id: 'g1', type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded',
    paidTo: 'Ferretería El Maestro', rncEmisor: '130123454', rncCliente: COMPANY, ncf: 'B0100000123',
    date: '2026-10-12', fechaEmision: '2026-10-12', subtotal: 4000, itbis: 720, total: 4720, amount: 4720,
    ...over
});

describe('RECEIPT_STATES', () => {
    test('cada estado tiene etiqueta, pista y color', () => {
        for (const key of ['leida', 'revisar', 'consumo', 'otra', 'respaldo']) {
            expect(RECEIPT_STATES[key].label).toEqual(expect.any(String));
            expect(RECEIPT_STATES[key].hint).toEqual(expect.any(String));
            expect(RECEIPT_STATES[key].color).toMatch(/^#[0-9a-f]{6}$/i);
        }
        expect(RECEIPT_STATES.otra.label).toBe('Otra empresa');
        expect(RECEIPT_STATES.respaldo.label).toBe('Sin respaldo');
    });
    test('revisar, respaldo y otra piden atención; el resto no', () => {
        expect(['revisar', 'respaldo', 'otra'].every(needsAttention)).toBe(true);
        expect(['leida', 'consumo', 'reposicion'].some(needsAttention)).toBe(false);
    });
});

describe('movementReviewState', () => {
    test('una factura de crédito fiscal a nombre de la empresa y sin avisos es Leída', () => {
        const r = movementReviewState(base(), ctx);
        expect(r.key).toBe('leida');
        expect(r.issues).toEqual([]);
    });

    test('un gasto sin comprobante es Sin respaldo, aunque no tenga avisos', () => {
        const r = movementReviewState(base({ hasReceipt: false, receiptStatus: null, ncf: '', rncEmisor: '' }), ctx);
        expect(r.key).toBe('respaldo');
    });

    test('con comprobante guardado solo en el teléfono NO es Sin respaldo', () => {
        const r = movementReviewState(base({ receiptStatus: 'pending-upload' }), ctx);
        expect(r.key).toBe('leida');
    });

    test('el total que no cuadra lo deja Por revisar con el aviso y el total calculado', () => {
        const r = movementReviewState(base({ subtotal: 850, itbis: 153, propina: 85, total: 1098, amount: 1098 }), ctx);
        expect(r.key).toBe('revisar');
        const mismatch = r.issues.find((i) => i.code === 'total-mismatch');
        expect(mismatch.detail).toEqual({ read: 1098, calc: 1088 });
    });

    test('un registro creado automáticamente (reviewPending) está Por revisar aunque no tenga avisos', () => {
        expect(movementReviewState(base({ reviewPending: true }), ctx).key).toBe('revisar');
    });

    test('un crédito fiscal con otro RNC de cliente es Otra empresa, y gana a Por revisar', () => {
        const r = movementReviewState(base({ rncCliente: '130123454', reviewPending: true }), ctx);
        expect(r.key).toBe('otra');
        expect(r.issues.map((i) => i.code)).toContain('client-rnc');
    });

    test('una factura de consumo es Consumo y trae su nota', () => {
        const r = movementReviewState(base({ ncf: 'B0200004411', rncCliente: '' }), ctx);
        expect(r.key).toBe('consumo');
        expect(r.notes.map((n) => n.code)).toContain('consumer-invoice');
    });

    test('sin NCF es Consumo y avisa que no genera crédito fiscal', () => {
        const r = movementReviewState(base({ ncf: '', rncCliente: '' }), ctx);
        expect(r.key).toBe('consumo');
        expect(r.notes.map((n) => n.code)).toContain('no-ncf');
    });

    test('dar por bueno un aviso lo quita (reviewAccepted)', () => {
        const m = base({ subtotal: 850, itbis: 153, propina: 85, total: 1098, amount: 1098, reviewAccepted: ['total-mismatch'] });
        expect(movementReviewState(m, ctx).key).toBe('leida');
    });

    test('un NCF repetido con el mismo emisor lo deja Por revisar', () => {
        const other = base({ id: 'g2', date: '2026-10-07' });
        const r = movementReviewState(base(), { ...ctx, movements: [other] });
        expect(r.key).toBe('revisar');
        expect(r.issues.map((i) => i.code)).toContain('ncf-duplicate');
    });

    test('una reposición no se revisa: su estado es reposicion', () => {
        const r = movementReviewState({ id: 'r1', type: 'reposicion', amount: 5000 }, ctx);
        expect(r).toEqual({ key: 'reposicion', issues: [], notes: [] });
    });

    test('sin RNC de la empresa no se compara el cliente', () => {
        const r = movementReviewState(base({ rncCliente: '' }), { ...ctx, companyRnc: null });
        expect(r.key).toBe('leida');
    });
});

describe('reviewFilterCounts', () => {
    const items = [
        { id: 'a', key: 'revisar' }, { id: 'b', key: 'revisar' }, { id: 'c', key: 'leida' },
        { id: 'd', key: 'otra' }, { id: 'e', key: 'reposicion' }
    ];
    test('cuenta todos y cada estado', () => {
        expect(reviewFilterCounts(items)).toEqual({ todos: 5, revisar: 2, respaldo: 0, consumo: 0, otra: 1, leida: 1 });
    });
});

describe('groupReviewFirst', () => {
    const items = [
        { id: 'a', key: 'leida' }, { id: 'b', key: 'revisar' }, { id: 'c', key: 'consumo' },
        { id: 'd', key: 'respaldo' }, { id: 'e', key: 'otra' }, { id: 'f', key: 'reposicion' }
    ];
    test('con «primero en revisión» separa en dos secciones y conserva el orden dentro de cada una', () => {
        const groups = groupReviewFirst(items, { first: true, filter: 'todos' });
        expect(groups.map((g) => g.id)).toEqual(['review', 'rest']);
        expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'd', 'e']);
        expect(groups[1].items.map((i) => i.id)).toEqual(['a', 'c', 'f']);
        expect(groups[0].title).toBe('POR REVISAR');
        expect(groups[1].title).toBe('RESTO');
    });
    test('si no hay nada que revisar, solo sale la sección RESTO', () => {
        const groups = groupReviewFirst(items.filter((i) => !needsAttention(i.key)), { first: true, filter: 'todos' });
        expect(groups.map((g) => g.id)).toEqual(['rest']);
    });
    test('con el interruptor apagado, o con un filtro activo, es una sola lista sin título', () => {
        expect(groupReviewFirst(items, { first: false, filter: 'todos' })).toEqual([{ id: 'all', title: '', items }]);
        const one = groupReviewFirst(items, { first: true, filter: 'revisar' });
        expect(one).toEqual([{ id: 'all', title: '', items: [items[1]] }]);
    });
    test('lista vacía → sin secciones', () => {
        expect(groupReviewFirst([], { first: true, filter: 'todos' })).toEqual([]);
    });
});
