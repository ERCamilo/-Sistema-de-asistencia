/**
 * La foto va al lector con el ancho de la cámara con que se tomó: la 2.1 guarda `ocrMaxWidth`
 * (2800) en el trabajo de la cola; las fotos de antes o de la 2.0 siguen con el de siempre.
 */
import { createReceiptQueueProcessor } from '../modules/features/pettycash/PettyCashReceiptProcessor.js';

const run = async (job) => {
    const prepareForOcr = jest.fn(async () => { throw new Error('alto aquí'); });
    const processor = createReceiptQueueProcessor({
        receiptStore: { listReceiptJobs: async () => [job], updateReceiptJob: jest.fn(async () => ({})) },
        getMovement: () => ({ id: job.txId }),
        saveMovement: jest.fn(),
        getIdToken: async () => 'token',
        getOcrUrl: () => 'https://example.test/ocr',
        isOnline: () => true,
        setTimer: () => 0,
        clearTimer: () => {},
        prepareForOcr
    });
    await processor.process({ txIds: [job.txId] });
    return prepareForOcr;
};
const blob = new Blob(['x'], { type: 'image/webp' });

test('cámara 2.1: el lector recibe hasta 2800 px', async () => {
    const prepare = await run({ txId: 't1', queueStatus: 'queued', ocrStatus: 'pending', originalBlob: blob, ocrMaxWidth: 2800 });
    expect(prepare).toHaveBeenCalledWith(blob, { maxWidth: 2800 });
});

test('fotos de antes o de la cámara 2.0: el ancho de siempre', async () => {
    const prepare = await run({ txId: 't2', queueStatus: 'queued', ocrStatus: 'pending', originalBlob: blob });
    expect(prepare).toHaveBeenCalledWith(blob, {});
});
