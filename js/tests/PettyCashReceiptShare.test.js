/**
 * Descargar o compartir la foto de la factura que se está viendo.
 * Compartir con archivo solo existe donde el navegador lo permite; si no,
 * se descarga y se avisa, sin fingir que se envió.
 */
import { receiptFileName, downloadReceipt, shareReceipt } from '../modules/features/pettycash/PettyCashReceiptShare.js';

const blobOf = (type = 'image/jpeg') => new Blob(['x'], { type });
const fetchOk = (type) => jest.fn().mockResolvedValue({ ok: true, blob: async () => blobOf(type) });

describe('receiptFileName', () => {
    test('usa el NCF; sin NCF, el número de registro; y la extensión del tipo', () => {
        expect(receiptFileName({ ncf: 'B0100000123', recordNumber: 7 }, 'image/jpeg')).toBe('factura-B0100000123.jpg');
        expect(receiptFileName({ ncf: '', recordNumber: 7 }, 'image/webp')).toBe('factura-007.webp');
        expect(receiptFileName({ id: 'abc' }, 'application/pdf')).toBe('factura-abc.pdf');
        expect(receiptFileName({ ncf: 'B01 000/123' }, 'image/png')).toBe('factura-B01000123.png');
        expect(receiptFileName({}, null)).toBe('factura.jpg');
    });
});

describe('downloadReceipt', () => {
    test('baja el archivo con un enlace temporal y lo libera', async () => {
        const click = jest.fn();
        const a = { click, set href(v) { this._h = v; }, get href() { return this._h; }, style: {} };
        const doc = { createElement: jest.fn(() => a), body: { appendChild: jest.fn(), removeChild: jest.fn() } };
        const urlApi = { createObjectURL: jest.fn(() => 'blob:tmp'), revokeObjectURL: jest.fn() };
        jest.useFakeTimers();
        const result = await downloadReceipt({ url: 'blob:abc', mime: 'image/jpeg', name: 'factura-1.jpg', doc, urlApi, fetchImpl: fetchOk() });
        expect(result).toEqual({ status: 'downloaded', name: 'factura-1.jpg' });
        expect(a.download).toBe('factura-1.jpg');
        expect(click).toHaveBeenCalledTimes(1);
        expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();   // se libera con un pequeño retraso para que el navegador termine
        jest.advanceTimersByTime(1000);
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:tmp');
        jest.useRealTimers();
    });
    test('si no se puede leer el archivo, lo dice', async () => {
        const result = await downloadReceipt({ url: 'https://x', mime: 'image/jpeg', name: 'f.jpg', fetchImpl: jest.fn().mockResolvedValue({ ok: false }) });
        expect(result.status).toBe('error');
    });
});

describe('shareReceipt', () => {
    test('con compartir archivos disponible, abre el menú del sistema con la foto', async () => {
        const share = jest.fn().mockResolvedValue();
        const nav = { canShare: jest.fn(() => true), share };
        const result = await shareReceipt({ url: 'blob:abc', mime: 'image/jpeg', name: 'factura-1.jpg', nav, fetchImpl: fetchOk(), FileCtor: File });
        expect(result).toEqual({ status: 'shared' });
        const arg = share.mock.calls[0][0];
        expect(arg.files[0].name).toBe('factura-1.jpg');
        expect(arg.files[0].type).toBe('image/jpeg');
    });
    test('si la persona cierra el menú, no es un error', async () => {
        const nav = { canShare: () => true, share: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })) };
        expect((await shareReceipt({ url: 'u', mime: 'image/jpeg', name: 'f.jpg', nav, fetchImpl: fetchOk(), FileCtor: File })).status).toBe('cancelled');
    });
    test('sin compartir archivos, descarga y lo avisa (no finge que se envió)', async () => {
        const click = jest.fn();
        const a = { click, style: {} };
        const doc = { createElement: () => a, body: { appendChild() {}, removeChild() {} } };
        const urlApi = { createObjectURL: () => 'blob:tmp', revokeObjectURL() {} };
        const result = await shareReceipt({ url: 'u', mime: 'image/jpeg', name: 'f.jpg', nav: {}, fetchImpl: fetchOk(), doc, urlApi, FileCtor: File });
        expect(result.status).toBe('downloaded');
        expect(click).toHaveBeenCalled();
    });
    test('un fallo real al compartir se informa como error', async () => {
        const nav = { canShare: () => true, share: jest.fn().mockRejectedValue(new Error('boom')) };
        expect((await shareReceipt({ url: 'u', mime: 'image/jpeg', name: 'f.jpg', nav, fetchImpl: fetchOk(), FileCtor: File })).status).toBe('error');
    });
});
