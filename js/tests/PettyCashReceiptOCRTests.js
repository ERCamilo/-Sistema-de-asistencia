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

    'conserva descuento, propina, exento e itbisIncluido (false incluido) en el gasto'() {
        const n = normalizeReceiptOcr({ total: 10, descuento: 2, propina: 1, exento: 3, itbisIncluido: false });
        testRunner.assertEquals(n.fiscal.descuento, 2);
        testRunner.assertEquals(n.fiscal.propina, 1);
        testRunner.assertEquals(n.fiscal.exento, 3);
        testRunner.assertEquals(n.fiscal.itbisIncluido, false);
        const mov = applyReceiptOcrToMovement({}, n);
        testRunner.assertEquals(mov.itbisIncluido, false);
        testRunner.assertEquals(mov.propina, 1);
        testRunner.assertEquals(normalizeReceiptOcr({ total: 1 }).fiscal.itbisIncluido, null);
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

    'guarda la posición de cada dato en la foto si el lector la envía (boxes)'() {
        const normalized = normalizeReceiptOcr({
            total: 590,
            fecha: '2026-10-05',
            boxes: { total: [880, 100, 910, 900], fecha: [120, 600, 140, 900], ncf: [1, 2, 3], emisor: 'x' }
        });
        testRunner.assertEquals(JSON.stringify(normalized.fiscal.boxes), JSON.stringify({ total: [880, 100, 910, 900], date: [120, 600, 140, 900] }));
        const movement = applyReceiptOcrToMovement({ amount: 0 }, normalized);
        testRunner.assertEquals(JSON.stringify(movement.ocrBoxes.date), JSON.stringify([120, 600, 140, 900]));
        const plain = applyReceiptOcrToMovement({ amount: 0 }, normalizeReceiptOcr({ total: 10 }));
        testRunner.assertEquals(plain.ocrBoxes, undefined);
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
        testRunner.assertEquals(body.fileBase64, 'YWJj');
        testRunner.assertEquals(body.imageBase64, 'YWJj');
        testRunner.assertEquals(body.mimeType, 'image/jpeg');
        testRunner.assertEquals(result.total, 10);
    },

    async 'envía PDF nativo sin disfrazarlo como imagen'() {
        let body = null;
        await requestReceiptOcr({
            url: 'https://example.test/ocr',
            idToken: 'token',
            fileDataUrl: 'data:application/pdf;base64,JVBERg==',
            mimeType: 'application/pdf',
            fileName: 'factura.pdf',
            fetchImpl: async (_url, options) => {
                body = JSON.parse(options.body);
                return { ok: true, json: async () => ({ ok: true }) };
            }
        });
        testRunner.assertEquals(body.fileBase64, 'JVBERg==');
        testRunner.assertEquals(body.mimeType, 'application/pdf');
        testRunner.assertEquals(body.fileName, 'factura.pdf');
        testRunner.assertEquals(Object.hasOwn(body, 'imageBase64'), false);
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
