/**
 * Enderezar una factura a mano desde el editor: abre la foto original, deja ajustar las cuatro
 * esquinas y deja la foto enderezada «en espera» (se guarda al confirmar el gasto, igual que
 * cambiar la foto). Nada se escribe en el gasto ni en el teléfono hasta ese momento.
 */
import { createStraightenFlow, decodeToCanvas, smallImageData, straightenedName } from '../modules/features/pettycash/PettyCashStraightenFlow.js';

const corners = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
const jpeg = () => new Blob(['original'], { type: 'image/jpeg' });
const mov = () => ({ id: 'g1', type: 'gasto', periodId: 'p1', hasReceipt: true, receiptStatus: 'local', ocrBoxes: { total: [700, 200, 800, 600] }, manualBoxes: {} });

const setup = (over = {}) => {
    const d = { _editSource: { url: 'blob:original', mime: 'image/jpeg', objectUrl: true }, _editorUi: { field: 'total', view: { s: 3, x: -4, y: -9 }, viewKey: 'total', draft: {} } };
    const movement = mov();
    let onApply; let editorArgs;
    const deps = {
        doc: document,
        getState: () => d,
        getMovement: () => movement,
        isClosed: () => false,
        resolveOriginal: jest.fn(async () => ({ ok: true, blob: jpeg(), name: 'factura-12.jpg' })),
        decode: jest.fn(async () => ({ width: 1000, height: 1400 })),
        suggest: jest.fn(() => ({ corners, source: 'quad' })),
        straighten: jest.fn(async () => ({ width: 800, height: 1200 })),
        encode: jest.fn(async () => new Blob(['recta'], { type: 'image/webp' })),
        prepareCapture: jest.fn(async (file) => ({ originalBlob: file, originalName: file.name, originalType: file.type, previewDataUrl: 'data:image/jpeg;base64,PV' })),
        openEditor: jest.fn((args) => { editorArgs = args; onApply = args.onApply; return { close: jest.fn() }; }),
        notify: jest.fn(),
        repaint: jest.fn(),
        releaseSource: jest.fn(),
        reloadSource: jest.fn(),
        readDraft: jest.fn(() => ({ pce_total: '10' })),
        createObjectUrl: jest.fn(() => 'blob:recta'),
        ...over
    };
    return { d, movement, deps, flow: createStraightenFlow(deps), apply: (c = corners) => onApply(c), editorArgs: () => editorArgs };
};

