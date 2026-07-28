import {
    normalizeReceiptOcr,
    applyReceiptOcrToMovement,
    applyReceiptOcrToForm,
    requestReceiptOcr,
    receiptRetryState
} from '../modules/features/pettycash/PettyCashReceiptOCR.js';

testRunner.addSuite('Caja chica — contrato OCR compartido', {

    'normaliza monto, datos fiscales y categoría permitida'() {
        const result = normalizeReceiptOcr({
            ok: true,
            total: 1250.5,
            emisor: 'Ferretería',
            fecha: '2026-07-28',
            categoria: 'Materiales',
            ncf: 'B01001',
            items: [{ descripcion: 'Cemento' }]
        }, ['Materiales', 'Otros']);

        testRunner.assertEquals(result.amount, 1250.5);
        testRunner.assertEquals(result.paidTo, 'Ferretería');
        testRunner.assertEquals(result.category, 'Materiales');
        testRunner.assertEquals(result.fiscal.ncf, 'B01001');
        testRunner.assertEquals(result.fiscal.items.length, 1);
        testRunner.assertEquals(result.got, true);
    },

    'rechaza categorías desconocidas sin perder los demás datos'() {
        const result = normalizeReceiptOcr({ subtotal: 90, categoria: 'Inventada' }, ['Otros']);
        testRunner.assertEquals(result.amount, 90);
        testRunner.assertEquals(result.category, null);
    },

    'aplica el mismo resultado a movimiento y formulario'() {
        const normalized = normalizeReceiptOcr({
            total: 500,
            emisor: 'Proveedor',
            concepto: 'Herramientas',
            fecha: '2026-07-27',
            rncEmisor: '123',
            itbis: 80
        });
        const movement = applyReceiptOcrToMovement({ amount: 0 }, normalized);
        const form = applyReceiptOcrToForm({ amount: '' }, normalized);

        testRunner.assertEquals(movement.amount, 500);
        testRunner.assertEquals(movement.paidTo, 'Proveedor');
        testRunner.assertEquals(movement.rncEmisor, '123');
        testRunner.assertEquals(form.amount, 500);
        testRunner.assertEquals(form.paidTo, 'Proveedor');
        testRunner.assertEquals(form.ocr.itbis, 80);
    },

    async 'envía el contrato esperado al webhook'() {
        let request = null;
        const fetchImpl = async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ ok: true, total: 10 }) };
        };
        const result = await requestReceiptOcr({
            url: 'https://example.test/ocr',
            idToken: 'token',
            imageDataUrl: 'data:image/jpeg;base64,YWJj',
            fetchImpl
        });

        const body = JSON.parse(request.options.body);
        testRunner.assertEquals(request.url, 'https://example.test/ocr');
        testRunner.assertEquals(body.idToken, 'token');
        testRunner.assertEquals(body.imageBase64, 'YWJj');
        testRunner.assertEquals(result.total, 10);
    },

    async 'propaga HTTP y respuestas vacías como error'() {
        let failedHttp = false;
        try {
            await requestReceiptOcr({
                url: 'x', idToken: 't', imageDataUrl: 'abc',
                fetchImpl: async () => ({ ok: false, status: 503 })
            });
        } catch (error) {
            failedHttp = error.message === 'HTTP 503';
        }
        testRunner.assert(failedHttp, 'debe reportar el código HTTP');
    }
});
testRunner.addSuite('Caja chica — política de reintentos OCR', {

    'sin conexión espera sin consumir intentos'() {
        const state = receiptRetryState(1, { online: false, now: 1000 });
        testRunner.assertEquals(state.attempts, 1);
        testRunner.assertEquals(state.queueStatus, 'waiting-network');
        testRunner.assertEquals(state.nextRetryAt, null);
    },

    'los fallos conectados esperan progresivamente'() {
        const first = receiptRetryState(0, { online: true, now: 1000 });
        const second = receiptRetryState(1, { online: true, now: 1000 });
        testRunner.assertEquals(first.queueStatus, 'retry-wait');
        testRunner.assertEquals(first.nextRetryAt, 6000);
        testRunner.assertEquals(second.nextRetryAt, 31000);
    },

    'el tercer fallo queda pausado para intervención manual'() {
        const state = receiptRetryState(2, { online: true, now: 1000 });
        testRunner.assertEquals(state.attempts, 3);
        testRunner.assertEquals(state.queueStatus, 'paused');
        testRunner.assertEquals(state.nextRetryAt, null);
    }

});
