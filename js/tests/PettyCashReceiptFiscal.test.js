/**
 * Revisiones fiscales de una factura: totales que cuadran con descuento,
 * ITBIS incluido o propina legal; factura a nombre de la empresa (RNC del
 * proyecto) y nota para facturas de consumo.
 */
import { checkReceipt, receiptNotes, receiptReviewState, fixesFor, validateFixInput } from '../modules/features/pettycash/PettyCashReceiptChecks.js';

const COMPANY = '101010632';
const codes = (issues) => issues.map(i => i.code);

describe('total e ITBIS: explicaciones antes de avisar', () => {
    test('con descuento leído: subtotal − descuento + ITBIS = total', () => {
        const m = { subtotal: 1000, descuento: 100, itbis: 162, total: 1062 };
        expect(codes(checkReceipt(m))).toEqual([]);
        expect(receiptNotes(m)).toEqual([expect.objectContaining({ code: 'total-discount', detail: { amount: 100 } })]);
    });

    test('ITBIS incluido en los precios (súper): subtotal = total y el ITBIS es 18/118', () => {
        const m = { subtotal: 1180, itbis: 180, total: 1180 };
        expect(codes(checkReceipt(m))).toEqual([]);
        expect(codes(receiptNotes(m))).toEqual(['itbis-included']);
        expect(codes(checkReceipt({ subtotal: 1180, itbis: 180, total: 1180, itbisIncluido: true }))).toEqual([]);
    });

    test('propina legal leída o deducida (10% del subtotal)', () => {
        expect(codes(checkReceipt({ subtotal: 1000, itbis: 180, propina: 100, total: 1280 }))).toEqual([]);
        const inferred = { subtotal: 1000, itbis: 180, total: 1280 };
        expect(codes(checkReceipt(inferred))).toEqual([]);
        expect(receiptNotes(inferred)).toEqual([expect.objectContaining({ code: 'total-tip', detail: { amount: 100 } })]);
    });

    test('ITBIS sobre la base gravada: descuento y exento se restan', () => {
        // Base gravada = 1000 − 100 − 400 = 500 → ITBIS 90.
        expect(codes(checkReceipt({ subtotal: 1000, descuento: 100, exento: 400, itbis: 90, total: 990 }))).toEqual([]);
    });

    test('si nada lo explica, sigue el aviso; si falta poco, sugiere un descuento no leído', () => {
        const issues = checkReceipt({ subtotal: 1000, itbis: 180, total: 1100 });
        expect(codes(issues)).toEqual(['total-mismatch']);
        expect(issues[0].hint).toMatch(/descuento/);
        expect(codes(checkReceipt({ subtotal: 1000, itbis: 180, total: 1500 }))).toEqual(['total-mismatch']);
    });

    test('el arreglo "usar lo calculado" incluye descuento y propina', () => {
        const [issue] = checkReceipt({ subtotal: 1000, descuento: 50, propina: 95, itbis: 171, total: 1300 });
        expect(issue.detail).toEqual({ read: 1300, calc: 1216 });
        expect(fixesFor(issue)[0].patch).toEqual({ total: 1216, amount: 1216 });
    });

    test('casos de siempre sin cambios: total correcto o ITBIS al 16%', () => {
        expect(codes(checkReceipt({ subtotal: 1000, itbis: 180, total: 1180 }))).toEqual([]);
        expect(codes(checkReceipt({ subtotal: 1000, itbis: 160, total: 1160 }))).toEqual([]);
        expect(receiptNotes({ subtotal: 1000, itbis: 180, total: 1180 })).toEqual([]);
    });
});

describe('factura a nombre de la empresa (RNC del proyecto)', () => {
    const fiscal = { total: 1180, subtotal: 1000, itbis: 180, ncf: 'B0100000123' };

    test('crédito fiscal (B01/E31) con el RNC de la empresa: sin aviso', () => {
        expect(codes(checkReceipt({ ...fiscal, rncCliente: '1-01-01063-2' }, { companyRnc: COMPANY }))).toEqual([]);
        expect(codes(checkReceipt({ ...fiscal, ncf: 'E310000000001', rncCliente: COMPANY }, { companyRnc: COMPANY }))).toEqual([]);
    });

    test('crédito fiscal sin RNC del cliente o con otro: aviso con lo leído y lo esperado', () => {
        const missing = checkReceipt({ ...fiscal }, { companyRnc: COMPANY });
        expect(missing).toEqual([expect.objectContaining({ code: 'client-rnc', field: 'rncCliente', detail: { read: '', expected: COMPANY } })]);
        const other = checkReceipt({ ...fiscal, rncCliente: '131246796' }, { companyRnc: COMPANY });
        expect(other[0]).toEqual(expect.objectContaining({ code: 'client-rnc', detail: { read: '131246796', expected: COMPANY } }));
        expect(other[0].message).toMatch(/no está a nombre de la empresa/);
    });

    test('sin RNC configurado en el proyecto, o factura de consumo: no se revisa', () => {
        expect(codes(checkReceipt({ ...fiscal }))).toEqual([]);
        expect(codes(checkReceipt({ ...fiscal, ncf: 'B0200000123' }, { companyRnc: COMPANY }))).toEqual([]);
    });

    test('arreglos: escribir el RNC del cliente (validado) o darla por buena', () => {
        const [issue] = checkReceipt({ ...fiscal, rncCliente: '131246796' }, { companyRnc: COMPANY });
        const fixes = fixesFor(issue);
        expect(fixes[0]).toEqual({ kind: 'input', field: 'rncCliente', validate: 'rnc-client', value: '131246796' });
        expect(fixes[1]).toEqual({ kind: 'accept', code: 'client-rnc' });
        expect(validateFixInput('rnc-client', '1-01-01063-2')).toEqual({ ok: true, patch: { rncCliente: COMPANY } });
        expect(validateFixInput('rnc-client', '123')).toEqual({ ok: false });
        // Dada por buena, no vuelve a salir.
        expect(codes(checkReceipt({ ...fiscal, reviewAccepted: ['client-rnc'] }, { companyRnc: COMPANY }))).toEqual([]);
    });
});

describe('nota para facturas de consumo (B02/E32)', () => {
    const consumo = { total: 500, subtotal: 423.73, itbis: 76.27, ncf: 'B0200000456' };

    test('por defecto sale en todas las de consumo; no marca la factura "por revisar"', () => {
        expect(receiptNotes(consumo)).toEqual([expect.objectContaining({ code: 'consumer-invoice' })]);
        expect(receiptNotes({ ...consumo, ncf: 'E320000000001' })).toEqual([expect.objectContaining({ code: 'consumer-invoice' })]);
        const review = receiptReviewState({ ocrStatus: 'extracted' }, consumo);
        expect(review.state).toBe('ok');
        expect(codes(review.notes)).toEqual(['consumer-invoice']);
    });

    test('con monto mínimo del proyecto: solo en facturas mayores a ese monto', () => {
        expect(receiptNotes(consumo, { consumerNoteMin: 1000 })).toEqual([]);
        expect(codes(receiptNotes({ ...consumo, total: 2500 }, { consumerNoteMin: 1000 }))).toEqual(['consumer-invoice']);
    });

    test('no sale en facturas de crédito fiscal ni sin NCF', () => {
        expect(receiptNotes({ ...consumo, ncf: 'B0100000456' })).toEqual([]);
        expect(receiptNotes({ ...consumo, ncf: '' })).toEqual([]);
    });
});
