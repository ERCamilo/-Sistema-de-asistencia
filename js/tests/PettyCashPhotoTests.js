/**
 * 🧪 PettyCashPhotoTests
 *
 * Solo se testea la parte PURA (la ruta de Storage). La compresión/subida/
 * visor usan APIs de navegador (canvas, Firebase Storage) y se verifican
 * manualmente en la app.
 */

import {
    receiptStoragePath,
    cloneOriginalReceipt,
    blobToDataUrl,
    receiptMimeType,
    isPdfReceipt,
    validateReceiptFile,
    prepareReceiptForOcr,
    RECEIPT_MAX_PDF_BYTES
} from '../modules/features/pettycash/PettyCashPhoto.js';

testRunner.addSuite("PettyCashPhoto — receiptStoragePath", {

    "construye la ruta por usuario y txId"() {
        testRunner.assertEquals(
            receiptStoragePath('uid123', 'mov-abc'),
            'users/uid123/receipts/mov-abc.jpg'
        );
    },

    "sin uid o txId retorna null (defensa)"() {
        testRunner.assertEquals(receiptStoragePath('', 'm1'), null);
        testRunner.assertEquals(receiptStoragePath('u1', ''), null);
        testRunner.assertEquals(receiptStoragePath(null, null), null);
    }

});

testRunner.addSuite("PettyCashPhoto — original local", {

    "clona el Blob sin reducir tamaño ni cambiar MIME"() {
        const source = new Blob(['factura-original'], { type: 'image/jpeg' });
        const copy = cloneOriginalReceipt(source);
        testRunner.assert(copy instanceof Blob, 'debe devolver un Blob');
        testRunner.assertEquals(copy.size, source.size, 'debe conservar todos los bytes');
        testRunner.assertEquals(copy.type, source.type, 'debe conservar el MIME type');
    },

    "rechaza entradas que no son archivos binarios"() {
        testRunner.assertEquals(cloneOriginalReceipt(null), null);
        testRunner.assertEquals(cloneOriginalReceipt('data:image/jpeg;base64,abc'), null);
    },

    async "convierte el original a data URL sólo cuando se solicita"() {
        const source = new Blob(['abc'], { type: 'image/jpeg' });
        const result = await blobToDataUrl(source);
        testRunner.assert(
            typeof result === 'string' && result.startsWith('data:image/jpeg;base64,'),
            'debe producir un data URL JPEG'
        );
    }

});

testRunner.addSuite("PettyCashPhoto — documentos PDF", {

    "detecta PDF por MIME o por extensión"() {
        const byMime = Object.assign(new Blob(['pdf'], { type: 'application/pdf' }), { name: 'factura' });
        const byName = Object.assign(new Blob(['pdf']), { name: 'factura.PDF' });
        testRunner.assertEquals(receiptMimeType(byMime), 'application/pdf');
        testRunner.assertEquals(receiptMimeType(byName), 'application/pdf');
        testRunner.assertEquals(isPdfReceipt(byName), true);
    },

    "rechaza PDF que supera 10 MB"() {
        let failed = false;
        try {
            validateReceiptFile({
                name: 'grande.pdf',
                type: 'application/pdf',
                size: RECEIPT_MAX_PDF_BYTES + 1,
                slice() {}
            });
        } catch (error) {
            failed = /10 MB/.test(error.message);
        }
        testRunner.assert(failed, 'debe aplicar el límite antes de persistir o enviar');
    },

    async "conserva el PDF original para OCR sin convertirlo a imagen"() {
        const source = Object.assign(
            new Blob(['%PDF-1.7 original'], { type: 'application/pdf' }),
            { name: 'factura.pdf' }
        );
        const prepared = await prepareReceiptForOcr(source);
        testRunner.assertEquals(prepared.mimeType, 'application/pdf');
        testRunner.assert(
            prepared.fileDataUrl.startsWith('data:application/pdf;base64,'),
            'el OCR debe recibir el PDF original'
        );
    }

});

console.log('🧪 PettyCashPhoto tests cargados.');
