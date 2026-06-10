/**
 * 🧪 ReceiptRetentionTests (Auditoría 2026-06-09, hallazgo M4)
 *
 * Las fotos de comprobantes se acumulaban en IndexedDB sin límite: tras una
 * subida exitosa a Supabase, uploadPendingReceipts guardaba OTRA VEZ el data
 * URL completo (full-res, ~100–500 KB) con status 'uploaded'. El original ya
 * vive en la nube (mov.receiptUrl), así que la copia local full-res es pura
 * acumulación.
 *
 * Fix: tras confirmar la subida, la copia local se reduce a una MINIATURA
 * (downscaleDataUrl) — suficiente para "Ver comprobante" sin romper la UX,
 * pero una fracción del tamaño. El borrado en cascada al eliminar el
 * movimiento ya existía; aquí se verifica que siga.
 *
 * Contratos / comportamiento:
 *   - receiptThumbnailScale capa imágenes grandes a maxDim y deja las pequeñas
 *     en escala 1 (función pura, testeable sin canvas).
 *   - uploadPendingReceipts, en el camino de éxito, reduce a miniatura en vez
 *     de re-guardar el data URL full-res.
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

testRunner.addSuite("Comprobantes — poda tras subir + cascada al borrar (M4)", {

    "downscaleDataUrl está disponible para podar la copia local"() {
        testRunner.assert(typeof PHOTO.downscaleDataUrl === 'function',
            'debe existir downscaleDataUrl(dataUrl, maxDim, quality) para generar la miniatura');
    },

    "uploadPendingReceipts reduce a miniatura tras subir (no re-guarda full-res)"() {
        const block = UI_SRC.match(/export async function uploadPendingReceipts[\s\S]{0,2200}?\n\}/);
        testRunner.assert(!!block, 'uploadPendingReceipts debe existir');
        testRunner.assert(/downscaleDataUrl|thumb/i.test(block[0]),
            'el camino de éxito debe reducir a miniatura (downscaleDataUrl) para no acumular full-res');
        // No debe re-guardar el data URL crudo tal cual con status 'uploaded'.
        testRunner.assert(!/saveReceipt\(\s*rec\.txId\s*,\s*rec\.dataUrl\s*,\s*'uploaded'\s*\)/.test(block[0]),
            'no debe re-guardar rec.dataUrl full-res con status uploaded — eso es la acumulación que arregla M4');
    },

    "eliminar un movimiento borra su comprobante (cascade, 3 sitios)"() {
        const cascades = UI_SRC.match(/if\s*\(\s*m?o?v?\.?receiptStatus\s*\)\s*indexedDBService\.deleteReceipt/g) || [];
        testRunner.assert(cascades.length >= 3,
            'los handlers de borrado deben hacer cascade deleteReceipt (esperados 3)');
    }

});
