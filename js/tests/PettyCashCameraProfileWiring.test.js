/**
 * La pantalla de Caja chica usa la versión de cámara de los ajustes: la 2.0 por defecto y la
 * 2.1 con su interruptor. Con la 2.1, la vista previa y lo que va al lector se preparan con sus
 * valores, y el ancho del lector queda guardado con la foto para cuando la cola la lea.
 */
import { prepareReceiptCapture } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';
import { CAMERA_V2, CAMERA_V21 } from '../modules/features/pettycash/PettyCashCameraProfile.js';

jest.mock('../modules/features/pettycash/PettyCashPhoto.js', () => ({
    ...jest.requireActual('../modules/features/pettycash/PettyCashPhoto.js'),
    prepareReceiptForOcr: jest.fn(),
    createReceiptPreview: jest.fn(),
    requestPersistentReceiptStorage: jest.fn(async () => true)
}));
import { createReceiptPreview } from '../modules/features/pettycash/PettyCashPhoto.js';

const file = () => new File(['x'], 'factura.webp', { type: 'image/webp' });
beforeEach(() => {
    createReceiptPreview.mockReset().mockResolvedValue({ previewDataUrl: 'data:image/webp;base64,PV', processingDataUrl: 'data:image/jpeg;base64,P', pageCount: 1 });
});
afterEach(() => { state.settings = {}; });

test('por defecto (cámara 2.0): vista previa y lector como siempre', async () => {
    state.settings = {};
    const capture = await prepareReceiptCapture(file());
    expect(createReceiptPreview).toHaveBeenCalledWith(expect.any(Blob), { preview: CAMERA_V2.preview, ocrMaxWidth: 2400 });
    expect(capture.ocrMaxWidth).toBe(2400);
});

test('cámara 2.1: vista previa de 720 px en WebP y 2800 px para el lector', async () => {
    state.settings = { receiptCamera21: true };
    const capture = await prepareReceiptCapture(file());
    expect(createReceiptPreview).toHaveBeenCalledWith(expect.any(Blob), { preview: CAMERA_V21.preview, ocrMaxWidth: 2800 });
    expect(capture.ocrMaxWidth).toBe(2800);
});
