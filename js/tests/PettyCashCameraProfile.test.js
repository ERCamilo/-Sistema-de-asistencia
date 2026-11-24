/**
 * Versiones de la cámara de facturas: la 2.0 es la de siempre (activa por defecto) y la 2.1
 * es la prueba con más resolución, recorte más ajustado, mejor enfoque y revisión rápida.
 */
import { CAMERA_V2, CAMERA_V21, cameraProfile, receiptCameraEnabled } from '../modules/features/pettycash/PettyCashCameraProfile.js';

describe('receiptCameraEnabled: la cámara de la app está activa por defecto', () => {
    test('sin ajuste guardado, activa', () => {
        expect(receiptCameraEnabled({})).toBe(true);
        expect(receiptCameraEnabled(undefined)).toBe(true);
    });
    test('si la persona la apagó, se respeta', () => {
        expect(receiptCameraEnabled({ newReceiptCamera: false })).toBe(false);
        expect(receiptCameraEnabled({ newReceiptCamera: true })).toBe(true);
    });
});

describe('cameraProfile', () => {
    test('por defecto la 2.0; la 2.1 solo con su interruptor', () => {
        expect(cameraProfile({})).toBe(CAMERA_V2);
        expect(cameraProfile(null)).toBe(CAMERA_V2);
        expect(cameraProfile({ receiptCamera21: true })).toBe(CAMERA_V21);
        expect(cameraProfile({ receiptCamera21: 'true' })).toBe(CAMERA_V2);
    });
    test('la 2.0 conserva los valores de siempre', () => {
        expect(CAMERA_V2).toMatchObject({
            version: '2.0',
            photo: { maxLongSide: 3000, maxPixels: Infinity, quality: 0.9 },
            paperMargin: 0.06, straightenMargin: 0.05, stitchWidth: 1600,
            video: { width: 1920, height: 1440 }, ocrMaxWidth: 2400,
            preview: { maxDim: 480, quality: 0.5, webp: false },
            focusAtPoint: false, quickReview: false
        });
    });
    test('la 2.1: más resolución sin más peso, recorte ajustado, enfoque y revisión rápida', () => {
        expect(CAMERA_V21).toMatchObject({
            version: '2.1',
            photo: { maxLongSide: 4096, maxPixels: 8_400_000, quality: 0.86 },
            paperMargin: 0.03, straightenMargin: 0.025, stitchWidth: 1800,
            video: { width: 2560, height: 1920 }, ocrMaxWidth: 2800,
            preview: { maxDim: 720, quality: 0.7, webp: true },
            focusAtPoint: true, quickReview: true
        });
    });
    test('no se pueden modificar por accidente', () => {
        expect(Object.isFrozen(CAMERA_V21)).toBe(true);
        expect(Object.isFrozen(CAMERA_V21.photo)).toBe(true);
    });
});
