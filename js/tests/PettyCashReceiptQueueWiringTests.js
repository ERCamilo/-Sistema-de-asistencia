import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashUI.js'),
    'utf8'
);

function handlerBody(name, nextName) {
    const start = SOURCE.indexOf(`window.${name} =`);
    const end = SOURCE.indexOf(`window.${nextName} =`, start + 1);
    return start >= 0 ? SOURCE.slice(start, end >= 0 ? end : undefined) : '';
}

testRunner.addSuite('Caja chica — conexión de la cola OCR', {

    'el arranque y el evento online reanudan pendientes'() {
        testRunner.assert(/recoverLocalReceiptDrafts/.test(SOURCE),
            'el arranque debe recuperar capturas guardadas antes de cerrar la app');
        testRunner.assert(/processPendingReceiptJobs\(\)/.test(SOURCE),
            'el arranque debe procesar la cola');
        const online = SOURCE.match(/addEventListener\(['"]online['"][\s\S]{0,500}?\n\s*\}\);/);
        testRunner.assert(online && /processPendingReceiptJobs/.test(online[0]),
            'online debe reanudar la cola OCR');
    },

    'el lote guarda primero y delega el OCR al procesador común'() {
        const body = handlerBody('pcBatchPhotos', 'pcPhotoNew');
        testRunner.assert(/saveLocalReceiptCapture/.test(body),
            'cada original debe persistirse antes de procesar');
        testRunner.assert(/processPendingReceiptJobs/.test(body),
            'el lote debe delegar al procesador persistente');
        testRunner.assert(!/\bfetch\s*\(/.test(body),
            'el lote no debe duplicar llamadas directas al webhook');
    },

    'escaneo individual y reescaneo comparten el mismo contrato OCR'() {
        const scan = handlerBody('pcScanReceipt', 'pcPhotoEdit');
        const rescan = handlerBody('pcRescanReceipt', 'pcBatchPhotos');
        testRunner.assert(/requestReceiptOcr/.test(scan), 'escaneo individual usa requestReceiptOcr');
        testRunner.assert(/requestReceiptOcr/.test(rescan), 'reescaneo usa requestReceiptOcr');
        testRunner.assert(/normalizeReceiptOcr/.test(scan), 'escaneo individual normaliza la respuesta');
        testRunner.assert(/normalizeReceiptOcr/.test(rescan), 'reescaneo normaliza la respuesta');
    },

    'la UI expone un control para continuar pendientes'() {
        testRunner.assert(/function _receiptQueueBanner/.test(SOURCE), 'debe renderizar el indicador de cola');
        testRunner.assert(/pcContinueReceiptQueue/.test(SOURCE), 'debe registrar el control Continuar pendientes');
    }

});