describe('abrir el editor de esquinas', () => {
    test('baja la foto original, la decodifica una vez y abre la capa con las esquinas sugeridas', async () => {
        const { flow, deps, editorArgs } = setup();
        await flow.start();
        expect(deps.resolveOriginal).toHaveBeenCalledWith('g1');
        expect(deps.decode).toHaveBeenCalledTimes(1);
        expect(deps.openEditor).toHaveBeenCalledTimes(1);
        expect(editorArgs().corners).toEqual(corners);
        expect(editorArgs().canvas).toEqual({ width: 1000, height: 1400 });
    });
    test('«Automático» vuelve a calcular las esquinas', async () => {
        const { flow, deps, editorArgs } = setup();
        await flow.start();
        deps.suggest.mockReturnValueOnce({ corners: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], source: 'rect' });
        expect(editorArgs().onAuto()[0]).toEqual([0.2, 0.2]);
    });
    test('periodo cerrado, PDF, sin foto o solo con la miniatura: avisa y no abre nada', async () => {
        for (const [label, over, expected] of [
            ['cerrado', { isClosed: () => true }, /cerrado/i],
            ['sin foto', { getMovement: () => ({ ...mov(), hasReceipt: false, receiptStatus: null }) }, /foto/i]
        ]) {
            const { flow, deps } = setup(over);
            await flow.start();
            expect(deps.openEditor).not.toHaveBeenCalled();
            expect(deps.notify).toHaveBeenCalledWith(expect.stringMatching(expected), expect.any(String));
            expect(label).toBeTruthy();
        }
        const pdf = setup(); pdf.d._editSource = { url: 'blob:x', mime: 'application/pdf' };
        await pdf.flow.start();
        expect(pdf.deps.openEditor).not.toHaveBeenCalled();
        const reduced = setup(); reduced.d._editSource = { url: 'data:x', mime: 'image/jpeg', reduced: true };
        await reduced.flow.start();
        expect(reduced.deps.openEditor).not.toHaveBeenCalled();
        expect(reduced.deps.notify).toHaveBeenCalledWith(expect.stringMatching(/original/i), expect.any(String));
    });
    test('si no se puede bajar la original, avisa y no usa la miniatura', async () => {
        const { flow, deps } = setup({ resolveOriginal: jest.fn(async () => ({ ok: false, reason: 'no-original' })) });
        await flow.start();
        expect(deps.openEditor).not.toHaveBeenCalled();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringMatching(/original/i), expect.any(String));
    });
    test('si la foto no se puede abrir (memoria, formato), avisa y no se queda a medias', async () => {
        const { flow, deps } = setup({ decode: jest.fn(async () => { throw new Error('sin memoria'); }) });
        await flow.start();
        expect(deps.openEditor).not.toHaveBeenCalled();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringMatching(/no se pudo/i), 'error');
        // y se puede volver a intentar
        deps.decode.mockResolvedValueOnce({ width: 10, height: 10 });
        await flow.start();
        expect(deps.openEditor).toHaveBeenCalledTimes(1);
    });
    test('pulsar dos veces seguidas no abre dos capas', async () => {
        const { flow, deps } = setup();
        await Promise.all([flow.start(), flow.start()]);
        expect(deps.openEditor).toHaveBeenCalledTimes(1);
    });
    test('con otra foto elegida (en espera) se parte de esa foto aunque la fuente aún no esté cargada', async () => {
        const { flow, d, deps } = setup();
        d._editSource = undefined;
        d._editPhotoCapture = { originalBlob: jpeg(), originalName: 'otra.jpg', originalType: 'image/jpeg', receiptKind: 'image' };
        await flow.start();
        expect(deps.resolveOriginal).not.toHaveBeenCalled();
        expect(deps.openEditor).toHaveBeenCalledTimes(1);
        expect(deps.notify).not.toHaveBeenCalledWith(expect.stringMatching(/cargando/i), expect.any(String));
    });
    test('si la foto elegida en espera es un PDF, avisa que no se puede enderezar', async () => {
        const { flow, d, deps } = setup();
        d._editSource = undefined;
        d._editPhotoCapture = { originalBlob: new Blob(['x'], { type: 'application/pdf' }), originalName: 'f.pdf', originalType: 'application/pdf', receiptKind: 'pdf' };
        await flow.start();
        expect(deps.openEditor).not.toHaveBeenCalled();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringMatching(/PDF/), 'info');
    });
    test('una foto vieja guardada como data URL también se puede enderezar', async () => {
        const dataUrl = 'data:image/jpeg;base64,AAAA';
        const { flow, deps } = setup({ resolveOriginal: jest.fn(async () => ({ ok: true, dataUrl, type: 'image/jpeg', name: 'vieja.jpg' })), blobFromDataUrl: jest.fn(async () => jpeg()) });
        await flow.start();
        expect(deps.blobFromDataUrl).toHaveBeenCalledWith(dataUrl);
        expect(deps.openEditor).toHaveBeenCalled();
    });
});

describe('enderezar: la foto queda en espera', () => {
    test('deja la foto enderezada como la nueva foto del gasto, en alta resolución y con su vista previa', async () => {
        const { flow, d, deps, apply } = setup();
        await flow.start();
        expect(await apply()).toBe(true);
        expect(deps.straighten).toHaveBeenCalledWith({ width: 1000, height: 1400 }, corners);
        expect(d._editPhotoCapture.originalBlob).toBeInstanceOf(Blob);
        expect(d._editPhotoCapture.originalBlob.type).toBe('image/webp');
        expect(d._editPhoto).toBe('data:image/jpeg;base64,PV');
        // el visor, la descarga y el compartir usan la foto grande, no la miniatura
        expect(d._editSource).toMatchObject({ url: 'blob:recta', mime: 'image/webp', objectUrl: true, staged: true });
        expect(deps.releaseSource).toHaveBeenCalled();
    });
    test('el archivo conserva el nombre de la factura y se nota que es la enderezada', async () => {
        const { flow, d, apply } = setup();
        await flow.start();
        await apply();
        expect(d._editPhotoCapture.originalName).toBe('factura-12-recta.webp');
        expect(straightenedName('factura.jpg', 'image/jpeg')).toBe('factura-recta.jpg');
        expect(straightenedName('factura-recta.jpg', 'image/jpeg')).toBe('factura-recta.jpg');
        expect(straightenedName(null, 'image/webp')).toBe('factura-recta.webp');
    });
    test('los recuadros pasan a la foto nueva, quedan en espera y el gasto no se toca', async () => {
        const { flow, d, movement, apply } = setup();
        await flow.start();
        await apply([[0, 0.5], [1, 0.5], [1, 1], [0, 1]]);
        expect(d._editBoxes.ocrBoxes.total).toEqual([400, 200, 600, 600]);
        expect(movement.ocrBoxes).toEqual({ total: [700, 200, 800, 600] });
    });
    test('al enderezar otra vez se parte de lo ya enderezado y de sus recuadros', async () => {
        const { flow, d, deps, apply } = setup();
        await flow.start();
        await apply([[0, 0.5], [1, 0.5], [1, 1], [0, 1]]);
        deps.resolveOriginal.mockClear();
        await flow.start();
        expect(deps.resolveOriginal).not.toHaveBeenCalled();                    // usa la foto en espera, no la baja otra vez
        const second = deps.openEditor.mock.calls[1][0];
        await second.onApply([[0, 0], [1, 0], [1, 1], [0, 1]]);          // sin recortar nada: los recuadros ya enderezados se conservan
        expect(d._editBoxes.ocrBoxes.total).toEqual([400, 200, 600, 600]);
    });
    test('si el gasto abierto cambió mientras la capa estaba abierta, no se deja nada en espera', async () => {
        let current = mov();
        const { flow, d, apply } = setup({ getMovement: () => current });
        await flow.start();
        current = { ...mov(), id: 'g2' };
        await expect(apply()).rejects.toThrow(/cambió/i);
        expect(d._editPhotoCapture).toBeUndefined();
        expect(d._editBoxes).toBeUndefined();
    });
    test('lo que queda en espera dice a qué gasto pertenece', async () => {
        const { flow, d, apply } = setup();
        await flow.start();
        await apply();
        expect(d._editPhotoFor).toBe('g1');
    });
    test('el zoom del visor se reinicia (la foto es otra) y se conserva lo escrito en el formulario', async () => {
        const { flow, d, deps, apply } = setup();
        await flow.start();
        await apply();
        expect(d._editorUi.view).toBeNull();
        expect(d._editorUi.viewKey).toBeNull();
        expect(d._editorUi.draft).toEqual({ pce_total: '10' });
        expect(deps.repaint).toHaveBeenCalled();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringMatching(/confirm/i), 'success');
    });
    test('si algo falla al procesar, no queda nada en espera y se avisa a la capa', async () => {
        const { flow, d, apply } = setup({ straighten: jest.fn(async () => null) });
        await flow.start();
        await expect(apply()).rejects.toThrow();
        expect(d._editPhotoCapture).toBeUndefined();
        expect(d._editBoxes).toBeUndefined();
        expect(d._editSource.url).toBe('blob:original');
    });
    test('si preparar la captura falla, tampoco queda nada a medias', async () => {
        const { flow, d, apply } = setup({ prepareCapture: jest.fn(async () => { throw new Error('archivo inválido'); }) });
        await flow.start();
        await expect(apply()).rejects.toThrow('archivo inválido');
        expect(d._editPhotoCapture).toBeUndefined();
        expect(d._editSource.url).toBe('blob:original');
    });
});

