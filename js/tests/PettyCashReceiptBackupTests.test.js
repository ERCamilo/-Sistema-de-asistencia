import {
    isReceiptReadyForBackup,
    uploadReceiptBackup,
    lookupReceiptBackup
} from '../modules/features/pettycash/PettyCashReceiptBackup.js';

describe('PettyCashReceiptBackup', () => {
    test('solo respalda originales confirmados que aún no se subieron', () => {
        const originalBlob = new Blob(['receipt'], { type: 'image/jpeg' });
        expect(isReceiptReadyForBackup({ originalBlob, userConfirmedAt: 10, uploadStatus: 'deferred' })).toBe(true);
        expect(isReceiptReadyForBackup({ originalBlob, userConfirmedAt: null, uploadStatus: 'deferred' })).toBe(false);
        expect(isReceiptReadyForBackup({ originalBlob, userConfirmedAt: 10, uploadStatus: 'uploaded' })).toBe(false);
        expect(isReceiptReadyForBackup({
            originalBlob,
            userConfirmedAt: 10,
            uploadStatus: 'retry-wait',
            nextUploadRetryAt: 200
        }, 100)).toBe(false);
    });

    test('envía un upload idempotente con imagen y metadatos', async () => {
        const fetchImpl = jest.fn(async (_url, options) => ({
            ok: true,
            json: async () => ({ ok: true, path: 'petty-cash-receipts/u/mov-1.jpg' })
        }));
        await uploadReceiptBackup({
            url: 'https://example.test/upload',
            idToken: 'firebase-token',
            txId: 'mov-1',
            imageDataUrl: 'data:image/jpeg;base64,YWJj',
            mimeType: 'image/jpeg',
            projectId: 'project-1',
            periodId: 'period-1',
            userConfirmedAt: 123,
            movement: { amount: 100 },
            fetchImpl
        });

        const [, options] = fetchImpl.mock.calls[0];
        expect(JSON.parse(options.body)).toEqual(expect.objectContaining({
            action: 'upload',
            idToken: 'firebase-token',
            txId: 'mov-1',
            imageBase64: 'YWJj',
            projectId: 'project-1',
            periodId: 'period-1',
            userConfirmedAt: 123,
            movement: { amount: 100 }
        }));
    });

    test('recupera una URL firmada sin volver a enviar la foto', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            json: async () => ({ ok: true, signedUrl: 'https://signed.test/receipt' })
        }));
        const result = await lookupReceiptBackup({
            url: 'https://example.test/upload',
            idToken: 'firebase-token',
            txId: 'mov-1',
            fetchImpl
        });

        expect(result.signedUrl).toBe('https://signed.test/receipt');
        const [, options] = fetchImpl.mock.calls[0];
        expect(JSON.parse(options.body)).toEqual({
            action: 'lookup',
            idToken: 'firebase-token',
            txId: 'mov-1'
        });
    });

    test('respalda un PDF nativo y conserva su cantidad de páginas', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            json: async () => ({ ok: true })
        }));
        await uploadReceiptBackup({
            url: 'https://example.test/upload',
            idToken: 'firebase-token',
            txId: 'mov-pdf',
            fileDataUrl: 'data:application/pdf;base64,JVBERg==',
            mimeType: 'application/pdf',
            originalName: 'factura.pdf',
            pageCount: 3,
            fetchImpl
        });
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.fileBase64).toBe('JVBERg==');
        expect(body.imageBase64).toBeUndefined();
        expect(body.mimeType).toBe('application/pdf');
        expect(body.pageCount).toBe(3);
    });

    test('propaga el código y estado del servidor', async () => {
        const lookup = lookupReceiptBackup({
            url: 'https://example.test/upload',
            idToken: 'firebase-token',
            txId: 'mov-1',
            fetchImpl: async () => ({
                ok: false,
                status: 404,
                json: async () => ({ ok: false, error: 'RECEIPT_NOT_FOUND' })
            })
        });

        await expect(lookup).rejects.toMatchObject({
            code: 'RECEIPT_NOT_FOUND',
            status: 404,
            message: expect.stringContaining('RECEIPT_NOT_FOUND')
        });
    });
});
