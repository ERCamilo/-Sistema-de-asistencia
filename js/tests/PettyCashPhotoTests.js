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
    blobToDataUrl
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

console.log('🧪 PettyCashPhoto tests cargados.');
