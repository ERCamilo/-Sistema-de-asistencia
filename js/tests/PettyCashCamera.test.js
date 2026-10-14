/**
 * Cámara de facturas a pantalla completa (prueba, Configuración → Tests).
 *
 * Visor en vivo, disparador, pila de fotos con su estado, bandeja compacta y
 * vista previa por foto. Las fotos entran a la misma cola de caja chica.
 */
import { createReceiptCamera, CAMERA_POLL_MS, RECEIVED_MS, ALIGN_POLL_MS, RESOLVED_ADVANCE_MS, summarizeCameraItems, highlightBox } from '../modules/features/pettycash/PettyCashCamera.js';

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
        onFix: jest.fn().mockResolvedValue(true),
        onRescan: jest.fn().mockResolvedValue(true),
        diag: { record: jest.fn() },
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

    test('mientras toma la foto no dispara dos veces', async () => {
        let release;
        const { camera, deps } = setup({ grabFrame: jest.fn(() => new Promise(r => { release = r; })) });
        await camera.open();
        $('[data-pcam-shutter]').click();
        $('[data-pcam-shutter]').click();
        await flush();
        expect(deps.grabFrame).toHaveBeenCalledTimes(1);
        release(new Blob(['jpg'], { type: 'image/jpeg' }));
        await flush();
        camera.close();
    });

    test('flash y vibración al instante; la siguiente foto no espera a que se guarde la anterior, y se guardan en orden', async () => {
        const releases = [];
        let n = 0;
        const { camera, deps } = setup({ capture: jest.fn(() => new Promise(r => { n += 1; const id = `m${n}`; releases.push(() => r({ id, previewUrl: `data:,${id}` })); })) });
        await camera.open();
        $('[data-pcam-shutter]').click();
        expect(deps.vibrate).toHaveBeenCalledWith(12);
        expect($('[data-pcam-flash]').hidden).toBe(false);
        await flush();
        $('[data-pcam-shutter]').click();
        await flush();
        expect(deps.grabFrame).toHaveBeenCalledTimes(2);
        expect(deps.capture).toHaveBeenCalledTimes(1);
        expect($('[data-pcam-summary]').textContent).toContain('2 guardando');
        releases[0](); await flush(); await flush();
        expect(deps.capture).toHaveBeenCalledTimes(2);
        releases[1](); await flush(); await flush();
        expect(camera.items().map(i => i.id)).toEqual(['m1', 'm2']);
        expect($('[data-pcam-summary]').textContent).not.toContain('guardando');
        camera.close();
    });

    test('si se cierra la cámara mientras se guarda, la foto entra a la cola pero no reaparece en la próxima tanda', async () => {
        let release;
        const { camera, deps } = setup({ capture: jest.fn(() => new Promise(r => { release = r; })) });
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.close();
        await camera.open();
        release({ id: 'm1', previewUrl: 'data:,' }); await flush(); await flush();
        expect(deps.capture).toHaveBeenCalledTimes(1);
        expect(camera.items()).toEqual([]);
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

    test('leída con notas: explica el total y la factura de consumo sin marcarla', async () => {
        jest.useFakeTimers();
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        states.set('m1', { state: 'ok', issues: [], data: { total: 'RD$ 1,062.00' }, notes: [
            { code: 'total-discount', message: 'Cuadra con un descuento de RD$100.00.' },
            { code: 'consumer-invoice', message: 'Factura de consumo: no da crédito fiscal.', hint: 'Si la compra lo permitía, pide la factura con el RNC de la empresa.' }
        ] });
        await camera.refresh();
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('ok');
        expect([...document.querySelectorAll('[data-pcam-info]')].map(n => n.dataset.pcamInfo)).toEqual(['total-discount', 'consumer-invoice']);
        expect($('[data-pcam-sheet]').textContent).toContain('pide la factura con el RNC de la empresa');
        camera.close();
    });

    test('a nombre de otra empresa: RNC del cliente frente al de la empresa', async () => {
        jest.useFakeTimers();
        const { camera, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        camera.openPreview(0);
        states.set('m1', { state: 'review', data: {}, issues: [
            { code: 'client-rnc', field: 'rncCliente', message: 'La factura no está a nombre de la empresa: el RNC del cliente es otro.', hint: 'Sin el RNC de la empresa no sirve para crédito fiscal.', detail: { read: '131246796', expected: '101010632' } }
        ] });
        await camera.refresh();
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        const sheet = $('[data-pcam-sheet]').textContent;
        expect(sheet).toContain('131246796');
        expect(sheet).toContain('101010632');
        expect($('[data-pcam-fix-input]').dataset.validate).toBe('rnc-client');
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

    test('el recuadro del dato lleva margen para no tapar el valor si llega algo corrido', () => {
        expect(highlightBox([880, 100, 910, 900])).toEqual([865, 92, 925, 908]);
        // Recuadro muy delgado (una línea): al menos 8 de alto por lado.
        expect(highlightBox([500, 400, 504, 600])).toEqual([492, 392, 512, 608]);
        // No se sale de la foto.
        expect(highlightBox([2, 0, 20, 1000])).toEqual([0, 0, 29, 1000]);
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
        // Con margen: [880, 100, 910, 900] → [865, 92, 925, 908].
        expect(hl.style.top).toBe('86.5%');
        expect(hl.style.height).toBe('6%');
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

    test('factura larga: lo anterior de la factura se ve arriba del recuadro, y la marca va pequeña en la barra de arriba', async () => {
        const { camera } = setup();
        await camera.open();
        expect($('[data-pcam-ghost-context]').hidden).toBe(true);
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        const context = $('[data-pcam-ghost-context]');
        expect(context.hidden).toBe(false);
        // Fuera del recuadro: no tapa lo que se guarda.
        expect($('[data-pcam-frame]').contains(context)).toBe(false);
        // La marca ya no va sobre la imagen: va en la barra de arriba, en lugar del nombre de la caja.
        expect($('.pcam-top').contains($('[data-pcam-ghost-tag]'))).toBe(true);
        expect($('[data-pcam-frame]').contains($('[data-pcam-ghost-tag]'))).toBe(false);
        expect($('[data-pcam-period]').hidden).toBe(true);
        $('[data-pcam-long]').click();
        expect($('[data-pcam-period]').hidden).toBe(false);
        expect($('[data-pcam-ghost-context]').hidden).toBe(true);
        camera.close();
    });

    test('la vista previa muestra la foto a resolución completa (no la miniatura) y la libera al cerrar', async () => {
        const create = jest.fn(() => 'blob:full-1');
        const revoke = jest.fn();
        const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        try {
            const { camera } = setup();
            await camera.open();
            $('[data-pcam-shutter]').click(); await flush();
            camera.openPreview(0);
            expect($('[data-pcam-preview] img').getAttribute('src')).toBe('blob:full-1');
            // La pila sigue usando la miniatura liviana.
            expect($('.pcam-card').getAttribute('style')).toContain('data:image/jpeg;base64,1');
            camera.close();
            expect(revoke).toHaveBeenCalledWith('blob:full-1');
        } finally {
            URL.createObjectURL = saved.create;
            URL.revokeObjectURL = saved.revoke;
        }
    });

    test('la foto se guarda con la extensión de su formato y la captura recibe la cámara (para la foto del sensor)', async () => {
        const track = { stop: jest.fn() };
        const { camera, deps } = setup({ track, grabFrame: jest.fn().mockResolvedValue(new Blob(['w'], { type: 'image/webp' })) });
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        expect(deps.grabFrame).toHaveBeenCalledWith($('[data-pcam-video]'), track);
        const file = deps.capture.mock.calls[0][0];
        expect(file.type).toBe('image/webp');
        expect(file.name).toMatch(/\.webp$/);
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
        // La franja para alinear en vivo sale del video (igual que lo que se compara), no de la foto del sensor.
        expect(deps.makeBand).toHaveBeenCalledWith($('[data-pcam-video]'));
        expect($('[data-pcam-ghost]').hidden).toBe(false);
        expect($('[data-pcam-tip]').textContent).toContain('parte 1');
        $('[data-pcam-shutter]').click(); await flush();
        expect($('[data-pcam-done]').textContent).toContain('Unir (2)');
        expect($('[data-pcam-done]').disabled).toBe(false);
        $('[data-pcam-done]').click(); await flush(); await flush();
        expect(deps.stitch).toHaveBeenCalledWith([expect.objectContaining({ width: 1080 }), expect.objectContaining({ width: 1080 })], expect.objectContaining({ onInfo: expect.any(Function) }));
        expect(deps.capture).toHaveBeenCalledTimes(1);
        expect(deps.capture.mock.calls[0][0].name).toMatch(/larga/);
        expect($('[data-pcam-long]').getAttribute('aria-pressed')).toBe('false');
        expect($('[data-pcam-ghost]').hidden).toBe(true);
        expect($('[data-pcam-count]').textContent).toBe('1');
        expect(camera.isOpen()).toBe(true);
        camera.close();
    });

    test('factura larga: en vivo dice dónde está el final de la parte anterior y lo marca con una línea', async () => {
        jest.useFakeTimers();
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        const tag = () => $('[data-pcam-ghost-tag]').textContent;
        const marker = $('[data-pcam-match]');
        expect(marker.hidden).toBe(true);

        deps.checkAlignment.mockReturnValue({ aligned: false, status: 'below', yFrac: 0.6 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect(tag()).toContain('Sigue bajando');
        expect(marker.hidden).toBe(false);
        expect(marker.style.top).toBe('72%');

        deps.vibrate.mockClear();
        deps.checkAlignment.mockReturnValue({ aligned: true, status: 'ok', yFrac: 0.2 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect(tag()).toContain('Listo');
        expect(marker.style.top).toBe('32%');
        expect(marker.classList.contains('is-aligned')).toBe(true);
        expect($('[data-pcam-ghost]').classList.contains('is-aligned')).toBe(true);
        expect($('[data-pcam-ghost-edge]').classList.contains('is-aligned')).toBe(true);
        expect($('[data-pcam-shutter]').classList.contains('is-ready')).toBe(true);
        expect(deps.vibrate).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect(deps.vibrate).toHaveBeenCalledTimes(1);

        deps.checkAlignment.mockReturnValue({ aligned: false, status: 'lost', yFrac: null });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        expect(tag()).toContain('No encuentro');
        expect(marker.hidden).toBe(true);
        camera.close();
    });

    test('factura larga: la unión recibe dónde vio la guía el final de cada parte al tomarla (si era confiable)', async () => {
        jest.useFakeTimers();
        const { camera, deps } = setup();
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        deps.checkAlignment.mockReturnValue({ aligned: false, status: 'below', yFrac: 0.7 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        $('[data-pcam-shutter]').click(); await flush();          // parte 2: la guía la veía en 0.7
        deps.checkAlignment.mockReturnValue({ aligned: false, status: 'unsure', yFrac: 0.3 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        $('[data-pcam-shutter]').click(); await flush();          // parte 3: ambigua → sin pista
        jest.useRealTimers();
        $('[data-pcam-done]').click(); await flush(); await flush();
        expect(deps.stitch).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ hints: [0.7, null] }));
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

describe('Cámara de facturas: corregir desde la vista previa', () => {
    const itbis = { code: 'itbis-rate', field: 'itbis', message: 'El ITBIS no es el 18% del subtotal.', detail: { read: 120, calc: 180, base: 1000 } };
    const ncf = { code: 'ncf-format', field: 'ncf', message: 'NCF incompleto.', detail: { read: 'B01000012', missing: 2 } };
    const reviewWith = async (issues, extra = {}) => {
        const ctx = setup(extra);
        await ctx.camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        ctx.states.set('m1', { state: 'review', issues, data: {} });
        await ctx.camera.refresh();
        return ctx;
    };

    test('usar lo calculado guarda el cambio y, si no queda nada, pasa a ✓ con su animación', async () => {
        const ctx = await reviewWith([itbis]);
        ctx.deps.onFix.mockImplementation(async () => { ctx.states.set('m1', { state: 'ok', issues: [], data: {} }); return true; });
        ctx.camera.openPreview(0);
        const use = $('[data-pcam-fix="0:0"]');
        expect(use.textContent).toContain('Usar 180.00');
        ctx.deps.vibrate.mockClear();
        use.click(); await flush(); await flush();
        expect(ctx.deps.onFix).toHaveBeenCalledWith('m1', { patch: { itbis: 180 } });
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('ok');
        expect($('[data-pcam-seal]').classList.contains('is-static')).toBe(false);
        expect(ctx.deps.vibrate).toHaveBeenCalledWith(20);
        ctx.camera.close();
    });

    test('dar por bueno lo leído', async () => {
        const ctx = await reviewWith([itbis]);
        ctx.camera.openPreview(0);
        expect($('[data-pcam-fix="0:1"]').textContent).toContain('Lo leído está bien');
        $('[data-pcam-fix="0:1"]').click(); await flush();
        expect(ctx.deps.onFix).toHaveBeenCalledWith('m1', { accept: 'itbis-rate' });
        ctx.camera.close();
    });

    test('completar el NCF escribiendo: solo se puede guardar cuando es válido', async () => {
        const ctx = await reviewWith([ncf]);
        ctx.camera.openPreview(0);
        const input = $('[data-pcam-fix-input="0:0"]');
        const save = $('[data-pcam-fix="0:0"]');
        expect(input.value).toBe('B01000012');
        expect(save.disabled).toBe(true);
        input.value = 'B0100000123';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(save.disabled).toBe(false);
        expect(input.classList.contains('is-valid')).toBe(true);
        save.click(); await flush();
        expect(ctx.deps.onFix).toHaveBeenCalledWith('m1', { patch: { ncf: 'B0100000123' } });
        ctx.camera.close();
    });

    test('lo escrito no se borra mientras la cámara consulta la cola', async () => {
        const ctx = await reviewWith([ncf]);
        ctx.camera.openPreview(0);
        const input = $('[data-pcam-fix-input="0:0"]');
        input.value = 'B01000012 3';
        await ctx.camera.refresh();
        expect($('[data-pcam-fix-input="0:0"]')).toBe(input);
        expect(input.value).toBe('B01000012 3');
        ctx.camera.close();
    });

    test('con dos avisos, resolver uno deja el otro (sigue por revisar)', async () => {
        const ctx = await reviewWith([itbis, ncf]);
        ctx.deps.onFix.mockImplementation(async () => { ctx.states.set('m1', { state: 'review', issues: [ncf], data: {} }); return true; });
        ctx.camera.openPreview(0);
        $('[data-pcam-fix="0:0"]').click(); await flush(); await flush();
        expect(document.querySelectorAll('.pcam-issue')).toHaveLength(1);
        expect($('[data-pcam-sheet]').textContent).toContain('NCF incompleto');
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('review');
        ctx.camera.close();
    });

    test('"Listo" con pendientes: recorre solo las que faltan y al resolverlas termina', async () => {
        jest.useFakeTimers();
        const ctx = setup();
        await ctx.camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        $('[data-pcam-shutter]').click(); await flush();
        ctx.states.set('m1', { state: 'ok', issues: [], data: {} });
        ctx.states.set('m2', { state: 'review', issues: [itbis], data: {} });
        await ctx.camera.refresh();
        $('[data-pcam-done]').click(); await flush();
        expect(ctx.camera.isOpen()).toBe(true);
        expect(ctx.deps.onFinish).not.toHaveBeenCalled();
        expect($('[data-pcam-counter]').textContent).toContain('Pendiente 1 de 1');
        expect($('[data-pcam-preview] img').getAttribute('src')).toContain('2');
        ctx.deps.onFix.mockImplementation(async () => { ctx.states.set('m2', { state: 'ok', issues: [], data: {} }); return true; });
        $('[data-pcam-fix="0:0"]').click(); await flush(); await flush();
        expect($('[data-pcam-counter]').textContent).toContain('Pendiente 1 de 1');
        jest.advanceTimersByTime(RESOLVED_ADVANCE_MS + 10);
        await flush();
        expect(ctx.camera.isOpen()).toBe(false);
        expect(ctx.deps.onFinish).toHaveBeenCalledWith(['m1', 'm2']);
        expect(ctx.deps.notify).toHaveBeenCalledWith(expect.stringContaining('Todo listo'), 'success');
    });

    test('en pendientes, "Terminar" cierra y deja lo pendiente para después', async () => {
        const ctx = setup();
        await ctx.camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        ctx.states.set('m1', { state: 'failed', issues: [], data: {} });
        await ctx.camera.refresh();
        $('[data-pcam-done]').click(); await flush();
        $('[data-pcam-action="finish"]').click();
        expect(ctx.camera.isOpen()).toBe(false);
        expect(ctx.deps.onFinish).toHaveBeenCalledWith(['m1']);
    });
});

describe('Cámara de facturas: diagnóstico (solo números)', () => {
    const recorded = (deps, type) => deps.diag.record.mock.calls.filter(c => c[0] === type).map(c => c[1]);

    test('cada foto: de dónde salió, cuánto tardó y cuánto pesa', async () => {
        const shot = { origin: 'sensor' };
        const { camera, deps } = setup({ grabFrame: jest.fn().mockResolvedValue(shot), toPhoto: jest.fn().mockResolvedValue(new Blob(['x'.repeat(2048)], { type: 'image/webp' })) });
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush(); await flush();
        const [entry] = recorded(deps, 'shot');
        expect(entry).toMatchObject({ origin: 'sensor', kb: 2, mime: 'image/webp', long: false });
        expect(entry.grabMs).toBeGreaterThanOrEqual(0);
        expect(entry.saveMs).toBeGreaterThanOrEqual(0);
        camera.close();
    });

    test('factura larga: qué decía la guía al tomar cada parte, y la unión', async () => {
        jest.useFakeTimers();
        const stitch = jest.fn(async (bitmaps, opts) => { opts?.onInfo?.({ found: 1, total: 1, height: 3000 }); return new Blob(['l'], { type: 'image/webp' }); });
        const { camera, deps } = setup({ stitch });
        await camera.open();
        $('[data-pcam-long]').click();
        $('[data-pcam-shutter]').click(); await flush();
        deps.checkAlignment.mockReturnValue({ aligned: false, status: 'below', yFrac: 0.7, ncc: 0.9 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        deps.checkAlignment.mockReturnValue({ aligned: true, status: 'ok', yFrac: 0.2, ncc: 0.95 });
        jest.advanceTimersByTime(ALIGN_POLL_MS + 10);
        $('[data-pcam-shutter]').click(); await flush();
        const [part] = recorded(deps, 'part');
        expect(part).toMatchObject({ status: 'ok', ncc: 0.95, checks: 2, bestNcc: 0.95, counts: { below: 1, ok: 1 } });
        expect(part.msToOk).toBeGreaterThanOrEqual(0);
        $('[data-pcam-done]').click(); await flush(); await flush();
        expect(recorded(deps, 'stitch')[0]).toMatchObject({ parts: 2, found: 1, total: 1 });
        camera.close();
    });

    test('el resultado de cada lectura se registra una sola vez, y cada corrección', async () => {
        const { camera, deps, states } = setup();
        await camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        const issue = { code: 'itbis-rate', field: 'itbis', message: 'El ITBIS no es el 18% del subtotal.', detail: { read: 120, calc: 180, base: 1000 } };
        states.set('m1', { state: 'review', issues: [issue], data: {} });
        await camera.refresh();
        await camera.refresh();
        expect(recorded(deps, 'result')).toEqual([{ state: 'review', codes: ['itbis-rate'] }]);
        camera.openPreview(0);
        $('[data-pcam-fix="0:0"]').click(); await flush();
        expect(recorded(deps, 'fix')).toEqual([{ code: 'itbis-rate', kind: 'apply' }]);
        camera.close();
    });
});

describe('summarizeCameraItems', () => {
    test('separa las que no se pudieron leer de las que hay que revisar', () => {
        expect(summarizeCameraItems([{ state: 'ok' }, { state: 'review' }, { state: 'failed' }, { state: 'reading' }]))
            .toBe('1 leída · 1 por revisar · 1 sin datos · 1 leyendo');
    });
});

describe('Cámara de facturas: volver a leer', () => {
    const itbis = { code: 'itbis-rate', field: 'itbis', message: 'El ITBIS no es el 18% del subtotal.', detail: { read: 120, calc: 180, base: 1000 } };
    const withState = async (state, extra = {}) => {
        const ctx = setup(extra);
        await ctx.camera.open();
        $('[data-pcam-shutter]').click(); await flush();
        ctx.states.set('m1', state);
        await ctx.camera.refresh();
        ctx.camera.openPreview(0);
        return ctx;
    };

    test('con avisos o sin datos aparece "Volver a leer"; leída sin avisos, no', async () => {
        let ctx = await withState({ state: 'review', issues: [itbis], data: {} });
        expect($('[data-pcam-action="rescan"]').textContent).toContain('Volver a leer');
        ctx.camera.close();
        ctx = await withState({ state: 'failed', issues: [], data: {} });
        expect($('[data-pcam-action="rescan"]')).not.toBeNull();
        ctx.camera.close();
        ctx = await withState({ state: 'ok', issues: [], data: {} });
        expect($('[data-pcam-action="rescan"]')).toBeNull();
        ctx.camera.close();
    });

    test('la manda otra vez al lector: vuelve a "Leyendo" y muestra el nuevo resultado al llegar', async () => {
        const ctx = await withState({ state: 'review', issues: [itbis], data: {} });
        ctx.deps.onRescan.mockImplementation(async () => { ctx.states.set('m1', { state: 'reading', issues: [], data: {} }); return true; });
        $('[data-pcam-action="rescan"]').click(); await flush();
        expect(ctx.deps.onRescan).toHaveBeenCalledWith('m1');
        expect($('[data-pcam-chip]').textContent).toContain('Leyendo');
        expect($('[data-pcam-wait]')).not.toBeNull();
        expect(ctx.deps.diag.record).toHaveBeenCalledWith('rescan', expect.objectContaining({ from: 'review', codes: ['itbis-rate'] }));

        jest.useFakeTimers();
        ctx.states.set('m1', { state: 'ok', issues: [], data: {} });
        await ctx.camera.refresh();
        expect($('[data-pcam-chip]').textContent).toContain('Recibido');
        jest.advanceTimersByTime(RECEIVED_MS + 10);
        expect($('[data-pcam-seal]').dataset.pcamSeal).toBe('ok');
        // El nuevo resultado también queda en el diagnóstico.
        expect(ctx.deps.diag.record.mock.calls.filter(([type]) => type === 'result')).toHaveLength(2);
        ctx.camera.close();
    });

    test('si no se puede reenviar, avisa y deja el resultado anterior', async () => {
        const ctx = await withState({ state: 'review', issues: [itbis], data: {} }, { onRescan: jest.fn().mockResolvedValue(false) });
        $('[data-pcam-action="rescan"]').click(); await flush();
        expect(ctx.deps.notify).toHaveBeenCalledWith(expect.stringContaining('No se pudo'), 'warning');
        expect($('[data-pcam-chip]').textContent).toContain('Por revisar');
        expect($('[data-pcam-action="rescan"]')).not.toBeNull();
        ctx.camera.close();
    });
});
