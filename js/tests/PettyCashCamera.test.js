/**
 * Cámara de facturas a pantalla completa (prueba, Configuración → Tests).
 *
 * Visor en vivo, disparador, pila de fotos con su estado, bandeja compacta y
 * vista previa por foto. Las fotos entran a la misma cola de caja chica.
 */
import { createReceiptCamera, CAMERA_POLL_MS, RECEIVED_MS, ALIGN_POLL_MS, summarizeCameraItems } from '../modules/features/pettycash/PettyCashCamera.js';

function setup(overrides = {}) {
    const stop = jest.fn();
    const track = overrides.track || { stop };
    if (!track.stop) track.stop = stop;
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
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
        toBitmap: jest.fn(async (blob) => ({ width: 1080, height: 1920, blob })),
        makeBand: jest.fn(() => ({ gray: new Uint8Array(4), rows: 1, width: 4 })),
        drawGhost: jest.fn(),
        checkAlignment: jest.fn(() => ({ aligned: false })),
        stitch: jest.fn(async () => new Blob(['larga'], { type: 'image/jpeg' })),
        ...overrides
    };
    delete deps.track;
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

    test('refrescar sin cambios no vuelve a dibujar la vista previa (no reinicia animaciones)', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        const img = $('[data-pcam-preview] img');
        const sheet = $('[data-pcam-sheet]');
        const scan = $('.pcam-scan');
        await camera.refresh();
        await camera.refresh();
        expect($('[data-pcam-preview] img')).toBe(img);
        expect($('[data-pcam-sheet]')).toBe(sheet);
        expect($('.pcam-scan')).toBe(scan);
        expect($('[data-pcam-photo]').dataset.phase).toBe('reading');
        camera.close();
    });

    test('al llegar el resultado: "Recibido" y luego el sello ✓ con los datos y una vibración', async () => {
        jest.useFakeTimers();
        const { camera, deps, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        deps.vibrate.mockClear();
        states.set('m1', { state: 'ok', issues: [], data: { paidTo: 'Ferretería Sol', total: 'RD$ 590.00' } });
        await camera.refresh();
        expect($('[data-pcam-photo]').dataset.phase).toBe('received');
        expect($('[data-pcam-chip]').textContent).toContain('Recibido');
        expect($('[data-pcam-seal]')).toBeNull();
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        expect($('[data-pcam-photo]').dataset.phase).toBe('done');
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('ok');
        expect($('[data-pcam-seal]').classList.contains('is-static')).toBe(false);
        expect($('[data-pcam-sheet]').textContent).toContain('Ferretería Sol');
        expect($('[data-pcam-chip]').textContent).toContain('Leída');
        expect(deps.vibrate).toHaveBeenCalledWith(20);
        camera.close();
    });

    test('por revisar (!): muestra lo leído frente a lo calculado, los dígitos que faltan y la fecha propuesta', async () => {
        jest.useFakeTimers();
        const { camera, deps, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        states.set('m1', { state: 'review', data: {}, issues: [
            { code: 'itbis-rate', field: 'itbis', message: 'El ITBIS no es el 18% del subtotal.', hint: 'Puede ser correcto si hay artículos exentos o al 16%.', detail: { read: 120, calc: 180, base: 1000 } },
            { code: 'ncf-format', field: 'ncf', message: 'NCF incompleto.', detail: { read: 'B01000012', missing: 2 } },
            { code: 'date-outside-period', field: 'date', message: 'La fecha está fuera del periodo de la caja.', detail: { read: '10/11/2026', suggestion: '2026-10-11' } }
        ] });
        await camera.refresh();
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('review');
        const sheet = $('[data-pcam-sheet]').textContent;
        expect(sheet).toMatch(/Leído\s*120\.00/);
        expect(sheet).toMatch(/Calculado\s*180\.00/);
        expect(sheet).toContain('18% de 1,000.00');
        expect(sheet).toContain('exentos');
        expect(sheet).toContain('B01000012');
        expect(sheet).toContain('faltan 2 dígitos');
        expect(document.querySelectorAll('.pcam-slot')).toHaveLength(2);
        expect(sheet).toContain('10 nov');
        expect(sheet).toContain('11 oct');
        expect(deps.vibrate).toHaveBeenCalledWith([15, 60, 15]);
        camera.close();
    });

    test('sin datos (✕): sello rojo y consejos para retomar la foto', async () => {
        jest.useFakeTimers();
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        states.set('m1', { state: 'failed', issues: [{ code: 'not-read', field: null, message: 'No se obtuvo ningún dato de esta foto.' }], data: {} });
        await camera.refresh();
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('failed');
        expect($('[data-pcam-sheet]').textContent).toContain('No se obtuvo ningún dato');
        expect($('[data-pcam-action="retake"]')).not.toBeNull();
        camera.close();
    });

    test('abrir una foto ya leída muestra su sello quieto en la esquina, sin vibrar', async () => {
        const { camera, deps, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'ok', issues: [], data: {} });
        await camera.refresh();
        deps.vibrate.mockClear();
        camera.openPreview(0);
        expect($('[data-pcam-seal]').classList.contains('is-static')).toBe(true);
        expect($('[data-pcam-photo]').dataset.phase).toBe('done');
        expect(deps.vibrate).not.toHaveBeenCalled();
        camera.close();
    });

    test('zoom: botones + y −, doble toque, y ↕ para facturas largas', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        const zoom = () => $('[data-pcam-zoom]').dataset.zoom;
        expect(zoom()).toBe('1');
        $('[data-pcam-zoom-in]').click();
        expect(zoom()).toBe('2');
        $('[data-pcam-zoom-out]').click();
        expect(zoom()).toBe('1');
        $('[data-pcam-photo]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(Number(zoom())).toBeGreaterThan(1);
        $('[data-pcam-photo]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(zoom()).toBe('1');
        expect($('[data-pcam-zoom-fit]').hidden).toBe(true);
        const img = $('[data-pcam-preview] img');
        Object.defineProperty(img, 'naturalWidth', { value: 400 });
        Object.defineProperty(img, 'naturalHeight', { value: 1600 });
        img.dispatchEvent(new Event('load'));
        expect($('[data-pcam-zoom-fit]').hidden).toBe(false);
        camera.close();
    });

    test('↕ ajusta al ancho aunque ya haya zoom, y al tocarlo otra vez vuelve a la foto completa', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        $('[data-pcam-zoom-in]').click();
        $('[data-pcam-zoom-fit]').click();
        expect($('[data-pcam-zoom-fit]').getAttribute('aria-pressed')).toBe('true');
        expect(Number($('[data-pcam-zoom]').dataset.zoom)).toBeGreaterThan(1);
        $('[data-pcam-zoom-fit]').click();
        expect($('[data-pcam-zoom-fit]').getAttribute('aria-pressed')).toBe('false');
        expect($('[data-pcam-zoom]').dataset.zoom).toBe('1');
        camera.close();
    });

    test('con la parte tomada, el aviso baja para no tapar la franja', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        expect($('[data-pcam-tip]').classList.contains('is-low')).toBe(false);
        $('[data-pcam-shutter]').click(); await flush();
        expect($('[data-pcam-tip]').classList.contains('is-low')).toBe(true);
        camera.close();
    });

    test('con la posición del dato, tocar el aviso enfoca la foto en él', async () => {
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        states.set('m1', { state: 'review', data: {}, issues: [
            { code: 'total-mismatch', field: 'total', message: 'Subtotal + ITBIS no da el total leído.', detail: { read: 1280, calc: 1180 }, box: [880, 100, 910, 900] },
            { code: 'rnc-invalid', field: 'rncEmisor', message: 'El RNC no es válido (dígito verificador).', detail: { read: '101010633', missing: 0 }, box: null }
        ] });
        await camera.refresh();
        camera.openPreview(0);
        const buttons = document.querySelectorAll('[data-pcam-issue]');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toContain('Ver en la foto');
        buttons[0].click();
        expect(Number($('[data-pcam-zoom]').dataset.zoom)).toBeGreaterThan(1);
        const hl = $('[data-pcam-hl]');
        expect(hl.hidden).toBe(false);
        expect(hl.style.top).toBe('88%');
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        $('[data-pcam-zoom-out]').click();
        expect(hl.hidden).toBe(true);
        camera.close();
    });

    test('flash: aparece si la cámara tiene linterna y la enciende/apaga', async () => {
        const applyConstraints = jest.fn().mockResolvedValue();
        const { camera } = setup({ track: { getCapabilities: () => ({ torch: true }), applyConstraints } });
        await camera.open();
        const torch = $('[data-pcam-torch]');
        expect(torch.hidden).toBe(false);
        torch.click(); await flush();
        expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
        expect(torch.getAttribute('aria-pressed')).toBe('true');
        torch.click(); await flush();
        expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
        expect(torch.getAttribute('aria-pressed')).toBe('false');
        camera.close();
    });

    test('flash: sin linterna, el botón no aparece', async () => {
        const { camera } = setup({ track: { getCapabilities: () => ({}) } });
        await camera.open();
        expect($('[data-pcam-torch]').hidden).toBe(true);
        camera.close();
    });

    test('lo que se ve es lo que se guarda: la cámara completa dentro del recuadro, sin nada encima', async () => {
        const { camera } = setup();
        await camera.open();
        const frame = $('[data-pcam-frame]');
        expect(frame).not.toBeNull();
        expect(frame.contains($('[data-pcam-video]'))).toBe(true);
        expect(frame.contains($('[data-pcam-ghost]'))).toBe(true);
        // Los botones no van encima de la imagen que se guarda.
        expect(frame.contains($('[data-pcam-shutter]'))).toBe(false);
        expect(frame.contains($('[data-pcam-long]'))).toBe(false);
        expect($('[data-pcam-guide]')).toBeNull();
        expect($('[data-pcam-tip]').textContent).toContain('recuadro');
        camera.close();
    });

    test('el recuadro toma la forma de la foto (sin recortar la imagen)', async () => {
        const { camera } = setup();
        await camera.open();
        const view = $('[data-pcam-view]');
        Object.defineProperty(view, 'clientWidth', { configurable: true, value: 390 });
        Object.defineProperty(view, 'clientHeight', { configurable: true, value: 560 });
        const video = $('[data-pcam-video]');
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1080 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1920 });
        video.dispatchEvent(new Event('loadedmetadata'));
        const frame = $('[data-pcam-frame]');
        expect(frame.style.width).toBe('315px');
        expect(frame.style.height).toBe('560px');
        // Foto horizontal: se ajusta al ancho.
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
        video.dispatchEvent(new Event('resize'));
        expect(frame.style.width).toBe('390px');
        expect(frame.style.height).toBe('219px');
        camera.close();
    });

    test('factura larga: la franja ya tomada lleva un borde y la marca "ya tomada"', async () => {
        const { camera } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        expect($('[data-pcam-ghost-edge]').hidden).toBe(false);
        expect($('[data-pcam-frame]').contains($('[data-pcam-ghost-edge]'))).toBe(true);
        expect($('[data-pcam-ghost-tag]').textContent).toContain('Ya tomada');
        camera.close();
    });

    test('factura larga: las partes no entran a la cola hasta "Unir"; luego entra una sola foto', async () => {
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        expect($('[data-pcam-long]').getAttribute('aria-pressed')).toBe('true');
        expect($('[data-pcam-done]').textContent).toContain('Unir (0)');
        expect($('[data-pcam-done]').disabled).toBe(true);
        $('[data-pcam-shutter]').click(); await flush();
        expect(deps.capture).not.toHaveBeenCalled();
        expect(deps.drawGhost).toHaveBeenCalled();
        expect($('[data-pcam-ghost]').hidden).toBe(false);
        expect($('[data-pcam-tip]').textContent).toContain('parte 1');
        $('[data-pcam-shutter]').click(); await flush();
        expect($('[data-pcam-done]').textContent).toContain('Unir (2)');
        expect($('[data-pcam-done]').disabled).toBe(false);
        $('[data-pcam-done]').click(); await flush(); await flush();
        expect(deps.stitch).toHaveBeenCalledWith([expect.objectContaining({ width: 1080 }), expect.objectContaining({ width: 1080 })]);
        expect(deps.capture).toHaveBeenCalledTimes(1);
        expect(deps.capture.mock.calls[0][0].name).toMatch(/larga/);
        expect($('[data-pcam-long]').getAttribute('aria-pressed')).toBe('false');
        expect($('[data-pcam-ghost]').hidden).toBe(true);
        expect($('[data-pcam-count]').textContent).toBe('1');
        expect(camera.isOpen()).toBe(true);
        camera.close();
    });

    test('factura larga: avisa en vivo cuando la franja queda alineada', async () => {
        jest.useFakeTimers();
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        deps.vibrate.mockClear();
        deps.checkAlignment.mockReturnValue({ aligned: true });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect($('[data-pcam-ghost]').classList.contains('is-aligned')).toBe(true);
        expect($('[data-pcam-ghost-tag]').textContent).toContain('Alineado');
        expect($('[data-pcam-ghost-edge]').classList.contains('is-aligned')).toBe(true);
        expect(deps.vibrate).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect(deps.vibrate).toHaveBeenCalledTimes(1);
        camera.close();
    });

    test('factura larga: apagar el modo descarta las partes y lo avisa', async () => {
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-long]').click();
        expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('1 parte'), 'info');
        expect($('[data-pcam-ghost]').hidden).toBe(true);
        expect($('[data-pcam-done]').textContent).toBe('Listo');
        camera.close();
    });
});

describe('summarizeCameraItems', () => {
    test('separa las que no se pudieron leer de las que hay que revisar', () => {
        expect(summarizeCameraItems([{ state: 'ok' }, { state: 'review' }, { state: 'failed' }, { state: 'reading' }]))
            .toBe('1 leída · 1 por revisar · 1 sin datos · 1 leyendo');
    });
});
