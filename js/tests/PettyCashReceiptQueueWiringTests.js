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
        const recovery = SOURCE.match(/async function recoverLocalReceiptDrafts[\s\S]*?\n\}/)?.[0] || '';
        testRunner.assert(/'draft'[\s\S]*?'queued'[\s\S]*?'processing'/.test(recovery),
            'también debe recuperar el corte entre guardar el original y guardar el movimiento');
        testRunner.assert(/processPendingReceiptJobs\(\)/.test(SOURCE),
            'el arranque debe procesar la cola');
        const online = SOURCE.match(/addEventListener\(['"]online['"][\s\S]{0,500}?\n\s*\}\);/);
        testRunner.assert(online && /processPendingReceiptJobs/.test(online[0]),
            'online debe reanudar la cola OCR');
    },

    'el lote guarda primero y delega el OCR al procesador común'() {
        const body = handlerBody('pcBatchPhotos', 'pcPhotoNew');
        const enqueue = SOURCE.match(/async function enqueueReceiptFile[\s\S]*?\n\}/)?.[0] || '';
        testRunner.assert(/enqueueReceiptFile/.test(body),
            'el lote debe reutilizar el guardado común');
        testRunner.assert(/await saveLocalReceiptCapture/.test(enqueue),
            'cada original debe persistirse antes de crear el movimiento');
        testRunner.assert(/await saveMovement/.test(enqueue),
            'el movimiento debe quedar durable antes de procesar');
        testRunner.assert(/processPendingReceiptJobs/.test(body),
            'el lote debe delegar al procesador persistente');
        testRunner.assert(!/\bfetch\s*\(/.test(body),
            'el lote no debe duplicar llamadas directas al webhook');
    },

    'la cámara permite capturas consecutivas y separa galería de archivos'() {
        testRunner.assert(/capture="environment"[\s\S]*?pcCameraBatchPhoto/.test(SOURCE),
            'la cámara debe abrir la captura trasera');
        testRunner.assert(/function _receiptSourcePickerModal/.test(SOURCE),
            'debe existir un selector explícito de origen');
        testRunner.assert(/<span>Galería<\/span>[\s\S]*?accept="image\/\*"[\s\S]*?multiple[\s\S]*?pcBatchPhotos/.test(SOURCE),
            'la galería debe aceptar varias imágenes sin mezclar PDF');
        testRunner.assert(/<span>Archivos \/ PDF<\/span>[\s\S]*?accept="image\/\*,application\/pdf"[\s\S]*?multiple[\s\S]*?pcBatchPhotos/.test(SOURCE),
            'el administrador de archivos debe aceptar imágenes y PDF');
        testRunner.assert(/pcOpenReceiptSourcePicker/.test(SOURCE) && /pcCloseReceiptSourcePicker/.test(SOURCE),
            'el selector debe poder abrirse y cerrarse explícitamente');
        testRunner.assert(/accept="image\/\*,application\/pdf"[\s\S]*?multiple[\s\S]*?pcBatchPhotos/.test(SOURCE),
            'el selector por lote debe aceptar imágenes y PDF');
        testRunner.assert(/function _cameraBatchModal/.test(SOURCE),
            'debe existir el paso Otra foto o Terminar');
        testRunner.assert(/Otra foto/.test(SOURCE) && /pcFinishCameraBatch/.test(SOURCE),
            'la sesión debe permitir continuar o finalizar');
    },

    'si llega otra captura durante el OCR se agenda otro drenado'() {
        const start = SOURCE.indexOf('export async function processPendingReceiptJobs');
        const end = SOURCE.indexOf('async function recoverLocalReceiptDrafts', start);
        const body = SOURCE.slice(start, end);
        testRunner.assert(/receiptQueueRequested\s*=\s*true/.test(body),
            'una nueva captura no debe perderse si el procesador ya está ocupado');
        testRunner.assert(/scheduleReceiptQueueFollowUp/.test(body),
            'al terminar debe drenar capturas paralelas, incluso tras un reintento automático');
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
