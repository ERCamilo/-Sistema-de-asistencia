jest.mock('../modules/features/pettycash/PettyCashPhoto.js', () => ({
    compressImage: jest.fn(async () => 'data:image/jpeg;base64,YWJj')
}));

import { createReceiptQueueProcessor } from '../modules/features/pettycash/PettyCashReceiptProcessor.js';

function buildHarness({ online = true, jobs = null, movement = null, fetchResult = null } = {}) {
    const records = jobs || [{
        txId: 'mov-1',
        originalBlob: new Blob(['original'], { type: 'image/jpeg' }),
        queueStatus: 'queued',
        ocrStatus: 'pending',
        attempts: 0
    }];
    const movements = [movement || { id: 'mov-1', amount: 0 }];
    const updates = [];
    const saved = [];
    const timers = [];
    const store = {
        listReceiptJobs: jest.fn(async () => records),
        updateReceiptJob: jest.fn(async (txId, patch) => {
            updates.push({ txId, patch });
            const record = records.find((item) => item.txId === txId);
            if (record) Object.assign(record, patch);
            return record;
        })
    };
    global.fetch = jest.fn(async () => fetchResult || ({
        ok: true,
        json: async () => ({ ok: true, total: 125, emisor: 'Proveedor', fecha: '2026-07-28' })
    }));
    const processor = createReceiptQueueProcessor({
        receiptStore: store,
        getMovement: (id) => movements.find((item) => item.id === id),
        saveMovement: async (item) => { saved.push({ ...item }); },
        getIdToken: async () => 'token',
        getOcrUrl: () => 'https://example.test/ocr',
        allowedCategories: ['Materiales'],
        isOnline: () => online,
        now: () => 1000,
        setTimer: (callback, delay) => {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimer: () => {}
    });
    return { processor, records, movements, updates, saved, timers, store };
}

testRunner.addSuite('Caja chica — procesador persistente de facturas', {

    async 'procesa el original y deja el movimiento para revisión'() {
        const harness = buildHarness();
        const result = await harness.processor.process();

        testRunner.assertEquals(result.processed, 1);
        testRunner.assertEquals(harness.movements[0].amount, 125);
        testRunner.assertEquals(harness.movements[0].paidTo, 'Proveedor');
        testRunner.assertEquals(harness.movements[0].reviewPending, true);
        testRunner.assertEquals(harness.records[0].queueStatus, 'awaiting-review');
        testRunner.assertEquals(harness.records[0].ocrStatus, 'extracted');
        testRunner.assertEquals(harness.saved.length, 1);
    },

    async 'sin conexión pausa sin consumir intentos ni llamar al webhook'() {
        const harness = buildHarness({ online: false });
        await harness.processor.process();

        testRunner.assertEquals(harness.records[0].queueStatus, 'waiting-network');
        testRunner.assertEquals(harness.records[0].attempts, 0);
        testRunner.assertEquals(global.fetch.mock.calls.length, 0);
    },

    async 'un fallo conectado queda programado para reintento'() {
        const harness = buildHarness({
            fetchResult: { ok: false, status: 503, json: async () => null }
        });
        const result = await harness.processor.process();

        testRunner.assertEquals(result.failed, 1);
        testRunner.assertEquals(harness.records[0].queueStatus, 'retry-wait');
        testRunner.assertEquals(harness.records[0].attempts, 1);
        testRunner.assertEquals(harness.records[0].nextRetryAt, 6000);
        testRunner.assertEquals(harness.timers.length, 1);
        testRunner.assertEquals(harness.timers[0].delay, 5000);
    },

    async 'una factura pausada sólo continúa mediante acción manual'() {
        const harness = buildHarness({
            jobs: [{
                txId: 'mov-1',
                originalBlob: new Blob(['original']),
                queueStatus: 'paused',
                ocrStatus: 'failed',
                attempts: 3
            }]
        });
        const automatic = await harness.processor.process();
        const manual = await harness.processor.process({ force: true });

        testRunner.assertEquals(automatic.processed, 0);
        testRunner.assertEquals(manual.processed, 1);
    },

    async 'un borrador sin movimiento no crea datos vacíos'() {
        const harness = buildHarness({
            jobs: [{
                txId: 'draft-1',
                originalBlob: new Blob(['original']),
                queueStatus: 'queued',
                ocrStatus: 'pending',
                attempts: 0
            }],
            movement: { id: 'otro', amount: 0 }
        });
        const result = await harness.processor.process();

        testRunner.assertEquals(result.skipped, 1);
        testRunner.assertEquals(harness.saved.length, 0);
        testRunner.assertEquals(global.fetch.mock.calls.length, 0);
    }
});
