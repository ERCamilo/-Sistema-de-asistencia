/**
 * 🧪 ReceiptRetentionTests (Auditoría 2026-06-09, hallazgo M4)
 *
 * Política vigente: el original local NO se poda mientras la recuperación
 * remota no esté disponible y el usuario no haya confirmado el movimiento.
 * La miniatura vive en un campo separado y nunca reemplaza el único original.
 *
 * Contratos / comportamiento:
 *   - receiptThumbnailScale capa imágenes grandes a maxDim y deja las pequeñas
 *     en escala 1 (función pura, testeable sin canvas).
 *   - uploadPendingReceipts no llama downscaleDataUrl en el camino de éxito.
 *   - las capturas nuevas usan saveReceiptOriginal y quedan local-only.
 *   - eliminar un movimiento borra su comprobante (cascade) en los 3 sitios.
 */

import fs from 'fs';
import path from 'path';

const PHOTO = jest.requireActual('../modules/features/pettycash/PettyCashPhoto.js');
const UI_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashUI.js'), 'utf8'
);

testRunner.addSuite("Comprobantes — escala de miniatura (M4)", {

    "una imagen grande se reduce a maxDim (escala < 1)"() {
        const scale = PHOTO.receiptThumbnailScale(2000, 1000, 480);
        testRunner.assert(scale > 0 && scale < 1, 'debe reducir una imagen de 2000px');
        // 2000 * scale ≈ 480
        testRunner.assert(Math.round(2000 * scale) <= 480,
            'el lado mayor reducido no debe exceder maxDim');
    },

    "una imagen pequeña no se agranda (escala 1)"() {
        const scale = PHOTO.receiptThumbnailScale(300, 200, 480);
        testRunner.assertEquals(scale, 1, 'una imagen menor a maxDim conserva su tamaño');
    },

    "usa el lado MAYOR para decidir la escala (vertical)"() {
        const scale = PHOTO.receiptThumbnailScale(1000, 3000, 480);
        testRunner.assert(Math.round(3000 * scale) <= 480,
            'debe escalar por el alto cuando es el lado mayor');
    },

    "tolera dimensiones inválidas devolviendo escala 1"() {
        testRunner.assertEquals(PHOTO.receiptThumbnailScale(0, 0, 480), 1, '0x0 → escala 1 (no NaN/Infinity)');
        testRunner.assertEquals(PHOTO.receiptThumbnailScale(undefined, undefined, 480), 1, 'undefined → escala 1');
    }

});

testRunner.addSuite("Comprobantes — conservación del original + cascada al borrar", {

    "downscaleDataUrl está disponible para podar la copia local"() {
        testRunner.assert(typeof PHOTO.downscaleDataUrl === 'function',
            'debe existir downscaleDataUrl(dataUrl, maxDim, quality) para generar la miniatura');
    },

    "uploadPendingReceipts conserva la copia completa hasta habilitar recuperación remota"() {
        const block = UI_SRC.match(/export async function uploadPendingReceipts[\s\S]{0,2200}?\n\}/);
        testRunner.assert(!!block, 'uploadPendingReceipts debe existir');
        testRunner.assert(!/downscaleDataUrl\s*\(\s*rec\./.test(block[0]),
            'la subida no debe reemplazar el original por una miniatura');
        testRunner.assert(/updateReceiptJob/.test(block[0]),
            'debe actualizar únicamente el estado del registro existente');
    },

    "las capturas nuevas persisten original y miniatura como recursos separados"() {
        testRunner.assert(/saveReceiptOriginal/.test(UI_SRC),
            'la UI debe usar saveReceiptOriginal para las capturas nuevas');
        testRunner.assert(/receiptStorage\s*=\s*['"]local-only['"]|receiptStorage:\s*['"]local-only['"]/.test(UI_SRC),
            'el movimiento debe declarar que la imagen sólo está local');
        testRunner.assert(/originalBlob/.test(UI_SRC) && /previewDataUrl/.test(UI_SRC),
            'la preparación debe separar original y miniatura');
    },

    "eliminar un movimiento borra su comprobante (cascade, 3 sitios)"() {
        const cascades = UI_SRC.match(/if\s*\(\s*m?o?v?\.?receiptStatus\s*\)\s*indexedDBService\.deleteReceipt/g) || [];
        testRunner.assert(cascades.length >= 3,
            'los handlers de borrado deben hacer cascade deleteReceipt (esperados 3)');
    }

});
