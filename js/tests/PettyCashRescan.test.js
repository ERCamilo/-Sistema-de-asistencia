/**
 * Resultado de volver a leer una factura: qué cambió, para decírselo a la
 * persona (antes el botón no mostraba nada) y para quitar del borrador lo que
 * el lector corrigió.
 */
import { rescanSummary } from '../modules/features/pettycash/PettyCashRescan.js';

describe('rescanSummary', () => {
    test('dice qué datos cambiaron y cuáles claves tocar en el borrador', () => {
        const before = { total: 1098, itbis: 153, paidTo: 'Comedor', date: '2026-10-11', fechaEmision: '2026-10-11' };
        const after = { ...before, total: 1000, itbis: 180, date: '2026-11-10', fechaEmision: '2026-11-10' };
        const out = rescanSummary(before, after, true);
        expect(out.tone).toBe('ok');
        expect(out.keys.sort()).toEqual(['date', 'fechaEmision', 'itbis', 'total']);
        expect(out.text).toContain('Total');
        expect(out.text).toContain('ITBIS');
        expect(out.text).toContain('Fecha');
        expect(out.text.match(/Fecha/g)).toHaveLength(1); // date y fechaEmision cuentan como una
    });

    test('si todo es igual, lo dice', () => {
        const mov = { total: 5, itbis: 1 };
        const out = rescanSummary(mov, { ...mov }, true);
        expect(out.keys).toEqual([]);
        expect(out.text).toMatch(/mismos/);
        expect(out.tone).toBe('ok');
    });

    test('si el lector no encontró nada, avisa con tono de advertencia', () => {
        const out = rescanSummary({ total: 5 }, { total: 5 }, false);
        expect(out.tone).toBe('warn');
        expect(out.text).toMatch(/No se encontraron datos/);
    });

    test('un dato nuevo (antes vacío) cuenta como cambio', () => {
        const out = rescanSummary({ total: 5 }, { total: 5, ncf: 'B0100000001' }, true);
        expect(out.keys).toEqual(['ncf']);
        expect(out.text).toContain('NCF');
    });

    test('compara importes sin falsos cambios por tipo (texto vs número)', () => {
        const out = rescanSummary({ total: '1098' }, { total: 1098 }, true);
        expect(out.keys).toEqual([]);
    });
});
