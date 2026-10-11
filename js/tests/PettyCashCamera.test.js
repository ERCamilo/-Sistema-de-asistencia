/**
 * Cámara de facturas a pantalla completa (prueba, Configuración → Tests).
 *
 * Visor en vivo, disparador, pila de fotos con su estado, bandeja compacta y
 * vista previa por foto. Las fotos entran a la misma cola de caja chica.
 */
import { createReceiptCamera, CAMERA_POLL_MS } from '../modules/features/pettycash/PettyCashCamera.js';

function setup(overrides = {}) {
    const stop = jest.fn();
    const stream = { getTracks: () => [{ stop }] };
    const states = new Map();
    let n = 0;
    const deps = {
        doc: document,
        mediaDevices: { getUserMedia: jest.fn().mockResolvedValue(stream) },
        grabFrame: jest.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
        capture: jest.fn(async () => { n += 1; return { id: `m${n}`, previewUrl: `data:image/jpeg;base64,${n}` }; }),
        getItemsState: jest.fn(async (ids) => new Map(ids.map(id => [id, states.get(id) || { state: 'reading', issues: [], data: {} }]))),
        onReview: jest.fn(),
        onDelete: jest.fn().mockResolvedValue(true),
        onFinish: jest.fn(),
        notify: jest.fn(),
        vibrate: jest.fn(),
        fallbackPick: jest.fn(),
        periodLabel: () => 'Obra Norte · Caja',
        ...overrides
    };
    const camera = createReceiptCamera(deps);
    return { camera, deps, stop, states };
}

const $ = (sel) => document.querySelector(sel);
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: jest.fn().mockResolvedValue() });
});
afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

describe('Cámara de facturas', () => {
    test('abre a pantalla completa con la cámara trasera y la cierra apagándola', async () => {
        const { camera, deps, stop } = setup();
        await camera.open();
        const dialog = $('[data-pcam]');
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(deps.mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }), audio: false }));
        expect($('[data-pcam-video]').srcObject).toBeTruthy();
        expect(dialog.textContent).toContain('Obra Norte · Caja');
        expect($('[data-pcam-summary]').textContent).toContain('Toma la primera foto');
        camera.close();
        expect(stop).toHaveBeenCalled();
        expect($('[data-pcam]')).toBeNull();
        expect(camera.isOpen()).toBe(false);
    });

    test('sin permiso o sin cámara: avisa y usa la cámara del sistema', async () => {
        const { camera, deps } = setup({ mediaDevices: { getUserMedia: jest.fn().mockRejectedValue(new Error('NotAllowedError')) } });
        await camera.open();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('cámara'), 'warning');
        expect(deps.fallbackPick).toHaveBeenCalled();
        expect(camera.isOpen()).toBe(false);
    });

    test('disparar guarda la foto en la cola, vibra y la suma a la pila', async () => {
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click();
        await flush();
        expect(deps.grabFrame).toHaveBeenCalled();
        const file = deps.capture.mock.calls[0][0];
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('image/jpeg');
        expect(deps.vibrate).toHaveBeenCalled();
        expect($('[data-pcam-count]').textContent).toBe('1');
        expect($('[data-pcam-summary]').textContent).toContain('1 leyendo');
        camera.close();
    });

    test('no dispara dos veces seguidas mientras guarda la anterior', async () => {
        let release;
        const { camera, deps } = setup({ capture: jest.fn(() => new Promise(r => { release = r; })) });
        await camera.open();
        $('[data-pcam-shutter]').click();
        $('[data-pcam-shutter]').click();
        await flush();
        expect(deps.capture).toHaveBeenCalledTimes(1);
        release({ id: 'm1', previewUrl: 'data:,' });
        await flush();
        camera.close();
    });

    test('el estado de cada foto se actualiza solo (leída / por revisar)', async () => {
        jest.useFakeTimers();
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'ok', issues: [], data: { total: 590 } });
        states.set('m2', { state: 'review', issues: [{ code: 'total-mismatch', message: 'Subtotal + ITBIS no da el total leído.' }], data: {} });
        jest.advanceTimersByTime(CAMERA_POLL_MS + 10);
        await flush();
        expect($('[data-pcam-summary]').textContent).toBe('1 leída · 1 por revisar');
        camera.close();
    });

    test('la pila abre una bandeja compacta; cada miniatura abre su vista previa', async () => {
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'ok', issues: [], data: { paidTo: 'Ferretería Sol', ncf: 'B0100000123', total: 590 } });
        await camera.refresh();
        $('[data-pcam-stack]').click();
        const minis = document.querySelectorAll('[data-pcam-thumb]');
        expect(minis).toHaveLength(2);
        expect($('[data-pcam-stack]').getAttribute('aria-expanded')).toBe('true');
        minis[1].click();
        const preview = $('[data-pcam-preview]');
        expect(preview).not.toBeNull();
        expect(preview.textContent).toContain('1 de 2');
        expect(preview.textContent).toContain('Leída');
        expect(preview.textContent).toContain('Ferretería Sol');
        expect(preview.querySelector('img').getAttribute('src')).toBe('data:image/jpeg;base64,1');
        $('[data-pcam-next]').click();
        expect($('[data-pcam-preview]').textContent).toContain('2 de 2');
        expect($('[data-pcam-preview]').textContent).toContain('Leyendo');
        camera.close();
    });

    test('por revisar: muestra los motivos y "Revisar ahora" cierra la cámara y abre el gasto', async () => {
        const { camera, deps, states, stop } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'review', issues: [{ code: 'total-mismatch', message: 'Subtotal + ITBIS no da el total leído.' }], data: {} });
        await camera.refresh();
        camera.openPreview(0);
        expect($('[data-pcam-preview]').textContent).toContain('Subtotal + ITBIS no da el total leído.');
        $('[data-pcam-action="review"]').click();
        expect(stop).toHaveBeenCalled();
        expect(deps.onReview).toHaveBeenCalledWith('m1');
        expect($('[data-pcam]')).toBeNull();
    });

    test('eliminar una foto la quita de la pila', async () => {
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        $('[data-pcam-action="delete"]').click();
        await flush();
        expect(deps.onDelete).toHaveBeenCalledWith('m1');
        expect($('[data-pcam-count]').textContent).toBe('1');
        camera.close();
    });

    test('Escape cierra primero la vista previa y luego la cámara', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect($('[data-pcam-preview]')).toBeNull();
        expect(camera.isOpen()).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(camera.isOpen()).toBe(false);
    });

    test('"Listo" entrega las fotos de la tanda y cierra', async () => {
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-done]').click();
        expect(deps.onFinish).toHaveBeenCalledWith(['m1']);
        expect(camera.isOpen()).toBe(false);
    });

    test('si guardar la foto falla, avisa y la pila no cambia', async () => {
        const { camera, deps } = setup({ capture: jest.fn().mockRejectedValue(new Error('disco lleno')) });
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('No se guardó'), 'warning');
        expect($('[data-pcam-count]').textContent).toBe('0');
        camera.close();
    });

    test('en cola: el mensaje dice por qué espera', async () => {
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'waiting', reason: 'session', issues: [], data: {} });
        await camera.refresh();
        camera.openPreview(0);
        expect($('[data-pcam-preview]').textContent).toContain('inicies sesión');
        expect($('[data-pcam-preview]').textContent).not.toContain('sin conexión');
        camera.close();
    });
});
