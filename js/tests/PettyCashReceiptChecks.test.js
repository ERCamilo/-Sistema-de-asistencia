/**
 * Revisiones locales de una factura leída (sin servicios externos).
 * Deciden qué se marca "por revisar" en la vista previa de la cámara.
 */
import { isValidRnc, isValidNcf, checkReceipt, receiptReviewState, parseReceiptDate } from '../modules/features/pettycash/PettyCashReceiptChecks.js';

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
        const issues = checkReceipt({ ...good, total: 1300, amount: 1300 }, { period });
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
        [{ ocrStatus: 'needs-review', queueStatus: 'awaiting-review' }, 'failed'],
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

describe('detalles para mostrar lo leído frente a lo calculado', () => {
    const period = { openingDate: '2026-10-01', closingDate: '2026-10-15' };
    const good = { id: 'm1', amount: 1180, subtotal: 1000, itbis: 180, total: 1180, rncEmisor: '101010632', ncf: 'B0100000123', date: '2026-10-05' };
    const byCode = (issues, code) => issues.find(i => i.code === code);

    test('total que no cuadra: total leído y subtotal + ITBIS', () => {
        const issue = byCode(checkReceipt({ ...good, total: 1300, amount: 1300 }, { period }), 'total-mismatch');
        expect(issue.detail).toEqual({ read: 1300, calc: 1180 });
    });

    test('ITBIS mayor que el 18% del subtotal: siempre es un error', () => {
        const issue = byCode(checkReceipt({ ...good, itbis: 200, total: 1200, amount: 1200 }, { period }), 'itbis-rate');
        expect(issue).toMatchObject({ field: 'itbis', detail: { read: 200, calc: 180, base: 1000 } });
        expect(issue.message).toMatch(/ITBIS/);
    });

    test('ITBIS menor que el 18%: se avisa, pero puede ser correcto (exentos o 16%)', () => {
        const issue = byCode(checkReceipt({ ...good, itbis: 120, total: 1120, amount: 1120 }, { period }), 'itbis-rate');
        expect(issue.detail).toMatchObject({ read: 120, calc: 180 });
        expect(issue.hint).toMatch(/exent|16%/);
    });

    test('ITBIS al 16% o en cero no se marca', () => {
        expect(byCode(checkReceipt({ ...good, itbis: 160, total: 1160, amount: 1160 }, { period }), 'itbis-rate')).toBeUndefined();
        expect(byCode(checkReceipt({ ...good, itbis: 0, total: 1000, amount: 1000 }, { period }), 'itbis-rate')).toBeUndefined();
    });

    test('NCF incompleto: muestra lo detectado y cuántos dígitos faltan', () => {
        const issue = byCode(checkReceipt({ ...good, ncf: 'B01000012' }, { period }), 'ncf-format');
        expect(issue.message).toMatch(/incompleto/i);
        expect(issue.detail).toEqual({ read: 'B01000012', missing: 2 });
        const e = byCode(checkReceipt({ ...good, ncf: 'E3100000001' }, { period }), 'ncf-format');
        expect(e.detail.missing).toBe(2);
    });

    test('RNC con dígitos de menos', () => {
        const issue = byCode(checkReceipt({ ...good, rncEmisor: '10101063' }, { period }), 'rnc-invalid');
        expect(issue.detail).toEqual({ read: '10101063', missing: 1 });
    });

    test('fecha con día y mes invertidos: propone la que cae dentro del periodo', () => {
        const issue = byCode(checkReceipt({ ...good, date: '2026-11-10' }, { period }), 'date-outside-period');
        expect(issue.detail).toEqual({ read: '2026-11-10', suggestion: '2026-10-11' });
    });

    test('fecha en formato día/mes/año también se revisa', () => {
        expect(checkReceipt({ ...good, date: '05/10/2026' }, { period })).toEqual([]);
        const issue = byCode(checkReceipt({ ...good, date: '10/11/2026' }, { period }), 'date-outside-period');
        expect(issue.detail).toEqual({ read: '10/11/2026', suggestion: '2026-10-11' });
    });

    test('sin sugerencia si al invertirla tampoco cae dentro', () => {
        const issue = byCode(checkReceipt({ ...good, date: '2026-09-20' }, { period }), 'date-outside-period');
        expect(issue.detail).toEqual({ read: '2026-09-20', suggestion: null });
    });

    test('periodo abierto: usa ±30 días de hoy como referencia', () => {
        const open = { openingDate: '2026-09-01', closingDate: null };
        const today = '2026-10-12';
        expect(checkReceipt({ ...good, date: '2026-10-08' }, { period: open, today })).toEqual([]);
        const issue = byCode(checkReceipt({ ...good, date: '2026-12-10' }, { period: open, today }), 'date-outside-period');
        expect(issue.detail.suggestion).toBe('2026-10-12');
    });

    test('parseReceiptDate entiende ISO y día/mes/año', () => {
        expect(parseReceiptDate('2026-10-05')).toBe('2026-10-05');
        expect(parseReceiptDate('5/10/2026')).toBe('2026-10-05');
        expect(parseReceiptDate('05-10-26')).toBe('2026-10-05');
        expect(parseReceiptDate('31/02/2026')).toBeNull();
        expect(parseReceiptDate('ayer')).toBeNull();
    });
});