describe('volver a la foto original', () => {
    test('descarta la foto, los recuadros y la fuente en espera, y recarga la original', async () => {
        const { flow, d, deps, apply } = setup();
        await flow.start();
        await apply();
        flow.undo();
        expect(d._editPhoto).toBeNull();
        expect(d._editPhotoCapture).toBeNull();
        expect(d._editBoxes).toBeNull();
        expect(deps.releaseSource).toHaveBeenCalledTimes(2);
        expect(deps.reloadSource).toHaveBeenCalledTimes(1);
    });
});

describe('decodeToCanvas', () => {
    const fakeDoc = () => {
        const made = [];
        return { made, createElement: () => { const ctx = { drawImage: jest.fn() }; const c = { width: 0, height: 0, getContext: () => ctx, ctx }; made.push(c); return c; } };
    };
    test('dibuja la foto con su orientación y no más grande que el tope', async () => {
        const doc = fakeDoc();
        const bitmap = { width: 4000, height: 6000, close: jest.fn() };
        const createBitmap = jest.fn(async () => bitmap);
        const canvas = await decodeToCanvas(new Blob(['x']), { doc, createBitmap, maxSide: 3000 });
        expect(createBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
        expect(Math.max(canvas.width, canvas.height)).toBe(3000);
        expect(canvas.width / canvas.height).toBeCloseTo(4000 / 6000, 2);
        expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, canvas.width, canvas.height);
        expect(bitmap.close).toHaveBeenCalled();
    });
    test('una foto pequeña no se agranda', async () => {
        const doc = fakeDoc();
        const canvas = await decodeToCanvas(new Blob(['x']), { doc, createBitmap: async () => ({ width: 800, height: 1000, close() {} }), maxSide: 3000 });
        expect([canvas.width, canvas.height]).toEqual([800, 1000]);
    });
    test('si el navegador no puede decodificar, falla con un error claro', async () => {
        await expect(decodeToCanvas(new Blob(['x']), { doc: fakeDoc(), createBitmap: async () => { throw new Error('bad'); } })).rejects.toThrow(/abrir la foto/i);
    });
});

describe('smallImageData', () => {
    test('saca una copia pequeña de la foto para buscar el papel', () => {
        const ctx = { drawImage: jest.fn(), getImageData: jest.fn(() => ({ width: 240, height: 336 })) };
        const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
        const out = smallImageData({ width: 3000, height: 4200 }, { doc });
        expect(out).toEqual({ width: 240, height: 336 });
        expect(ctx.drawImage).toHaveBeenCalledWith({ width: 3000, height: 4200 }, 0, 0, 240, 336);
    });
});
