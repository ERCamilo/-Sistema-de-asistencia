/**
 * Foto original para volver a leer una factura. Cuando el respaldo en la nube
 * ya se verificó, el teléfono borra el original y solo deja una miniatura de
 * 480 px: esa miniatura NUNCA debe llegar al lector (daba montos mal leídos).
 */
import { resolveReceiptOriginal } from '../modules/features/pettycash/PettyCashReceiptSource.js';

const blobOf = (type = 'image/webp', text = 'original') => new Blob([text], { type });
const PREVIEW = 'data:image/jpeg;base64,PREVIEW480';

describe('resolveReceiptOriginal', () => {
    test('usa el original guardado en el teléfono con su tipo real', async () => {
        const getReceipt = jest.fn().mockResolvedValue({ originalBlob: blobOf('image/webp'), originalType: 'image/webp', originalName: 'f.webp', previewDataUrl: PREVIEW });
        const lookup = jest.fn();
        const out = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup });
        expect(out).toMatchObject({ ok: true, origin: 'local', type: 'image/webp', name: 'f.webp' });
        expect(out.blob.size).toBeGreaterThan(0);
        expect(lookup).not.toHaveBeenCalled();
    });

    test('sin original (ya podado) lo baja del respaldo en la nube', async () => {
        const getReceipt = jest.fn().mockResolvedValue({ previewDataUrl: PREVIEW, remotePath: 'u/g1.webp', localOriginalPrunedAt: 5 });
        const lookup = jest.fn().mockResolvedValue({ signedUrl: 'https://cdn/x?sig=1', receipt: { mime_type: 'image/webp' } });
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, blob: async () => blobOf('image/webp', 'remoto-grande') });
        const out = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup, fetchImpl });
        expect(lookup).toHaveBeenCalledWith('g1');
        expect(fetchImpl).toHaveBeenCalledWith('https://cdn/x?sig=1');
        expect(out).toMatchObject({ ok: true, origin: 'remote', type: 'image/webp' });
        expect(out.dataUrl).toBeUndefined();
    });

    test('sin original ni respaldo disponible NO devuelve la miniatura', async () => {
        const getReceipt = jest.fn().mockResolvedValue({ previewDataUrl: PREVIEW });
        const out = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup: jest.fn().mockRejectedValue(new Error('sin red')), fetchImpl: jest.fn() });
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('no-original');
        expect(JSON.stringify(out)).not.toContain('PREVIEW480');
    });

    test('si la nube responde sin enlace o la descarga falla, no hay original', async () => {
        const getReceipt = jest.fn().mockResolvedValue({ previewDataUrl: PREVIEW });
        const noLink = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup: jest.fn().mockResolvedValue({}), fetchImpl: jest.fn() });
        expect(noLink).toMatchObject({ ok: false, reason: 'no-original' });
        const badFetch = await resolveReceiptOriginal({
            txId: 'g1', getReceipt,
            lookup: jest.fn().mockResolvedValue({ signedUrl: 'https://cdn/x' }),
            fetchImpl: jest.fn().mockResolvedValue({ ok: false, blob: async () => blobOf() })
        });
        expect(badFetch).toMatchObject({ ok: false, reason: 'no-original' });
    });

    test('un registro antiguo con la imagen completa (dataUrl) sí sirve; la miniatura no', async () => {
        const full = 'data:image/jpeg;base64,/9j/FULL1600';
        const getReceipt = jest.fn().mockResolvedValue({ dataUrl: full, previewDataUrl: PREVIEW });
        const out = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup: jest.fn(), fetchImpl: jest.fn() });
        expect(out).toMatchObject({ ok: true, origin: 'legacy', dataUrl: full, type: 'image/jpeg' });
    });

    test('si leer el teléfono falla, igual intenta la nube', async () => {
        const getReceipt = jest.fn().mockRejectedValue(new Error('idb'));
        const lookup = jest.fn().mockResolvedValue({ signedUrl: 'https://cdn/y' });
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, blob: async () => blobOf('image/jpeg') });
        const out = await resolveReceiptOriginal({ txId: 'g1', getReceipt, lookup, fetchImpl });
        expect(out).toMatchObject({ ok: true, origin: 'remote', type: 'image/jpeg' });
    });
});