describe('posición del dato en la foto (cuando el lector la envíe)', () => {
    const period = { openingDate: '2026-10-01', closingDate: '2026-10-15' };
    test('cada aviso lleva el recuadro de su campo si existe', () => {
        const mov = { id: 'm1', amount: 1300, subtotal: 1000, itbis: 180, total: 1300, date: '2026-10-05',
            ocrBoxes: { total: [880, 100, 910, 900], ncf: 'basura' } };
        const issues = checkReceipt(mov, { period });
        expect(issues.find(i => i.code === 'total-mismatch').box).toEqual([880, 100, 910, 900]);
        const ncfIssue = checkReceipt({ ...mov, total: 1180, amount: 1180, ncf: 'X1' }, { period }).find(i => i.code === 'ncf-format');
        expect(ncfIssue.box).toBeNull();
    });
});

describe('sin datos leídos', () => {
    test('needs-review (el lector no encontró nada) se muestra como no leída', () => {
        const r = receiptReviewState({ ocrStatus: 'needs-review' }, { id: 'm1' });
        expect(r.state).toBe('failed');
        expect(r.issues[0].code).toBe('not-read');
    });
});

describe('corregir desde la vista previa', () => {
    // eslint-disable-next-line global-require
    const { fixesFor, validateFixInput } = require('../modules/features/pettycash/PettyCashReceiptChecks.js');
    const period = { openingDate: '2026-10-01', closingDate: '2026-10-15' };

    test('total que no cuadra: usar subtotal + ITBIS, o dar por bueno el leído', () => {
        const fixes = fixesFor({ code: 'total-mismatch', detail: { read: 1300, calc: 1180 } });
        expect(fixes).toEqual([
            { kind: 'apply', patch: { total: 1180, amount: 1180 }, value: 1180 },
            { kind: 'accept', code: 'total-mismatch' }
        ]);
    });

    test('ITBIS: usar el calculado o dejar el leído', () => {
        expect(fixesFor({ code: 'itbis-rate', detail: { read: 120, calc: 180, base: 1000 } })[0]).toEqual({ kind: 'apply', patch: { itbis: 180 }, value: 180 });
    });

    test('fecha: cambiar a la propuesta; sin propuesta, escribirla', () => {
        expect(fixesFor({ code: 'date-outside-period', detail: { read: '10/11/2026', suggestion: '2026-10-11' } })[0])
            .toEqual({ kind: 'apply', patch: { date: '2026-10-11', fechaEmision: '2026-10-11' }, value: '2026-10-11' });
        expect(fixesFor({ code: 'date-outside-period', detail: { read: '2026-09-20', suggestion: null } })[0])
            .toMatchObject({ kind: 'input', field: 'date', validate: 'date' });
    });

    test('NCF y RNC incompletos: completar escribiendo, empezando por lo detectado', () => {
        expect(fixesFor({ code: 'ncf-format', detail: { read: 'B01000012', missing: 2 } })[0])
            .toEqual({ kind: 'input', field: 'ncf', validate: 'ncf', value: 'B01000012' });
        expect(fixesFor({ code: 'rnc-invalid', detail: { read: '10101063', missing: 1 } })[0])
            .toEqual({ kind: 'input', field: 'rncEmisor', validate: 'rnc', value: '10101063' });
    });

    test('NCF repetido: solo confirmar que es otra factura; sin datos: nada aquí', () => {
        expect(fixesFor({ code: 'ncf-duplicate' })).toEqual([{ kind: 'accept', code: 'ncf-duplicate' }]);
        expect(fixesFor({ code: 'not-read' })).toEqual([]);
    });

    test('valida lo que se escribe y devuelve el cambio a guardar', () => {
        expect(validateFixInput('ncf', 'b01 000 0012')).toEqual({ ok: false });
        expect(validateFixInput('ncf', 'b01 0000 0123')).toEqual({ ok: true, patch: { ncf: 'B0100000123' } });
        expect(validateFixInput('rnc', '1-01-01063-2')).toEqual({ ok: true, patch: { rncEmisor: '101010632' } });
        expect(validateFixInput('rnc', '101010633')).toEqual({ ok: false });
        expect(validateFixInput('amount', '1,180.50')).toEqual({ ok: true, patch: { total: 1180.5, amount: 1180.5 } });
        expect(validateFixInput('amount', '0')).toEqual({ ok: false });
        expect(validateFixInput('date', '11/10/2026')).toEqual({ ok: true, patch: { date: '2026-10-11', fechaEmision: '2026-10-11' } });
    });

    test('un aviso dado por bueno no vuelve a salir', () => {
        const mov = { id: 'm1', amount: 1120, subtotal: 1000, itbis: 120, total: 1120, date: '2026-10-05', reviewAccepted: ['itbis-rate'] };
        expect(checkReceipt(mov, { period })).toEqual([]);
        expect(receiptReviewState({ ocrStatus: 'extracted' }, mov, { period }).state).toBe('ok');
    });
});
