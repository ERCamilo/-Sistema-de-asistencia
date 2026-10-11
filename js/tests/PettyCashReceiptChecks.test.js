/**
 * Revisiones locales de una factura leída (sin servicios externos).
 * Deciden qué se marca "por revisar" en la vista previa de la cámara.
 */
import { isValidRnc, isValidNcf, checkReceipt, receiptReviewState } from '../modules/features/pettycash/PettyCashReceiptChecks.js';

// Dígito verificador de cédula (módulo 10, pesos 1-2) para armar casos válidos.
const cedula = (ten) => {
    const sum = [...ten].reduce((acc, ch, i) => {
        let p = Number(ch) * (i % 2 === 0 ? 1 : 2);
        if (p >= 10) p -= 9;
        return acc + p;
    }, 0);
    return ten + ((10 - (sum % 10)) % 10);
};

describe('isValidRnc', () => {
    test('RNC de 9 dígitos con dígito verificador (módulo 11)', () => {
        expect(isValidRnc('101010632')).toBe(true);
        expect(isValidRnc('1-01-01063-2')).toBe(true);
        expect(isValidRnc('101010633')).toBe(false);
    });
    test('cédula de 11 dígitos (módulo 10)', () => {
        const ok = cedula('0011234567');
        expect(isValidRnc(ok)).toBe(true);
        expect(isValidRnc(`${ok.slice(0, 3)}-${ok.slice(3, 10)}-${ok.slice(10)}`)).toBe(true);
        expect(isValidRnc(ok.slice(0, 10) + ((Number(ok[10]) + 1) % 10))).toBe(false);
    });
    test('largo incorrecto o vacío', () => {
        expect(isValidRnc('12345')).toBe(false);
        expect(isValidRnc('')).toBe(false);
        expect(isValidRnc(null)).toBe(false);
    });
});

describe('isValidNcf', () => {
    test('NCF en papel (B + tipo + 8) y electrónico (E + tipo + 10)', () => {
        expect(isValidNcf('B0100000123')).toBe(true);
        expect(isValidNcf('b02 0000 0456')).toBe(true);
        expect(isValidNcf('B1400000001')).toBe(true);
        expect(isValidNcf('E310000000123')).toBe(true);
        expect(isValidNcf('E450000000123')).toBe(true);
    });
    test('tipo inexistente o largo incorrecto', () => {
        expect(isValidNcf('B0900000001')).toBe(false);
        expect(isValidNcf('B01000001')).toBe(false);
        expect(isValidNcf('E990000000123')).toBe(false);
        expect(isValidNcf('')).toBe(false);
    });
});

describe('checkReceipt', () => {
    const period = { openingDate: '2026-10-01', closingDate: '2026-10-15' };
    const good = { id: 'm1', amount: 1180, subtotal: 1000, itbis: 180, total: 1180, rncEmisor: '101010632', ncf: 'B0100000123', date: '2026-10-05' };

    test('una factura coherente no tiene problemas', () => {
        expect(checkReceipt(good, { period, movements: [good] })).toEqual([]);
    });

    test('subtotal + ITBIS que no da el total (tolera redondeo de 1 peso)', () => {
        expect(checkReceipt({ ...good, total: 1180.6 }, { period })).toEqual([]);
        const issues = checkReceipt({ ...good, total: 1280, amount: 1280 }, { period });
        expect(issues.map(i => i.code)).toEqual(['total-mismatch']);
        expect(issues[0].field).toBe('total');
    });

    test('RNC inválido y NCF con formato raro', () => {
        const codes = checkReceipt({ ...good, rncEmisor: '101010633', ncf: 'X12' }, { period }).map(i => i.code);
        expect(codes).toEqual(expect.arrayContaining(['rnc-invalid', 'ncf-format']));
    });

    test('mismo NCF y emisor en otro gasto → posible duplicado', () => {
        const other = { ...good, id: 'm2' };
        const issues = checkReceipt(good, { period, movements: [good, other] });
        expect(issues.map(i => i.code)).toEqual(['ncf-duplicate']);
    });

    test('fecha fuera del periodo', () => {
        expect(checkReceipt({ ...good, date: '2026-09-20' }, { period }).map(i => i.code)).toEqual(['date-outside-period']);
    });

    test('sin total leído', () => {
        expect(checkReceipt({ id: 'm3', amount: 0 }, { period }).map(i => i.code)).toEqual(['missing-total']);
    });

    test('campos ausentes no se marcan como error (solo lo que se leyó)', () => {
        expect(checkReceipt({ id: 'm4', amount: 500, date: '2026-10-02' }, { period })).toEqual([]);
    });
});

describe('receiptReviewState', () => {
    const period = { openingDate: '2026-10-01', closingDate: '2026-10-15' };
    const mov = { id: 'm1', amount: 590, subtotal: 500, itbis: 90, total: 590, date: '2026-10-03' };

    test.each([
        [{ ocrStatus: 'pending', queueStatus: 'queued' }, 'reading'],
        [{ ocrStatus: 'processing', queueStatus: 'processing' }, 'reading'],
        [{ ocrStatus: 'pending', queueStatus: 'waiting-network' }, 'waiting'],
        [{ ocrStatus: 'failed', queueStatus: 'retry-wait' }, 'failed'],
        [{ ocrStatus: 'needs-review', queueStatus: 'awaiting-review' }, 'review'],
        [{ ocrStatus: 'extracted', queueStatus: 'awaiting-review' }, 'ok']
    ])('%j → %s', (job, state) => {
        expect(receiptReviewState(job, mov, { period }).state).toBe(state);
    });

    test('leída pero con problemas → review, con sus motivos', () => {
        const r = receiptReviewState({ ocrStatus: 'extracted' }, { ...mov, total: 700, amount: 700 }, { period });
        expect(r.state).toBe('review');
        expect(r.issues[0].code).toBe('total-mismatch');
    });

    test('en cola: indica el motivo (sin conexión, sin sesión o pausada)', () => {
        expect(receiptReviewState({ ocrStatus: 'pending', queueStatus: 'waiting-session' }, mov).reason).toBe('session');
        expect(receiptReviewState({ ocrStatus: 'pending', queueStatus: 'waiting-network' }, mov).reason).toBe('network');
        expect(receiptReviewState({ ocrStatus: 'pending', queueStatus: 'paused' }, mov).reason).toBe('paused');
    });
});
