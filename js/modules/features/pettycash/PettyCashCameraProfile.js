/**
 * Versiones de la cámara de facturas.
 *
 * - 2.0: la de siempre. Es la cámara por defecto de Caja chica (se puede apagar en
 *   Configuración → Pruebas para usar la cámara del teléfono).
 * - 2.1: prueba en Configuración → Pruebas. Foto limitada por megapíxeles en lugar del lado
 *   largo (las facturas largas y angostas conservan su ancho), WebP algo más comprimido para
 *   que pese lo mismo, recorte con menos fondo, más ancho para el lector y la factura larga,
 *   video de más resolución (iPhone), enfoque y luz en el punto tocado, y revisión rápida con
 *   botones de fecha, total y NCF.
 *
 * Los módulos de foto, recorte, enderezado y unión usan por defecto los valores de la 2.0;
 * la 2.1 los cambia pasando estas opciones.
 *
 * Probado en js/tests/PettyCashCameraProfile.test.js.
 */
const freeze = (profile) => Object.freeze(Object.fromEntries(Object.entries(profile)
    .map(([k, v]) => [k, v && typeof v === 'object' ? Object.freeze(v) : v])));

export const CAMERA_V2 = freeze({
    version: '2.0',
    photo: { maxLongSide: 3000, maxPixels: Infinity, quality: 0.9 },
    paperMargin: 0.06,
    straightenMargin: 0.05,
    stitchWidth: 1600,
    video: { width: 1920, height: 1440 },
    ocrMaxWidth: 2400,
    preview: { maxDim: 480, quality: 0.5, webp: false },
    focusAtPoint: false,
    quickReview: false
});

export const CAMERA_V21 = freeze({
    version: '2.1',
    photo: { maxLongSide: 4096, maxPixels: 8_400_000, quality: 0.86 },
    paperMargin: 0.03,
    straightenMargin: 0.025,
    stitchWidth: 1800,
    video: { width: 2560, height: 1920 },
    ocrMaxWidth: 2800,
    preview: { maxDim: 720, quality: 0.7, webp: true },
    focusAtPoint: true,
    quickReview: true
});

/** Versión de la cámara según los ajustes: la 2.1 solo con su interruptor de Pruebas. */
export function cameraProfile(settings) {
    return settings?.receiptCamera21 === true ? CAMERA_V21 : CAMERA_V2;
}

/** La cámara de la app está activa salvo que la persona la haya apagado. */
export function receiptCameraEnabled(settings) {
    return settings?.newReceiptCamera !== false;
}
