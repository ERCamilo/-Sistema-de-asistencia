/**
 * 🧪 PettyCashPhotoTests
 *
 * Solo se testea la parte PURA (la ruta de Storage). La compresión/subida/
 * visor usan APIs de navegador (canvas, Firebase Storage) y se verifican
 * manualmente en la app.
 */

import { receiptStoragePath } from '../modules/features/pettycash/PettyCashPhoto.js';

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

console.log('🧪 PettyCashPhoto tests cargados.');
